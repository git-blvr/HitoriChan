/* =========================================================
   Message studio — CV2 message composer, live preview,
   templates + send-to-channel. Depends on dashboard.js
   globals: sections, sectionDisplayNames, api/json,
   showToast, escapeHtml, currentGuild, populateChannels.
   ========================================================= */

const STUDIO_COMP_TYPES = {
  text: { label: "Text", defaults: () => ({ type: "text", content: "Your message" }) },
  section: { label: "Section", defaults: () => ({ type: "section", content: "Section text", thumbnail: "" }) },
  image: { label: "Image", defaults: () => ({ type: "image", url: "" }) },
  media_gallery: { label: "Gallery", defaults: () => ({ type: "media_gallery", urls: [""] }) },
  separator: { label: "Separator", defaults: () => ({ type: "separator", divider: true, large: false }) },
  buttons: { label: "Buttons", defaults: () => ({ type: "buttons", buttons: [{ label: "Open", url: "https://example.com" }] }) },
};

let studioLoaded = false;

function studioComponentsList() {
  return document.getElementById("studio-components");
}

function studioComponentRow(c, i, count) {
  const type = STUDIO_COMP_TYPES[c.type] ? c.type : "text";
  const header = `
    <header>
      <span class="move-btns">
        <button type="button" data-action="studio-move" data-index="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">&#8593;</button>
        <button type="button" data-action="studio-move" data-index="${i}" data-dir="1" ${i === count - 1 ? "disabled" : ""} aria-label="Move down">&#8595;</button>
      </span>
      ${STUDIO_COMP_TYPES[type].label}
      <button type="button" class="remove-btn" data-action="studio-remove" data-index="${i}">Remove</button>
    </header>`;

  let body = "";
  if (type === "text") {
    body = `<textarea class="sc-content" rows="3" data-emoji placeholder="Message text — Discord markdown supported">${escapeHtml(c.content || "")}</textarea>`;
  } else if (type === "section") {
    body = `
      <textarea class="sc-content" rows="3" data-emoji placeholder="Section text">${escapeHtml(c.content || "")}</textarea>
      <input type="text" class="sc-thumb" value="${escapeHtml(c.thumbnail || "")}" placeholder="Thumbnail image URL (optional)" />`;
  } else if (type === "image") {
    body = `<input type="text" class="sc-url" value="${escapeHtml(c.url || "")}" placeholder="https://… image URL" />`;
  } else if (type === "media_gallery") {
    body = `<textarea class="sc-urls" rows="3" placeholder="One image URL per line">${escapeHtml((c.urls || []).join("\n"))}</textarea>`;
  } else if (type === "separator") {
    body = `
      <label class="checkbox-inline"><input type="checkbox" class="sc-divider" ${c.divider !== false ? "checked" : ""} /> Show divider line</label>
      <label class="checkbox-inline"><input type="checkbox" class="sc-large" ${c.large ? "checked" : ""} /> Large spacing</label>`;
  } else if (type === "buttons") {
    const rows = (c.buttons || []).slice(0, 5).map((b, bi) => `
      <div class="comp-btn-row" data-btn-index="${bi}">
        <input type="text" class="sc-btn-label" value="${escapeHtml(b.label || "")}" data-emoji placeholder="Label" />
        <input type="text" class="sc-btn-url" value="${escapeHtml(b.url || "")}" placeholder="https://…" />
        <button type="button" class="remove-btn" data-action="studio-remove-btn" data-index="${i}" data-btn="${bi}">×</button>
      </div>`).join("");
    body = `<div class="comp-btns">${rows}</div>
      ${(c.buttons || []).length < 5 ? `<button type="button" class="btn btn-sm btn-ghost" data-action="studio-add-btn" data-index="${i}">+ Button</button>` : ""}`;
  }

  return `<div class="reorder-item studio-comp" data-type="${type}" data-index="${i}">${header}${body}</div>`;
}

function readStudioComponents() {
  const out = [];
  document.querySelectorAll("#studio-components .studio-comp").forEach((el) => {
    const type = el.dataset.type;
    if (type === "text") out.push({ type, content: el.querySelector(".sc-content")?.value ?? "" });
    else if (type === "section") out.push({ type, content: el.querySelector(".sc-content")?.value ?? "", thumbnail: el.querySelector(".sc-thumb")?.value?.trim() ?? "" });
    else if (type === "image") out.push({ type, url: el.querySelector(".sc-url")?.value?.trim() ?? "" });
    else if (type === "media_gallery") out.push({ type, urls: (el.querySelector(".sc-urls")?.value ?? "").split("\n").map((s) => s.trim()).filter(Boolean) });
    else if (type === "separator") out.push({ type, divider: !!el.querySelector(".sc-divider")?.checked, large: !!el.querySelector(".sc-large")?.checked });
    else if (type === "buttons") {
      const buttons = [];
      el.querySelectorAll(".comp-btn-row").forEach((row) => {
        const label = row.querySelector(".sc-btn-label")?.value?.trim();
        const url = row.querySelector(".sc-btn-url")?.value?.trim();
        if (label && url) buttons.push({ label, url });
      });
      out.push({ type, buttons });
    }
  });
  return out;
}

function renderStudioComponents(components) {
  studioComponentsList().innerHTML = components.map((c, i) => studioComponentRow(c, i, components.length)).join("");
  renderStudioPreview();
}

function getStudioPayload() {
  const title = document.getElementById("studio-title")?.value?.trim() ?? "";
  const noAccent = document.getElementById("studio-no-accent")?.checked;
  const colorHex = document.getElementById("studio-color")?.value ?? "#00ff1e";
  const color = noAccent ? null : parseInt(colorHex.replace("#", ""), 16);
  return { title, color, components: readStudioComponents() };
}

function mdInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>");
  html = html.replace(/__([^_]+)__/g, "<u>$1</u>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^# (.+)$/gm, "<strong class=\"dc-h1\">$1</strong>");
  html = html.replace(/^## (.+)$/gm, "<strong>$1</strong>");
  return html;
}

function studioPreviewComponent(c) {
  if (!c || !c.type) return "";
  if (c.type === "text" && c.content) return `<div class="dc-text">${mdInline(c.content)}</div>`;
  if (c.type === "section" && (c.content || c.thumbnail)) {
    const thumb = c.thumbnail ? `<img class="dc-thumb" src="${escapeHtml(c.thumbnail)}" alt="" onerror="this.style.display='none'" />` : "";
    return `<div class="dc-section"><div class="dc-text">${mdInline(c.content || "")}</div>${thumb}</div>`;
  }
  if (c.type === "image" && c.url) return `<img class="dc-img" src="${escapeHtml(c.url)}" alt="" onerror="this.style.display='none'" />`;
  if (c.type === "media_gallery" && c.urls?.length) {
    return `<div class="dc-gallery">${c.urls.slice(0, 4).map((u) => `<img src="${escapeHtml(u)}" alt="" onerror="this.style.display='none'" />`).join("")}</div>`;
  }
  if (c.type === "separator") return `<hr class="dc-sep ${c.divider ? "" : "plain"}" />`;
  if (c.type === "buttons" && c.buttons?.length) {
    return `<div class="dc-btn-row">${c.buttons.slice(0, 5).map((b) => `<button type="button" class="dc-btn">${escapeHtml(b.label)}</button>`).join("")}</div>`;
  }
  return "";
}

async function renderStudioPreview() {
  const box = document.getElementById("studio-preview");
  if (!box) return;
  const payload = getStudioPayload();
  const color = payload.color != null ? `#${payload.color.toString(16).padStart(6, "0")}` : "#313338";

  let inner = "";
  if (payload.title) inner += `<div class="dc-text dc-title">${mdInline(payload.title)}</div>`;
  inner += payload.components.map(studioPreviewComponent).join("");
  if (!inner.trim()) inner = `<div class="dc-empty">Nothing here yet — add a component.</div>`;

  const avatar = window.hcBotAvatarUrl
    ? `<img src="${escapeHtml(window.hcBotAvatarUrl)}" alt="" />`
    : "H";
  box.innerHTML = `
    <div class="dc-avatar">${avatar}</div>
    <div class="dc-body">
      <div class="dc-head">
        <span class="dc-name">${escapeHtml(window.hcBotName || "HitoriChan")}</span>
        <span class="dc-badge">APP</span>
        <span class="dc-time">Today at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div class="dc-container" style="border-left-color:${escapeHtml(color)}">${inner}</div>
    </div>`;
}

let studioPreviewTimer = null;
function queueStudioPreview() {
  clearTimeout(studioPreviewTimer);
  studioPreviewTimer = setTimeout(renderStudioPreview, 150);
}

async function loadStudioTemplates() {
  const list = document.getElementById("studio-templates");
  if (!list || !currentGuild) return;
  try {
    const templates = await json(`/api/messages/${currentGuild}`);
    if (!templates.length) {
      list.innerHTML = `<p class="hint">No saved templates yet.</p>`;
      return;
    }
    list.innerHTML = templates.map((t) => `
      <div class="studio-tpl" data-id="${t.id}">
        <span class="tpl-name">${escapeHtml(t.name)}</span>
        <span class="tpl-meta">${(t.payload?.components || []).length} components</span>
        <button type="button" class="btn btn-sm btn-ghost" data-action="studio-load-tpl" data-id="${t.id}">Load</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="studio-send-tpl" data-id="${t.id}">Send</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="studio-del-tpl" data-id="${t.id}">Delete</button>
      </div>`).join("");
  } catch (err) {
    list.innerHTML = `<p class="hint">Could not load templates: ${escapeHtml(err.message)}</p>`;
  }
}

function fillStudioEditor(payload) {
  document.getElementById("studio-title").value = payload?.title ?? "";
  const color = payload?.color;
  document.getElementById("studio-no-accent").checked = color == null;
  document.getElementById("studio-color").value = color != null ? `#${color.toString(16).padStart(6, "0")}` : "#00ff1e";
  renderStudioComponents(payload?.components?.length ? payload.components : [{ type: "text", content: "" }]);
}

async function studioSend(payloadOverride) {
  const channelId = document.getElementById("studio-channel")?.value;
  if (!channelId) return showToast("Pick a channel to send to", "error");
  const payload = payloadOverride ?? getStudioPayload();
  try {
    const body = { channelId };
    if (payloadOverride) body.templateId = payloadOverride; else body.payload = payload;
    await json(`/api/messages/${currentGuild}/send`, { method: "POST", body: JSON.stringify(body) });
    showToast("Message sent", "success");
  } catch (err) {
    showToast(err.message || "Send failed", "error");
  }
}

function handleStudioAction(btn) {
  const action = btn.dataset.action;
  if (action === "studio-add-comp") {
    const type = btn.dataset.type;
    const components = readStudioComponents();
    components.push(STUDIO_COMP_TYPES[type].defaults());
    renderStudioComponents(components);
  } else if (action === "studio-remove") {
    const components = readStudioComponents();
    components.splice(Number(btn.dataset.index), 1);
    renderStudioComponents(components);
  } else if (action === "studio-move") {
    const components = readStudioComponents();
    const i = Number(btn.dataset.index);
    const j = i + Number(btn.dataset.dir);
    if (j >= 0 && j < components.length) {
      [components[i], components[j]] = [components[j], components[i]];
      renderStudioComponents(components);
    }
  } else if (action === "studio-add-btn") {
    const components = readStudioComponents();
    const c = components[Number(btn.dataset.index)];
    if (c?.type === "buttons" && c.buttons.length < 5) {
      c.buttons.push({ label: "", url: "" });
      renderStudioComponents(components);
    }
  } else if (action === "studio-remove-btn") {
    const components = readStudioComponents();
    const c = components[Number(btn.dataset.index)];
    if (c?.type === "buttons") {
      c.buttons.splice(Number(btn.dataset.btn), 1);
      renderStudioComponents(components);
    }
  } else if (action === "studio-new") {
    fillStudioEditor({ title: "", color: null, components: [{ type: "text", content: "" }] });
  } else if (action === "studio-import") {
    const raw = window.prompt("Paste a studio payload JSON ({ title, color, components }):");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const payload = parsed.payload ?? parsed;
      fillStudioEditor(payload);
      showToast("Payload imported", "success");
    } catch (err) {
      showToast("Invalid JSON: " + err.message, "error");
    }
  } else if (action === "studio-copy-json") {
    const payload = getStudioPayload();
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2))
      .then(() => showToast("Payload copied", "success"))
      .catch(() => showToast("Copy failed", "error"));
  } else if (action === "studio-send") {
    studioSend();
  } else if (action === "studio-save-template") {
    const name = window.prompt("Template name:");
    if (!name?.trim()) return;
    const payload = getStudioPayload();
    json(`/api/messages/${currentGuild}`, { method: "POST", body: JSON.stringify({ name: name.trim(), payload }) })
      .then(() => { showToast("Template saved", "success"); loadStudioTemplates(); })
      .catch((err) => showToast(err.message || "Save failed", "error"));
  } else if (action === "studio-load-tpl") {
    const id = Number(btn.dataset.id);
    json(`/api/messages/${currentGuild}`).then((templates) => {
      const tpl = templates.find((t) => t.id === id);
      if (tpl) fillStudioEditor(tpl.payload);
    }).catch(() => showToast("Load failed", "error"));
  } else if (action === "studio-send-tpl") {
    studioSend(Number(btn.dataset.id));
  } else if (action === "studio-del-tpl") {
    if (!window.confirm("Delete this template?")) return;
    json(`/api/messages/${currentGuild}/${btn.dataset.id}`, { method: "DELETE" })
      .then(() => { showToast("Template deleted", "success"); loadStudioTemplates(); })
      .catch((err) => showToast(err.message || "Delete failed", "error"));
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action^='studio-']");
  if (btn) handleStudioAction(btn);
});

document.addEventListener("input", (e) => {
  if (e.target.closest("#studio")) queueStudioPreview();
});
document.addEventListener("change", (e) => {
  if (e.target.closest("#studio")) queueStudioPreview();
});

function studioInit() {
  populateChannels("studio-channel", null, "Pick a channel");
  if (!studioLoaded) {
    fillStudioEditor({ title: "", color: null, components: [{ type: "text", content: "" }] });
    studioLoaded = true;
  } else {
    renderStudioPreview();
  }
  loadStudioTemplates();
  // Grab bot avatar/name for the preview header (best effort).
  json("/api/bot/profile")
    .then((p) => {
      if (p?.avatar) window.hcBotAvatarUrl = p.avatar;
      if (p?.username) window.hcBotName = p.username;
      renderStudioPreview();
    })
    .catch(() => {});
}

if (typeof sections === "object" && sections) sections.studio = studioInit;
if (typeof sectionDisplayNames === "object" && sectionDisplayNames) sectionDisplayNames.studio = "Message studio";
