#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${ROOT}/dist"

python3 - <<PY
import gzip, json
from pathlib import Path

dist = Path("${DIST}")
rows = []
for name in ("decode.wasm", "encode.wasm"):
    path = dist / name
    raw = path.stat().st_size
    gz = len(gzip.compress(path.read_bytes(), compresslevel=9))
    rows.append({
        "file": name,
        "bytes": raw,
        "gzipBytes": gz,
        "kib": round(raw / 1024, 1),
        "gzipKib": round(gz / 1024, 1),
    })
    print(f"{name:14}  raw {raw:9} B ({raw/1024:7.1f} KiB)  gzip {gz:9} B ({gz/1024:7.1f} KiB)")

(dist / "sizes.json").write_text(json.dumps({"wasm": rows}, indent=2) + "\n")
PY
