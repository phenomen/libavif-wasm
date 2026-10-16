export interface AvifImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** URL of decode.wasm (use with readFile in Node, or new URL() in bundlers). */
export const wasmUrl: URL;

/**
 * Instantiate the decode module from an imported WebAssembly.Module.
 * Does not fetch or compile from bytes.
 */
export function init(wasmModule: WebAssembly.Module): Promise<void>;

/** Decode an AVIF bitstream to 8-bit RGBA. Call init() first. */
export function decode(input: ArrayBuffer | ArrayBufferView): Promise<AvifImageData>;

export default decode;
