import createDecodeModule from "./codec/decode.mjs";
import { instantiateFromModule, readCString } from "./instantiate.js";

/** @type {Promise<object> | null} */
let modulePromise = null;

/** URL of the decode wasm, for Node or any runtime that reads files. */
export const wasmUrl = new URL("./decode.wasm", import.meta.url);

/**
 * Prepare the decode module from an already-compiled WebAssembly.Module.
 * Required before decode() in every environment.
 *
 * @param {WebAssembly.Module} wasmModule
 * @returns {Promise<void>}
 */
export async function init(wasmModule) {
  modulePromise = instantiateFromModule(createDecodeModule, wasmModule);
  await modulePromise;
}

function requireModule() {
  if (!modulePromise) {
    throw new Error(
      "AVIF decode module is not initialized. Import decode.wasm and call init(module) first.",
    );
  }
  return modulePromise;
}

/**
 * Decode an AVIF bitstream to 8-bit RGBA.
 *
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number }>}
 */
export async function decode(input) {
  const module = await requireModule();
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  const inPtr = module._avif_wasm_malloc(bytes.byteLength);
  if (!inPtr) {
    throw new Error("Failed to allocate wasm memory for AVIF input");
  }
  module.HEAPU8.set(bytes, inPtr);

  const outPtr = module._avif_wasm_decode(inPtr, bytes.byteLength);
  module._avif_wasm_free(inPtr);

  if (!outPtr) {
    const msg = readCString(module, module._avif_wasm_last_error());
    throw new Error(msg || "AVIF decode failed");
  }

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
