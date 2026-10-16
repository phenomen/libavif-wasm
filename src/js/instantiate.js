/**
 * Instantiate an Emscripten MODULARIZE factory from a precompiled
 * WebAssembly.Module. Never fetches, compiles from bytes, or touches a
 * filesystem — callers (bundlers, Workers, Node) supply the Module.
 *
 * @param {(opts: object) => Promise<object>} factory
 * @param {WebAssembly.Module} wasmModule
 * @returns {Promise<object>}
 */
export function instantiateFromModule(factory, wasmModule) {
  if (!(wasmModule instanceof WebAssembly.Module)) {
    throw new TypeError(
      "init() requires a WebAssembly.Module. Import the .wasm file (bundler / Workers) or construct one with new WebAssembly.Module(bytes) in Node.",
    );
  }

  return factory({
    noInitialRun: true,
    instantiateWasm(imports, receiveInstance) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      // Emscripten 3+ accepts (instance) or (instance, module).
      receiveInstance(instance, wasmModule);
      return instance.exports;
    },
  });
}

/**
 * Read a UTF-8 C string from an Emscripten HEAP.
 * @param {object} module
 * @param {number} ptr
 */
export function readCString(module, ptr) {
  if (!ptr) return "";
  const heap = module.HEAPU8;
  let end = ptr;
  while (heap[end] !== 0) end++;
  return new TextDecoder().decode(heap.subarray(ptr, end));
}
