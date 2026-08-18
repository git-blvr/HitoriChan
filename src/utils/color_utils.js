import { loadImage, createCanvas } from "@napi-rs/canvas";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads");

async function resolve_source(source) {
    if (typeof source === "string" && source.startsWith("http")) {
        const res = await fetch(source, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
        const array_buffer = await res.arrayBuffer();
        return Buffer.from(array_buffer);
    }
    if (typeof source === "string" && source.startsWith("attachment://")) {
        const filename = source.slice("attachment://".length);
        if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
            throw new Error(`Invalid attachment filename: ${filename}`);
        }
        return path.join(UPLOAD_DIR, filename);
    }
    return source;
}

export async function get_dominant_color(source) {
    const image = await loadImage(await resolve_source(source));
    const size = 64;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 128) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max > 240 && min > 225) continue;
        if (max < 15) continue;
        const saturation = max === 0 ? 0 : (max - min) / max;
        const weight = 1 + saturation * 3;
        const key = `${r >> 3}_${g >> 3}_${b >> 3}`;
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.r += r * weight;
            bucket.g += g * weight;
            bucket.b += b * weight;
            bucket.count += weight;
        } else {
            buckets.set(key, { r: r * weight, g: g * weight, b: b * weight, count: weight });
        }
    }

    let best = null;
    for (const bucket of buckets.values()) {
        if (!best || bucket.count > best.count) best = bucket;
    }

    if (!best) return 0x2f3136;
    const r = Math.round(best.r / best.count);
    const g = Math.round(best.g / best.count);
    const b = Math.round(best.b / best.count);
    return (r << 16) + (g << 8) + b;
}

export async function apply_dominant_color(target, source) {
    let obj = null;
    let src;
    if (source === undefined) {
        src = target;
    } else {
        obj = target;
        src = source;
    }

    try {
        const color = await get_dominant_color(src.attachment ?? src);
        if (!obj) return color;
        if (typeof obj.setColor === "function") return obj.setColor(color);
        if (typeof obj.setAccentColor === "function") return obj.setAccentColor(color);
        return color;
    } catch (err) {
        console.error("Dominant color error:", err.message);
        if (!obj) return 0x2f3136;
        if (typeof obj.setColor === "function") return obj.setColor(0x2f3136);
        if (typeof obj.setAccentColor === "function") return obj.setAccentColor(0x2f3136);
        return 0x2f3136;
    }
}