#!/usr/bin/env bash
# Fetch pinned upstream sources into vendor/. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../versions.env
source "${ROOT}/versions.env"

VENDOR="${ROOT}/vendor"
mkdir -p "${VENDOR}"

clone_tag() {
  local url="$1" dest="$2" tag="$3"
  if [[ -d "${dest}/.git" ]]; then
    git -C "${dest}" fetch --depth 1 origin "refs/tags/${tag}:refs/tags/${tag}" || \
      git -C "${dest}" fetch --depth 1 origin "${tag}" || return 1
    git -C "${dest}" checkout --force "${tag}" || return 1
    return 0
  fi
  rm -rf "${dest}"
  git clone --depth 1 --branch "${tag}" "${url}" "${dest}"
}

clone_commit() {
  local url="$1" dest="$2" commit="$3"
  if [[ -d "${dest}/.git" ]]; then
    git -C "${dest}" fetch --depth 1 origin "${commit}" || git -C "${dest}" fetch origin "${commit}"
    git -C "${dest}" checkout --force "${commit}"
    return
  fi
  rm -rf "${dest}"
  git clone --filter=blob:none "${url}" "${dest}"
  git -C "${dest}" checkout --force "${commit}"
}

echo "==> libavif ${LIBAVIF_VERSION}"
clone_tag "${LIBAVIF_URL}" "${VENDOR}/libavif" "${LIBAVIF_VERSION}"

echo "==> dav1d ${DAV1D_VERSION}"
clone_tag "${DAV1D_URL}" "${VENDOR}/dav1d" "${DAV1D_VERSION}"

echo "==> libaom ${AOM_VERSION}"
if ! clone_tag "${AOM_URL}" "${VENDOR}/aom" "${AOM_VERSION}"; then
  echo "git clone of aom failed; falling back to release tarball"
  rm -rf "${VENDOR}/aom"
  mkdir -p "${VENDOR}/aom"
  curl -fsSL "${AOM_TARBALL_URL}" | tar -xz --strip-components=1 -C "${VENDOR}/aom"
fi

echo "==> libyuv ${LIBYUV_VERSION}"
clone_commit "${LIBYUV_URL}" "${VENDOR}/libyuv" "${LIBYUV_VERSION}"

echo "==> libwebp/libsharpyuv ${LIBWEBP_VERSION}"
clone_tag "${LIBWEBP_URL}" "${VENDOR}/libwebp" "${LIBWEBP_VERSION}"

echo "==> vendor sources ready"
