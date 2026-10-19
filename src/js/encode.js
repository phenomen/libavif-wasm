import createEncodeModule from "./codec/encode.mjs";
import { instantiateFromModule, readCString } from "./instantiate.js";

/** @type {Promise<object> | null} */
let modulePromise = null;

/** URL of the encode wasm, for Node or any runtime that reads files. */
export const wasmUrl = new URL("./encode.wasm", import.meta.url);

/**
 * Prepare the encode module from an already-compiled WebAssembly.Module.
 * Required before encode() in every environment.
 *
 * @param {WebAssembly.Module} wasmModule
 * @returns {Promise<void>}
 */
export async function init(wasmModule) {
  modulePromise = instantiateFromModule(createEncodeModule, wasmModule);
  await modulePromise;
}

function requireModule() {
  if (!modulePromise) {
    throw new Error(
      "AVIF encode module is not initialized. Import encode.wasm and call init(module) first.",
    );
  }
  return modulePromise;
}

/**
 * @param {420 | 422 | 444 | 400 | "420" | "422" | "444" | "400" | undefined} subsample
 */
function normalizeSubsample(subsample) {
  if (subsample === undefined || subsample === null) return 420;
  const n = typeof subsample === "string" ? Number(subsample) : subsample;
  if (n === 420 || n === 422 || n === 444 || n === 400) return n;
  throw new TypeError(`unsupported subsample: ${subsample}`);
}

/**
 * Encode 8-bit RGBA image data to AVIF.
 *
 * @param {{ data: ArrayBufferView | ArrayLike<number>, width: number, height: number }} image
 * @param {{ quality?: number, speed?: number, subsample?: 420 | 422 | 444 | 400 | "420" | "422" | "444" | "400", bitDepth?: 8 }} [options]
 * @returns {Promise<ArrayBuffer>}
 */
export async function encode(image, options = {}) {
  const module = await requireModule();
  if (!image || !image.data || image.width <= 0 || image.height <= 0) {
    throw new TypeError("encode() expected { data, width, height }");
  }

  const expected = image.width * image.height * 4;
  const pixels = image.data instanceof Uint8Array
    ? image.data
    : new Uint8Array(image.data.buffer ?? image.data, image.data.byteOffset ?? 0, image.data.byteLength ?? expected);

  if (pixels.byteLength < expected) {
    throw new TypeError(`image.data is ${pixels.byteLength} bytes; expected at least ${expected} (RGBA)`);
  }

  const quality = options.quality ?? 60;
  const speed = options.speed ?? 6;
  const subsample = normalizeSubsample(options.subsample);
  if (options.bitDepth !== undefined && options.bitDepth !== 8) {
    throw new TypeError("bitDepth must be 8");
  }

  const inPtr = module._avif_wasm_malloc(expected);
  if (!inPtr) {
    throw new Error("Failed to allocate wasm memory for RGBA input");
  }
  module.HEAPU8.set(pixels.subarray(0, expected), inPtr);

  const sizePtr = module._avif_wasm_malloc(4);
  const outPtr = module._avif_wasm_encode(
    inPtr,
    image.width,
    image.height,
    quality,
    speed,
    subsample,
    sizePtr,
  );
  module._avif_wasm_free(inPtr);

  if (!outPtr) {
    module._avif_wasm_free(sizePtr);
    const msg = readCString(module, module._avif_wasm_last_error());
    throw new Error(msg || "AVIF encode failed");
  }

  const size = new DataView(
    module.HEAPU8.buffer,
    module.HEAPU8.byteOffset + sizePtr,
    4,
  ).getInt32(0, true);
  module._avif_wasm_free(sizePtr);

  const copy = module.HEAPU8.slice(outPtr, outPtr + size);
  module._avif_wasm_free(outPtr);
  return copy.buffer;
}

export default encode;
