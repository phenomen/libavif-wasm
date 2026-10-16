// Encode-only C glue for libavif + libaom (+ libyuv / libsharpyuv).
// Input is 8-bit RGBA ImageData; output is a malloc'd AVIF byte buffer.

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

static avifPixelFormat subsample_to_format(int subsample) {
    switch (subsample) {
        case 444:
            return AVIF_PIXEL_FORMAT_YUV444;
        case 422:
            return AVIF_PIXEL_FORMAT_YUV422;
        case 400:
            return AVIF_PIXEL_FORMAT_YUV400;
        default:
            return AVIF_PIXEL_FORMAT_YUV420;
    }
}

static int has_transparency(const uint8_t *rgba, int width, int height) {
    const size_t n = (size_t)width * (size_t)height;
    for (size_t i = 0; i < n; i++) {
        if (rgba[i * 4u + 3u] != 255u) {
            return 1;
        }
    }
    return 0;
}

// subsample: 420, 422, 444, or 400.
// On success: malloc'd AVIF bytes; *out_size is the length.
// On failure: NULL and avif_wasm_last_error() is set.
EMSCRIPTEN_KEEPALIVE
uint8_t *avif_wasm_encode(const uint8_t *rgba, int width, int height, int quality, int speed,
                          int subsample, int bit_depth, int *out_size) {
    g_error[0] = '\0';
    if (out_size) {
        *out_size = 0;
    }
    if (!rgba || width <= 0 || height <= 0) {
        set_error("invalid image dimensions");
        return NULL;
    }
    if (quality < 0) {
        quality = 60;
    }
    if (quality > 100) {
        quality = 100;
    }
    if (speed < 0) {
        speed = 6;
    }
    if (speed > 10) {
        speed = 10;
    }
    if (bit_depth != 8 && bit_depth != 10 && bit_depth != 12) {
        set_error("bitDepth must be 8, 10, or 12");
        return NULL;
    }

    avifPixelFormat format = subsample_to_format(subsample);
    avifImage *image = avifImageCreate(width, height, bit_depth, format);
    if (!image) {
        set_error("avifImageCreate failed");
        return NULL;
    }

    image->colorPrimaries = AVIF_COLOR_PRIMARIES_BT709;
    image->transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_SRGB;
    image->matrixCoefficients = AVIF_MATRIX_COEFFICIENTS_BT601;
    image->yuvRange = AVIF_RANGE_FULL;

    avifRGBImage rgb;
    memset(&rgb, 0, sizeof(rgb));
    avifRGBImageSetDefaults(&rgb, image);
    rgb.format = AVIF_RGB_FORMAT_RGBA;
    rgb.depth = 8;
    rgb.pixels = (uint8_t *)rgba;
    rgb.rowBytes = (uint32_t)width * 4u;
    rgb.ignoreAlpha = has_transparency(rgba, width, height) ? AVIF_FALSE : AVIF_TRUE;
    rgb.maxThreads = 1;

    avifResult result = avifImageRGBToYUV(image, &rgb);
    if (result != AVIF_RESULT_OK) {
        set_error(avifResultToString(result));
        avifImageDestroy(image);
        return NULL;
    }

    avifEncoder *encoder = avifEncoderCreate();
    if (!encoder) {
        set_error("avifEncoderCreate failed");
        avifImageDestroy(image);
        return NULL;
    }
    encoder->maxThreads = 1;
    encoder->quality = quality;
    encoder->qualityAlpha = quality;
    encoder->speed = speed;

    avifRWData output = AVIF_DATA_EMPTY;
    result = avifEncoderWrite(encoder, image, &output);
    avifEncoderDestroy(encoder);
    avifImageDestroy(image);

    if (result != AVIF_RESULT_OK) {
        set_error(avifResultToString(result));
        avifRWDataFree(&output);
        return NULL;
    }

    uint8_t *out = (uint8_t *)malloc(output.size);
    if (!out) {
        set_error("out of memory");
        avifRWDataFree(&output);
        return NULL;
    }
    memcpy(out, output.data, output.size);
    if (out_size) {
        *out_size = (int)output.size;
    }
    avifRWDataFree(&output);
    return out;
}
