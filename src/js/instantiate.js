// Kept in a variable so bundlers leave the Node-only import alone.
const NODE_FS = "node:fs/promises";

const decoder = new TextDecoder();

function isWasmModule(value) {
  // instanceof fails across realms (vm contexts, test runners), so check the tag too.
  return (
    value instanceof WebAssembly.Module ||
    Object.prototype.toString.call(value) === "[object WebAssembly.Module]"
  );
}

function isResponse(value) {
  return typeof Response !== "undefined" && value instanceof Response;
}

/**
 * Turn any supported wasm source into a compiled WebAssembly.Module.
 *
 * @param {unknown} source
 * @returns {Promise<WebAssembly.Module>}
 */
async function compileWasm(source) {
  source = await source;

  if (isWasmModule(source)) return source;

  if (typeof source === "string" || source instanceof URL) {
    let url = null;
    try {
      url = new URL(source);
    } catch {
      // Relative string: let fetch resolve it against the page.
    }
    if (url?.protocol === "file:") {
      const { readFile } = await import(/* webpackIgnore: true */ /* @vite-ignore */ NODE_FS);
      return WebAssembly.compile(await readFile(url));
    }
    source = await fetch(source);
  }

  if (isResponse(source)) {
    if (!source.ok) {
      throw new Error(`Failed to fetch wasm: HTTP ${source.status} ${source.url}`);
    }
    // compileStreaming consumes the body and rejects on a wrong MIME type,
    // so only use it when the server says application/wasm.
    const type = source.headers.get("content-type") ?? "";
    if (WebAssembly.compileStreaming && type.startsWith("application/wasm")) {
      return WebAssembly.compileStreaming(source);
    }
    return WebAssembly.compile(await source.arrayBuffer());
  }

  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return WebAssembly.compile(source);
  }

  throw new TypeError(
    "init() expected a WebAssembly.Module, wasm bytes, a Response, or a URL to the .wasm file.",
  );
}

/**
 * Instantiate an Emscripten MODULARIZE factory from a compiled
 * WebAssembly.Module. The glue never fetches or reads files itself.
 *
 * @param {(opts: object) => Promise<object>} factory
 * @param {WebAssembly.Module} wasmModule
 * @returns {Promise<object>}
 */
function instantiateFromModule(factory, wasmModule) {
  // The glue's instantiateWasm callback has no reject path, so surface
  // instantiation errors through a separate promise.
  let fail;
  const failed = new Promise((_, reject) => {
    fail = reject;
  });
  const ready = factory({
    instantiateWasm(imports, receiveInstance) {
      WebAssembly.instantiate(wasmModule, imports).then(
        (instance) => receiveInstance(instance, wasmModule),
        fail,
      );
      return {};
    },
  });
  return Promise.race([ready, failed]);
}

/**
 * Build the init()/getModule() pair for one codec. init() is idempotent:
 * the first call loads the module, later calls return the same promise.
 * A failed init() can be retried.
 *
 * @param {(opts: object) => Promise<object>} factory
 * @param {URL | undefined} defaultUrl
 * @param {"decode" | "encode"} name
 */
export function createLoader(factory, defaultUrl, name) {
  /** @type {Promise<object> | null} */
  let modulePromise = null;

  function init(source) {
    if (!modulePromise) {
      if (source === undefined && !defaultUrl) {
        return Promise.reject(
          new TypeError(
            `init() could not locate ${name}.wasm in this runtime. Pass the imported WebAssembly.Module.`,
          ),
        );
      }
      modulePromise = compileWasm(source ?? defaultUrl)
        .then((wasmModule) => instantiateFromModule(factory, wasmModule))
        .catch((err) => {
          modulePromise = null;
          throw err;
        });
    }
    return modulePromise.then(() => {});
  }

  function getModule() {
    if (!modulePromise) {
      throw new Error(`AVIF ${name} module is not initialized. Call init() first.`);
    }
    return modulePromise;
  }

  return { init, getModule };
}

/**
 * Resolve a sibling .wasm file next to the calling module. Written as
 * new URL("./x.wasm", import.meta.url) at each call site so bundlers
 * (webpack, Vite, Parcel) detect and emit the asset.
 *
 * @param {() => URL} resolve
 * @returns {URL | undefined}
 */
export function tryUrl(resolve) {
  try {
    return resolve();
  } catch {
    // Runtimes without import.meta.url.
    return undefined;
  }
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
  return decoder.decode(heap.subarray(ptr, end));
}
