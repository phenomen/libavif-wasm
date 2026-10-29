export interface AvifImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * What init() can load the wasm from: an already-compiled module (Workers,
 * Vercel Edge), raw bytes, a fetch Response, or a URL / path to the file.
 */
export type InitInput = WebAssembly.Module | BufferSource | Response | URL | string;

/**
 * URL of decode.wasm next to this module. Bundlers that understand
 * `new URL(..., import.meta.url)` emit the file and rewrite this URL.
 */
export const wasmUrl: URL;

/**
 * Load the decode module. Call once before decode(); later calls return the
 * same promise. With no argument, loads `wasmUrl` (fetch in browsers, the
 * filesystem in Node, Deno and Bun). A failed init() can be retried.
 */
export function init(source?: InitInput | Promise<InitInput>): Promise<void>;

/** Decode an AVIF bitstream to 8-bit RGBA. Call init() first. */
export function decode(input: ArrayBuffer | ArrayBufferView): Promise<AvifImageData>;

export default decode;
