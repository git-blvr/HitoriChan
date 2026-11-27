/* =========================================================
   Bot profile section — view/edit the bot's global profile
   (username, avatar, banner) + presence.
   ========================================================= */

function bpStatus(msg, kind = "") {
  const el = document.getElementById("bp-status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = `form-status ${kind}`;
}

async function bpLoad() {
  bpStatus("Loading…");
  try {
    const p = await json("/api/bot/profile");
    document.getElementById("bp-tag").textContent = p.tag || p.username || "—";
    document.getElementById("bp-id").textContent = p.id ? `ID ${p.id}` : "";
    document.getElementById("bp-created").textContent = p.createdAt ? `Created ${new Date(p.createdAt).toLocaleDateString()}` : "";
    const avatarEl = document.getElementById("bp-avatar");
    avatarEl.src = p.avatar || "";
    avatarEl.style.visibility = p.avatar ? "visible" : "hidden";
    const bannerEl = document.getElementById("bp-banner");
    bannerEl.style.backgroundImage = p.banner ? `url("${p.banner}")` : "";
    if (!p.banner && p.accentColor != null) {
      bannerEl.style.background = `#${p.accentColor.toString(16).padStart(6, "0")}`;
    }
    document.getElementById("bp-username").value = p.username || "";
    document.getElementById("bp-avatar-url").value = "";
    document.getElementById("bp-banner-url").value = "";
    document.getElementById("bp-status-select").value = p.status || "online";
    const act = (p.activities || [])[0];
    const typeNames = { 0: "playing", 1: "streaming", 2: "listening", 3: "watching", 5: "competing" };
    document.getElementById("bp-activity-type").value = act ? (typeNames[act.type] || "playing") : "playing";
    document.getElementById("bp-activity-name").value = act?.name || "";
    document.getElementById("bp-activity-url-row").hidden = document.getElementById("bp-activity-type").value !== "streaming";
    window.hcBotAvatarUrl = p.avatar;
    window.hcBotName = p.username;
    bpStatus("");
  } catch (err) {
    bpStatus(err.message || "Could not load bot profile", "err");
  }
}

function bpFileToInput(fileInputId, urlInputId) {
  const file = document.getElementById(fileInputId)?.files?.[0];
  if (!file) return;
  if (file.size > 9 * 1024 * 1024) return showToast("Image must be under 9 MB", "error");
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById(urlInputId).value = String(reader.result || "");
    showToast("Image loaded — save to apply", "info");
  };
  reader.readAsDataURL(file);
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action^='bp-']");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "bp-avatar-file") {
    document.getElementById("bp-avatar-file").click();
  } else if (action === "bp-banner-file") {
    document.getElementById("bp-banner-file").click();
  } else if (action === "bp-refresh") {
    bpLoad();
  } else if (action === "bp-save") {
    const body = {};
    const username = document.getElementById("bp-username").value.trim();
    const avatar = document.getElementById("bp-avatar-url").value.trim();
    const banner = document.getElementById("bp-banner-url").value.trim();
    if (username) body.username = username;
    if (avatar) body.avatar = avatar;
    if (banner) body.banner = banner;
    if (!Object.keys(body).length) return showToast("Nothing to change", "info");
    bpStatus("Saving…");
    json("/api/bot/profile", { method: "POST", body: JSON.stringify(body) })
      .then((r) => {
        bpStatus(`Saved: ${(r.changed || []).join(", ") || "no changes"}`, "ok");
        showToast("Bot profile updated", "success");
        bpLoad();
      })
      .catch((err) => bpStatus(err.message || "Save failed", "err"));
  } else if (action === "bp-save-presence") {
    const body = {
      status: document.getElementById("bp-status-select").value,
      activityType: document.getElementById("bp-activity-type").value,
      activityName: document.getElementById("bp-activity-name").value,
      activityUrl: document.getElementById("bp-activity-url").value,
    };
    json("/api/bot/presence", { method: "POST", body: JSON.stringify(body) })
      .then(() => { bpStatus("Presence updated", "ok"); showToast("Presence updated", "success"); })
      .catch((err) => bpStatus(err.message || "Save failed", "err"));
  }
});

document.getElementById("bp-avatar-file")?.addEventListener("change", () => bpFileToInput("bp-avatar-file", "bp-avatar-url"));
document.getElementById("bp-banner-file")?.addEventListener("change", () => bpFileToInput("bp-banner-file", "bp-banner-url"));
document.getElementById("bp-activity-type")?.addEventListener("change", (e) => {
  document.getElementById("bp-activity-url-row").hidden = e.target.value !== "streaming";
});

if (typeof sections === "object" && sections) sections.bot = bpLoad;
if (typeof sectionDisplayNames === "object" && sectionDisplayNames) sectionDisplayNames.bot = "Bot profile";
