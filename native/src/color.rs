use image::imageops::FilterType;
use napi::bindgen_prelude::Buffer;
use napi::Result;
use std::collections::HashMap;

const SIZE: u32 = 64;
const FALLBACK: u32 = 0x2f3136;

struct Bucket {
    r: f64,
    g: f64,
    b: f64,
    count: f64,
}

/// Dominant color of an image buffer (png/jpeg/gif/webp), matching the
/// algorithm in src/utils/color_utils.js: resize to 64x64, bucket pixels
/// by (r>>3, g>>3, b>>3) weighted by saturation, skip transparent,
/// near-white and near-black pixels, return the winning bucket's mean.
#[napi(js_name = "dominantColor")]
pub fn dominant_color(buffer: Buffer) -> Result<u32> {
    let bytes: &[u8] = buffer.as_ref();
    let img = image::load_from_memory(bytes)
        .map_err(|e| napi::Error::from_reason(format!("image decode failed: {e}")))?;
    let rgba = img
        .resize_exact(SIZE, SIZE, FilterType::Triangle)
        .to_rgba8();

    let mut buckets: HashMap<u32, Bucket> = HashMap::new();
    let mut order: Vec<u32> = Vec::new();

    for px in rgba.pixels() {
        let (r, g, b, a) = (px[0], px[1], px[2], px[3]);
        if a < 128 {
            continue;
        }
        let (max, min) = (r.max(g).max(b), r.min(g).min(b));
        if max > 240 && min > 225 {
            continue;
        }
        if max < 15 {
            continue;
        }
        let saturation = if max == 0 {
            0.0
        } else {
            (max - min) as f64 / max as f64
        };
        let weight = 1.0 + saturation * 3.0;
        let key = ((r as u32 >> 3) << 10) | ((g as u32 >> 3) << 5) | (b as u32 >> 3);

        match buckets.get_mut(&key) {
            Some(bucket) => {
                bucket.r += r as f64 * weight;
                bucket.g += g as f64 * weight;
                bucket.b += b as f64 * weight;
                bucket.count += weight;
            }
            None => {
                order.push(key);
                buckets.insert(
                    key,
                    Bucket {
                        r: r as f64 * weight,
                        g: g as f64 * weight,
                        b: b as f64 * weight,
                        count: weight,
                    },
                );
            }
        }
    }

    let mut best: Option<&Bucket> = None;
    for key in &order {
        let bucket = &buckets[key];
        if best.map_or(true, |b| bucket.count > b.count) {
            best = Some(bucket);
        }
    }

    let Some(best) = best else {
        return Ok(FALLBACK);
    };
    let r = (best.r / best.count).round() as u32;
    let g = (best.g / best.count).round() as u32;
    let b = (best.b / best.count).round() as u32;
    Ok((r << 16) + (g << 8) + b)
}
