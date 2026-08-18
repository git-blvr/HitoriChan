import { loadImage, createCanvas } from '@napi-rs/canvas';

export async function extractImageColor(source) {
    try {
        const img = await loadImage(source);
        const size = 64;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);

        const { data } = ctx.getImageData(0, 0, size, size);
        const bins = new Map();

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < 128) continue;

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            if (max - min < 30) continue;

            const key = `${r >> 4},${g >> 4},${b >> 4}`;
            const bin = bins.get(key) || { r: 0, g: 0, b: 0, count: 0 };
            bin.r += r;
            bin.g += g;
            bin.b += b;
            bin.count++;
            bins.set(key, bin);
        }

        let best = null;
        for (const bin of bins.values()) {
            if (!best || bin.count > best.count) best = bin;
        }

        if (!best) return null;

        const r = Math.round(best.r / best.count);
        const g = Math.round(best.g / best.count);
        const b = Math.round(best.b / best.count);
        return (r << 16) | (g << 8) | b;
    } catch (err) {
        console.error('Failed to extract image color:', err);
        return null;
    }
}
