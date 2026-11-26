const listEl = document.getElementById("server-list");
const emptyEl = document.getElementById("servers-empty");
const errorEl = document.getElementById("servers-error");
const userBox = document.getElementById("servers-user");
const nameEl = document.getElementById("servers-name");
const avatarEl = document.getElementById("servers-avatar");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function initials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "—";
  return clean.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

async function fetchJson(path, options) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  if (res.status === 401) {
    window.location.replace("/");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  return res.json();
}

function renderUser(user) {
  if (!user) return;
  nameEl.textContent = user.displayName || user.username || "Account";
  if (user.avatar) {
    avatarEl.src = user.avatar;
    avatarEl.hidden = false;
  }
  userBox.hidden = false;
}

function renderList(guilds) {
  if (!guilds.length) {
    emptyEl.hidden = false;
    return;
  }
  listEl.innerHTML = guilds.map((g) => `
    <button type="button" role="option" class="server-pick" data-id="${escapeHtml(g.id)}">
      ${g.icon
        ? `<img src="${escapeHtml(g.icon)}" alt="" />`
        : `<span class="server-fallback">${escapeHtml(initials(g.name))}</span>`}
      <span class="server-meta">
        <span class="server-name">${escapeHtml(g.name || g.id)}</span>
        <span class="server-sub">${(g.memberCount || 0).toLocaleString()} members</span>
      </span>
      ${g.role ? `<span class="server-role ${g.role === "owner" ? "owner" : ""}">${g.role === "owner" ? "Owner" : "Manager"}</span>` : ""}
    </button>
  `).join("");
}

listEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".server-pick");
  if (!btn) return;
  window.location.href = `/dashboard?guild=${encodeURIComponent(btn.dataset.id)}`;
});

document.getElementById("servers-logout").addEventListener("click", async () => {
  try { await fetchJson("/api/logout", { method: "POST" }); } catch { /* session may already be gone */ }
  window.location.href = "/";
});

(async () => {
  try {
    const [me, guilds] = await Promise.all([
      fetchJson("/api/auth/me"),
      fetchJson("/api/guilds"),
    ]);
    renderUser(me.user);
    renderList(guilds);
  } catch (err) {
    if (err.message === "unauthorized") return;
    errorEl.textContent = "Could not load your servers. Refresh to try again.";
    errorEl.hidden = false;
  }
})();
