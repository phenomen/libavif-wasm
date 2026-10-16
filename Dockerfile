# Reproducible toolchain. Version is read from versions.env at image build time
# so bumping EMSDK_VERSION rebuilds against a new official emscripten/emsdk tag.
ARG EMSDK_VERSION=6.0.12
FROM emscripten/emsdk:${EMSDK_VERSION}

# dav1d is built with Meson + Ninja against the Emscripten cross file.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        meson \
        ninja-build \
        pkg-config \
        python3 \
        ca-certificates \
        curl \
        gzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# The official image entrypoint activates emsdk. Mount the repo at /src and run:
#   docker build --build-arg EMSDK_VERSION=6.0.12 -t libavif-wasm-builder .
#   docker run --rm -v "$PWD":/src -u "$(id -u):$(id -g)" libavif-wasm-builder ./scripts/build.sh
CMD ["./scripts/build.sh"]
