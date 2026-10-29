// Types for `@phenomen/libavif-wasm/{decode,encode}.wasm`. Cloudflare Workers,
// Vercel Edge and wrangler/esbuild wasm loaders import .wasm as a compiled module.
declare const wasmModule: WebAssembly.Module;
export default wasmModule;
