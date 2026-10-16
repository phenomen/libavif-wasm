# @phenomen/libavif-wasm

Maintained WebAssembly port of [libavif](https://github.com/AOMediaCodec/libavif) with **separate decode and encode** ES modules. Single-threaded (`-msimd128`) so the same artifacts run in browsers, Node 20+, Vercel Node functions, and Vercel Edge / Cloudflare Workers.

The unscoped name `libavif-wasm` is already taken on npm (an unmaintained 0.1.x package). This port is published as **`@phenomen/libavif-wasm`**. This repository does not publish to npm from CI; consume it from a GitHub Release or `npm pack`.

## Upstream pins

All versions live in [`versions.env`](./versions.env) so bumping is one file:

| Component | Pin | Role |
| --- | --- | --- |
| Emscripten (emsdk) | 6.0.12 | Toolchain |
| libavif | v1.4.2 | AVIF container |
| dav1d | 1.5.4 | Decode |
| libaom | v3.15.2 | Encode (`AOM_TARGET_CPU=generic`) |
| libyuv | `644251f25` | YUV ↔ RGB |
| libsharpyuv (libwebp) | v1.6.0 | RGB → YUV (encode) |

A Monday cron workflow compares libavif, dav1d, and libaom to their latest releases and opens an issue when a pin is stale.

## Wasm sizes

Measured from this build (`gzip -9`). Re-run `./scripts/measure-sizes.sh` after rebuilding.

| Module | Raw | gzip |
| --- | --- | --- |
| `decode.wasm` (dav1d) | *built in CI / local Docker* | *see `dist/sizes.json`* |
| `encode.wasm` (libaom) | *built in CI / local Docker* | *see `dist/sizes.json`* |

Sizes are filled in after a successful `./scripts/build.sh` (also written to `dist/sizes.json`).

## Install

```bash
# from a GitHub Release artifact, or:
npm pack
npm install ./phenomen-libavif-wasm-1.4.2.tgz
```

Do not `npm publish` from this repo unless you intend to.

## API

Both modules must be **initialized from an imported `WebAssembly.Module`**. The glue never fetches, never compiles from raw bytes, and is built with `-sFILESYSTEM=0`, so Edge and Workers do not need a filesystem or a `locateFile` hook.

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
    speed?: number       // 0 (slow/best) – 10 (fast), default 6
    subsample?: 420 | 422 | 444 | 400
    bitDepth?: 8 | 10 | 12
  }
): Promise<ArrayBuffer>
```

## Browser

Bundlers (Vite, webpack, esbuild) can import a `.wasm` file as a `WebAssembly.Module`:

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";
import decodeWasm from "@phenomen/libavif-wasm/decode.wasm";

await init(decodeWasm);

const avif = await fetch("/photo.avif").then((r) => r.arrayBuffer());
const { data, width, height } = await decode(avif);

const canvas = document.createElement("canvas");
canvas.width = width;
canvas.height = height;
canvas.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
```

Encode:

```ts
import { init, encode } from "@phenomen/libavif-wasm/encode";
import encodeWasm from "@phenomen/libavif-wasm/encode.wasm";

await init(encodeWasm);
const avif = await encode(imageData, { quality: 70, speed: 6, subsample: 420 });
```

If your bundler gives you an `URL` or `ArrayBuffer` instead of a `Module`, compile once at the edge of your app (`new WebAssembly.Module(bytes)`) and pass that `Module` to `init`. The library itself will not compile from bytes.

## Node 20+ / Vercel Function

Node cannot `import` a `.wasm` as a `WebAssembly.Module` without experimental flags. Read the file the package exports and construct a `Module` yourself:

```ts
import { readFile } from "node:fs/promises";
import { init, decode, wasmUrl } from "@phenomen/libavif-wasm/decode";

export async function GET() {
  await init(new WebAssembly.Module(await readFile(wasmUrl)));
  const avif = await readFile("./photo.avif");
  const image = await decode(avif.buffer);
  return Response.json({ width: image.width, height: image.height });
}
```

Vercel Node function (same pattern):

```ts
import { readFile } from "node:fs/promises";
import { init, encode, wasmUrl } from "@phenomen/libavif-wasm/encode";

export async function POST(req: Request) {
  await init(new WebAssembly.Module(await readFile(wasmUrl)));
  const { data, width, height } = await req.json();
  const avif = await encode(
    { data: Buffer.from(data, "base64"), width, height },
    { quality: 60, speed: 8 },
  );
  return new Response(avif, { headers: { "content-type": "image/avif" } });
}
```

## Vercel Edge / Cloudflare Workers

Workers treat `import x from "./file.wasm"` as a `WebAssembly.Module`. No `fetch` of the wasm, no `WebAssembly.compile`:

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";
import decodeWasm from "@phenomen/libavif-wasm/decode.wasm";

export default {
  async fetch(request: Request) {
    await init(decodeWasm);
    const avif = await request.arrayBuffer();
    const { data, width, height } = await decode(avif);
    return Response.json({ width, height, bytes: data.byteLength });
  },
};
```

Vercel Edge (App Router):

```ts
import { init, decode } from "@phenomen/libavif-wasm/decode";
import decodeWasm from "@phenomen/libavif-wasm/decode.wasm";

export const runtime = "edge";

export async function POST(req: Request) {
  await init(decodeWasm);
  const image = await decode(await req.arrayBuffer());
  return Response.json({ width: image.width, height: image.height });
}
```

wrangler.toml / bundler config must emit the `.wasm` as a module import (Cloudflare's default). For Vercel Edge, mark the wasm file as an asset or use a bundler plugin that turns `*.wasm` imports into `WebAssembly.Module`.

## Build

```bash
# Docker (recommended, pins emscripten/emsdk:6.0.12)
docker build --build-arg EMSDK_VERSION=6.0.12 -t libavif-wasm-builder .
docker run --rm -v "$PWD":/src -u "$(id -u):$(id -g)" libavif-wasm-builder ./scripts/build.sh

# or with emsdk + meson + ninja + cmake + pkg-config on PATH
./scripts/build.sh

node --test test/node/*.test.mjs
```

`scripts/build.sh` fetches the pinned tarball/tags into `vendor/`, builds dav1d with Meson and `src/meson/emscripten-cross.ini` (`-Denable_asm=false`), builds libaom with `AOM_TARGET_CPU=generic`, then links two modules:

- `dist/decode.wasm` — libavif + dav1d + libyuv
- `dist/encode.wasm` — libavif + libaom (encode only) + libyuv + libsharpyuv

Both are single-threaded. A pthread / `SharedArrayBuffer` encode variant is omitted on purpose: it needs a second full libaom rebuild, COOP/COEP headers, and does not run on Edge.

## Tests

Node tests (no extra test runner):

1. Decode `test/fixtures/sample.avif` (libavif’s `kodim03_yuv420_8bpc.avif`).
2. Encode a synthetic RGBA image and decode it back.
3. Re-encode the decoded fixture and confirm dimensions survive the round-trip.

## Licensing

Repository code (glue, TypeScript API, scripts) is **MIT**, which is compatible with libavif’s **BSD-2-Clause**.

Wasm binaries additionally contain dav1d, libaom, libyuv, and libsharpyuv. Full license texts — including libaom’s BSD-2-Clause **and** the Alliance for Open Media Patent License 1.0 — are in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and [`licenses/`](./licenses/). Those files ship in the npm package (`files` in `package.json`) and in GitHub Release zips.

The decode-only module does not link libaom. The encode module does, so AOMedia patent terms apply when you ship `encode.wasm`.

## Limitations

- Still images only (no animated AVIF / sequences).
- Decode output is 8-bit RGBA. 10- and 12-bit sources are converted down.
- Encode input is 8-bit RGBA; `bitDepth` 10/12 only affects the YUV payload.
- Single-threaded; Edge and Workers have no `pthread`.
- No ICC / EXIF / XMP round-trip through the small JS API.
- `init()` is required in every isolate. Cache the `Module` (Workers do this for you) and call `init` once per isolate.
