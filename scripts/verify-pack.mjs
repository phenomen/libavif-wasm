#!/usr/bin/env node
// Build an npm tarball and assert it contains the wasm modules and licenses.

import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublishable, REQUIRED_PACK_FILES } from "./prepack.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await assertPublishable(root);

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.publishConfig?.access !== "public") {
  throw new Error("publishConfig.access must be public for the scoped package");
}

const work = await mkdtemp(join(tmpdir(), "libavif-wasm-pack-"));
try {
  execFileSync("npm", ["pack", "--pack-destination", work], {
    cwd: root,
    stdio: "inherit",
  });
  const packed = (await readdir(work)).filter((name) => name.endsWith(".tgz"));
  if (packed.length !== 1) {
    throw new Error(`expected one tarball in ${work}, found ${packed.join(", ") || "(none)"}`);
  }
  const filename = packed[0];
  const archive = join(work, filename);
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^package\//, ""));

  const missing = REQUIRED_PACK_FILES.filter((rel) => !listing.includes(rel));
  if (missing.length) {
    throw new Error(`npm pack omitted:\n  ${missing.join("\n  ")}`);
  }

  const unexpectedRoot = listing.filter(
    (rel) =>
      rel.startsWith("vendor/") ||
      rel.startsWith("build/") ||
      rel.startsWith("src/c/") ||
      rel === "src/c/decode.c",
  );
  if (unexpectedRoot.length) {
    throw new Error(`npm pack included build/source paths:\n  ${unexpectedRoot.join("\n  ")}`);
  }

  console.log(`packed ${filename}`);
  console.log(`files ${listing.length}`);
  for (const rel of ["dist/decode.wasm", "dist/encode.wasm", "THIRD_PARTY_NOTICES.md"]) {
    console.log(`  ok ${rel}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
