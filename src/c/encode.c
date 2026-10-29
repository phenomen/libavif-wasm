// Encode-only C glue for libavif + libaom (+ libyuv / libsharpyuv).
// Input is 8-bit RGBA. The encoder is built without high bit depth, so the
// AVIF payload is 8-bit as well. Output is a malloc'd AVIF byte buffer.

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
// lossless: nonzero forces 4:4:4, the identity matrix, and quantizer 0, so
// decoding returns the exact input pixels. quality and subsample are ignored.
// On success: malloc'd AVIF bytes; *out_size is the length.
// On failure: NULL and avif_wasm_last_error() is set.
EMSCRIPTEN_KEEPALIVE
uint8_t *avif_wasm_encode(const uint8_t *rgba, int width, int height, int quality, int speed,
                          int subsample, int lossless, int *out_size) {
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

    if (lossless) {
        quality = AVIF_QUALITY_LOSSLESS;
        subsample = 444;
    }

    avifPixelFormat format = subsample_to_format(subsample);
    avifImage *image = avifImageCreate(width, height, 8, format);
    if (!image) {
        set_error("avifImageCreate failed");
        return NULL;
    }

    image->colorPrimaries = AVIF_COLOR_PRIMARIES_BT709;
    image->transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_SRGB;
    // Identity stores RGB as-is, which is what makes 8-bit 4:4:4 lossless.
    image->matrixCoefficients =
        lossless ? AVIF_MATRIX_COEFFICIENTS_IDENTITY : AVIF_MATRIX_COEFFICIENTS_BT601;
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
        set_result_error(result, NULL);
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
    if (result != AVIF_RESULT_OK) {
        set_result_error(result, &encoder->diag);
    }
    avifEncoderDestroy(encoder);
    avifImageDestroy(image);

    if (result != AVIF_RESULT_OK) {
        avifRWDataFree(&output);
        return NULL;
    }

    // avifAlloc is plain malloc, so hand the buffer to JS as-is; it is
    // released with avif_wasm_free like every other returned pointer.
    if (out_size) {
        *out_size = (int)output.size;
    }
    return output.data;
}

#ifdef __cplusplus
}
#endif
