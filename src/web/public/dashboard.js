const guildSelect = document.getElementById("guild-select");
const sectionTitle = document.getElementById("section-title");
const navLinks = document.querySelectorAll(".nav-links a");

let currentGuild = "";
let currentSection = "overview";

function api(path, options = {}) {
  return fetch(path, { credentials: "same-origin", ...options });
}

async function json(path, options = {}) {
  const res = await api(path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401) window.location.href = "/";
    throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
  }
  return res.json();
}

async function loadGuilds() {
  const guilds = await json("/api/guilds");
  guildSelect.innerHTML = '<option value="">Select a server</option>' +
    guilds.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

// ── Sections ──

const sections = {
  overview: async () => {
    const client = await json("/api/guilds");
    document.getElementById("stat-servers").textContent = client.length;
    let users = 0;
    for (const g of client) users += g.memberCount || 0;
    document.getElementById("stat-users").textContent = users;
    document.getElementById("stat-commands").textContent = "-";
    document.getElementById("stat-messages").textContent = "-";
  },

  economy: async () => {
    if (!currentGuild) return;
    const rows = await json(`/api/economy/${currentGuild}`);
    const tbody = document.querySelector("#economy-table tbody");
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.userName || r.userId)}</td>
        <td>${r.primary.toLocaleString()}</td>
        <td>${r.secondary.toLocaleString()}</td>
      </tr>
    `).join("") || '<tr><td colspan="3">No data</td></tr>';
  },

  ai: async () => {
    if (!currentGuild) return;
    const settings = await json(`/api/ai/${currentGuild}`);
    document.getElementById("ai-enabled").checked = settings.enabled;
    document.getElementById("ai-mode").value = settings.mode;
    document.getElementById("ai-channel").value = settings.channelId || "";
    document.getElementById("ai-prompt").value = settings.customPrompt || "";
  },

  streak: async () => {
    if (!currentGuild) return;
    const settings = await json(`/api/streak/${currentGuild}`);
    document.getElementById("streak-enabled").checked = settings.enabled;
    document.getElementById("streak-track").value = settings.trackChannelId || "";
    document.getElementById("streak-notify").value = settings.notifyChannelId || "";
  },

  moderation: async () => {
    if (!currentGuild) return;
    const mod = await json(`/api/moderation/${currentGuild}`);
    document.getElementById("mod-log").value = mod.logChannelId || "";
    document.getElementById("mod-role").value = mod.modRoleId || "";
    const prefix = await json(`/api/prefix/${currentGuild}`);
    document.getElementById("prefix").value = prefix.prefix;
  },

  triggers: async () => {
    if (!currentGuild) return;
    const rows = await json(`/api/triggers/${currentGuild}`);
    const tbody = document.querySelector("#triggers-table tbody");
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.keyword)}</td>
        <td>${escapeHtml(r.commandName)}</td>
        <td><button onclick="deleteTrigger('${r.keyword}')">Delete</button></td>
      </tr>
    `).join("") || '<tr><td colspan="3">No triggers</td></tr>';
  },

  logs: async () => {
    if (!currentGuild) return;
    const cmdLogs = await json(`/api/logs/commands/${currentGuild}?limit=50`);
    const msgLogs = await json(`/api/logs/messages/${currentGuild}?limit=50`);

    const cmdBody = document.querySelector("#command-logs-table tbody");
    cmdBody.innerHTML = cmdLogs.map((l) => `
      <tr>
        <td>${formatDate(l.createdAt)}</td>
        <td>${escapeHtml(l.userName || l.userId)}</td>
        <td>${escapeHtml(l.commandName)}</td>
        <td>${escapeHtml(l.source)}</td>
        <td class="${l.success ? 'status-ok' : 'status-err'}">${l.success ? 'Yes' : 'No'}</td>
      </tr>
    `).join("") || '<tr><td colspan="5">No command logs</td></tr>';

    const msgBody = document.querySelector("#message-logs-table tbody");
    msgBody.innerHTML = msgLogs.map((l) => `
      <tr>
        <td>${formatDate(l.createdAt)}</td>
        <td>${escapeHtml(l.userName || l.userId)}</td>
        <td>${l.channelId}</td>
        <td>${escapeHtml(l.content)}</td>
      </tr>
    `).join("") || '<tr><td colspan="4">No message logs</td></tr>';
  },
};

async function refreshSection() {
  if (sections[currentSection]) await sections[currentSection]();
}

function showSection(name) {
  currentSection = name;
  sectionTitle.textContent = name[0].toUpperCase() + name.slice(1);
  document.querySelectorAll(".content-section").forEach((el) => el.classList.remove("active"));
  document.getElementById(name).classList.add("active");
  navLinks.forEach((l) => l.classList.toggle("active", l.dataset.section === name));
  refreshSection();
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showSection(link.dataset.section);
  });
});

guildSelect.addEventListener("change", (e) => {
  currentGuild = e.target.value;
  refreshSection();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  window.location.href = "/";
});

// ── Forms ──

document.getElementById("ai-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/ai/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({
      enabled: document.getElementById("ai-enabled").checked,
      mode: document.getElementById("ai-mode").value,
      channelId: document.getElementById("ai-channel").value.trim() || null,
      customPrompt: document.getElementById("ai-prompt").value.trim() || null,
    }),
  });
  alert("AI settings saved");
});

document.getElementById("streak-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/streak/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({
      enabled: document.getElementById("streak-enabled").checked,
      trackChannelId: document.getElementById("streak-track").value.trim() || null,
      notifyChannelId: document.getElementById("streak-notify").value.trim() || null,
    }),
  });
  alert("Streak settings saved");
});

document.getElementById("moderation-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/moderation/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({
      logChannelId: document.getElementById("mod-log").value.trim() || null,
      modRoleId: document.getElementById("mod-role").value.trim() || null,
    }),
  });
  alert("Moderation settings saved");
});

document.getElementById("prefix-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/prefix/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({ prefix: document.getElementById("prefix").value.trim() }),
  });
  alert("Prefix saved");
});

document.getElementById("trigger-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  const keyword = document.getElementById("trigger-keyword").value.trim();
  const commandName = document.getElementById("trigger-command").value.trim();
  await json(`/api/triggers/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({ keyword, commandName }),
  });
  document.getElementById("trigger-form").reset();
  refreshSection();
});

window.deleteTrigger = async (keyword) => {
  if (!currentGuild) return;
  await json(`/api/triggers/${currentGuild}/${encodeURIComponent(keyword)}`, { method: "DELETE" });
  refreshSection();
};

// ── Init ──

loadGuilds().then(() => showSection("overview"));
