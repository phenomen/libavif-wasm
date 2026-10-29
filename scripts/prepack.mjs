#!/usr/bin/env node
// Fail `npm pack` / `npm publish` if the wasm build is missing.
// dist/ is gitignored, so a clean checkout cannot publish by accident.

import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_PACK_FILES = [
  "package.json",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "versions.env",
  "licenses/libavif.BSD-2-Clause.txt",
  "licenses/dav1d.BSD-2-Clause.txt",
  "licenses/libaom.BSD-2-Clause.txt",
  "licenses/libaom.PATENTS.txt",
  "licenses/libyuv.BSD-3-Clause.txt",
  "licenses/libsharpyuv.BSD-3-Clause.txt",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/decode.js",
  "dist/decode.d.ts",
  "dist/encode.js",
  "dist/encode.d.ts",
  "dist/instantiate.js",
  "dist/wasm.d.ts",
  "dist/codec/decode.mjs",
  "dist/codec/encode.mjs",
  "dist/decode.wasm",
  "dist/encode.wasm",
  "dist/THIRD_PARTY_NOTICES.md",
  "dist/licenses/libaom.PATENTS.txt",
];

export async function assertPublishable(base = root) {
  const missing = [];
  for (const rel of REQUIRED_PACK_FILES) {
    try {
      await access(join(base, rel));
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length) {
    throw new Error(
      `Package is not publishable. Missing:\n  ${missing.join("\n  ")}\n\nRun ./scripts/build.sh (or the Docker build) first.`,
    );
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    await assertPublishable();
    console.log("prepack: required publish files are present");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
