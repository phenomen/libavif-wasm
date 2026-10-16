import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it, before } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const { init, decode, wasmUrl } = await import(join(root, "dist/decode.js"));

describe("decode", () => {
  before(async () => {
    const bytes = await readFile(wasmUrl);
    await init(new WebAssembly.Module(bytes));
  });

  it("decodes the sample AVIF fixture to RGBA ImageData", async () => {
    const avif = await readFile(join(root, "test/fixtures/sample.avif"));
    const image = await decode(avif.buffer);
    assert.equal(typeof image.width, "number");
    assert.equal(typeof image.height, "number");
    assert.ok(image.width > 0);
    assert.ok(image.height > 0);
    assert.ok(image.data instanceof Uint8ClampedArray);
    assert.equal(image.data.length, image.width * image.height * 4);
    // kodim03 is an opaque photograph — alpha should be 255.
    assert.equal(image.data[3], 255);
  });

  it("rejects invalid input", async () => {
    await assert.rejects(() => decode(new Uint8Array([0, 1, 2, 3]).buffer), /./);
  });
});
