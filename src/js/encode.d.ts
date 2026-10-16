import type { AvifImageData } from "./decode.js";

export type ChromaSubsampling = 420 | 422 | 444 | 400 | "420" | "422" | "444" | "400";
export type BitDepth = 8 | 10 | 12;

export interface EncodeOptions {
  /** 0 (worst) – 100 (lossless). Default 60. */
  quality?: number;
  /** 0 (slowest / best) – 10 (fastest). Default 6. */
  speed?: number;
  /** Chroma subsampling. Default 420. */
  subsample?: ChromaSubsampling;
  /** Output YUV bit depth. Input pixels stay 8-bit RGBA. Default 8. */
  bitDepth?: BitDepth;
}

export type { AvifImageData };

/** URL of encode.wasm (use with readFile in Node, or new URL() in bundlers). */
export const wasmUrl: URL;

/**
 * Instantiate the encode module from an imported WebAssembly.Module.
 * Does not fetch or compile from bytes.
 */
export function init(wasmModule: WebAssembly.Module): Promise<void>;

/** Encode 8-bit RGBA to AVIF. Call init() first. */
export function encode(
  image: Pick<AvifImageData, "data" | "width" | "height">,
  options?: EncodeOptions,
): Promise<ArrayBuffer>;

export default encode;
