//! In-process LRU cache for encoded GIF output. Keyed by a caller-supplied
//! string (the JS layer hashes the full scene spec); capacity-bounded in
//! both bytes and entries, with hit/miss accounting.

use napi::bindgen_prelude::Buffer;
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

const DEFAULT_CAPACITY_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES: usize = 256;

struct Entry {
    data: Vec<u8>,
}

pub struct GifCache {
    map: HashMap<String, Entry>,
    order: VecDeque<String>,
    bytes: usize,
    capacity: usize,
    max_entries: usize,
    hits: u64,
    misses: u64,
}

impl GifCache {
    fn new() -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            capacity: DEFAULT_CAPACITY_BYTES,
            max_entries: DEFAULT_MAX_ENTRIES,
            hits: 0,
            misses: 0,
        }
    }

    fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        if self.map.contains_key(key) {
            self.hits += 1;
            // refresh recency
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                if let Some(k) = self.order.remove(pos) {
                    self.order.push_back(k);
                }
            }
            Some(self.map[key].data.clone())
        } else {
            self.misses += 1;
            None
        }
    }

    fn set(&mut self, key: String, data: Vec<u8>) {
        if data.len() > self.capacity {
            return; // too big to ever store
        }
        if let Some(old) = self.map.remove(&key) {
            self.bytes -= old.data.len();
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
        }
        self.bytes += data.len();
        self.order.push_back(key.clone());
        self.map.insert(key, Entry { data });
        self.evict();
    }

    fn evict(&mut self) {
        while (self.bytes > self.capacity || self.map.len() > self.max_entries)
            && !self.order.is_empty()
        {
            if let Some(oldest) = self.order.pop_front() {
                if let Some(e) = self.map.remove(&oldest) {
                    self.bytes -= e.data.len();
                }
            }
        }
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
        self.bytes = 0;
    }
}

static CACHE: OnceLock<Mutex<GifCache>> = OnceLock::new();

fn cache() -> &'static Mutex<GifCache> {
    CACHE.get_or_init(|| Mutex::new(GifCache::new()))
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct GifCacheStats {
    pub hits: f64,
    pub misses: f64,
    pub entries: u32,
    pub bytes: f64,
    pub capacity: f64,
    pub max_entries: u32,
}

#[napi(js_name = "gifCacheGet")]
pub fn gif_cache_get(key: String) -> Option<Buffer> {
    let mut cache = cache().lock().ok()?;
    cache.get(&key).map(Buffer::from)
}

#[napi(js_name = "gifCacheSet")]
pub fn gif_cache_set(key: String, data: Buffer) {
    if let Ok(mut cache) = cache().lock() {
        cache.set(key, data.to_vec());
    }
}

#[napi(js_name = "gifCacheStats")]
pub fn gif_cache_stats() -> GifCacheStats {
    match cache().lock() {
        Ok(c) => GifCacheStats {
            hits: c.hits as f64,
            misses: c.misses as f64,
            entries: c.map.len() as u32,
            bytes: c.bytes as f64,
            capacity: c.capacity as f64,
            max_entries: c.max_entries as u32,
        },
        Err(_) => GifCacheStats {
            hits: 0.0,
            misses: 0.0,
            entries: 0,
            bytes: 0.0,
            capacity: 0.0,
            max_entries: 0,
        },
    }
}

#[napi(js_name = "gifCacheClear")]
pub fn gif_cache_clear() {
    if let Ok(mut c) = cache().lock() {
        c.clear();
    }
}

#[napi(js_name = "gifCacheConfigure")]
pub fn gif_cache_configure(capacity_bytes: Option<f64>, max_entries: Option<u32>) {
    if let Ok(mut c) = cache().lock() {
        if let Some(b) = capacity_bytes {
            c.capacity = b.max(0.0) as usize;
        }
        if let Some(n) = max_entries {
            c.max_entries = n.max(1) as usize;
        }
        c.evict();
    }
}

/// FNV-1a 64-bit — deterministic helper so JS can turn a spec string into a
/// short stable cache key without pulling in a hashing dependency.
#[napi(js_name = "gifCacheKey")]
pub fn gif_cache_key(input: String) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}
