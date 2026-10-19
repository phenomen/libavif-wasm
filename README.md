# @phenomen/libavif-wasm

WebAssembly port of [libavif](https://github.com/AOMediaCodec/libavif) with separate decode and encode ES modules for browsers, Node 20+, and Edge/Workers.

## Install

```bash
npm install @phenomen/libavif-wasm
```

Call `init()` once per isolate with a `WebAssembly.Module` before `decode` or `encode`.

## Browser

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";
import decodeWasm from "@phenomen/libavif-wasm/decode.wasm";

await init(decodeWasm);
const { data, width, height } = await decode(await fetch("/photo.avif").then((r) => r.arrayBuffer()));
ctx.putImageData(new ImageData(data, width, height), 0, 0);
```

```ts
import { init, encode } from "@phenomen/libavif-wasm/encode";
import encodeWasm from "@phenomen/libavif-wasm/encode.wasm";

await init(encodeWasm);
const avif = await encode(imageData, { quality: 70, speed: 6, subsample: 420 });
```

If your bundler gives you bytes or a URL instead of a `WebAssembly.Module`, compile once with `new WebAssembly.Module(bytes)` and pass that to `init`.

## Node / Vercel Function

```ts
import { readFile } from "node:fs/promises";
import { init, decode, wasmUrl } from "@phenomen/libavif-wasm/decode";

await init(new WebAssembly.Module(await readFile(wasmUrl)));
const image = await decode((await readFile("./photo.avif")).buffer);
```

```ts
import { readFile } from "node:fs/promises";
import { init, encode, wasmUrl } from "@phenomen/libavif-wasm/encode";

await init(new WebAssembly.Module(await readFile(wasmUrl)));
const avif = await encode(image, { quality: 60, speed: 8 });
```

## Edge / Workers

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";
import decodeWasm from "@phenomen/libavif-wasm/decode.wasm";

export const runtime = "edge";

export async function POST(req: Request) {
  await init(decodeWasm);
  const { width, height } = await decode(await req.arrayBuffer());
  return Response.json({ width, height });
}
```

Cloudflare Workers and Vercel Edge treat `import … from "*.wasm"` as a `WebAssembly.Module`. Configure the bundler to emit wasm as a module import.

## API

```ts
init(wasmModule: WebAssembly.Module): Promise<void>

decode(input: ArrayBuffer | ArrayBufferView): Promise<{
  data: Uint8ClampedArray
  width: number
  height: number
}>

encode(
  image: { data: ArrayLike<number>; width: number; height: number },
  options?: {
    quality?: number     // 0–100, default 60
    speed?: number       // 0 (slowest / best) – 10 (fastest), default 6
    subsample?: 420 | 422 | 444 | 400
    bitDepth?: 8         // only 8 is supported
  },
): Promise<ArrayBuffer>
```

Import decode from `@phenomen/libavif-wasm/decode` and encode from `@phenomen/libavif-wasm/encode`. Each has its own wasm file and `init`.

## Sizes

| Module | Raw | gzip-9 |
| --- | --- | --- |
| `decode.wasm` | 770.3 KiB (788,769 B) | 294.1 KiB (301,185 B) |
| `encode.wasm` | 5.70 MiB (5,981,594 B) | 1.25 MiB (1,306,020 B) |

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

## Limitations

- Still images only (no animated AVIF).
- Decode output is 8-bit RGBA. 10- and 12-bit AVIF still decodes.
- Encode input is 8-bit RGBA, and the encoded AVIF is 8-bit.
- Single-threaded. Call `init()` once per isolate.

## Build from source

```bash
docker build --build-arg EMSDK_VERSION=6.0.12 -t libavif-wasm-builder .
docker run --rm -v "$PWD":/src -u "$(id -u):$(id -g)" libavif-wasm-builder ./scripts/build.sh
node --test test/node/*.test.mjs
```

Or run `./scripts/build.sh` with emsdk, Meson, Ninja, CMake, and pkg-config on `PATH`.

## License

This repository is [MIT](./LICENSE). The wasm binaries bundle libavif, dav1d, libaom, libyuv, and libsharpyuv. Full texts — including the Alliance for Open Media Patent License 1.0, which applies to encode — are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
