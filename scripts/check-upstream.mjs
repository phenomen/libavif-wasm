#!/usr/bin/env node
// Compare versions.env pins against the latest upstream release tags.
// Codecs and emsdk are checked against their newest stable tag; libyuv and
// libsharpyuv against the revisions the pinned libavif release vendors.
// Exit 0 when current, 1 when an update exists, 2 on lookup failure.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

function parseSemver(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!m) return null;
  return { tag, n: [Number(m[1]), Number(m[2]), Number(m[3])] };
}

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.n[i] !== b.n[i]) return a.n[i] - b.n[i];
  }
  return 0;
}

// `git ls-remote` works the same for GitHub, googlesource and GitLab, and is
// not rate limited like the GitHub API.
async function latestStableTag(url) {
  const { stdout } = await run("git", ["ls-remote", "--tags", "--refs", url], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const tags = stdout
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .map((name) => name && parseSemver(name))
    .filter(Boolean)
    .sort(cmpSemver);
  if (!tags.length) throw new Error(`no release tags at ${url}`);
  return tags.at(-1).tag;
}

// libavif's ext/*.cmd scripts record the dependency revisions it is tested with.
async function libavifVendored(file, pattern) {
  const url = `https://raw.githubusercontent.com/AOMediaCodec/libavif/${env.LIBAVIF_VERSION}/ext/${file}`;
  const res = await fetch(url, { headers: { "User-Agent": "libavif-wasm-upstream-check" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const match = pattern.exec(await res.text());
  if (!match) throw new Error(`${file}: revision not found`);
  return match[1];
}

const sameVersion = (a, b) => a.replace(/^v/, "") === b.replace(/^v/, "");

const env = parseEnv(await readFile(join(root, "versions.env"), "utf8"));
const checks = [
  { name: "libavif", current: env.LIBAVIF_VERSION, latest: () => latestStableTag(env.LIBAVIF_URL) },
  { name: "dav1d", current: env.DAV1D_VERSION, latest: () => latestStableTag(env.DAV1D_URL) },
  { name: "libaom", current: env.AOM_VERSION, latest: () => latestStableTag(env.AOM_URL) },
  {
    name: "emsdk",
    current: env.EMSDK_VERSION,
    latest: () => latestStableTag("https://github.com/emscripten-core/emsdk.git"),
  },
  {
    name: `libyuv (libavif ${env.LIBAVIF_VERSION})`,
    current: env.LIBYUV_VERSION,
    latest: () => libavifVendored("libyuv.cmd", /git checkout ([0-9a-f]+)/),
  },
  {
    name: `libsharpyuv (libavif ${env.LIBAVIF_VERSION})`,
    current: env.LIBWEBP_VERSION,
    latest: () => libavifVendored("libsharpyuv.cmd", /git clone -b (\S+)/),
  },
];

const results = await Promise.allSettled(checks.map((check) => check.latest()));
let updates = 0;
results.forEach((result, i) => {
  const { name, current } = checks[i];
  if (result.status === "rejected") {
    console.error(`${name}: ${result.reason.message}`);
    process.exitCode = 2;
    return;
  }
  const latest = result.value;
  const changed = !sameVersion(latest, current);
  if (changed) updates++;
  console.log(`${name}: pinned ${current}  latest ${latest}${changed ? "  UPDATE" : ""}`);
});

if (updates && process.exitCode !== 2) {
  process.exitCode = 1;
}
