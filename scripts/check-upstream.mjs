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

async function githubLatestTag(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "libavif-wasm-upstream-check" },
  });
  if (!res.ok) throw new Error(`GitHub ${repo}: HTTP ${res.status}`);
  const json = await res.json();
  return json.tag_name;
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
    latest: () => githubLatestTag("AOMediaCodec/libavif"),
  },
  {
    name: "dav1d",
    current: env.DAV1D_VERSION,
    latest: () => githubLatestTag("videolan/dav1d"),
  },
  {
    name: "libaom",
    current: env.AOM_VERSION,
    latest: async () =>
      (await gitlabLatestTag("webmproject/libaom")) ??
      (await githubLatestTag("webmproject/libaom")),
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
