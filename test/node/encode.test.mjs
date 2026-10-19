import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it, before } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const decodeApi = await import(join(root, "dist/decode.js"));
const encodeApi = await import(join(root, "dist/encode.js"));

function solid(width, height, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

describe("encode + round-trip", () => {
  before(async () => {
    await decodeApi.init(new WebAssembly.Module(await readFile(decodeApi.wasmUrl)));
    await encodeApi.init(new WebAssembly.Module(await readFile(encodeApi.wasmUrl)));
  });

  it("encodes RGBA and decodes back with matching dimensions", async () => {
    const src = solid(16, 12, 30, 180, 90);
    const avif = await encodeApi.encode(src, {
      quality: 80,
      speed: 10,
      subsample: 420,
      bitDepth: 8,
    });
    assert.ok(avif instanceof ArrayBuffer);
    assert.ok(avif.byteLength > 32);
    const header = new Uint8Array(avif).subarray(4, 8);
    assert.equal(Buffer.from(header).toString("ascii"), "ftyp");

    const image = await decodeApi.decode(avif);
    assert.equal(image.width, 16);
    assert.equal(image.height, 12);
    assert.equal(image.data.length, 16 * 12 * 4);
    // Lossy encode of a flat field should stay close to the source color.
    assert.ok(Math.abs(image.data[0] - 30) < 20);
    assert.ok(Math.abs(image.data[1] - 180) < 20);
    assert.ok(Math.abs(image.data[2] - 90) < 20);
    assert.equal(image.data[3], 255);
  });

  it("round-trips the decoded sample fixture", async () => {
    const avif = await readFile(join(root, "test/fixtures/sample.avif"));
    const decoded = await decodeApi.decode(avif.buffer);
    const encoded = await encodeApi.encode(decoded, {
      quality: 50,
      speed: 10,
      subsample: "420",
      bitDepth: 8,
    });
    const again = await decodeApi.decode(encoded);
    assert.equal(again.width, decoded.width);
    assert.equal(again.height, decoded.height);
    assert.equal(again.data.length, decoded.data.length);
  });

  it("encodes 444 and rejects 10-bit", async () => {
    const src = solid(8, 8, 255, 0, 0);
    await assert.rejects(
      () => encodeApi.encode(src, { quality: 70, speed: 10, subsample: 444, bitDepth: 10 }),
      /bitDepth must be 8/,
    );
    const avif = await encodeApi.encode(src, {
      quality: 70,
      speed: 10,
      subsample: 444,
    });
    const image = await decodeApi.decode(avif);
    assert.equal(image.width, 8);
    assert.equal(image.height, 8);
    assert.ok(image.data[0] > 200);
  });
});
