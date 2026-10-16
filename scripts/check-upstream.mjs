#!/usr/bin/env node
// Compare versions.env pins against the latest published releases.
// Exit 0 when current, 1 when a newer release exists, 2 on lookup failure.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

async function githubLatestRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "libavif-wasm-upstream-check" },
  });
  if (!res.ok) throw new Error(`GitHub ${repo}: HTTP ${res.status}`);
  const json = await res.json();
  return json.tag_name;
}

async function githubLatestStableTag(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=30`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "libavif-wasm-upstream-check" },
  });
  if (!res.ok) throw new Error(`GitHub ${repo} tags: HTTP ${res.status}`);
  const json = await res.json();
  const parsed = json.map((t) => parseSemver(t.name)).filter(Boolean);
  parsed.sort(cmpSemver);
  return parsed.at(-1)?.tag;
}

async function gitlabLatestTag(project) {
  const res = await fetch(
    `https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/repository/tags?per_page=10`,
    { headers: { "User-Agent": "libavif-wasm-upstream-check" } },
  );
  if (!res.ok) throw new Error(`GitLab ${project}: HTTP ${res.status}`);
  const json = await res.json();
  const tag = json.find((t) => /^v?\d+\.\d+\.\d+$/.test(t.name));
  return tag?.name;
}

const env = parseEnv(await readFile(join(root, "versions.env"), "utf8"));
const checks = [
  {
    name: "libavif",
    current: env.LIBAVIF_VERSION,
    latest: () => githubLatestRelease("AOMediaCodec/libavif"),
  },
  {
    name: "dav1d",
    current: env.DAV1D_VERSION,
    // videolan/dav1d's GitHub "latest release" is a stale 0.1.0; use tags.
    latest: () => githubLatestStableTag("videolan/dav1d"),
  },
  {
    name: "libaom",
    current: env.AOM_VERSION,
    latest: async () =>
      (await gitlabLatestTag("webmproject/libaom")) ??
      (await githubLatestStableTag("webmproject/libaom")),
  },
];

const updates = [];
for (const check of checks) {
  try {
    const latest = await check.latest();
    const current = check.current;
    const changed = latest && latest !== current && `v${latest}` !== current && latest !== `v${current}`;
    console.log(`${check.name}: pinned ${current}  latest ${latest}${changed ? "  UPDATE" : ""}`);
    if (changed) {
      updates.push({ name: check.name, current, latest });
    }
  } catch (err) {
    console.error(`${check.name}: ${err.message}`);
    process.exitCode = 2;
  }
}

if (updates.length && process.exitCode !== 2) {
  process.exitCode = 1;
}

if (process.env.GITHUB_OUTPUT) {
  const { appendFile } = await import("node:fs/promises");
  const body = updates.length
    ? [
        "New upstream releases are available:",
        "",
        ...updates.map((u) => `- **${u.name}**: \`${u.current}\` → \`${u.latest}\``),
        "",
        "Pins live in `versions.env`. After bumping, run the Docker build and refresh README sizes.",
      ].join("\n")
    : "";
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `has_updates=${updates.length ? "true" : "false"}\nupdates_markdown<<EOF\n${body}\nEOF\n`,
  );
}
