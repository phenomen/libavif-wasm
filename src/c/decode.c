// Decode-only C glue for libavif + dav1d. Linked into a single-threaded
// SIMD wasm module. Returns an RGBA heap buffer the JS wrapper copies out.

#include <avif/avif.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
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

// On success: malloc'd buffer of [int32 width][int32 height][RGBA pixels].
// On failure: NULL and avif_wasm_last_error() is set.
EMSCRIPTEN_KEEPALIVE
uint8_t *avif_wasm_decode(const uint8_t *data, size_t size) {
    g_error[0] = '\0';
    if (!data || size == 0) {
        set_error("empty input");
        return NULL;
    }

    avifDecoder *decoder = avifDecoderCreate();
    if (!decoder) {
        set_error("avifDecoderCreate failed");
        return NULL;
    }
    decoder->maxThreads = 1;

    avifImage *image = avifImageCreateEmpty();
    if (!image) {
        set_error("avifImageCreateEmpty failed");
        avifDecoderDestroy(decoder);
        return NULL;
    }

    avifResult result = avifDecoderReadMemory(decoder, image, data, size);
    if (result != AVIF_RESULT_OK) {
        set_error(avifResultToString(result));
        avifImageDestroy(image);
        avifDecoderDestroy(decoder);
        return NULL;
    }

    avifRGBImage rgb;
    memset(&rgb, 0, sizeof(rgb));
    avifRGBImageSetDefaults(&rgb, image);
    rgb.format = AVIF_RGB_FORMAT_RGBA;
    rgb.depth = 8;
    rgb.maxThreads = 1;

    result = avifRGBImageAllocatePixels(&rgb);
    if (result != AVIF_RESULT_OK) {
        set_error(avifResultToString(result));
        avifImageDestroy(image);
        avifDecoderDestroy(decoder);
        return NULL;
    }

    result = avifImageYUVToRGB(image, &rgb);
    if (result != AVIF_RESULT_OK) {
        set_error(avifResultToString(result));
        avifRGBImageFreePixels(&rgb);
        avifImageDestroy(image);
        avifDecoderDestroy(decoder);
        return NULL;
    }

    const int width = (int)rgb.width;
    const int height = (int)rgb.height;
    const size_t pixels = (size_t)width * (size_t)height * 4u;
    uint8_t *out = (uint8_t *)malloc(8u + pixels);
    if (!out) {
        set_error("out of memory");
        avifRGBImageFreePixels(&rgb);
        avifImageDestroy(image);
        avifDecoderDestroy(decoder);
        return NULL;
    }

    int32_t dims[2] = {(int32_t)width, (int32_t)height};
    memcpy(out, dims, 8);
    memcpy(out + 8, rgb.pixels, pixels);

    avifRGBImageFreePixels(&rgb);
    avifImageDestroy(image);
    avifDecoderDestroy(decoder);
    return out;
}
