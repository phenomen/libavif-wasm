# Reproducible toolchain on the official emscripten/emsdk image.
# scripts/docker-build.sh passes EMSDK_VERSION from versions.env; the default
# here only applies to a bare `docker build`.
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

# The official image entrypoint activates emsdk. The repo is mounted at /src:
#   npm run build:docker   (or ./scripts/docker-build.sh)
CMD ["./scripts/build.sh"]
