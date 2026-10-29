# @phenomen/libavif-wasm

WebAssembly port of [libavif](https://github.com/AOMediaCodec/libavif) with separate decode and encode ES modules for browsers, Node 22+, Deno, Bun, and Edge/Workers.

## Install

```bash
npm install @phenomen/libavif-wasm
```

Call `init()` before `decode` or `encode`. It loads the module once; calling it again returns the same promise, so it is safe to call per request.

## Browser

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";

await init(); // fetches decode.wasm next to the module
const { data, width, height } = await decode(await fetch("/photo.avif").then((r) => r.arrayBuffer()));
ctx.putImageData(new ImageData(data, width, height), 0, 0);
```

```ts
import { init, encode } from "@phenomen/libavif-wasm/encode";

await init();
const avif = await encode(imageData, { quality: 70, speed: 6, subsample: 420 });
```

Vite, webpack 5, Parcel and Rollup (with an asset plugin) pick up the `.wasm` file from the `new URL("./decode.wasm", import.meta.url)` reference and serve it automatically. To host the file yourself, pass its URL or a `fetch` promise: `await init(fetch("/wasm/decode.wasm"))`.

## Node, Deno, Bun

```ts
import { readFile } from "node:fs/promises";
import { init, decode } from "@phenomen/libavif-wasm/decode";

await init(); // reads decode.wasm from node_modules
const image = await decode(await readFile("./photo.avif"));
```

```ts
import { init, encode } from "@phenomen/libavif-wasm/encode";

await init();
const avif = await encode(image, { quality: 60, speed: 8 });
const lossless = await encode(image, { lossless: true });
```

## Edge / Workers

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";
import decodeWasm from "@phenomen/libavif-wasm/decode.wasm";

export const runtime = "edge";

export async function POST(req: Request) {
  await init(decodeWasm); // instantiates on the first request only
  const { width, height } = await decode(await req.arrayBuffer());
  return Response.json({ width, height });
}
```

Cloudflare Workers and Vercel Edge import `*.wasm` as a `WebAssembly.Module` (typed by this package). These runtimes cannot compile wasm from bytes at run time, so pass the imported module.

## API

```ts
type InitInput = WebAssembly.Module | BufferSource | Response | URL | string

init(source?: InitInput | Promise<InitInput>): Promise<void>

decode(input: ArrayBuffer | ArrayBufferView): Promise<{
  data: Uint8ClampedArray   // straight (non-premultiplied) RGBA
  width: number
  height: number
}>

encode(
  image: { data: Uint8ClampedArray | Uint8Array | ArrayLike<number>; width: number; height: number },
  options?: {
    quality?: number     // 0–100, default 60
    speed?: number       // 0 (slowest / best) – 10 (fastest), default 6
    subsample?: 420 | 422 | 444 | 400   // default 420
    lossless?: boolean   // exact pixels: 4:4:4, identity matrix; ignores quality
    bitDepth?: 8         // only 8 is supported
  },
): Promise<ArrayBuffer>
```

Import decode from `@phenomen/libavif-wasm/decode` and encode from `@phenomen/libavif-wasm/encode`. Each has its own wasm file and `init`. The root export re-exports both as `initDecode` / `initEncode`.

Invalid options throw `RangeError` / `TypeError`. Decode and encode errors carry libavif's message and diagnostics.

## Sizes

| Module | Raw | gzip-9 |
| --- | --- | --- |
| `decode.wasm` | 573.1 KiB (586,861 B) | 242.9 KiB (248,750 B) |
| `encode.wasm` | 1.95 MiB (2,041,605 B) | 837.1 KiB (857,162 B) |

## Versions

| Component | Version |
| --- | --- |
| libavif | v1.4.2 |
| dav1d | 1.5.4 |
| libaom | v3.15.2 |
| libyuv | `644251f25` |
| libsharpyuv (libwebp) | v1.6.0 |
| Emscripten | 6.0.12 |

Pins live in [`versions.env`](./versions.env).

Package versions are `x.y.zzz`: `x.y.z` is the bundled libavif release and the last two digits count package revisions on top of it. `1.4.203` is revision 3 on libavif v1.4.2; the first build of a new libavif release is `x.y.z00`. Pin a libavif release with `~1.4.200`.

## Limitations

- Still images only. Animated AVIF decodes its first frame.
- Decode output is 8-bit RGBA. 10- and 12-bit AVIF still decodes.
- Decode does not apply `irot`/`imir` orientation or convert to sRGB; pixels come out in the image's own color space.
- Encode input is 8-bit RGBA, tagged as sRGB, and the encoded AVIF is 8-bit.
- Single-threaded.

## Build from source

```bash
npm run build:docker
npm test
```

`build:docker` builds the emsdk image pinned in `versions.env` and runs `./scripts/build.sh` inside it. You can also run `./scripts/build.sh` directly with emsdk, Meson, Ninja, CMake, and pkg-config on `PATH`. Dependencies are cached in `build/` and rebuilt when their version or flags change.

`npm run check-upstream` compares the pins against the latest upstream releases.

## License

This repository is [MIT](./LICENSE). The wasm binaries bundle libavif, dav1d, libaom, libyuv, and libsharpyuv. Full texts — including the Alliance for Open Media Patent License 1.0, which applies to encode — are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
