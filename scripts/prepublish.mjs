#!/usr/bin/env node
// Check the package version before publishing.
//
// Versions are x.y.zzz: x.y.z is the bundled libavif release and the last two
// digits count package revisions on top of it (libavif v1.4.2 -> 1.4.200,
// 1.4.201, ...). That keeps every release a plain semver version that sorts
// after the previous one. Prerelease suffixes are refused for `latest`, since
// semver sorts 1.4.2-2 *below* 1.4.2.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const env = await readFile(join(root, "versions.env"), "utf8");
const libavif = /^LIBAVIF_VERSION=v?(\d+)\.(\d+)\.(\d+)$/m.exec(env);
const tag = process.env.npm_config_tag || "latest";

function fail(message) {
  console.error(`prepublish: ${message}`);
  process.exit(1);
}

if (!libavif) fail("LIBAVIF_VERSION in versions.env is not x.y.z");
const [, major, minor, patch] = libavif.map(Number);

const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
if (!m) fail(`${version} is not a semver version`);
const [, vMajor, vMinor, vPatch] = m.slice(0, 4).map(Number);
const prerelease = m[4];

if (vMajor !== major || vMinor !== minor || Math.floor(vPatch / 100) !== patch) {
  const first = `${major}.${minor}.${patch * 100}`;
  fail(
    `${version} does not follow x.y.zzz for libavif ${major}.${minor}.${patch}.\n` +
      `Use ${major}.${minor}.${patch}NN, starting at ${first}.`,
  );
}

if (prerelease && tag === "latest") {
  fail(
    `${version} is a semver prerelease and sorts below ${version.split("-")[0]}.\n` +
      "Bump the revision digits instead, or publish with --tag next for a real prerelease.",
  );
}

console.log(`prepublish: ${version} (libavif ${major}.${minor}.${patch}, revision ${vPatch % 100}) -> ${tag}`);
