#!/usr/bin/env bash
# Build the wasm modules inside the emsdk image pinned in versions.env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../versions.env
source "${ROOT}/versions.env"

IMAGE="libavif-wasm-builder:${EMSDK_VERSION}"
docker build --build-arg EMSDK_VERSION="${EMSDK_VERSION}" -t "${IMAGE}" "${ROOT}"
docker run --rm -v "${ROOT}":/src -u "$(id -u):$(id -g)" -e JOBS "${IMAGE}" ./scripts/build.sh "$@"
