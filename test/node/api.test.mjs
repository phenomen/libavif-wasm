import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const distUrl = (file) => pathToFileURL(join(root, "dist", file)).href;

let fresh = 0;
// A query string gives a new module instance, so each test gets its own
// uninitialized loader.
const freshDecode = () => import(`${distUrl("decode.js")}?fresh=${fresh++}`);

describe("init", () => {
  it("rejects decode() before init()", async () => {
    const api = await freshDecode();
    await assert.rejects(() => api.decode(new Uint8Array([1])), /not initialized/);
  });

  it("loads wasmUrl from disk when called with no argument", async () => {
    const api = await freshDecode();
    await api.init();
    const image = await api.decode(await readFile(join(root, "test/fixtures/sample.avif")));
    assert.ok(image.width > 0);
  });

  it("accepts bytes, a file URL, and a promise", async () => {
    const bytes = await readFile(join(root, "dist/decode.wasm"));
    for (const source of [bytes, bytes.buffer, new URL(distUrl("decode.wasm")), Promise.resolve(bytes)]) {
      const api = await freshDecode();
      await api.init(source);
      await assert.rejects(() => api.decode(new Uint8Array([0, 1, 2, 3])), /./);
    }
  });

  it("is idempotent and reuses the first instance", async () => {
    const api = await freshDecode();
    const first = api.init();
    const second = api.init(new WebAssembly.Module(await readFile(api.wasmUrl)));
    await Promise.all([first, second]);
    await api.init();
    assert.ok((await api.decode(await readFile(join(root, "test/fixtures/sample.avif")))).width > 0);
  });

  it("can be retried after a failed init()", async () => {
    const api = await freshDecode();
    await assert.rejects(() => api.init(new Uint8Array([0, 97, 115, 109])), WebAssembly.CompileError);
    await assert.rejects(() => api.init({}), TypeError);
    await api.init();
    assert.ok((await api.decode(await readFile(join(root, "test/fixtures/sample.avif")))).width > 0);
  });
});

describe("encode options and inputs", () => {
  let decodeApi;
  let encodeApi;

  before(async () => {
    decodeApi = await import(distUrl("decode.js"));
    encodeApi = await import(distUrl("encode.js"));
    await decodeApi.init();
    await encodeApi.init();
  });

  function noise(width, height, alpha) {
    const data = new Uint8ClampedArray(width * height * 4);
    let seed = 1;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = seed >>> 24;
      if (!alpha && i % 4 === 3) data[i] = 255;
    }
    return { data, width, height };
  }

  it("lossless round-trips exact RGBA pixels", async () => {
    for (const alpha of [false, true]) {
      const src = noise(33, 17, alpha);
      const avif = await encodeApi.encode(src, { lossless: true, speed: 10 });
      const out = await decodeApi.decode(avif);
      assert.deepEqual(out.data, src.data, `alpha=${alpha}`);
    }
  });

  it("preserves translucent alpha in lossy mode", async () => {
    const width = 16;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([200, 40, 40, 128], i * 4);
    const out = await decodeApi.decode(await encodeApi.encode({ data, width, height }, { speed: 10 }));
    assert.ok(Math.abs(out.data[3] - 128) < 8);
  });

  it("accepts Uint8Array, Node Buffer and plain array pixel data", async () => {
    const { data, width, height } = noise(8, 8, false);
    for (const pixels of [new Uint8Array(data.buffer), Buffer.from(data.buffer), Array.from(data)]) {
      const out = await decodeApi.decode(await encodeApi.encode({ data: pixels, width, height }, { speed: 10 }));
      assert.equal(out.width, 8);
    }
  });

  it("validates options", async () => {
    const src = noise(4, 4, false);
    await assert.rejects(() => encodeApi.encode(src, { quality: Number.NaN }), RangeError);
    await assert.rejects(() => encodeApi.encode(src, { quality: 101 }), RangeError);
    await assert.rejects(() => encodeApi.encode(src, { speed: -1 }), RangeError);
    await assert.rejects(() => encodeApi.encode(src, { subsample: 411 }), TypeError);
    await assert.rejects(() => encodeApi.encode(src, { lossless: true, subsample: 420 }), /444/);
    await assert.rejects(() => encodeApi.encode({ ...src, width: 3.5 }), TypeError);
    await assert.rejects(() => encodeApi.encode({ ...src, data: src.data.subarray(4) }), /expected at least/);
    await assert.rejects(() => decodeApi.decode("not bytes"), TypeError);
  });

  it("grows wasm memory for images larger than the initial heap", async () => {
    // 3000x2000 RGBA is 24 MB, more than decode's 16 MB initial memory.
    const width = 3000;
    const height = 2000;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data.set([x & 255, y & 255, 128, 255], (y * width + x) * 4);
      }
    }
    const out = await decodeApi.decode(await encodeApi.encode({ data, width, height }, { speed: 10 }));
    assert.equal(out.width, width);
    assert.equal(out.height, height);
    assert.equal(out.data.length, width * height * 4);
  });

  it("reports libavif diagnostics for truncated files", async () => {
    const sample = await readFile(join(root, "test/fixtures/sample.avif"));
    await assert.rejects(() => decodeApi.decode(sample.subarray(0, 200)), (err) => {
      assert.match(err.message, /\S/);
      return true;
    });
  });
});
