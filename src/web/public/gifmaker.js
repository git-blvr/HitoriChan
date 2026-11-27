// GIF maker editor — layers, canvas preview, keyframe timeline, export.
// Uses GifScene (gifscene.js) for sampling/drawing and dashboard.js globals
// (json, showToast, escapeHtml, sections, guildData).
/* global GifScene, json, showToast, escapeHtml, sections, guildData */
"use strict";

const GM_STORAGE_KEY = "hc-gifmaker-v1";
const GM_KEY_SNAP_MS = 30;
const GM_FONTS = ["Geist", "Geist Mono", "Instrument Serif", "system-ui", "monospace", "serif"];
const GM_EASES = Object.keys(GifScene.EASINGS);

const Gm = {
  spec: null,
  selectedId: null,
  selectedKey: null, // { elId, prop, index }
  time: 0,
  playing: false,
  raf: 0,
  lastTick: 0,
  assets: {}, // src -> HTMLImageElement | null
  initDone: false,
  saveTimer: 0,
  drag: null, // { kind:'move'|'key'|'scrub', ... }
  grid: { on: false, size: 8, snap: true },
};

const $gm = (id) => document.getElementById(id);
const gmEls = {};

function gmDefaultSpec() {
  const shape = GifScene.defaultElement("shape", 120, 52);
  shape.name = "Accent dot";
  shape.shape = "ellipse";
  shape.fill = "#ff2ec4";
  shape.width = 44;
  shape.height = 44;
  shape.tracks = {
    x: [
      { t: 0, v: 30, e: "ease-in-out" },
      { t: 1500, v: 246, e: "ease-in-out" },
      { t: 3000, v: 30 },
    ],
  };
  const text = GifScene.defaultElement("text", 60, 110);
  text.name = "Title";
  text.text = "New GIF";
  text.align = "center";
  text.width = 200;
  text.height = 48;
  text.fontSize = 34;
  text.tracks = {
    opacity: [
      { t: 0, v: 0, e: "ease-out" },
      { t: 600, v: 1 },
    ],
    y: [
      { t: 0, v: 130, e: "ease-out" },
      { t: 600, v: 110 },
    ],
  };
  return {
    width: 320,
    height: 180,
    fps: 15,
    durationMs: 3000,
    loop: true,
    background: { type: "color", color: "#0a0a12" },
    elements: [shape, text],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function gmSave() {
  clearTimeout(Gm.saveTimer);
  Gm.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(GM_STORAGE_KEY, JSON.stringify({ spec: Gm.spec, selectedId: Gm.selectedId, grid: Gm.grid }));
    } catch { /* private mode */ }
  }, 300);
}

function gmLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(GM_STORAGE_KEY) || "null");
    if (raw?.spec) {
      Gm.spec = GifScene.sanitizeSpec(raw.spec);
      Gm.selectedId = raw.selectedId || null;
      if (raw.grid) Gm.grid = { on: !!raw.grid.on, size: Math.max(2, Math.min(64, Number(raw.grid.size) || 8)), snap: raw.grid.snap !== false };
      return;
    }
  } catch { /* fall through */ }
  Gm.spec = gmDefaultSpec();
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------
function gmEl(id = Gm.selectedId) {
  return Gm.spec.elements.find((e) => e.id === id) || null;
}

function gmSampled(el, prop) {
  const s = GifScene.sampleElement(el, Gm.time);
  return s[prop];
}

function gmTrackHasKey(el, prop, t) {
  const track = el.tracks?.[prop];
  if (!track) return -1;
  return track.findIndex((k) => Math.abs(k.t - t) <= GM_KEY_SNAP_MS);
}

/** Write a property: into the playhead keyframe when the track exists there,
 *  upsert a key when a track exists but has no key at the playhead, else set
 *  the base property. */
function gmSetProp(el, prop, v) {
  const track = el.tracks?.[prop];
  if (!track || !track.length) {
    el[prop] = v;
    return;
  }
  const at = Math.round(Gm.time / 10) * 10;
  const idx = gmTrackHasKey(el, prop, at);
  if (idx >= 0) {
    track[idx].v = v;
  } else {
    track.push({ t: at, v, e: "ease-in-out" });
    track.sort((a, b) => a.t - b.t);
  }
}

function gmToggleKey(el, prop) {
  el.tracks = el.tracks || {};
  const track = el.tracks[prop] || (el.tracks[prop] = []);
  const at = Math.round(Gm.time / 10) * 10;
  const idx = gmTrackHasKey(el, prop, at);
  if (idx >= 0) {
    Gm.selectedKey = { elId: el.id, prop, index: idx };
    gmRenderAll();
    return;
  }
  const v = gmSampled(el, prop);
  track.push({ t: at, v: v === undefined ? 0 : v, e: "ease-in-out" });
  track.sort((a, b) => a.t - b.t);
  Gm.selectedKey = { elId: el.id, prop, index: track.findIndex((k) => k.t === at) };
  gmRenderAll();
}

function gmDeleteSelectedKey() {
  const sel = Gm.selectedKey;
  if (!sel) return false;
  const el = gmEl(sel.elId);
  if (!el) return false;
  const track = el.tracks?.[sel.prop];
  if (!track || !track[sel.index]) return false;
  track.splice(sel.index, 1);
  if (!track.length) delete el.tracks[sel.prop];
  Gm.selectedKey = null;
  gmRenderAll();
  return true;
}

function gmSelectedKeyObj() {
  const sel = Gm.selectedKey;
  if (!sel) return null;
  const el = gmEl(sel.elId);
  const key = el?.tracks?.[sel.prop]?.[sel.index];
  return el && key ? { el, key } : null;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
function gmAddElement(type) {
  const el = GifScene.defaultElement(type, 40 + (Gm.spec.elements.length * 16) % 160, 40 + (Gm.spec.elements.length * 24) % 80);
  if (type === "avatar" && (guildData.members || []).length) {
    const m = guildData.members.find((x) => x.avatar);
    if (m) el.src = m.avatar;
  }
  Gm.spec.elements.push(el);
  Gm.selectedId = el.id;
  Gm.selectedKey = null;
  gmRenderAll();
  showToast(`Added ${type}`, "success");
}

function gmRemoveElement(id) {
  const i = Gm.spec.elements.findIndex((e) => e.id === id);
  if (i < 0) return;
  Gm.spec.elements.splice(i, 1);
  if (Gm.selectedId === id) {
    Gm.selectedId = null;
    Gm.selectedKey = null;
  }
  gmRenderAll();
}

function gmMoveElement(id, dir) {
  const i = Gm.spec.elements.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= Gm.spec.elements.length) return;
  [Gm.spec.elements[i], Gm.spec.elements[j]] = [Gm.spec.elements[j], Gm.spec.elements[i]];
  gmRenderAll();
}

function gmDuplicateElement(id) {
  const src = gmEl(id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = GifScene.uid(src.type);
  copy.name = `${src.name || src.type} copy`;
  copy.x = (copy.x || 0) + Math.max(4, Gm.grid.size);
  copy.y = (copy.y || 0) + Math.max(4, Gm.grid.size);
  Gm.spec.elements.splice(Gm.spec.elements.indexOf(src) + 1, 0, copy);
  Gm.selectedId = copy.id;
  Gm.selectedKey = null;
  gmRenderAll();
}

function gmEnsureAsset(src) {
  if (!src || Gm.assets[src] !== undefined) return;
  Gm.assets[src] = null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    Gm.assets[src] = img;
    gmDraw();
  };
  img.onerror = () => {
    const retry = new Image();
    retry.onload = () => {
      Gm.assets[src] = retry;
      gmDraw();
    };
    retry.onerror = () => {
      Gm.assets[src] = null;
    };
    retry.src = src;
  };
  img.src = src;
}

function gmRefreshAssets() {
  for (const u of GifScene.collectImageSources(Gm.spec)) gmEnsureAsset(u);
}

// ---------------------------------------------------------------------------
// Rendering — preview + layers + inspector + timeline
// ---------------------------------------------------------------------------
function gmDraw() {
  const canvas = gmEls.canvas;
  if (!canvas) return;
  if (canvas.width !== Gm.spec.width) canvas.width = Gm.spec.width;
  if (canvas.height !== Gm.spec.height) canvas.height = Gm.spec.height;
  const ctx = canvas.getContext("2d");
  GifScene.drawScene(ctx, Gm.spec, Gm.time, Gm.assets);

  // Grid overlay + center guides
  if (Gm.grid.on) {
    const step = Math.max(2, Gm.grid.size);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = step; gx < Gm.spec.width; gx += step) {
      ctx.moveTo(gx + 0.5, 0);
      ctx.lineTo(gx + 0.5, Gm.spec.height);
    }
    for (let gy = step; gy < Gm.spec.height; gy += step) {
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(Gm.spec.width, gy + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,255,30,0.35)";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(Gm.spec.width / 2 + 0.5, 0);
    ctx.lineTo(Gm.spec.width / 2 + 0.5, Gm.spec.height);
    ctx.moveTo(0, Gm.spec.height / 2 + 0.5);
    ctx.lineTo(Gm.spec.width, Gm.spec.height / 2 + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  // Selection outline
  const el = gmEl();
  if (el) {
    const p = GifScene.sampleElement(el, Gm.time);
    ctx.save();
    ctx.strokeStyle = "#00ff1e";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const w = Math.max(1, p.width), h = Math.max(1, p.height);
    const cx = p.x + w / 2, cy = p.y + h / 2;
    ctx.translate(cx, cy);
    if (p.rotation) ctx.rotate((p.rotation * Math.PI) / 180);
    if (p.scaleX !== 1 || p.scaleY !== 1) ctx.scale(p.scaleX ?? 1, p.scaleY ?? 1);
    ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
    ctx.restore();
  }

  if (gmEls.time) {
    gmEls.time.textContent = `${(Gm.time / 1000).toFixed(2)} / ${(Gm.spec.durationMs / 1000).toFixed(2)}s`;
  }
  gmPositionPlayhead();
}

const GM_LAYER_ICONS = {
  text: '<svg class="gm-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h16v2M9 20h6M12 5v15"/></svg>',
  shape: '<svg class="gm-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
  image: '<svg class="gm-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 19 5-5 3 3 4-4 2 2"/></svg>',
  avatar: '<svg class="gm-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/></svg>',
  bar: '<svg class="gm-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="9" width="18" height="6" rx="3"/><rect x="3" y="9" width="10" height="6" rx="3" fill="currentColor" stroke="none"/></svg>',
  counter: '<svg class="gm-layer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9V7h4M4 15v2h4M16 7h4v2M20 15v2h-4"/><path d="M12 9v6"/></svg>',
};

function gmRenderLayers() {
  const list = gmEls.layers;
  list.innerHTML = "";
  gmEls.layersEmpty.hidden = Gm.spec.elements.length > 0;
  [...Gm.spec.elements].reverse().forEach((el) => {
    const li = document.createElement("li");
    li.className = `gm-layer${el.id === Gm.selectedId ? " selected" : ""}${el.visible === false ? " gm-layer-off" : ""}`;
    li.dataset.el = el.id;
    li.innerHTML = `
      ${GM_LAYER_ICONS[el.type] || GM_LAYER_ICONS.shape}
      <span class="gm-layer-name">${escapeHtml(el.name || el.type)}</span>
      <span class="gm-layer-actions">
        <button type="button" class="gm-layer-act" data-gm="layer-vis" data-el="${el.id}" title="Toggle visibility" aria-label="Toggle visibility">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button type="button" class="gm-layer-act" data-gm="layer-up" data-el="${el.id}" title="Bring forward" aria-label="Bring forward">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 14 6-6 6 6"/></svg>
        </button>
        <button type="button" class="gm-layer-act" data-gm="layer-down" data-el="${el.id}" title="Send backward" aria-label="Send backward">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 10 6 6 6-6"/></svg>
        </button>
        <button type="button" class="gm-layer-act" data-gm="layer-dup" data-el="${el.id}" title="Duplicate layer" aria-label="Duplicate layer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
        </button>
        <button type="button" class="gm-layer-act gm-layer-act--danger" data-gm="layer-del" data-el="${el.id}" title="Delete layer" aria-label="Delete layer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>
        </button>
      </span>`;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".gm-layer-act")) return;
      Gm.selectedId = el.id;
      Gm.selectedKey = null;
      gmRenderAll();
    });
    list.appendChild(li);
  });
}

// ---- Inspector ----

const GM_FIELDSETS = {
  common: [
    { group: "Layer" },
    { prop: "name", label: "Name", kind: "text" },
    { prop: "visible", label: "Visible", kind: "check" },
    { group: "Transform" },
    { prop: "x", label: "X", kind: "num", key: true, step: 1 },
    { prop: "y", label: "Y", kind: "num", key: true, step: 1 },
    { prop: "width", label: "Width", kind: "num", key: true, step: 1, min: 1 },
    { prop: "height", label: "Height", kind: "num", key: true, step: 1, min: 1 },
    { prop: "rotation", label: "Rotate°", kind: "num", key: true, step: 1 },
    { prop: "scaleX", label: "Scale X", kind: "num", key: true, step: 0.05 },
    { prop: "scaleY", label: "Scale Y", kind: "num", key: true, step: 0.05 },
    { prop: "opacity", label: "Opacity", kind: "num", key: true, step: 0.05, min: 0, max: 1 },
  ],
  text: [
    { group: "Text" },
    { prop: "text", label: "Content", kind: "text", key: true },
    { prop: "fontFamily", label: "Font", kind: "select", options: GM_FONTS },
    { prop: "fontSize", label: "Size", kind: "num", key: true, step: 1, min: 4 },
    { prop: "fontWeight", label: "Weight", kind: "select", options: [400, 500, 600, 700] },
    { prop: "fontStyle", label: "Style", kind: "select", options: ["normal", "italic"] },
    { prop: "color", label: "Color", kind: "color", key: true },
    { prop: "align", label: "Align", kind: "select", options: ["left", "center", "right"] },
    { prop: "stroke", label: "Outline", kind: "color", key: true },
    { prop: "strokeWidth", label: "Outline w", kind: "num", key: true, step: 1, min: 0 },
  ],
  shape: [
    { group: "Shape" },
    { prop: "shape", label: "Kind", kind: "select", options: ["rect", "roundrect", "ellipse", "line", "star", "polygon"] },
    { prop: "sides", label: "Sides", kind: "num", step: 1, min: 3 },
    { prop: "fill", label: "Fill", kind: "color", key: true },
    { prop: "stroke", label: "Stroke", kind: "color", key: true },
    { prop: "strokeWidth", label: "Stroke w", kind: "num", key: true, step: 1, min: 0 },
    { prop: "cornerRadius", label: "Radius", kind: "num", key: true, step: 1, min: 0 },
  ],
  image: [
    { group: "Image" },
    { prop: "src", label: "Image URL", kind: "url", key: true },
    { prop: "fit", label: "Fit", kind: "select", options: ["cover", "contain", "fill"] },
    { prop: "radius", label: "Radius", kind: "num", key: true, step: 1, min: 0 },
  ],
  avatar: [
    { group: "Avatar" },
    { prop: "src", label: "Avatar URL", kind: "url", key: true },
    { prop: "member", label: "Member", kind: "member" },
    { prop: "ring", label: "Ring", kind: "color", key: true },
    { prop: "strokeWidth", label: "Ring w", kind: "num", key: true, step: 1, min: 0 },
  ],
  bar: [
    { group: "Progress bar" },
    { prop: "value", label: "Value %", kind: "num", key: true, step: 1, min: 0, max: 100 },
    { prop: "track", label: "Track", kind: "color", key: true },
    { prop: "fill", label: "Fill", kind: "color", key: true },
    { prop: "cornerRadius", label: "Radius", kind: "num", key: true, step: 1, min: 0 },
    { prop: "stroke", label: "Stroke", kind: "color", key: true },
    { prop: "strokeWidth", label: "Stroke w", kind: "num", key: true, step: 1, min: 0 },
  ],
  counter: [
    { group: "Counter" },
    { prop: "value", label: "Value", kind: "num", key: true, step: 1 },
    { prop: "prefix", label: "Prefix", kind: "text" },
    { prop: "suffix", label: "Suffix", kind: "text" },
    { prop: "decimals", label: "Decimals", kind: "num", step: 1, min: 0, max: 6 },
    { prop: "fontFamily", label: "Font", kind: "select", options: GM_FONTS },
    { prop: "fontSize", label: "Size", kind: "num", key: true, step: 1, min: 4 },
    { prop: "fontWeight", label: "Weight", kind: "select", options: [400, 500, 600, 700] },
    { prop: "fontStyle", label: "Style", kind: "select", options: ["normal", "italic"] },
    { prop: "color", label: "Color", kind: "color", key: true },
    { prop: "align", label: "Align", kind: "select", options: ["left", "center", "right"] },
  ],
};

function gmPropValue(el, prop) {
  const sampled = gmSampled(el, prop);
  return sampled !== undefined ? sampled : el[prop];
}

function gmKeyBtn(el, prop) {
  const track = el.tracks?.[prop];
  const keyed = track?.length && gmTrackHasKey(el, prop, Gm.time) >= 0;
  const hasTrack = track?.length;
  return `<button type="button" class="gm-keybtn${keyed ? " keyed" : ""}" data-gm="key" data-prop="${prop}"
    title="${keyed ? "Select key at playhead" : hasTrack ? "Add key at playhead" : "Start animating"}"
    aria-label="Keyframe for ${prop}" aria-pressed="${keyed ? "true" : "false"}">
    <svg viewBox="0 0 24 24" fill="${keyed || hasTrack ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M12 3 21 12 12 21 3 12Z"/></svg>
  </button>`;
}

function gmRenderInspector() {
  const body = gmEls.inspectorBody;
  const el = gmEl();
  if (!el) {
    body.innerHTML = '<p class="gm-empty">Select a layer to edit its properties.</p>';
    gmRenderKeyEditor();
    return;
  }

  const fields = [...GM_FIELDSETS.common, ...(GM_FIELDSETS[el.type] || [])];
  const html = [];
  for (const f of fields) {
    if (f.group) {
      html.push(`<div class="gm-prop-group"><span class="gm-group-label">${escapeHtml(f.group)}</span></div>`);
      continue;
    }
    const v = gmPropValue(el, f.prop);
    html.push('<div class="gm-prop-row">');
    html.push(`<label for="gmf-${f.prop}">${escapeHtml(f.label)}</label>`);
    const id = `gmf-${f.prop}`;
    if (f.kind === "num") {
      const num = typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
      html.push(`<input type="number" id="${id}" data-gm-prop="${f.prop}" step="${f.step ?? 1}"${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""} value="${escapeHtml(num ?? "")}" />`);
    } else if (f.kind === "color") {
      const col = (typeof v === "string" && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) ? v : "#ffffff";
      html.push(`<input type="color" id="${id}" data-gm-prop="${f.prop}" value="${escapeHtml(col)}" />`);
      html.push(`<span class="gm-prop-color-text">${escapeHtml(col)}</span>`);
    } else if (f.kind === "select") {
      const opts = f.options.map((o) => `<option value="${escapeHtml(o)}"${String(o) === String(v) ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
      html.push(`<select id="${id}" data-gm-prop="${f.prop}">${opts}</select>`);
    } else if (f.kind === "check") {
      html.push(`<input type="checkbox" id="${id}" data-gm-prop="${f.prop}"${v !== false ? " checked" : ""} />`);
    } else if (f.kind === "member") {
      const members = guildData.members || [];
      const opts = ['<option value="">Select member…</option>']
        .concat(members.map((m) => `<option value="${escapeHtml(m.avatar || "")}"${m.avatar === el.src ? " selected" : ""}>${escapeHtml(m.displayName || m.username || m.id)}</option>`))
        .join("");
      html.push(`<select id="${id}" data-gm-prop="member" ${members.length ? "" : "disabled"}>${opts}</select>`);
    } else {
      html.push(`<input type="text" id="${id}" data-gm-prop="${f.prop}" value="${escapeHtml(v ?? "")}" spellcheck="false" />`);
    }
    if (f.key) html.push(gmKeyBtn(el, f.prop));
    html.push("</div>");
  }
  if (el.type === "avatar" && !(guildData.members || []).length) {
    html.push('<p class="gm-inspector-note">Select a server in the sidebar to pick member avatars, or paste a URL.</p>');
  }
  html.push('<p class="gm-inspector-note">Values with a track edit the keyframe at the playhead; ◆ adds or selects a key at the playhead.</p>');
  body.innerHTML = html.join("");
  gmRenderKeyEditor();
}

function gmRenderKeyEditor() {
  const wrap = gmEls.keyEditor;
  const body = gmEls.keyEditorBody;
  const sel = gmSelectedKeyObj();
  if (!sel) {
    wrap.hidden = true;
    return;
  }
  const { el, key } = sel;
  const prop = Gm.selectedKey.prop;
  wrap.hidden = false;
  const isColor = ["color", "fill", "stroke", "ring"].includes(prop);
  const isText = ["text", "src"].includes(prop);
  const vInput = isColor
    ? `<input type="color" data-gm-key="v" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(key.v) ? key.v : "#ffffff")}" />`
    : isText
      ? `<input type="text" data-gm-key="v" value="${escapeHtml(key.v)}" spellcheck="false" />`
      : `<input type="number" data-gm-key="v" step="any" value="${escapeHtml(key.v)}" />`;
  body.innerHTML = `
    <div class="gm-prop-row"><label>Element</label><input type="text" value="${escapeHtml(el.name || el.type)}" disabled /></div>
    <div class="gm-prop-row"><label>Property</label><input type="text" value="${escapeHtml(prop)}" disabled /></div>
    <div class="gm-prop-row"><label>Time (ms)</label>${vInput ? "" : ""}<input type="number" data-gm-key="t" min="0" max="${Gm.spec.durationMs}" step="10" value="${Math.round(key.t)}" /></div>
    <div class="gm-prop-row"><label>Value</label>${vInput}</div>
    <div class="gm-prop-row"><label>Easing out</label>
      <select data-gm-key="e">${GM_EASES.map((e) => `<option value="${e}"${key.e === e ? " selected" : ""}>${e}</option>`).join("")}</select>
    </div>
    <div class="gm-prop-row">
      <button type="button" class="btn btn--sm btn--ghost" data-gm="key-delete">Delete key</button>
      <button type="button" class="btn btn--sm" data-gm="key-goto">Go to time</button>
    </div>`;
}

// ---- Timeline ----

function gmTickStep(durationMs) {
  const steps = [100, 200, 250, 500, 1000, 2000, 5000];
  for (const s of steps) {
    if (durationMs / s <= 12) return s;
  }
  return 10000;
}

function gmRenderTimeline() {
  const ruler = gmEls.tlRuler;
  const rows = gmEls.tlRows;
  const dur = Gm.spec.durationMs;

  ruler.innerHTML = "";
  const step = gmTickStep(dur);
  for (let t = 0; t <= dur; t += step) {
    const tick = document.createElement("span");
    tick.className = "gm-tl-tick";
    tick.style.insetInlineStart = `${(t / dur) * 100}%`;
    if (t % (step * 2) === 0 || t === 0) {
      const label = document.createElement("span");
      label.className = "gm-tl-tick-label";
      label.textContent = `${(t / 1000).toFixed(step < 1000 ? 1 : 0)}s`;
      tick.appendChild(label);
    }
    ruler.appendChild(tick);
  }

  rows.innerHTML = "";
  for (const el of Gm.spec.elements) {
    const block = document.createElement("div");
    block.className = `gm-tl-el${el.id === Gm.selectedId ? " selected" : ""}`;

    // Header row — union of all key times
    const head = document.createElement("div");
    head.className = "gm-tl-row gm-tl-el-head";
    const label = document.createElement("span");
    label.className = "gm-tl-label";
    label.textContent = el.name || el.type;
    head.appendChild(label);
    const lane = document.createElement("div");
    lane.className = "gm-tl-lane";
    lane.dataset.el = el.id;
    for (const t of GifScene.elementKeyTimes(el)) {
      const dot = document.createElement("span");
      dot.className = "gm-key";
      dot.style.left = `${(t / dur) * 100}%`;
      dot.setAttribute("aria-hidden", "true");
      lane.appendChild(dot);
    }
    head.appendChild(lane);
    block.appendChild(head);

    // One lane per animated property
    for (const [prop, track] of Object.entries(el.tracks || {})) {
      if (!track?.length) continue;
      const row = document.createElement("div");
      row.className = "gm-tl-row gm-tl-prop";
      const pl = document.createElement("span");
      pl.className = "gm-tl-label";
      pl.textContent = prop;
      row.appendChild(pl);
      const plane = document.createElement("div");
      plane.className = "gm-tl-lane";
      plane.dataset.el = el.id;
      plane.dataset.prop = prop;
      track.forEach((k, i) => {
        const key = document.createElement("button");
        key.type = "button";
        key.className = `gm-key${Gm.selectedKey && Gm.selectedKey.elId === el.id && Gm.selectedKey.prop === prop && Gm.selectedKey.index === i ? " selected" : ""}`;
        key.style.left = `${(k.t / dur) * 100}%`;
        key.dataset.el = el.id;
        key.dataset.prop = prop;
        key.dataset.index = String(i);
        key.setAttribute("aria-label", `${prop} key at ${(k.t / 1000).toFixed(2)}s`);
        plane.appendChild(key);
      });
      row.appendChild(plane);
      block.appendChild(row);
    }

    rows.appendChild(block);
  }
  gmPositionPlayhead();
}

function gmPositionPlayhead() {
  const ph = gmEls.tlPlayhead;
  const lane = gmEls.tlRows?.querySelector(".gm-tl-lane") || gmEls.tlRuler;
  if (!ph || !lane) return;
  const tl = gmEls.tl.getBoundingClientRect();
  const rect = lane.getBoundingClientRect();
  const frac = Gm.spec.durationMs ? Gm.time / Gm.spec.durationMs : 0;
  ph.hidden = false;
  ph.style.left = `${rect.left - tl.left + frac * rect.width}px`;
  ph.style.top = `${gmEls.tlRuler.getBoundingClientRect().bottom - tl.top}px`;
  ph.style.bottom = "0";
}

// ---------------------------------------------------------------------------
// Interaction handlers
// ---------------------------------------------------------------------------
function gmLaneTime(e, lane) {
  const rect = lane.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  return Math.round((frac * Gm.spec.durationMs) / 10) * 10;
}

// Keep the canvas, inspector values and key editor in sync when the playhead moves.
function gmAfterScrub() {
  const el = gmEl();
  if (el) gmRenderInspectorValues(el);
  gmDraw();
  gmRenderKeyEditor();
}

function gmInitTimelineEvents() {
  const tl = gmEls.tl;
  tl.addEventListener("pointerdown", (e) => {
    const key = e.target.closest(".gm-key[data-el]");
    if (key && key.dataset.prop) {
      e.preventDefault();
      const index = Number(key.dataset.index);
      const keyObj = gmEl(key.dataset.el)?.tracks?.[key.dataset.prop]?.[index];
      try { key.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      Gm.drag = { kind: "key", el: key.dataset.el, prop: key.dataset.prop, keyObj, node: key, lane: key.parentElement };
      Gm.selectedKey = { elId: key.dataset.el, prop: key.dataset.prop, index };
      Gm.selectedId = key.dataset.el;
      tl.querySelectorAll(".gm-key.selected").forEach((k) => k.classList.remove("selected"));
      key.classList.add("selected");
      gmRenderLayers();
      gmRenderKeyEditor();
      return;
    }
    const lane = e.target.closest(".gm-tl-lane");
    if (lane) {
      Gm.drag = { kind: "scrub" };
      Gm.time = Math.min(Math.max(gmLaneTime(e, lane), 0), Gm.spec.durationMs);
      gmAfterScrub();
      return;
    }
    if (e.target.closest(".gm-tl-ruler")) {
      Gm.drag = { kind: "scrub" };
      Gm.time = Math.min(Math.max(gmLaneTime(e, gmEls.tlRuler), 0), Gm.spec.durationMs);
      gmAfterScrub();
    }
  });

  window.addEventListener("pointermove", (e) => {
    if (!Gm.drag) return;
    if (Gm.drag.kind === "scrub") {
      Gm.time = Math.min(Math.max(gmLaneTime(e, gmEls.tlRuler), 0), Gm.spec.durationMs);
      gmAfterScrub();
    } else if (Gm.drag.kind === "key") {
      const keyObj = Gm.drag.keyObj;
      if (!keyObj) return;
      const t = Math.min(Math.max(gmLaneTime(e, Gm.drag.lane), 0), Gm.spec.durationMs);
      keyObj.t = t;
      Gm.drag.node.style.left = `${(t / Gm.spec.durationMs) * 100}%`;
      Gm.time = t;
      gmDraw();
    } else if (Gm.drag.kind === "move") {
      gmDragMove(e);
    }
  });

  window.addEventListener("pointerup", () => {
    if (!Gm.drag) return;
    if (Gm.drag.kind === "key") {
      const el = gmEl(Gm.drag.el);
      const track = el?.tracks?.[Gm.drag.prop];
      if (track && Gm.drag.keyObj) {
        track.sort((a, b) => a.t - b.t);
        Gm.selectedKey = { elId: Gm.drag.el, prop: Gm.drag.prop, index: track.indexOf(Gm.drag.keyObj) };
      }
      gmRenderAll();
    }
    if (Gm.drag.kind === "move" || Gm.drag.kind === "key") gmSave();
    Gm.drag = null;
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (gmActiveSection() !== "gifmaker") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (gmDeleteSelectedKey()) {
        e.preventDefault();
        return;
      }
      if (Gm.selectedId) {
        gmRemoveElement(Gm.selectedId);
        e.preventDefault();
      }
    } else if (e.key === " " && !e.repeat) {
      e.preventDefault();
      gmTogglePlay();
    } else if (e.key === "Escape") {
      Gm.selectedKey = null;
      gmRenderAll();
    } else if (e.key.startsWith("Arrow") && Gm.selectedId) {
      const el = gmEl();
      if (!el) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : (Gm.grid.snap ? Math.max(2, Gm.grid.size) : 1);
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      gmSetProp(el, "x", (gmPropValue(el, "x") || 0) + dx);
      gmSetProp(el, "y", (gmPropValue(el, "y") || 0) + dy);
      gmDraw();
      gmRenderInspectorValues(el);
      gmRenderTimeline();
      gmSave();
    }
  });
}

function gmActiveSection() {
  return document.querySelector(".content-section.active")?.id || "";
}

// ---- Canvas drag ----
function gmHitTest(px, py) {
  // Topmost = last element. Reverse iterate.
  for (let i = Gm.spec.elements.length - 1; i >= 0; i--) {
    const el = Gm.spec.elements[i];
    if (el.visible === false) continue;
    const p = GifScene.sampleElement(el, Gm.time);
    const w = Math.max(1, p.width), h = Math.max(1, p.height);
    const cx = p.x + w / 2, cy = p.y + h / 2;
    const rad = -((p.rotation || 0) * Math.PI) / 180;
    const dx = px - cx, dy = py - cy;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    const sx = (p.scaleX || 1) * w, sy = (p.scaleY || 1) * h;
    if (Math.abs(rx) <= sx / 2 && Math.abs(ry) <= sy / 2) return el;
  }
  return null;
}

function gmDragMove(e) {
  const el = gmEl(Gm.drag.el);
  if (!el) return;
  const rect = gmEls.canvas.getBoundingClientRect();
  const scaleX = Gm.spec.width / rect.width;
  const scaleY = Gm.spec.height / rect.height;
  const dx = (e.clientX - Gm.drag.startX) * scaleX;
  const dy = (e.clientY - Gm.drag.startY) * scaleY;
  let nx = Gm.drag.origX + dx;
  let ny = Gm.drag.origY + dy;
  if (Gm.grid.snap) {
    const step = Math.max(2, Gm.grid.size);
    nx = Math.round(nx / step) * step;
    ny = Math.round(ny / step) * step;
  }
  gmSetProp(el, "x", Math.round(nx * 10) / 10);
  gmSetProp(el, "y", Math.round(ny * 10) / 10);
  gmDraw();
  gmRenderInspectorValues(el);
}

function gmRenderInspectorValues(el) {
  // Keep inspector numeric inputs in sync during drags without rebuilding.
  for (const input of gmEls.inspectorBody.querySelectorAll("input[data-gm-prop], select[data-gm-prop]")) {
    const prop = input.dataset.gmProp;
    if (prop === "member") continue;
    const v = gmPropValue(el, prop);
    if (input.type === "checkbox") input.checked = v !== false;
    else if (input.type === "color") {
      const col = typeof v === "string" && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v) ? v : "#ffffff";
      input.value = col;
      const swatch = input.parentElement.querySelector(".gm-prop-color-text");
      if (swatch) swatch.textContent = col;
    } else if (input.type === "number") {
      input.value = typeof v === "number" ? Math.round(v * 1000) / 1000 : (v ?? "");
    } else {
      input.value = v ?? "";
    }
  }
  // Refresh key button states (track may have been created by the drag).
  for (const btn of gmEls.inspectorBody.querySelectorAll(".gm-keybtn")) {
    const track = el.tracks?.[btn.dataset.prop];
    btn.classList.toggle("keyed", Boolean(track?.length && gmTrackHasKey(el, btn.dataset.prop, Gm.time) >= 0));
    const path = btn.querySelector("svg path");
    if (path) path.setAttribute("fill", track?.length ? "currentColor" : "none");
  }
}

function gmInitCanvas() {
  const canvas = gmEls.canvas;
  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (Gm.spec.width / rect.width);
    const py = (e.clientY - rect.top) * (Gm.spec.height / rect.height);
    const el = gmHitTest(px, py);
    if (!el) {
      Gm.selectedId = null;
      Gm.selectedKey = null;
      gmRenderAll();
      return;
    }
    Gm.selectedId = el.id;
    Gm.selectedKey = null;
    const p = GifScene.sampleElement(el, Gm.time);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    Gm.drag = { kind: "move", el: el.id, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y };
    gmRenderAll();
  });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
function gmTogglePlay() {
  Gm.playing = !Gm.playing;
  if (Gm.playing) {
    Gm.lastTick = performance.now();
    Gm.raf = requestAnimationFrame(gmTick);
    gmEls.play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
    gmEls.play.setAttribute("aria-label", "Pause");
  } else {
    cancelAnimationFrame(Gm.raf);
    gmEls.play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>';
    gmEls.play.setAttribute("aria-label", "Play");
  }
}

function gmTick(now) {
  if (!Gm.playing) return;
  const dt = Math.min(100, now - Gm.lastTick);
  Gm.lastTick = now;
  Gm.time += dt;
  if (Gm.time >= Gm.spec.durationMs) {
    if (Gm.spec.loop) Gm.time %= Gm.spec.durationMs;
    else {
      Gm.time = Gm.spec.durationMs;
      gmTogglePlay();
    }
  }
  gmDraw();
  Gm.raf = requestAnimationFrame(gmTick);
}

function gmSyncTransport() {
  gmEls.width.value = Gm.spec.width;
  gmEls.height.value = Gm.spec.height;
  gmEls.fps.value = Gm.spec.fps;
  gmEls.duration.value = Gm.spec.durationMs / 1000;
  gmEls.loop.checked = Gm.spec.loop;
  const bgOn = Gm.spec.background?.type === "color";
  gmEls.bgOn.checked = bgOn;
  if (bgOn) gmEls.bg.value = /^#[0-9a-f]{6}$/i.test(Gm.spec.background.color) ? Gm.spec.background.color : "#0a0a12";
}

function gmInitTransport() {
  gmEls.width.addEventListener("change", () => {
    Gm.spec.width = Math.min(640, Math.max(16, Math.round(Number(gmEls.width.value) || 320)));
    gmEls.width.value = Gm.spec.width;
    gmRenderAll();
  });
  gmEls.height.addEventListener("change", () => {
    Gm.spec.height = Math.min(640, Math.max(16, Math.round(Number(gmEls.height.value) || 180)));
    gmEls.height.value = Gm.spec.height;
    gmRenderAll();
  });
  gmEls.fps.addEventListener("change", () => {
    Gm.spec.fps = Math.min(30, Math.max(1, Math.round(Number(gmEls.fps.value) || 15)));
    gmEls.fps.value = Gm.spec.fps;
    gmSave();
  });
  gmEls.duration.addEventListener("change", () => {
    Gm.spec.durationMs = Math.min(15000, Math.max(200, Math.round((Number(gmEls.duration.value) || 3) * 1000)));
    gmEls.duration.value = Gm.spec.durationMs / 1000;
    if (Gm.time > Gm.spec.durationMs) Gm.time = 0;
    gmRenderAll();
  });
  gmEls.loop.addEventListener("change", () => {
    Gm.spec.loop = gmEls.loop.checked;
    gmSave();
  });
  gmEls.bgOn.addEventListener("change", () => {
    Gm.spec.background = gmEls.bgOn.checked ? { type: "color", color: gmEls.bg.value } : { type: "none" };
    gmRenderAll();
  });
  gmEls.bg.addEventListener("input", () => {
    if (Gm.spec.background?.type === "color") Gm.spec.background.color = gmEls.bg.value;
    else Gm.spec.background = { type: "color", color: gmEls.bg.value };
    if (!gmEls.bgOn.checked) { gmEls.bgOn.checked = true; }
    gmDraw();
    gmSave();
  });
}

function gmInitGridControls() {
  if (!gmEls.gridOn) return;
  gmEls.gridOn.checked = Gm.grid.on;
  gmEls.gridSnap.checked = Gm.grid.snap;
  gmEls.gridSize.value = String(Gm.grid.size);
  gmEls.gridOn.addEventListener("change", () => {
    Gm.grid.on = gmEls.gridOn.checked;
    gmDraw();
    gmSave();
  });
  gmEls.gridSnap.addEventListener("change", () => {
    Gm.grid.snap = gmEls.gridSnap.checked;
    gmSave();
  });
  gmEls.gridSize.addEventListener("change", () => {
    Gm.grid.size = Math.max(2, Math.min(64, Number(gmEls.gridSize.value) || 8));
    gmEls.gridSize.value = String(Gm.grid.size);
    gmDraw();
    gmSave();
  });
}

// ---------------------------------------------------------------------------
// Engine + export
// ---------------------------------------------------------------------------
async function gmLoadEngine() {
  try {
    const info = await json("/api/gifmaker/engine");
    gmEls.engine.textContent = info.engine === "rust" ? "rust engine · cache on" : "js fallback";
    gmEls.engine.classList.toggle("gm-engine--rust", info.engine === "rust");
    const c = info.cache;
    gmEls.engine.title = c
      ? `Cache: ${c.hits} hits / ${c.misses} misses · ${c.entries} entries · ${(c.bytes / 1048576).toFixed(1)} MB`
      : "Native cache unavailable";
  } catch {
    gmEls.engine.textContent = "engine —";
  }
}

async function gmExport() {
  const btn = document.querySelector('[data-gm="export"]');
  btn.disabled = true;
  btn.textContent = "Rendering…";
  try {
    const res = await fetch("/api/gifmaker/render", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: Gm.spec }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Render failed (${res.status})`);
    }
    const blob = await res.blob();
    const engine = res.headers.get("X-Gif-Engine") || "?";
    const cache = res.headers.get("X-Gif-Cache");
    const frames = res.headers.get("X-Gif-Frames") || "?";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hitori-${Date.now()}.gif`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(
      `Exported ${frames} frames · ${(blob.size / 1024).toFixed(1)} KB · ${engine}${cache === "hit" ? " (cache hit)" : ""}`,
      "success"
    );
    gmLoadEngine();
  } catch (err) {
    showToast(err.message || "Export failed", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Export GIF";
  }
}

// ---------------------------------------------------------------------------
// Delegated actions
// ---------------------------------------------------------------------------
function gmInitActions() {
  document.getElementById("gifmaker").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-gm]");
    if (!btn) return;
    const act = btn.dataset.gm;
    const elId = btn.dataset.el;
    if (act === "add-text") gmAddElement("text");
    else if (act === "add-shape") gmAddElement("shape");
    else if (act === "add-image") gmAddElement("image");
    else if (act === "add-avatar") gmAddElement("avatar");
    else if (act === "add-bar") gmAddElement("bar");
    else if (act === "add-counter") gmAddElement("counter");
    else if (act === "export") gmExport();
    else if (act === "play") gmTogglePlay();
    else if (act === "stop") {
      if (Gm.playing) gmTogglePlay();
      Gm.time = 0;
      gmAfterScrub();
    } else if (act === "layer-del") gmRemoveElement(elId);
    else if (act === "layer-up") gmMoveElement(elId, 1);
    else if (act === "layer-down") gmMoveElement(elId, -1);
    else if (act === "layer-dup") gmDuplicateElement(elId);
    else if (act === "layer-vis") {
      const el = gmEl(elId);
      if (el) {
        el.visible = el.visible === false;
        gmRenderAll();
      }
    } else if (act === "key") {
      const el = gmEl();
      if (el) gmToggleKey(el, btn.dataset.prop);
    } else if (act === "key-delete") {
      gmDeleteSelectedKey();
    } else if (act === "key-goto") {
      const sel = gmSelectedKeyObj();
      if (sel) {
        Gm.time = sel.key.t;
        gmAfterScrub();
      }
    }
  });

  gmEls.inspectorBody.addEventListener("input", (e) => {
    const input = e.target.closest("[data-gm-prop]");
    const el = gmEl();
    if (!input || !el) return;
    const prop = input.dataset.gmProp;
    if (prop === "member") {
      if (input.value) {
        el.src = input.value;
        gmEnsureAsset(el.src);
        gmDraw();
        gmSave();
      }
      return;
    }
    let v;
    if (input.type === "checkbox") v = input.checked;
    else if (input.type === "number") v = Number(input.value);
    else v = input.value;
    if (input.type === "number" && !Number.isFinite(v)) return;
    gmSetProp(el, prop, v);
    gmDraw();
    gmRenderTimeline();
    gmSave();
  });

  gmEls.inspectorBody.addEventListener("change", (e) => {
    const input = e.target.closest("[data-gm-prop]");
    if (!input) return;
    gmRenderInspector();
    gmDraw();
  });

  gmEls.keyEditorBody.addEventListener("input", (e) => {
    const input = e.target.closest("[data-gm-key]");
    const sel = gmSelectedKeyObj();
    if (!input || !sel) return;
    const what = input.dataset.gmKey;
    if (what === "t") {
      const t = Math.min(Gm.spec.durationMs, Math.max(0, Number(input.value) || 0));
      sel.key.t = t;
    } else if (what === "v") {
      sel.key.v = input.type === "number" ? Number(input.value) : input.value;
    } else if (what === "e") {
      sel.key.e = input.value;
    }
    sel.el.tracks[Gm.selectedKey.prop].sort((a, b) => a.t - b.t);
    Gm.selectedKey.index = sel.el.tracks[Gm.selectedKey.prop].indexOf(sel.key);
    gmDraw();
    gmRenderTimeline();
    gmSave();
  });
}

// ---------------------------------------------------------------------------
// Init + section hook
// ---------------------------------------------------------------------------
function gmRenderAll() {
  gmRenderLayers();
  gmRenderInspector();
  gmRenderTimeline();
  gmSyncTransport();
  gmRefreshAssets();
  gmDraw();
  gmSave();
}

function gmInit() {
  if (Gm.initDone) return;
  Gm.initDone = true;

  gmEls.canvas = $gm("gm-canvas");
  gmEls.layers = $gm("gm-layers");
  gmEls.layersEmpty = $gm("gm-layers-empty");
  gmEls.inspectorBody = $gm("gm-inspector-body");
  gmEls.keyEditor = $gm("gm-keyeditor");
  gmEls.keyEditorBody = $gm("gm-keyeditor-body");
  gmEls.tl = $gm("gm-tl");
  gmEls.tlRuler = $gm("gm-tl-ruler");
  gmEls.tlRows = $gm("gm-tl-rows");
  gmEls.tlPlayhead = $gm("gm-tl-playhead");
  gmEls.play = $gm("gm-play");
  gmEls.time = $gm("gm-time");
  gmEls.engine = $gm("gm-engine");
  gmEls.width = $gm("gm-width");
  gmEls.height = $gm("gm-height");
  gmEls.fps = $gm("gm-fps");
  gmEls.duration = $gm("gm-duration");
  gmEls.loop = $gm("gm-loop");
  gmEls.bgOn = $gm("gm-bg-on");
  gmEls.bg = $gm("gm-bg");
  gmEls.gridOn = $gm("gm-grid-on");
  gmEls.gridSize = $gm("gm-grid-size");
  gmEls.gridSnap = $gm("gm-snap");

  gmLoad();
  gmInitActions();
  gmInitTimelineEvents();
  gmInitCanvas();
  gmInitTransport();
  gmInitGridControls();
  gmLoadEngine();

  window.addEventListener("resize", gmPositionPlayhead);
  gmRenderAll();
}

// Section hook — registered into dashboard.js's loader map.
if (typeof sections === "object" && sections) {
  sections.gifmaker = () => {
    gmInit();
    gmLoadEngine();
    gmRenderAll();
  };
}

if (typeof sectionDisplayNames === "object" && sectionDisplayNames) {
  sectionDisplayNames.gifmaker = "GIF maker";
}
