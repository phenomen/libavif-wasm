// Decode-only C glue for libavif + dav1d. Linked into a single-threaded
// SIMD wasm module. Returns an RGBA heap buffer the JS wrapper copies out.

#include <avif/avif.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#ifdef __cplusplus
extern "C" {
#endif

static char g_error[256];

static void set_error(const char *msg) {
    strncpy(g_error, msg ? msg : "unknown error", sizeof(g_error) - 1);
    g_error[sizeof(g_error) - 1] = '\0';
}

EMSCRIPTEN_KEEPALIVE
const char *avif_wasm_last_error(void) { return g_error; }

EMSCRIPTEN_KEEPALIVE
void *avif_wasm_malloc(size_t n) { return malloc(n); }

EMSCRIPTEN_KEEPALIVE
void avif_wasm_free(void *p) { free(p); }

static void set_result_error(avifResult result, const avifDiagnostics *diag) {
    if (diag && diag->error[0]) {
        snprintf(g_error, sizeof(g_error), "%s: %s", avifResultToString(result), diag->error);
    } else {
        set_error(avifResultToString(result));
    }
}

// On success: malloc'd buffer of [int32 width][int32 height][RGBA pixels].
// On failure: NULL and avif_wasm_last_error() is set.
EMSCRIPTEN_KEEPALIVE
uint8_t *avif_wasm_decode(const uint8_t *data, size_t size) {
    g_error[0] = '\0';
    if (!data || size == 0) {
        set_error("empty input");
        return NULL;
    }

    // Declared up front so the cleanup gotos never jump past an initializer.
    uint8_t *out = NULL;
    avifImage *image = NULL;
    avifRGBImage rgb;
    avifResult result;
    avifDecoder *decoder = avifDecoderCreate();
    if (!decoder) {
        set_error("avifDecoderCreate failed");
        return NULL;
    }
    decoder->maxThreads = 1;
    // Metadata is never returned to JS, so skip copying it.
    decoder->ignoreExif = AVIF_TRUE;
    decoder->ignoreXMP = AVIF_TRUE;

    image = avifImageCreateEmpty();
    if (!image) {
        set_error("avifImageCreateEmpty failed");
        goto cleanup;
    }

    result = avifDecoderReadMemory(decoder, image, data, size);
    if (result != AVIF_RESULT_OK) {
        set_result_error(result, &decoder->diag);
        goto cleanup;
    }

    memset(&rgb, 0, sizeof(rgb));
    avifRGBImageSetDefaults(&rgb, image);
    rgb.format = AVIF_RGB_FORMAT_RGBA;
    rgb.depth = 8;
    rgb.maxThreads = 1;
    rgb.rowBytes = rgb.width * 4u;

    // Convert straight into the returned buffer instead of a separate
    // RGB allocation, saving one full-frame copy and its peak memory.
    out = (uint8_t *)malloc(8u + (size_t)rgb.rowBytes * (size_t)rgb.height);
    if (!out) {
        set_error("out of memory");
        goto cleanup;
    }
    rgb.pixels = out + 8;

    result = avifImageYUVToRGB(image, &rgb);
    if (result != AVIF_RESULT_OK) {
        set_result_error(result, NULL);
        free(out);
        out = NULL;
        goto cleanup;
    }

    {
        int32_t dims[2] = {(int32_t)rgb.width, (int32_t)rgb.height};
        memcpy(out, dims, 8);
    }

cleanup:
    if (image) {
        avifImageDestroy(image);
    }
    avifDecoderDestroy(decoder);
    return out;
}

#ifdef __cplusplus
}
#endif
