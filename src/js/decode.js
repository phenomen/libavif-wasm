import createDecodeModule from "./codec/decode.mjs";
import { createLoader, readCString, tryUrl } from "./instantiate.js";

/** URL of the decode wasm, or undefined in runtimes without import.meta.url. */
export const wasmUrl = tryUrl(() => new URL("./decode.wasm", import.meta.url));

const loader = createLoader(createDecodeModule, wasmUrl, "decode");

/**
 * Load the decode module. Required once before decode(); later calls are
 * no-ops. With no argument, loads decode.wasm from next to this file (fetch
 * in browsers, the filesystem in Node, Deno and Bun).
 *
 * @param {import("./decode.js").InitInput | Promise<import("./decode.js").InitInput>} [source]
 * @returns {Promise<void>}
 */
export const init = loader.init;

/**
 * @param {unknown} input
 * @returns {Uint8Array}
 */
function toBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError("decode() expected an ArrayBuffer or ArrayBufferView");
}

/**
 * Decode an AVIF bitstream to 8-bit RGBA.
 *
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number }>}
 */
export async function decode(input) {
  const module = await loader.getModule();
  const bytes = toBytes(input);
  if (bytes.byteLength === 0) {
    throw new TypeError("decode() received empty input");
  }

  const inPtr = module._avif_wasm_malloc(bytes.byteLength);
  if (!inPtr) {
    throw new Error("Failed to allocate wasm memory for AVIF input");
  }
  let outPtr;
  try {
    module.HEAPU8.set(bytes, inPtr);
    outPtr = module._avif_wasm_decode(inPtr, bytes.byteLength);
  } finally {
    module._avif_wasm_free(inPtr);
  }

  if (!outPtr) {
    const msg = readCString(module, module._avif_wasm_last_error());
    throw new Error(msg || "AVIF decode failed");
  }

  // Read HEAPU8 again: decoding may have grown (and replaced) wasm memory.
  const heap = module.HEAPU8;
  const view = new DataView(heap.buffer, heap.byteOffset + outPtr, 8);
  const width = view.getInt32(0, true);
  const height = view.getInt32(4, true);
  const pixelBytes = width * height * 4;
  const data = new Uint8ClampedArray(pixelBytes);
  data.set(heap.subarray(outPtr + 8, outPtr + 8 + pixelBytes));
  module._avif_wasm_free(outPtr);

  return { data, width, height };
}

export default decode;
