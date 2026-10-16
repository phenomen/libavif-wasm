#!/usr/bin/env bash
# Reproducible wasm build. Works inside the Dockerfile or with emsdk on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../versions.env
source "${ROOT}/versions.env"

if ! command -v emcc >/dev/null 2>&1; then
  for candidate in /opt/emsdk/emsdk_env.sh "${HOME}/emsdk/emsdk_env.sh" /emsdk/emsdk_env.sh; do
    if [[ -f "${candidate}" ]]; then
      # shellcheck disable=SC1090
      source "${candidate}"
      break
    fi
  done
fi

for tool in emcc em++ emcmake emmake meson ninja cmake pkg-config; do
  command -v "${tool}" >/dev/null 2>&1 || {
    echo "missing required tool: ${tool}" >&2
    exit 1
  }
done

echo "emcc:  $(emcc -v 2>&1 | head -n 1)"
echo "meson: $(meson --version)"
echo "cmake: $(cmake --version | head -n 1)"

JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
VENDOR="${ROOT}/vendor"
BUILD="${ROOT}/build"
PREFIX="${BUILD}/prefix"
DIST="${ROOT}/dist"
COMMON_FLAGS=(-O3 -msimd128 -fno-exceptions -fno-rtti)
export CFLAGS="${COMMON_FLAGS[*]}"
export CXXFLAGS="${COMMON_FLAGS[*]}"
export CMAKE_BUILD_PARALLEL_LEVEL="${JOBS}"

mkdir -p "${PREFIX}/lib/pkgconfig" "${PREFIX}/include" "${DIST}/codec" "${DIST}/licenses"

"${ROOT}/scripts/fetch-deps.sh"

export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"
export EM_PKG_CONFIG_PATH="${PKG_CONFIG_PATH}"
export CMAKE_PREFIX_PATH="${PREFIX}${CMAKE_PREFIX_PATH:+:${CMAKE_PREFIX_PATH}}"

write_pc() {
  local name="$1" version="$2" libs="$3"
  cat > "${PREFIX}/lib/pkgconfig/${name}.pc" <<EOF
prefix=${PREFIX}
exec_prefix=\${prefix}
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: ${name}
Description: ${name} (wasm static)
Version: ${version}
Libs: -L\${libdir} ${libs}
Cflags: -I\${includedir}
EOF
}

# ---------------------------------------------------------------------------
# dav1d (decode) — Meson + Emscripten cross file, asm off
# ---------------------------------------------------------------------------
if [[ ! -f "${PREFIX}/lib/libdav1d.a" ]]; then
  echo "==> building dav1d ${DAV1D_VERSION}"
  rm -rf "${BUILD}/dav1d"
  CROSS_FILE="${BUILD}/emscripten-cross.ini"
  sed "s#exe_wrapper = 'node'#exe_wrapper = ['${ROOT}/scripts/emscripten-exe-wrapper.sh']#" \
    "${ROOT}/src/meson/emscripten-cross.ini" > "${CROSS_FILE}"
  meson setup "${BUILD}/dav1d" "${VENDOR}/dav1d" \
    --cross-file "${CROSS_FILE}" \
    --prefix "${PREFIX}" \
    --libdir lib \
    --default-library static \
    --buildtype release \
    -Denable_asm=false \
    -Denable_tools=false \
    -Denable_examples=false \
    -Denable_tests=false \
    -Dlogging=false
  meson compile -C "${BUILD}/dav1d" -j "${JOBS}"
  meson install -C "${BUILD}/dav1d"
fi

# ---------------------------------------------------------------------------
# libaom (encode) — generic CPU, no examples/tests, encode-focused
# ---------------------------------------------------------------------------
if [[ ! -f "${PREFIX}/lib/libaom.a" ]]; then
  echo "==> building libaom ${AOM_VERSION}"
  rm -rf "${BUILD}/aom"
  emcmake cmake -S "${VENDOR}/aom" -B "${BUILD}/aom" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
    -DAOM_TARGET_CPU=generic \
    -DENABLE_DOCS=0 \
    -DENABLE_EXAMPLES=0 \
    -DENABLE_TESTDATA=0 \
    -DENABLE_TESTS=0 \
    -DENABLE_TOOLS=0 \
    -DCONFIG_ACCOUNTING=0 \
    -DCONFIG_INSPECTION=0 \
    -DCONFIG_RUNTIME_CPU_DETECT=0 \
    -DCONFIG_WEBM_IO=0 \
    -DCONFIG_AV1_DECODER=0 \
    -DCONFIG_AV1_ENCODER=1 \
    -DCONFIG_MULTITHREAD=0 \
    -DCONFIG_AV1_HIGHBITDEPTH=1 \
    -DBUILD_SHARED_LIBS=0
  cmake --build "${BUILD}/aom" --target aom --parallel "${JOBS}"
  # emscripten + encode-only sometimes skips aom.pc / aomenc; install the
  # static library and headers ourselves so cmake --install cannot abort.
  mkdir -p "${PREFIX}/lib/pkgconfig" "${PREFIX}/include/aom"
  cp -a "${BUILD}/aom/libaom.a" "${PREFIX}/lib/"
  cp -a "${VENDOR}/aom/aom/." "${PREFIX}/include/aom/"
  if [[ -f "${BUILD}/aom/aom.pc" ]]; then
    cp -a "${BUILD}/aom/aom.pc" "${PREFIX}/lib/pkgconfig/"
  else
    write_pc aom "${AOM_VERSION#v}" "-laom -lm"
  fi
fi

# ---------------------------------------------------------------------------
# libyuv
# ---------------------------------------------------------------------------
if [[ ! -f "${PREFIX}/lib/libyuv.a" ]]; then
  echo "==> building libyuv ${LIBYUV_VERSION}"
  rm -rf "${BUILD}/libyuv"
  emcmake cmake -S "${VENDOR}/libyuv" -B "${BUILD}/libyuv" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
    -DUNIT_TEST=OFF \
    -DJPEG_FOUND=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON
  cmake --build "${BUILD}/libyuv" --target yuv --parallel "${JOBS}"
  cmake --install "${BUILD}/libyuv" || true
  mkdir -p "${PREFIX}/include/libyuv"
  cp -a "${VENDOR}/libyuv/include/." "${PREFIX}/include/"
  cp -a "${BUILD}/libyuv/libyuv.a" "${PREFIX}/lib/" 2>/dev/null || \
    cp -a "${BUILD}/libyuv/"*/libyuv.a "${PREFIX}/lib/"
  write_pc libyuv "${LIBYUV_VERSION}" "-lyuv"
fi

# ---------------------------------------------------------------------------
# libsharpyuv (from libwebp)
# ---------------------------------------------------------------------------
if [[ ! -f "${PREFIX}/lib/libsharpyuv.a" ]]; then
  echo "==> building libsharpyuv ${LIBWEBP_VERSION}"
  rm -rf "${BUILD}/libwebp"
  emcmake cmake -S "${VENDOR}/libwebp" -B "${BUILD}/libwebp" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
    -DBUILD_SHARED_LIBS=OFF \
    -DWEBP_BUILD_ANIM_UTILS=OFF \
    -DWEBP_BUILD_CWEBP=OFF \
    -DWEBP_BUILD_DWEBP=OFF \
    -DWEBP_BUILD_GIF2WEBP=OFF \
    -DWEBP_BUILD_IMG2WEBP=OFF \
    -DWEBP_BUILD_VWEBP=OFF \
    -DWEBP_BUILD_WEBPINFO=OFF \
    -DWEBP_BUILD_LIBWEBPMUX=OFF \
    -DWEBP_BUILD_WEBPMUX=OFF \
    -DWEBP_BUILD_EXTRAS=OFF \
    -DWEBP_USE_THREAD=OFF \
    -DWEBP_ENABLE_SIMD=OFF
  cmake --build "${BUILD}/libwebp" --target sharpyuv --parallel "${JOBS}"
  cmake --install "${BUILD}/libwebp" || true
  cp -a "${BUILD}/libwebp/libsharpyuv.a" "${PREFIX}/lib/" 2>/dev/null || true
  mkdir -p "${PREFIX}/include/sharpyuv"
  cp -a "${VENDOR}/libwebp/sharpyuv/sharpyuv.h" "${VENDOR}/libwebp/sharpyuv/sharpyuv_csp.h" \
    "${PREFIX}/include/sharpyuv/" 2>/dev/null || true
  if [[ -d "${PREFIX}/include/webp/sharpyuv" && ! -e "${PREFIX}/include/sharpyuv/sharpyuv.h" ]]; then
    ln -sfn ../webp/sharpyuv/sharpyuv.h "${PREFIX}/include/sharpyuv/sharpyuv.h"
    ln -sfn ../webp/sharpyuv/sharpyuv_csp.h "${PREFIX}/include/sharpyuv/sharpyuv_csp.h"
  fi
  if [[ ! -f "${PREFIX}/lib/pkgconfig/libsharpyuv.pc" ]]; then
    write_pc libsharpyuv "${LIBWEBP_VERSION#v}" "-lsharpyuv"
  fi
fi

# ---------------------------------------------------------------------------
# libavif — decode-only (dav1d + libyuv)
# ---------------------------------------------------------------------------
echo "==> building libavif ${LIBAVIF_VERSION} (decode)"
rm -rf "${BUILD}/libavif-decode"
emcmake cmake -S "${VENDOR}/libavif" -B "${BUILD}/libavif-decode" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${BUILD}/prefix-decode" \
  -DBUILD_SHARED_LIBS=OFF \
  -DAVIF_CODEC_DAV1D=SYSTEM \
  -DAVIF_CODEC_AOM=OFF \
  -DAVIF_LIBYUV=SYSTEM \
  -DAVIF_LIBSHARPYUV=OFF \
  -DAVIF_BUILD_APPS=OFF \
  -DAVIF_BUILD_TESTS=OFF \
  -DAVIF_BUILD_EXAMPLES=OFF \
  -DCMAKE_PREFIX_PATH="${PREFIX}" \
  -DCMAKE_FIND_ROOT_PATH="${PREFIX}" \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH \
  -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH \
  -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH
cmake --build "${BUILD}/libavif-decode" --parallel "${JOBS}"
cmake --install "${BUILD}/libavif-decode"

# ---------------------------------------------------------------------------
# libavif — encode-only (libaom encode + libyuv + libsharpyuv)
# ---------------------------------------------------------------------------
echo "==> building libavif ${LIBAVIF_VERSION} (encode)"
rm -rf "${BUILD}/libavif-encode"
emcmake cmake -S "${VENDOR}/libavif" -B "${BUILD}/libavif-encode" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${BUILD}/prefix-encode" \
  -DBUILD_SHARED_LIBS=OFF \
  -DAVIF_CODEC_AOM=SYSTEM \
  -DAVIF_CODEC_AOM_ENCODE=ON \
  -DAVIF_CODEC_AOM_DECODE=OFF \
  -DAVIF_CODEC_DAV1D=OFF \
  -DAVIF_LIBYUV=SYSTEM \
  -DAVIF_LIBSHARPYUV=SYSTEM \
  -DAVIF_BUILD_APPS=OFF \
  -DAVIF_BUILD_TESTS=OFF \
  -DAVIF_BUILD_EXAMPLES=OFF \
  -DCMAKE_PREFIX_PATH="${PREFIX}" \
  -DCMAKE_FIND_ROOT_PATH="${PREFIX}" \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH \
  -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH \
  -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH
cmake --build "${BUILD}/libavif-encode" --parallel "${JOBS}"
cmake --install "${BUILD}/libavif-encode"

# ---------------------------------------------------------------------------
# Link decode / encode ES modules
# ---------------------------------------------------------------------------
# ENVIRONMENT=web,worker keeps Node fs/path out of the glue. Instantiation is
# always via an imported WebAssembly.Module, so no fetch/locateFile is used.
LINK_FLAGS=(
  -O3
  -flto
  -msimd128
  --no-entry
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,worker
  -sFILESYSTEM=0
  -sALLOW_MEMORY_GROWTH=1
  -sALLOW_TABLE_GROWTH=0
  -sASSERTIONS=0
  -sSTACK_OVERFLOW_CHECK=0
  -sMALLOC=emmalloc
  -sEXPORTED_RUNTIME_METHODS=['HEAPU8']
  -sERROR_ON_UNDEFINED_SYMBOLS=1
  -sTEXTDECODER=1
)

echo "==> linking decode module"
emcc -c "${ROOT}/src/c/decode.c" \
  -I"${BUILD}/prefix-decode/include" \
  "${COMMON_FLAGS[@]}" \
  -o "${BUILD}/decode.o"
em++ "${BUILD}/decode.o" \
  "${BUILD}/prefix-decode/lib/libavif.a" \
  "${PREFIX}/lib/libdav1d.a" \
  "${PREFIX}/lib/libyuv.a" \
  "${LINK_FLAGS[@]}" \
  -sEXPORT_NAME=createAvifDecode \
  -sEXPORTED_FUNCTIONS='["_avif_wasm_decode","_avif_wasm_malloc","_avif_wasm_free","_avif_wasm_last_error"]' \
  -sINITIAL_MEMORY=16MB \
  -sSTACK_SIZE=256KB \
  -o "${DIST}/codec/decode.mjs"

echo "==> linking encode module"
emcc -c "${ROOT}/src/c/encode.c" \
  -I"${BUILD}/prefix-encode/include" \
  "${COMMON_FLAGS[@]}" \
  -o "${BUILD}/encode.o"
em++ "${BUILD}/encode.o" \
  "${BUILD}/prefix-encode/lib/libavif.a" \
  "${PREFIX}/lib/libaom.a" \
  "${PREFIX}/lib/libyuv.a" \
  "${PREFIX}/lib/libsharpyuv.a" \
  "${LINK_FLAGS[@]}" \
  -sEXPORT_NAME=createAvifEncode \
  -sEXPORTED_FUNCTIONS='["_avif_wasm_encode","_avif_wasm_malloc","_avif_wasm_free","_avif_wasm_last_error"]' \
  -sINITIAL_MEMORY=32MB \
  -sSTACK_SIZE=1MB \
  -o "${DIST}/codec/encode.mjs"

# Emscripten writes the wasm next to the glue. Move it to dist/ so package
# exports can import @phenomen/libavif-wasm/decode.wasm.
mv -f "${DIST}/codec/decode.wasm" "${DIST}/decode.wasm"
mv -f "${DIST}/codec/encode.wasm" "${DIST}/encode.wasm"

# Patch glue so default locateFile (unused when init(module) is used) would
# still resolve ../decode.wasm if someone instantiates the factory directly.
python3 - <<PY
from pathlib import Path
dist = Path("${DIST}")
for name, wasm in (("decode", "decode.wasm"), ("encode", "encode.wasm")):
    path = dist / "codec" / f"{name}.mjs"
    text = path.read_text()
    text = text.replace(f"{name}.wasm", f"../{wasm}")
    path.write_text(text)
PY

cp -a "${ROOT}/src/js/." "${DIST}/"
# codec/ is already in dist; JS imports ./codec/*.mjs

cp -a "${ROOT}/LICENSE" "${DIST}/"
cp -a "${ROOT}/THIRD_PARTY_NOTICES.md" "${DIST}/"
cp -a "${ROOT}/licenses/." "${DIST}/licenses/"
cp -a "${ROOT}/versions.env" "${DIST}/versions.env"

python3 - <<PY
import json
from pathlib import Path
root = Path("${ROOT}")
vals = {}
for line in (root / "versions.env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k] = v
(root / "dist" / "versions.json").write_text(json.dumps(vals, indent=2) + "\n")
PY

"${ROOT}/scripts/measure-sizes.sh"

echo "==> build complete"
ls -lh "${DIST}/decode.wasm" "${DIST}/encode.wasm"
