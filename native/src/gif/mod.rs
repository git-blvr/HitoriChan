//! GIF engine — napi surface.
//!
//! `GifEngine` is the streaming API (add_frame per RGBA buffer, finish to
//! get GIF bytes). `encodeGif` is the one-shot API — it runs the whole
//! pipeline on a libuv worker thread via AsyncTask so the Node event loop
//! never blocks. `gifCache*` functions expose the built-in result cache.

mod cache;
mod core;

pub use cache::*;

use core::{Options, Pipeline};
use napi::bindgen_prelude::*;
use napi::{Env, Task};

#[napi(object)]
#[derive(Clone, Copy, Default)]
pub struct GifEncodeOptions {
    /// Quantization quality cap, 0-100 (default 90).
    pub quality: Option<u8>,
    /// Quantizer speed 1-10 (default 4).
    pub speed: Option<u8>,
    /// Max palette entries per frame, <=256 (default 256).
    pub max_colors: Option<u16>,
    /// Dither strength 0-1 (default 1.0).
    pub dither: Option<f64>,
    /// -1 = play once, 0 = infinite, n = repeat count (default 0).
    pub repeat: Option<i32>,
    /// Per-channel delta under which a pixel is reused (default 0).
    pub tolerance: Option<u8>,
    /// Frame-difference optimization (default true).
    pub optimize: Option<bool>,
}

impl From<GifEncodeOptions> for Options {
    fn from(o: GifEncodeOptions) -> Self {
        let d = Options::default();
        Options {
            quality: o.quality.unwrap_or(d.quality),
            speed: o.speed.unwrap_or(d.speed),
            max_colors: o.max_colors.unwrap_or(d.max_colors),
            dither: o.dither.unwrap_or(d.dither as f64) as f32,
            repeat: o.repeat.unwrap_or(d.repeat),
            tolerance: o.tolerance.unwrap_or(d.tolerance),
            optimize: o.optimize.unwrap_or(d.optimize),
        }
    }
}

#[napi]
pub struct GifEngine {
    pipe: Pipeline,
}

#[napi]
impl GifEngine {
    #[napi(constructor)]
    pub fn new(width: u32, height: u32, options: Option<GifEncodeOptions>) -> Result<Self> {
        let pipe = Pipeline::new(width, height, options.unwrap_or_default().into())
            .map_err(napi::Error::from_reason)?;
        Ok(Self { pipe })
    }

    /// Push one RGBA frame (must be exactly width*height*4 bytes).
    /// Returns the new frame count.
    #[napi(js_name = "addFrame")]
    pub fn add_frame(&mut self, rgba: Buffer, delay_ms: Option<u32>) -> Result<u32> {
        self.pipe
            .push(rgba.as_ref(), delay_ms.unwrap_or(100))
            .map(|n| n as u32 + 1)
            .map_err(napi::Error::from_reason)
    }

    /// Encode everything pushed so far into GIF bytes.
    /// The engine keeps its state — call `reset()` to reuse it.
    #[napi]
    pub fn finish(&mut self) -> Result<Buffer> {
        self.pipe.encode().map(Buffer::from).map_err(napi::Error::from_reason)
    }

    #[napi(js_name = "frameCount")]
    pub fn frame_count(&self) -> u32 {
        self.pipe.frame_count() as u32
    }

    #[napi]
    pub fn reset(&mut self) {
        self.pipe.reset();
    }
}

pub struct EncodeGifTask {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    delays: Vec<u32>,
    options: GifEncodeOptions,
}

impl Task for EncodeGifTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut pipe = Pipeline::new(self.width, self.height, self.options.into())
            .map_err(napi::Error::from_reason)?;
        let stride = (self.width * self.height * 4) as usize;
        for (i, delay) in self.delays.iter().enumerate() {
            let start = i * stride;
            pipe.push(&self.rgba[start..start + stride], *delay)
                .map_err(napi::Error::from_reason)?;
        }
        pipe.encode().map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

/// One-shot async encode. `frames` is a single buffer containing every
/// frame's RGBA pixels back to back (frames_i = delays_i slices of w*h*4).
/// Returns a Promise<Buffer>.
#[napi(js_name = "encodeGif")]
pub fn encode_gif(
    width: u32,
    height: u32,
    frames: Buffer,
    delays: Vec<u32>,
    options: Option<GifEncodeOptions>,
) -> Result<AsyncTask<EncodeGifTask>> {
    let frame_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| napi::Error::from_reason("dimensions overflow"))?;
    if frame_bytes == 0 || delays.is_empty() {
        return Err(napi::Error::from_reason("width/height/delays required"));
    }
    if delays.len() > core::MAX_FRAMES {
        return Err(napi::Error::from_reason(format!(
            "frame limit ({}) exceeded",
            core::MAX_FRAMES
        )));
    }
    if frames.len() != frame_bytes * delays.len() {
        return Err(napi::Error::from_reason(format!(
            "frames buffer is {} bytes, expected {} ({} frames x {} bytes)",
            frames.len(),
            frame_bytes * delays.len(),
            delays.len(),
            frame_bytes
        )));
    }
    Ok(AsyncTask::new(EncodeGifTask {
        width,
        height,
        rgba: frames.to_vec(),
        delays,
        options: options.unwrap_or_default(),
    }))
}
