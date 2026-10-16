#!/usr/bin/env bash
# Meson exe_wrapper: emcc -o foo.exe emits foo.exe (JS) + foo.exe.wasm.
set -euo pipefail
target="${1:-}"
shift || true
if [[ -z "${target}" ]]; then
  echo "emscripten-exe-wrapper: missing program" >&2
  exit 1
fi
if [[ -f "${target}" ]]; then
  exec node "${target}" "$@"
fi
if [[ -f "${target}.js" ]]; then
  exec node "${target}.js" "$@"
fi
echo "emscripten-exe-wrapper: cannot run ${target}" >&2
exit 1
