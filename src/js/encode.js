import createEncodeModule from "./codec/encode.mjs";
import { createLoader, readCString, tryUrl } from "./instantiate.js";

/** URL of the encode wasm, or undefined in runtimes without import.meta.url. */
export const wasmUrl = tryUrl(() => new URL("./encode.wasm", import.meta.url));

const loader = createLoader(createEncodeModule, wasmUrl, "encode");

/**
 * Load the encode module. Required once before encode(); later calls are
 * no-ops. With no argument, loads encode.wasm from next to this file (fetch
 * in browsers, the filesystem in Node, Deno and Bun).
 *
 * @param {import("./decode.js").InitInput | Promise<import("./decode.js").InitInput>} [source]
 * @returns {Promise<void>}
 */
export const init = loader.init;

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
 * @param {unknown} value
 * @param {string} name
 * @param {number} fallback
 * @param {number} max
 */
function intInRange(value, name, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !(value >= 0 && value <= max)) {
    throw new RangeError(`${name} must be a number from 0 to ${max}, got ${value}`);
  }
  return Math.round(value);
}

/**
 * View 8-bit data as bytes without copying; convert anything else.
 *
 * @param {ArrayBufferView | ArrayLike<number>} data
 * @returns {Uint8Array}
 */
function toBytes(data) {
  if (ArrayBuffer.isView(data) && (data.BYTES_PER_ELEMENT ?? 1) === 1) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return Uint8ClampedArray.from(/** @type {ArrayLike<number>} */ (data));
}

/**
 * Encode 8-bit RGBA image data to AVIF.
 *
 * @param {{ data: ArrayBufferView | ArrayLike<number>, width: number, height: number }} image
 * @param {import("./encode.js").EncodeOptions} [options]
 * @returns {Promise<ArrayBuffer>}
 */
export async function encode(image, options = {}) {
  const module = await loader.getModule();
  const { data, width, height } = image ?? {};
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError("encode() expected { data, width, height } with positive integer dimensions");
  }

  const expected = width * height * 4;
  const pixels = toBytes(data);
  if (pixels.byteLength < expected) {
    throw new TypeError(`image.data is ${pixels.byteLength} bytes; expected at least ${expected} (RGBA)`);
  }

  const lossless = options.lossless === true;
  const quality = intInRange(options.quality, "quality", 60, 100);
  const speed = intInRange(options.speed, "speed", 6, 10);
  const subsample = lossless && options.subsample === undefined ? 444 : normalizeSubsample(options.subsample);
  if (lossless && subsample !== 444) {
    throw new TypeError("lossless encoding requires subsample 444");
  }
  if (options.bitDepth !== undefined && options.bitDepth !== 8) {
    throw new TypeError("bitDepth must be 8");
  }

  const inPtr = module._avif_wasm_malloc(expected);
  const sizePtr = module._avif_wasm_malloc(4);
  if (!inPtr || !sizePtr) {
    module._avif_wasm_free(inPtr);
    module._avif_wasm_free(sizePtr);
    throw new Error("Failed to allocate wasm memory for RGBA input");
  }

  let outPtr;
  let size = 0;
  try {
    module.HEAPU8.set(pixels.subarray(0, expected), inPtr);
    outPtr = module._avif_wasm_encode(
      inPtr,
      width,
      height,
      quality,
      speed,
      subsample,
      lossless ? 1 : 0,
      sizePtr,
    );
    // Read HEAPU8 again: encoding may have grown (and replaced) wasm memory.
    size = new DataView(module.HEAPU8.buffer, module.HEAPU8.byteOffset + sizePtr, 4).getInt32(0, true);
  } finally {
    module._avif_wasm_free(inPtr);
    module._avif_wasm_free(sizePtr);
  }

  if (!outPtr) {
    const msg = readCString(module, module._avif_wasm_last_error());
    throw new Error(msg || "AVIF encode failed");
  }

  const copy = module.HEAPU8.slice(outPtr, outPtr + size);
  module._avif_wasm_free(outPtr);
  return copy.buffer;
}

export default encode;
