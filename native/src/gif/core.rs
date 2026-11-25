//! Core GIF encode pipeline: per-frame quantization (imagequant),
//! transparency-based frame differencing, minimal-rect cropping and
//! LZW encoding via the `gif` crate. No napi types in here so the
//! engine stays usable from plain Rust.

use gif::{DisposalMethod, Encoder, Frame, Repeat};
use imagequant::{Attributes, RGBA};

pub const MAX_DIMENSION: u32 = 4096;
pub const MAX_FRAMES: usize = 2000;

#[derive(Clone, Copy, Debug)]
pub struct Options {
    /// Upper quantization quality bound, 0-100.
    pub quality: u8,
    /// Quantizer speed, 1 (best) .. 10 (fastest).
    pub speed: u8,
    /// Max palette entries per frame, <= 256.
    pub max_colors: u16,
    /// Dither strength 0.0 - 1.0.
    pub dither: f32,
    /// -1 = play once, 0 = loop forever, n = repeat n extra times.
    pub repeat: i32,
    /// Per-channel delta under which a pixel is considered unchanged.
    pub tolerance: u8,
    /// Emit minimal diff-rects with transparency when true.
    pub optimize: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            quality: 90,
            speed: 4,
            max_colors: 256,
            dither: 1.0,
            repeat: 0,
            tolerance: 0,
            optimize: true,
        }
    }
}

pub struct PreparedFrame {
    pub left: u16,
    pub top: u16,
    pub width: u16,
    pub height: u16,
    /// Frame delay in centiseconds (GIF time unit).
    pub delay_cs: u16,
    pub transparent: Option<u8>,
    /// RGB triples, padded to a power-of-two entry count.
    pub palette: Vec<u8>,
    pub indices: Vec<u8>,
}

pub struct Pipeline {
    w: usize,
    h: usize,
    opts: Options,
    /// Composited output model (decoder state). Only two alpha values are
    /// used: 0 (nothing drawn yet / fully transparent) and 255.
    canvas: Vec<u8>,
    has_canvas: bool,
    frames: Vec<PreparedFrame>,
}

type GifResult<T> = Result<T, String>;

fn delay_to_cs(delay_ms: u32) -> u16 {
    ((delay_ms as u64 + 5) / 10).clamp(2, u16::MAX as u64) as u16
}

#[inline]
fn channel_delta(a: &[u8], b: &[u8], at: usize) -> u16 {
    (a[at] as i16 - b[at] as i16).unsigned_abs()
        + (a[at + 1] as i16 - b[at + 1] as i16).unsigned_abs()
        + (a[at + 2] as i16 - b[at + 2] as i16).unsigned_abs()
}

/// Pad an RGB palette to a power-of-two entry count (GIF requirement).
fn pad_palette(rgb: Vec<u8>) -> Vec<u8> {
    let entries = rgb.len() / 3;
    let mut target = 2usize;
    while target < entries {
        target <<= 1;
    }
    let mut out = rgb;
    out.resize(target * 3, 0);
    out
}

impl Pipeline {
    pub fn new(width: u32, height: u32, opts: Options) -> GifResult<Self> {
        if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
            return Err(format!(
                "invalid dimensions {width}x{height} (max {MAX_DIMENSION})"
            ));
        }
        Ok(Self {
            w: width as usize,
            h: height as usize,
            opts,
            canvas: vec![0; (width * height) as usize * 4],
            has_canvas: false,
            frames: Vec::new(),
        })
    }

    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    pub fn reset(&mut self) {
        for px in self.canvas.chunks_exact_mut(4) {
            px[3] = 0;
        }
        self.has_canvas = false;
        self.frames.clear();
    }

    /// Push one RGBA frame. `rgba` must be exactly w*h*4 bytes.
    pub fn push(&mut self, rgba: &[u8], delay_ms: u32) -> GifResult<usize> {
        if self.frames.len() >= MAX_FRAMES {
            return Err(format!("frame limit ({MAX_FRAMES}) exceeded"));
        }
        if rgba.len() != self.w * self.h * 4 {
            return Err(format!(
                "frame buffer is {} bytes, expected {}",
                rgba.len(),
                self.w * self.h * 4
            ));
        }
        let delay_cs = delay_to_cs(delay_ms);
        let n = self.w * self.h;
        let tol = self.opts.tolerance as u16 * 3;

        // Classify pixels: CHANGED (emitted opaque), or transparent
        // (decoder keeps showing the previous canvas).
        let mut opaque = vec![false; n];
        if self.opts.optimize && self.has_canvas {
            for i in 0..n {
                let a = rgba[i * 4 + 3];
                if a < 128 {
                    continue; // transparent source -> canvas shows through
                }
                let ca = self.canvas[i * 4 + 3];
                if ca == 0 {
                    opaque[i] = true; // canvas had nothing here
                    continue;
                }
                if channel_delta(&self.canvas, rgba, i * 4) > tol {
                    opaque[i] = true;
                }
            }
        } else {
            for i in 0..n {
                opaque[i] = rgba[i * 4 + 3] >= 128;
            }
        }

        // Bounding box of changed pixels.
        let mut min_x = self.w;
        let mut min_y = self.h;
        let mut max_x = 0usize;
        let mut max_y = 0usize;
        let mut any = false;
        for y in 0..self.h {
            for x in 0..self.w {
                if !opaque[y * self.w + x] {
                    continue;
                }
                any = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }

        if !any {
            // Nothing changed: 1x1 fully transparent keep-frame.
            self.frames.push(PreparedFrame {
                left: 0,
                top: 0,
                width: 1,
                height: 1,
                delay_cs,
                transparent: Some(0),
                palette: vec![0; 6],
                indices: vec![0],
            });
            // Canvas unchanged. Still counts as a frame for timing.
            self.has_canvas = true;
            return Ok(self.frames.len() - 1);
        }

        let rw = max_x - min_x + 1;
        let rh = max_y - min_y + 1;

        // Quantize the changed rect. Transparent pixels are marked a=0 so
        // imagequant reserves palette slots for them.
        let has_transparent = (0..rh).any(|y| {
            (0..rw).any(|x| !opaque[(min_y + y) * self.w + (min_x + x)])
        });
        let mut pixels: Vec<RGBA> = Vec::with_capacity(rw * rh);
        for y in 0..rh {
            for x in 0..rw {
                let i = (min_y + y) * self.w + (min_x + x);
                if opaque[i] {
                    pixels.push(RGBA::new(
                        rgba[i * 4],
                        rgba[i * 4 + 1],
                        rgba[i * 4 + 2],
                        255,
                    ));
                } else {
                    pixels.push(RGBA::new(0, 0, 0, 0));
                }
            }
        }

        let mut attr = Attributes::new();
        let _ = attr.set_speed(self.opts.speed.clamp(1, 10) as i32);
        let _ = attr.set_quality(0, self.opts.quality.clamp(0, 100));
        let _ = attr.set_max_colors(self.opts.max_colors.clamp(2, 256) as u32);
        let mut img = attr
            .new_image(pixels, rw, rh, 0.0)
            .map_err(|e| format!("image init failed: {e}"))?;
        let mut res = attr
            .quantize(&mut img)
            .map_err(|e| format!("quantize failed: {e}"))?;
        let _ = res.set_dithering_level(self.opts.dither.clamp(0.0, 1.0));
        let (palette, mut indices) = res
            .remapped(&mut img)
            .map_err(|e| format!("remap failed: {e}"))?;

        // Resolve THE transparent index: first palette entry with a<128.
        // If the frame needs one but none was produced, append it.
        let mut pal_rgba: Vec<RGBA> = palette;
        let mut transparent = pal_rgba
            .iter()
            .position(|c| c.a < 128)
            .map(|i| i as u8);
        if has_transparent && transparent.is_none() {
            if pal_rgba.len() < 256 {
                pal_rgba.push(RGBA::new(0, 0, 0, 0));
                transparent = Some((pal_rgba.len() - 1) as u8);
            } else {
                transparent = Some(0);
            }
        }
        if let Some(t) = transparent {
            for (k, ix) in indices.iter_mut().enumerate() {
                let row = k / rw;
                let col = k % rw;
                let src = (min_y + row) * self.w + (min_x + col);
                if !opaque[src] || pal_rgba[*ix as usize].a < 128 {
                    *ix = t;
                }
            }
        }

        // Palette -> padded RGB triples.
        let mut pal_rgb = Vec::with_capacity(pal_rgba.len() * 3);
        for c in &pal_rgba {
            pal_rgb.extend_from_slice(&[c.r, c.g, c.b]);
        }
        let pal_rgb = pad_palette(pal_rgb);

        // Update the composited model: opaque pixels overwrite the canvas.
        for y in 0..rh {
            for x in 0..rw {
                let i = (min_y + y) * self.w + (min_x + x);
                if opaque[i] {
                    let c = i * 4;
                    self.canvas[c] = rgba[c];
                    self.canvas[c + 1] = rgba[c + 1];
                    self.canvas[c + 2] = rgba[c + 2];
                    self.canvas[c + 3] = 255;
                }
            }
        }
        self.has_canvas = true;

        self.frames.push(PreparedFrame {
            left: min_x as u16,
            top: min_y as u16,
            width: rw as u16,
            height: rh as u16,
            delay_cs,
            transparent,
            palette: pal_rgb,
            indices,
        });
        Ok(self.frames.len() - 1)
    }

    /// Encode all prepared frames to a GIF89a byte stream.
    pub fn encode(&self) -> GifResult<Vec<u8>> {
        if self.frames.is_empty() {
            return Err("no frames to encode".into());
        }
        let mut out = Vec::new();
        {
            let mut enc = Encoder::new(&mut out, self.w as u16, self.h as u16, &[])
                .map_err(|e| format!("gif init failed: {e}"))?;
            match self.opts.repeat {
                r if r < 0 => {} // no Netscape block -> plays once
                0 => enc
                    .set_repeat(Repeat::Infinite)
                    .map_err(|e| format!("repeat failed: {e}"))?,
                n => enc
                    .set_repeat(Repeat::Finite(n.min(u16::MAX as i32) as u16))
                    .map_err(|e| format!("repeat failed: {e}"))?,
            }
            for f in &self.frames {
                let mut frame =
                    Frame::from_indexed_pixels(f.width, f.height, &f.indices[..], f.transparent);
                frame.left = f.left;
                frame.top = f.top;
                frame.delay = f.delay_cs;
                frame.dispose = DisposalMethod::Keep;
                frame.palette = Some(f.palette.clone());
                enc.write_frame(&frame)
                    .map_err(|e| format!("write frame failed: {e}"))?;
            }
        }
        Ok(out)
    }
}
