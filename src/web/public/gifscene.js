// GifScene — shared GIF-maker scene model, keyframe sampling and canvas
// renderer. Runs unchanged in the browser (dashboard preview) and in Node
// (server-side frame rendering through @napi-rs/canvas). No imports; it
// attaches itself to globalThis.GifScene.

(function () {
  "use strict";

  const EASINGS = {
    linear: (t) => t,
    "ease-in": (t) => t * t * t,
    "ease-out": (t) => 1 - Math.pow(1 - t, 3),
    "ease-in-out": (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    step: () => 0,
    overshoot: (t) => {
      const c = 1.70158;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    },
    bounce: (t) => {
      const n = 7.5625;
      const d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    },
  };

  const NUMERIC_PROPS = new Set([
    "x", "y", "width", "height", "rotation", "opacity", "value",
    "scaleX", "scaleY", "fontSize", "cornerRadius", "strokeWidth", "radius",
  ]);
  const COLOR_PROPS = new Set(["color", "fill", "stroke", "track"]);
  const STEP_PROPS = new Set(["text", "src"]);

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function parseColor(c) {
    if (typeof c !== "string") return null;
    const s = c.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) {
      return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
    }
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return [
        parseInt(s[1] + s[1], 16),
        parseInt(s[2] + s[2], 16),
        parseInt(s[3] + s[3], 16),
        255,
      ];
    }
    if (/^#[0-9a-fA-F]{8}$/.test(s)) {
      return [
        parseInt(s.slice(1, 3), 16),
        parseInt(s.slice(3, 5), 16),
        parseInt(s.slice(5, 7), 16),
        parseInt(s.slice(7, 9), 16),
      ];
    }
    return null;
  }

  function toColorString(rgba) {
    const r = clamp(Math.round(rgba[0]), 0, 255);
    const g = clamp(Math.round(rgba[1]), 0, 255);
    const b = clamp(Math.round(rgba[2]), 0, 255);
    const a = clamp(Math.round(rgba[3]), 0, 255);
    return a === 255
      ? `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
      : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }

  function sortedKeys(track) {
    return Array.isArray(track) ? track.slice().sort((a, b) => a.t - b.t) : [];
  }

  function ease(name) {
    return EASINGS[name] || EASINGS.linear;
  }

  function sampleNumeric(track, t) {
    if (!track || !track.length) return undefined;
    const keys = sortedKeys(track);
    if (t <= keys[0].t) return keys[0].v;
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t >= a.t && t < b.t) {
        const span = b.t - a.t;
        const u = span <= 0 ? 1 : (t - a.t) / span;
        return a.v + (b.v - a.v) * ease(a.e)(clamp(u, 0, 1));
      }
    }
    return keys[keys.length - 1].v;
  }

  function sampleColor(track, t) {
    if (!track || !track.length) return undefined;
    const keys = sortedKeys(track);
    const pick = (v) => parseColor(v) || [255, 255, 255, 255];
    if (t <= keys[0].t) return keys[0].v;
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t >= a.t && t < b.t) {
        const span = b.t - a.t;
        const u = span <= 0 ? 1 : (t - a.t) / span;
        const e = ease(a.e)(clamp(u, 0, 1));
        const ca = pick(a.v);
        const cb = pick(b.v);
        return toColorString(ca.map((v, j) => v + (cb[j] - v) * e));
      }
    }
    return keys[keys.length - 1].v;
  }

  function sampleStep(track, t) {
    if (!track || !track.length) return undefined;
    const keys = sortedKeys(track);
    let v = keys[0].v;
    for (const k of keys) {
      if (t >= k.t) v = k.v;
      else break;
    }
    return v;
  }

  /** Merge base props + sampled track values at time t (ms). */
  function sampleElement(el, t) {
    const out = { ...el };
    const tracks = el.tracks || {};
    for (const [prop, track] of Object.entries(tracks)) {
      let v;
      if (NUMERIC_PROPS.has(prop)) v = sampleNumeric(track, t);
      else if (COLOR_PROPS.has(prop)) v = sampleColor(track, t);
      else if (STEP_PROPS.has(prop)) v = sampleStep(track, t);
      else v = sampleNumeric(track, t);
      if (v !== undefined) out[prop] = v;
    }
    return out;
  }

  /** Keyframe times for an element (union across its tracks), sorted. */
  function elementKeyTimes(el) {
    const times = new Set();
    for (const track of Object.values(el.tracks || {})) {
      for (const k of track || []) times.add(k.t);
    }
    return Array.from(times).sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------------

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
    if (!rr) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function starPath(ctx, cx, cy, outerR, innerR, points) {
    const n = Math.max(3, Math.round(points || 5));
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (Math.PI * i) / n - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function polygonPath(ctx, cx, cy, r, sides) {
    const n = Math.max(3, Math.round(sides || 6));
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawShape(ctx, p) {
    const { x, y, width: w, height: h } = p;
    ctx.beginPath();
    switch (p.shape) {
      case "ellipse":
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case "roundrect":
        roundRectPath(ctx, x, y, w, h, p.cornerRadius || 8);
        break;
      case "line":
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        break;
      case "star":
        starPath(ctx, x + w / 2, y + h / 2, Math.min(w, h) / 2, Math.min(w, h) / 4, p.sides || 5);
        break;
      case "polygon":
        polygonPath(ctx, x + w / 2, y + h / 2, Math.min(w, h) / 2, p.sides || 6);
        break;
      default:
        ctx.rect(x, y, w, h);
    }
    if (p.shape !== "line" && p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill();
    }
    if (p.stroke && (p.strokeWidth || 0) > 0) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  function fontString(p) {
    const style = p.fontStyle === "italic" ? "italic " : "";
    const weight = p.fontWeight || 400;
    const size = Math.max(1, p.fontSize || 24);
    const family = p.fontFamily || "sans-serif";
    return `${style}${weight} ${size}px ${family}`;
  }

  function drawText(ctx, p) {
    const text = String(p.text ?? "");
    if (!text) return;
    ctx.font = fontString(p);
    ctx.textBaseline = "middle";
    const align = p.align || "left";
    ctx.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
    const tx = ctx.textAlign === "center" ? p.x + p.width / 2 : ctx.textAlign === "right" ? p.x + p.width : p.x;
    const ty = p.y + p.height / 2;
    if (p.stroke && (p.strokeWidth || 0) > 0) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.strokeText(text, tx, ty);
    }
    ctx.fillStyle = p.color || "#ffffff";
    ctx.fillText(text, tx, ty);
  }

  function getAsset(assets, src) {
    if (!src || !assets) return null;
    return assets[src] || assets[String(src)] || null;
  }

  function drawImageEl(ctx, p, assets) {
    const img = getAsset(assets, p.src);
    const { x, y, width: w, height: h } = p;
    const radius = p.type === "avatar" ? Math.max(p.radius ?? Math.min(w, h) / 2, 0) : p.radius || 0;

    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.save();
    ctx.clip();

    if (img && (img.width || img.naturalWidth)) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const fit = p.fit || "cover";
      let sw = iw;
      let sh = ih;
      let sx = 0;
      let sy = 0;
      if (fit === "cover") {
        const s = Math.max(w / iw, h / ih);
        sw = w / s;
        sh = h / s;
        sx = (iw - sw) / 2;
        sy = (ih - sh) / 2;
      } else if (fit === "contain") {
        const s = Math.min(w / iw, h / ih);
        const dw = iw * s;
        const dh = ih * s;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        ctx.restore();
        drawImageRing(ctx, p, radius);
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    } else {
      // Placeholder while the asset loads / failed.
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, radius - 1));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = `${Math.max(9, Math.min(w, h) / 5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.type === "avatar" ? "avatar" : "image", x + w / 2, y + h / 2);
    }
    ctx.restore();
    drawImageRing(ctx, p, radius);
  }

  function drawImageRing(ctx, p, radius) {
    if (p.type === "avatar" && p.ring && (p.strokeWidth || 2) > 0) {
      ctx.beginPath();
      roundRectPath(ctx, p.x, p.y, p.width, p.height, radius);
      ctx.strokeStyle = p.ring;
      ctx.lineWidth = p.strokeWidth || 2;
      ctx.stroke();
    }
  }

  function drawBar(ctx, p) {
    const { x, y, width: w, height: h } = p;
    const r = Math.max(0, Math.min(p.cornerRadius ?? 8, h / 2));
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = p.track || "rgba(255,255,255,0.12)";
    ctx.fill();
    const frac = clamp((p.value ?? 0) / 100, 0, 1);
    if (frac > 0) {
      const fw = Math.max(h, w * frac);
      ctx.beginPath();
      roundRectPath(ctx, x, y, Math.min(fw, w), h, r);
      ctx.fillStyle = p.fill || "#00ff1e";
      ctx.fill();
    }
    if (p.stroke && (p.strokeWidth || 0) > 0) {
      ctx.beginPath();
      roundRectPath(ctx, x, y, w, h, r);
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.stroke();
    }
  }

  function drawCounter(ctx, p) {
    const decimals = clamp(Math.round(p.decimals || 0), 0, 6);
    const text = `${p.prefix || ""}${Number(p.value ?? 0).toFixed(decimals)}${p.suffix || ""}`;
    drawText(ctx, { ...p, text });
  }

  function drawScene(ctx, spec, tMs, assets) {
    const { width: W, height: H } = spec;
    ctx.clearRect(0, 0, W, H);
    const bg = spec.background;
    if (bg && bg.type === "color" && bg.color) {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, W, H);
    } else if (bg && bg.type === "image" && bg.src) {
      const img = getAsset(assets, bg.src);
      if (img) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const s = Math.max(W / iw, H / ih);
        ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
      }
    }

    for (const el of spec.elements || []) {
      if (el.visible === false) continue;
      const p = sampleElement(el, tMs);
      const w = Math.max(0.01, p.width || 1);
      const h = Math.max(0.01, p.height || 1);
      const cx = p.x + w / 2;
      const cy = p.y + h / 2;

      ctx.save();
      ctx.globalAlpha = clamp(p.opacity ?? 1, 0, 1);
      ctx.translate(cx, cy);
      if (p.rotation) ctx.rotate((p.rotation * Math.PI) / 180);
      if (p.scaleX !== 1 || p.scaleY !== 1) ctx.scale(p.scaleX ?? 1, p.scaleY ?? 1);
      ctx.translate(-cx, -cy);
      const rp = { ...p, width: w, height: h };
      if (p.type === "text") drawText(ctx, rp);
      else if (p.type === "counter") drawCounter(ctx, rp);
      else if (p.type === "bar") drawBar(ctx, rp);
      else if (p.type === "image" || p.type === "avatar") drawImageEl(ctx, rp, assets);
      else drawShape(ctx, rp);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------------
  // Defaults + validation
  // ------------------------------------------------------------------------

  let nextId = 1;
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
  }

  const ELEMENT_DEFAULTS = {
    text: {
      type: "text", name: "Text", text: "Hello", fontFamily: "Geist",
      fontSize: 32, fontWeight: 500, fontStyle: "normal", color: "#ffffff",
      align: "center", stroke: "", strokeWidth: 0,
    },
    shape: {
      type: "shape", name: "Shape", shape: "rect", fill: "#00ff1e",
      stroke: "", strokeWidth: 0, cornerRadius: 8, sides: 5,
    },
    image: {
      type: "image", name: "Image", src: "", fit: "cover", radius: 0,
    },
    avatar: {
      type: "avatar", name: "Avatar", src: "", fit: "cover",
      radius: 9999, ring: "#00ff1e", strokeWidth: 2,
    },
    bar: {
      type: "bar", name: "Progress bar", value: 60,
      track: "#2a2a2a", fill: "#00ff1e", cornerRadius: 8,
      stroke: "", strokeWidth: 0,
    },
    counter: {
      type: "counter", name: "Counter", value: 0,
      prefix: "", suffix: "", decimals: 0,
      fontFamily: "Geist", fontSize: 32, fontWeight: 600, fontStyle: "normal",
      color: "#ffffff", align: "center", stroke: "", strokeWidth: 0,
    },
  };

  const ELEMENT_SIZES = {
    text: { width: 220, height: 60 },
    shape: { width: 120, height: 120 },
    image: { width: 160, height: 160 },
    avatar: { width: 120, height: 120 },
    bar: { width: 220, height: 24 },
    counter: { width: 160, height: 52 },
  };

  function defaultElement(type, x = 40, y = 40) {
    const d = ELEMENT_DEFAULTS[type] || ELEMENT_DEFAULTS.shape;
    const s = ELEMENT_SIZES[type] || ELEMENT_SIZES.shape;
    return {
      ...JSON.parse(JSON.stringify(d)),
      id: uid(type),
      x, y,
      width: s.width,
      height: s.height,
      rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
      visible: true,
      tracks: {},
    };
  }

  const LIMITS = {
    width: [16, 640],
    height: [16, 640],
    fps: [1, 30],
    durationMs: [200, 15000],
    elements: 40,
    keysPerTrack: 300,
    textLen: 300,
    urlLen: 2048,
  };

  function clampNum(v, [lo, hi], fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  }

  function sanitizeUrl(u) {
    const s = String(u || "").trim().slice(0, LIMITS.urlLen);
    if (!s) return "";
    return /^https?:\/\//i.test(s) ? s : "";
  }

  function sanitizeTrack(track) {
    if (!Array.isArray(track)) return [];
    return track
      .filter((k) => k && Number.isFinite(Number(k.t)) && k.v !== undefined)
      .slice(0, LIMITS.keysPerTrack)
      .map((k) => ({
        t: clampNum(k.t, [0, LIMITS.durationMs[1]], 0),
        v: typeof k.v === "number" ? k.v : String(k.v).slice(0, 2048),
        e: typeof k.e === "string" && EASINGS[k.e] ? k.e : "linear",
      }))
      .sort((a, b) => a.t - b.t);
  }

  /** Validate + clamp an incoming spec; returns a clean spec or throws. */
  function sanitizeSpec(input) {
    if (!input || typeof input !== "object") throw new Error("spec required");
    const width = Math.round(clampNum(input.width, LIMITS.width, 320));
    const height = Math.round(clampNum(input.height, LIMITS.height, 180));
    const fps = Math.round(clampNum(input.fps, LIMITS.fps, 15));
    const durationMs = Math.round(clampNum(input.durationMs, LIMITS.durationMs, 3000));
    const loop = Boolean(input.loop ?? true);

    const bgIn = input.background || {};
    const background =
      bgIn.type === "color"
        ? { type: "color", color: String(bgIn.color || "#000000").slice(0, 32) }
        : bgIn.type === "image"
          ? { type: "image", src: sanitizeUrl(bgIn.src) }
          : { type: "none" };

    const elements = (Array.isArray(input.elements) ? input.elements : [])
      .slice(0, LIMITS.elements)
      .map((el, i) => {
        const type = ELEMENT_DEFAULTS[el.type] ? el.type : "shape";
        const out = {
          ...JSON.parse(JSON.stringify(ELEMENT_DEFAULTS[type])),
          id: String(el.id || `${type}-${i}`).slice(0, 64),
          name: String(el.name || type).slice(0, 64),
          visible: el.visible !== false,
          x: Number(el.x) || 0,
          y: Number(el.y) || 0,
          width: clampNum(el.width, [1, 4096], 100),
          height: clampNum(el.height, [1, 4096], 100),
          rotation: Number(el.rotation) || 0,
          scaleX: Number(el.scaleX) || 1,
          scaleY: Number(el.scaleY) || 1,
          opacity: clampNum(el.opacity, [0, 1], 1),
          tracks: {},
        };
        // Copy type-specific props declared on the element defaults (text,
        // shape, fill, src, fontFamily, …) so reloaded specs keep them.
        for (const key of Object.keys(ELEMENT_DEFAULTS[type])) {
          if (key === "type" || key === "name" || !(key in el) || el[key] === undefined) continue;
          const dv = ELEMENT_DEFAULTS[type][key];
          const v = el[key];
          out[key] =
            typeof dv === "number" ? (Number.isFinite(Number(v)) ? Number(v) : dv)
            : typeof dv === "boolean" ? Boolean(v)
            : typeof dv === "string" ? String(v) : v;
        }
        for (const key of Object.keys(out)) {
          if (typeof out[key] === "string") out[key] = out[key].slice(0, LIMITS.urlLen);
        }
        if (typeof out.text === "string") out.text = out.text.slice(0, LIMITS.textLen);
        if ("src" in out) out.src = sanitizeUrl(out.src);
        if ("color" in out && out.color) out.color = String(out.color).slice(0, 32);
        if ("fill" in out && out.fill) out.fill = String(out.fill).slice(0, 32);
        if ("stroke" in out && out.stroke) out.stroke = String(out.stroke).slice(0, 32);
        if ("ring" in out && out.ring) out.ring = String(out.ring).slice(0, 32);
        for (const [prop, track] of Object.entries(el.tracks || {})) {
          out.tracks[prop] = sanitizeTrack(track);
        }
        return out;
      });

    return { width, height, fps, durationMs, loop, background, elements };
  }

  function collectImageSources(spec) {
    const urls = new Set();
    if (spec.background?.type === "image" && spec.background.src) urls.add(spec.background.src);
    for (const el of spec.elements || []) {
      if ((el.type === "image" || el.type === "avatar") && el.src) urls.add(el.src);
      for (const track of Object.values(el.tracks || {})) {
        if (el.type === "image" || el.type === "avatar") {
          for (const k of track || []) {
            if (typeof k.v === "string" && /^https?:\/\//.test(k.v)) urls.add(k.v);
          }
        }
      }
    }
    return [...urls];
  }

  globalThis.GifScene = {
    EASINGS,
    LIMITS,
    ELEMENT_DEFAULTS,
    defaultElement,
    sampleElement,
    sampleTrack: (track, t, prop) =>
      STEP_PROPS.has(prop) ? sampleStep(track, t) : COLOR_PROPS.has(prop) ? sampleColor(track, t) : sampleNumeric(track, t),
    elementKeyTimes,
    drawScene,
    sanitizeSpec,
    sanitizeUrl,
    collectImageSources,
    parseColor,
    toColorString,
    uid,
  };
})();
