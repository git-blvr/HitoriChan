// GIF engine — single entry point for GIF encoding.
//
// Two backends:
//  - "native": the Rust engine in native/src/gif/ (imagequant palettes,
//    diff-rect optimization, LZW via the gif crate, async worker thread,
//    built-in LRU result cache).
//  - "js": the bundled pure-JS fallback (fixed 256-color palette, LZW),
//    used automatically when the native module isn't built.
//
// Caching: callers pass a cacheKey (hash of everything that determines the
// output — scene spec, size, fps, fonts, image URLs). On a hit the cached
// GIF bytes are returned with `cached: true` and no re-encode happens.

import { createHash } from "node:crypto";
import native, { nativeAvailable } from "../native/index.js";

const TRANSPARENT_INDEX = 255;

// ---------------------------------------------------------------------------
// Pure-JS fallback encoder (GIF89a, global 256-entry palette, LZW).
// ---------------------------------------------------------------------------
function buildFallbackPalette() {
  const pal = new Uint8Array(768);
  let i = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) {
        pal[i * 3] = r * 51;
        pal[i * 3 + 1] = g * 51;
        pal[i * 3 + 2] = b * 51;
        i++;
      }
  for (let k = 0; k < 39; k++) {
    const v = Math.round((k * 255) / 38);
    pal[i * 3] = v;
    pal[i * 3 + 1] = v;
    pal[i * 3 + 2] = v;
    i++;
  }
  // index 255 stays (0,0,0) — the transparency slot.
  return pal;
}

function pixelToIndex(r, g, b, a) {
  if (a < 128) return TRANSPARENT_INDEX;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 18) {
    return 216 + Math.min(38, Math.round((((r + g + b) / 3) * 38) / 255));
  }
  return Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51);
}

// LZW compressor — mirrors omggif's proven code-size/clear rules.
function lzwEncode(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let curCodeSize = minCodeSize + 1;
  const dict = new Map();
  const bytes = [];
  let cur = 0;
  let shift = 0;

  const emit = (code) => {
    cur |= code << shift;
    shift += curCodeSize;
    while (shift >= 8) {
      bytes.push(cur & 0xff);
      cur >>>= 8;
      shift -= 8;
    }
  };

  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      nextCode = eoiCode + 1;
      curCodeSize = minCodeSize + 1;
      dict.clear();
    } else {
      if (nextCode >= 1 << curCodeSize) curCodeSize++;
      dict.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (shift > 0) bytes.push(cur & 0xff);
  return bytes;
}

function encodeGifJS(width, height, frames, delays, { repeat = 0 } = {}) {
  const palette = buildFallbackPalette();
  const npix = width * height;
  const out = [];

  // Header + Logical Screen Descriptor + Global Color Table
  out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  out.push(width & 0xff, width >> 8, height & 0xff, height >> 8);
  out.push(0xf7, 0, 0); // GCT present, 8-bit res, 256 entries; bg 0; square px
  for (const b of palette) out.push(b);

  // Netscape looping extension (skipped entirely for play-once)
  if (repeat >= 0) {
    const count = repeat === 0 ? 0 : repeat; // 0 = infinite in the ext
    out.push(0x21, 0xff, 0x0b);
    for (const c of "NETSCAPE2.0") out.push(c.charCodeAt(0));
    out.push(0x03, 0x01, count & 0xff, count >> 8, 0x00);
  }

  for (let f = 0; f < delays.length; f++) {
    const rgba = frames.subarray(f * npix * 4, (f + 1) * npix * 4);
    const indices = new Uint8Array(npix);
    let hasTransparent = false;
    for (let i = 0; i < npix; i++) {
      const idx = pixelToIndex(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]);
      if (idx === TRANSPARENT_INDEX) hasTransparent = true;
      indices[i] = idx;
    }

    const delayCs = Math.min(65535, Math.max(2, Math.round((delays[f] ?? 100) / 10)));
    // Graphics Control Extension (always emitted — delay + disposal + trans flag)
    out.push(0x21, 0xf9, 0x04, (1 << 2) | (hasTransparent ? 1 : 0), delayCs & 0xff, delayCs >> 8,
      hasTransparent ? TRANSPARENT_INDEX : 0, 0x00);
    // Image Descriptor — full-size frame, no local palette
    out.push(0x2c, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8, 0x00);
    // LZW data
    out.push(8);
    const data = lzwEncode(indices, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0x00);
  }

  out.push(0x3b);
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function gifEngineAvailable() {
  return nativeAvailable && typeof native?.encodeGif === "function";
}

export function gifEngineName() {
  return gifEngineAvailable() ? "rust" : "js";
}

/** Stable cache key from any JSON-serializable input. */
export function gifCacheKey(input) {
  return createHash("sha256")
    .update(typeof input === "string" ? input : JSON.stringify(input))
    .digest("hex")
    .slice(0, 40);
}

export function gifCacheStats() {
  if (!gifEngineAvailable()) return null;
  try {
    return native.gifCacheStats();
  } catch {
    return null;
  }
}

export function gifCacheClear() {
  if (gifEngineAvailable()) native.gifCacheClear();
}

/**
 * Encode RGBA frames to a GIF.
 * @param {object} params
 * @param {number} params.width
 * @param {number} params.height
 * @param {Buffer} params.frames  every frame back-to-back (w*h*4 bytes each)
 * @param {number[]} params.delays per-frame delay in ms
 * @param {object} [params.options] {quality, speed, maxColors, dither, repeat, tolerance, optimize}
 * @param {string} [params.cacheKey] enables the native result cache
 * @returns {Promise<{gif: Buffer, engine: string, cached: boolean}>}
 */
export async function encodeGif({ width, height, frames, delays, options = {}, cacheKey = null }) {
  const opts = {
    quality: options.quality ?? 90,
    speed: options.speed ?? 4,
    maxColors: options.maxColors ?? 256,
    dither: options.dither ?? 1.0,
    repeat: options.repeat ?? 0,
    tolerance: options.tolerance ?? 0,
    optimize: options.optimize ?? true,
  };

  if (gifEngineAvailable()) {
    if (cacheKey) {
      const hit = native.gifCacheGet(cacheKey);
      if (hit) return { gif: hit, engine: "rust", cached: true };
    }
    const gif = await native.encodeGif(width, height, frames, delays, {
      quality: opts.quality,
      speed: opts.speed,
      maxColors: opts.maxColors,
      dither: opts.dither,
      repeat: opts.repeat,
      tolerance: opts.tolerance,
      optimize: opts.optimize,
    });
    if (cacheKey) native.gifCacheSet(cacheKey, gif);
    return { gif, engine: "rust", cached: false };
  }

  // JS fallback — synchronous, no cache.
  const gif = encodeGifJS(width, height, frames, delays, { repeat: opts.repeat });
  return { gif, engine: "js", cached: false };
}
