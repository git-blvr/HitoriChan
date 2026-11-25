// Server-side GIF renderer: sanitizes a GIF-maker scene spec, rasterizes
// every frame with @napi-rs/canvas using the shared GifScene renderer (the
// same code the dashboard preview runs), then encodes via gifEngine.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { safeFetch } from "./safeFetch.js";
import {
  encodeGif,
  gifCacheKey,
  gifCacheStats,
  gifEngineName,
  gifEngineAvailable,
} from "./gifEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GifScene is a classic script — importing it installs globalThis.GifScene.
await import("../web/public/gifscene.js");
const GifScene = globalThis.GifScene;

// Cap total rasterized pixels so a render can't exhaust memory.
const PIXEL_BUDGET = 40_000_000;
const ASSET_CACHE_MAX = 128;
const assetCache = new Map(); // url -> Image | null

// ---------------------------------------------------------------------------
// Fonts — register the self-hosted dashboard fonts once so text elements
// render identically server-side.
// ---------------------------------------------------------------------------
let fontsDone = false;
function ensureFonts() {
  if (fontsDone) return;
  fontsDone = true;
  const dir = path.join(__dirname, "..", "web", "public", "assets", "fonts");
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".woff2")) continue;
      try {
        GlobalFonts.registerFromPath(path.join(dir, file));
      } catch (err) {
        console.warn(`[gif] font ${file} not registered: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[gif] font dir unavailable: ${err.message}`);
  }
}

async function loadAsset(url) {
  if (assetCache.has(url)) return assetCache.get(url);
  let img = null;
  try {
    const { buffer } = await safeFetch(url, { maxBytes: 8 * 1024 * 1024 });
    img = await loadImage(buffer);
  } catch (err) {
    console.warn(`[gif] asset failed ${url.slice(0, 120)}: ${err.message}`);
  }
  assetCache.set(url, img);
  if (assetCache.size > ASSET_CACHE_MAX) {
    assetCache.delete(assetCache.keys().next().value);
  }
  return img;
}

export function gifEngineInfo() {
  return {
    engine: gifEngineName(),
    native: gifEngineAvailable(),
    cache: gifCacheStats(),
  };
}

/**
 * @param {object} spec - raw GIF-maker scene spec (sanitized here)
 * @returns {Promise<{gif: Buffer, meta: object}>}
 */
export async function renderGifScene(spec) {
  ensureFonts();
  const clean = GifScene.sanitizeSpec(spec);
  const { width: W, height: H } = clean;

  // Bound total work: shrink fps until W*H*frames fits the budget.
  let fps = clean.fps;
  let frameCount = Math.max(1, Math.round((clean.durationMs * fps) / 1000));
  while (frameCount * W * H > PIXEL_BUDGET && fps > 1) {
    fps -= 1;
    frameCount = Math.max(1, Math.round((clean.durationMs * fps) / 1000));
  }
  const delayMs = 1000 / fps;

  const urls = GifScene.collectImageSources(clean);
  const assets = {};
  await Promise.all(
    urls.map(async (u) => {
      assets[u] = await loadAsset(u);
    })
  );

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const frames = Buffer.alloc(frameCount * W * H * 4);
  const delays = new Array(frameCount).fill(delayMs);
  const stride = W * H * 4;

  for (let f = 0; f < frameCount; f++) {
    GifScene.drawScene(ctx, clean, f * delayMs, assets);
    const img = ctx.getImageData(0, 0, W, H);
    Buffer.from(img.data.buffer, img.data.byteOffset, stride).copy(frames, f * stride);
  }

  const cacheKey = gifCacheKey({ spec: clean, fps });
  const { gif, engine, cached } = await encodeGif({
    width: W,
    height: H,
    frames,
    delays,
    cacheKey,
    options: {
      repeat: clean.loop ? 0 : -1,
      quality: 90,
      speed: 4,
    },
  });

  return {
    gif,
    meta: {
      engine,
      cached,
      frames: frameCount,
      fps,
      width: W,
      height: H,
      bytes: gif.length,
    },
  };
}
