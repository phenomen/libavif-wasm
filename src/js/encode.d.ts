import type { AvifImageData, InitInput } from "./decode.js";

export type ChromaSubsampling = 420 | 422 | 444 | 400 | "420" | "422" | "444" | "400";
export type BitDepth = 8;

export interface EncodeOptions {
  /** 0 (worst) – 100 (best). Default 60. Use `lossless` for exact output. */
  quality?: number;
  /** 0 (slowest / best) – 10 (fastest). Default 6. */
  speed?: number;
  /** Chroma subsampling. Default 420, or 444 when `lossless` is set. */
  subsample?: ChromaSubsampling;
  /** Must be 8. 10- and 12-bit encoding is not built. */
  bitDepth?: BitDepth;
  /**
   * Mathematically lossless: 4:4:4, identity matrix, quantizer 0. Decoding
   * returns the exact input pixels. `quality` is ignored.
   */
  lossless?: boolean;
}

/** 8-bit RGBA pixels. Typed arrays with 1-byte elements are read without a copy. */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array | ArrayLike<number>;
  width: number;
  height: number;
}

export type { AvifImageData, InitInput };

/**
 * URL of encode.wasm next to this module. Bundlers that understand
 * `new URL(..., import.meta.url)` emit the file and rewrite this URL.
 */
export const wasmUrl: URL;

/**
 * Load the encode module. Call once before encode(); later calls return the
 * same promise. With no argument, loads `wasmUrl` (fetch in browsers, the
 * filesystem in Node, Deno and Bun). A failed init() can be retried.
 */
export function init(source?: InitInput | Promise<InitInput>): Promise<void>;

/** Encode 8-bit RGBA to AVIF. Call init() first. */
export function encode(image: RgbaImage, options?: EncodeOptions): Promise<ArrayBuffer>;

export default encode;
