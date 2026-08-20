const guildSelect = document.getElementById("guild-select");
const sectionTitle = document.getElementById("section-title");
const navLinks = document.querySelectorAll(".nav-links a");

let currentGuild = "";
let currentSection = "overview";
let allGuilds = [];
let activityChart = null;
let guildData = { id: null, channels: [], roles: [] };

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

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, 3500);
}

async function loadGuilds() {
  allGuilds = await json("/api/guilds");
  guildSelect.innerHTML = '<option value="">Select a server</option>' +
    allGuilds.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");

  if (allGuilds.length === 1) {
    const g = allGuilds[0];
    currentGuild = g.id;
    guildSelect.value = g.id;
    updateGuildIcon(g.id);
    await loadGuildData(g.id);
  }

  return allGuilds;
}

async function loadGuildData(guildId) {
  if (!guildId) {
    guildData = { id: null, channels: [], roles: [], categories: [] };
    return;
  }
  if (guildData.id === guildId) return;

  const [channels, roles, categories] = await Promise.all([
    json(`/api/guilds/${guildId}/channels`),
    json(`/api/guilds/${guildId}/roles`),
    json(`/api/guilds/${guildId}/categories`),
  ]);

  guildData = { id: guildId, channels, roles, categories };
}

function populateChannels(selectId, selectedId, placeholder = "-- None --") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = guildData.channels.map((c) =>
    `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>#${escapeHtml(c.name)}</option>`
  ).join("");
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options;
}

function populateRoles(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = guildData.roles.map((r) =>
    `<option value="${r.id}" ${r.id === selectedId ? "selected" : ""}>${escapeHtml(r.name)}</option>`
  ).join("");
  select.innerHTML = '<option value="">-- None --</option>' + options;
}

async function loadGuildCategories(guildId) {
  if (!guildId) return [];
  if (guildData.id === guildId && guildData.categories) return guildData.categories;
  guildData.categories = await json(`/api/guilds/${guildId}/categories`);
  return guildData.categories;
}

function populateCategories(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = (guildData.categories || []).map((c) =>
    `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");
  select.innerHTML = '<option value="">-- None --</option>' + options;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

const sections = {
  overview: async () => {
    const [overview, guilds] = await Promise.all([json("/api/overview"), json("/api/guilds")]);

    document.getElementById("stat-servers").textContent = overview.bot.guilds;
    document.getElementById("stat-users").textContent = overview.bot.users;
    document.getElementById("stat-messages").textContent = overview.totals.messages.toLocaleString();
    document.getElementById("stat-voice").textContent = overview.totals.voiceHours.toLocaleString();
    document.getElementById("stat-collaborators").textContent = overview.totals.collaborators.toLocaleString();
    document.getElementById("stat-uptime").textContent = formatDuration(overview.bot.uptime);

    document.getElementById("sys-bot").textContent = overview.bot.tag;
    document.getElementById("sys-status").textContent = overview.bot.status;
    document.getElementById("sys-node").textContent = overview.system.node;
    document.getElementById("sys-platform").textContent = overview.system.platform;
    document.getElementById("sys-cpus").textContent = overview.system.cpuCount;

    const usedGB = (overview.system.memoryUsed / 1024 / 1024 / 1024).toFixed(2);
    const totalGB = (overview.system.memoryTotal / 1024 / 1024 / 1024).toFixed(2);
    const freePercent = Math.round((overview.system.memoryFree / overview.system.memoryTotal) * 100);
    document.getElementById("sys-memory").textContent = `${usedGB} / ${totalGB} GB (${freePercent}% free)`;

    await renderChart(currentGuild || "", document.getElementById("chart-range").value);
  },

  economy: async () => {
    if (!currentGuild) return;
    const { settings, leaderboard } = await json(`/api/economy/${currentGuild}`);

    document.getElementById("econ-primary-name").value = settings.primaryCurrency.name;
    document.getElementById("econ-primary-symbol").value = settings.primaryCurrency.symbol;
    document.getElementById("econ-primary-emoji").value = settings.primaryCurrency.emoji || "";
    document.getElementById("econ-secondary-name").value = settings.secondaryCurrency.name;
    document.getElementById("econ-secondary-symbol").value = settings.secondaryCurrency.symbol;
    document.getElementById("econ-secondary-emoji").value = settings.secondaryCurrency.emoji || "";
    document.getElementById("econ-daily-min").value = settings.dailyMin;
    document.getElementById("econ-daily-max").value = settings.dailyMax;

    await loadEmojiPicker(currentGuild);

    const tbody = document.querySelector("#economy-table tbody");
    tbody.innerHTML = leaderboard.map((r) => `
      <tr>
        <td class="user-cell">
          ${r.userAvatar ? `<img src="${escapeHtml(r.userAvatar)}" alt="" class="table-avatar" />` : ""}
          <span>${escapeHtml(r.userName || r.userId)}</span>
        </td>
        <td>${(settings.primaryCurrency.emoji ? `${settings.primaryCurrency.emoji} ` : "")}${r.primary.toLocaleString()}</td>
        <td>${(settings.secondaryCurrency.emoji ? `${settings.secondaryCurrency.emoji} ` : "")}${r.secondary.toLocaleString()}</td>
      </tr>
    `).join("") || '<tr><td colspan="3">No data</td></tr>';
  },

  ai: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const settings = await json(`/api/ai/${currentGuild}`);
    document.getElementById("ai-enabled").checked = settings.enabled;
    document.getElementById("ai-mode").value = settings.mode;
    populateChannels("ai-channel", settings.channelId || "", "-- None --");
    document.getElementById("ai-prompt").value = settings.customPrompt || "";
  },

  streak: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const settings = await json(`/api/streak/${currentGuild}`);
    document.getElementById("streak-enabled").checked = settings.enabled;
    populateChannels("streak-track", settings.trackChannelId || "", "-- All channels --");
    populateChannels("streak-notify", settings.notifyChannelId || "", "-- Same as track --");
  },

  moderation: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const mod = await json(`/api/moderation/${currentGuild}`);
    populateChannels("mod-log", mod.logChannelId || "", "-- None --");
    populateRoles("mod-role", mod.modRoleId || "");
    const prefix = await json(`/api/prefix/${currentGuild}`);
    document.getElementById("prefix").value = prefix.prefix;
  },

  cases: async () => {
    if (!currentGuild) return;
    const rows = await json(`/api/moderation/cases/${currentGuild}`);
    const tbody = document.querySelector("#cases-table tbody");
    tbody.innerHTML = rows.map((c) => `
      <tr>
        <td>${escapeHtml(c.caseId)}</td>
        <td>${escapeHtml(c.action)}</td>
        <td title="${escapeHtml(c.targetId)}">${escapeHtml(c.targetName || c.targetId)}</td>
        <td title="${escapeHtml(c.moderatorId)}">${escapeHtml(c.moderatorName || c.moderatorId)}</td>
        <td>${escapeHtml(c.reason)}</td>
        <td>${formatDate(c.createdAt)}</td>
      </tr>
    `).join("") || '<tr><td colspan="6">No cases</td></tr>';
  },

  tickets: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const panels = await json(`/api/tickets/panels/${currentGuild}`);
    const tbody = document.querySelector("#ticket-panels-table tbody");
    tbody.innerHTML = panels.map((p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.type)}</td>
        <td>${escapeHtml(p.buttonLabel)}</td>
        <td title="${escapeHtml(p.categoryId || "")}">${escapeHtml(guildData.categories.find((c) => c.id === p.categoryId)?.name || "—")}</td>
        <td>
          <button onclick="editTicketPanel(${p.id})">Edit</button>
          <button onclick="deleteTicketPanel(${p.id})">Delete</button>
        </td>
      </tr>
    `).join("") || '<tr><td colspan="5">No panels</td></tr>';

    hideTicketEditor();
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
    await Promise.all([loadCommandLogs(), loadMessageLogs()]);
  },
};

async function loadCommandLogs() {
  if (!currentGuild) return;
  const params = new URLSearchParams({ limit: "50" });
  const user = document.getElementById("cmd-filter-user").value.trim();
  const command = document.getElementById("cmd-filter-command").value.trim();
  const success = document.getElementById("cmd-filter-success").value;
  if (user) params.set("user", user);
  if (command) params.set("command", command);
  if (success !== "all") params.set("success", success);

  const cmdLogs = await json(`/api/logs/commands/${currentGuild}?${params}`);

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
}

async function loadMessageLogs() {
  if (!currentGuild) return;
  const params = new URLSearchParams({ limit: "50" });
  const user = document.getElementById("msg-filter-user").value.trim();
  const content = document.getElementById("msg-filter-content").value.trim();
  if (user) params.set("user", user);
  if (content) params.set("content", content);

  const msgLogs = await json(`/api/logs/messages/${currentGuild}?${params}`);

  const msgBody = document.querySelector("#message-logs-table tbody");
  msgBody.innerHTML = msgLogs.map((l) => `
    <tr>
      <td>${formatDate(l.createdAt)}</td>
      <td>${escapeHtml(l.userName || l.userId)}</td>
      <td>${l.channelId}</td>
      <td>${escapeHtml(l.content)}</td>
    </tr>
  `).join("") || '<tr><td colspan="4">No message logs</td></tr>';
}

async function refreshSection() {
  if (sections[currentSection]) {
    try {
      await sections[currentSection]();
    } catch (err) {
      showToast(err.message || "Failed to refresh", "error");
    }
  }
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

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  window.location.href = "/";
});

// Forms
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
  showToast("AI settings saved", "success");
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
  showToast("Streak settings saved", "success");
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
  showToast("Moderation settings saved", "success");
});

document.getElementById("prefix-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/prefix/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({ prefix: document.getElementById("prefix").value.trim() }),
  });
  showToast("Prefix saved", "success");
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
  showToast("Trigger added", "success");
});

window.deleteTrigger = async (keyword) => {
  if (!currentGuild) return;
  await json(`/api/triggers/${currentGuild}/${encodeURIComponent(keyword)}`, { method: "DELETE" });
  refreshSection();
  showToast("Trigger deleted", "success");
};

document.getElementById("economy-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const min = Number(document.getElementById("econ-daily-min").value);
  const max = Number(document.getElementById("econ-daily-max").value);
  if (min > max) {
    showToast("Daily Min cannot be greater than Daily Max", "error");
    return;
  }

  await json(`/api/economy/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({
      primaryName: document.getElementById("econ-primary-name").value.trim(),
      primarySymbol: document.getElementById("econ-primary-symbol").value.trim(),
      primaryEmoji: document.getElementById("econ-primary-emoji").value.trim() || null,
      secondaryName: document.getElementById("econ-secondary-name").value.trim(),
      secondarySymbol: document.getElementById("econ-secondary-symbol").value.trim(),
      secondaryEmoji: document.getElementById("econ-secondary-emoji").value.trim() || null,
      dailyMin: min,
      dailyMax: max,
    }),
  });
  showToast("Economy settings saved", "success");
  refreshSection();
});

function formatDuration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(" ") || "0m";
}

async function renderChart(guildId, days) {
  const url = guildId ? `/api/stats/${guildId}?days=${days}` : `/api/stats?days=${days}`;
  const { data } = await json(url);

  const ctx = document.getElementById("activity-chart").getContext("2d");

  if (activityChart) {
    activityChart.destroy();
  }

  activityChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => escapeHtml(d.name || d.guildId)),
      datasets: [
        {
          label: "Messages",
          data: data.map((d) => d.messages),
          backgroundColor: "#7c3aed",
          borderRadius: 6,
        },
        {
          label: "Voice Hours",
          data: data.map((d) => d.voiceHours),
          backgroundColor: "#22c55e",
          borderRadius: 6,
        },
        {
          label: "Collaborators",
          data: data.map((d) => d.collaborators),
          backgroundColor: "#3b82f6",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#f3f4f6" } },
      },
      scales: {
        x: {
          ticks: {
            color: "#9ca3af",
            maxRotation: 45,
            minRotation: 0,
            callback(value) {
              if (typeof value === "string" && value.length > 18) {
                return value.slice(0, 18) + "…";
              }
              return value;
            },
          },
          grid: { color: "rgba(255, 255, 255, 0.06)" },
        },
        y: {
          ticks: { color: "#9ca3af" },
          grid: { color: "rgba(255, 255, 255, 0.06)" },
        },
      },
    },
  });
}

document.getElementById("chart-range").addEventListener("change", async (e) => {
  await renderChart(currentGuild || "", e.target.value);
});

function updateGuildIcon(guildId) {
  const iconEl = document.getElementById("guild-icon");
  if (!iconEl) return;
  if (!guildId) {
    iconEl.hidden = true;
    return;
  }
  const g = allGuilds.find((x) => x.id === guildId);
  if (g && g.icon) {
    iconEl.src = g.icon;
    iconEl.alt = g.name;
    iconEl.hidden = false;
  } else {
    iconEl.hidden = true;
  }
}

guildSelect.addEventListener("change", async (e) => {
  currentGuild = e.target.value;
  updateGuildIcon(currentGuild);
  if (currentGuild) await loadGuildData(currentGuild);
  if (currentSection === "overview") {
    await renderChart(currentGuild || "", document.getElementById("chart-range").value);
  } else {
    refreshSection();
  }
});

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.classList.add("spin");
    await refreshSection();
    refreshBtn.classList.remove("spin");
    showToast("Refreshed", "success");
  });
}

const cmdFilterBtn = document.getElementById("cmd-filter-btn");
if (cmdFilterBtn) cmdFilterBtn.addEventListener("click", loadCommandLogs);

const msgFilterBtn = document.getElementById("msg-filter-btn");
if (msgFilterBtn) msgFilterBtn.addEventListener("click", loadMessageLogs);

// Emoji picker
let activeEmojiInput = null;

const DEFAULT_EMOJIS = [
  "🪙", "💰", "💵", "💶", "💷", "💴", "💎", "🔮", "⭐", "🌟",
  "✨", "🏆", "🥇", "🥈", "🎖️", "🏅", "🎗️", "🎁", "🎀", "🎟️",
  "🧧", "🍀", "🌸", "🌺", "🌻", "🌹", "🌷", "💐", "🌼", "🌵",
  "🍎", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💖",
  "🔥", "⚡", "💧", "🌊", "☀️", "🌙", "⭐", "🌈", "☁️", "❄️",
];

function highlightEmoji(value) {
  document.querySelectorAll(".emoji-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.value === value);
  });
}

function showEmojiTab(tab) {
  document.querySelectorAll(".emoji-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".emoji-tab-content").forEach((c) => c.classList.toggle("active", c.id === `emoji-${tab === "discord" ? "defaults" : "guild"}`));
}

document.querySelectorAll(".emoji-tab").forEach((tab) => {
  tab.addEventListener("click", () => showEmojiTab(tab.dataset.tab));
});

function positionPicker(input) {
  const picker = document.getElementById("emoji-picker");
  const rect = input.getBoundingClientRect();
  const economy = document.getElementById("economy");
  const econRect = economy.getBoundingClientRect();
  const padding = 8;
  const pickerHeight = picker.offsetHeight || 320;

  let top = rect.bottom - econRect.top + padding;
  if (top + pickerHeight > economy.clientHeight) {
    top = Math.max(0, rect.top - econRect.top - pickerHeight - padding);
  }

  picker.style.top = `${top}px`;
  picker.style.left = `${Math.min(Math.max(0, rect.left - econRect.left), Math.max(0, economy.clientWidth - 340))}px`;
}

async function loadEmojiPicker(guildId) {
  const picker = document.getElementById("emoji-picker");
  const defaultsEl = document.getElementById("emoji-defaults");
  const guildEl = document.getElementById("emoji-guild");

  defaultsEl.innerHTML = "";
  guildEl.innerHTML = "";

  if (!guildId) {
    picker.hidden = true;
    return;
  }

  for (const emoji of DEFAULT_EMOJIS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-btn";
    btn.dataset.value = emoji;
    btn.textContent = emoji;
    btn.addEventListener("click", () => pickEmoji(emoji, btn));
    defaultsEl.appendChild(btn);
  }

  try {
    const { guild } = await json(`/api/emojis/${guildId}`);
    if (guild && guild.length) {
      for (const emoji of guild) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "emoji-btn";
        btn.dataset.value = emoji.value;
        const img = document.createElement("img");
        img.src = emoji.url;
        img.alt = emoji.name;
        img.className = "emoji-img";
        img.width = 22;
        img.height = 22;
        btn.appendChild(img);
        btn.title = emoji.name;
        btn.addEventListener("click", () => pickEmoji(emoji.value, btn));
        guildEl.appendChild(btn);
      }
    } else {
      const empty = document.createElement("p");
      empty.className = "emoji-empty";
      empty.textContent = "No server emojis";
      guildEl.appendChild(empty);
    }
  } catch {
    const empty = document.createElement("p");
    empty.className = "emoji-empty";
    empty.textContent = "No server emojis";
    guildEl.appendChild(empty);
  }

  highlightEmoji(activeEmojiInput?.value);
}

function pickEmoji(emoji, btn) {
  if (activeEmojiInput) {
    activeEmojiInput.value = emoji;
    document.querySelectorAll(".emoji-btn").forEach((b) => b.classList.remove("selected"));
    if (btn) btn.classList.add("selected");
  }
  document.getElementById("emoji-picker").hidden = true;
}

for (const id of ["econ-primary-emoji", "econ-secondary-emoji"]) {
  const input = document.getElementById(id);
  const openPicker = () => {
    activeEmojiInput = input;
    const picker = document.getElementById("emoji-picker");
    picker.hidden = false;
    positionPicker(input);
    showEmojiTab("discord");
    highlightEmoji(input.value);
  };
  input.addEventListener("focus", openPicker);
  input.addEventListener("click", openPicker);
}

document.addEventListener("click", (e) => {
  const picker = document.getElementById("emoji-picker");
  if (picker.hidden) return;
  if (!e.target.closest(".emoji-picker") && !e.target.classList.contains("emoji-input")) {
    picker.hidden = true;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("emoji-picker").hidden = true;
  }
});

// Ticket panel editor
const ticketForm = document.getElementById("ticket-form");
const ticketEditor = document.getElementById("ticket-editor");

function intToHex(color) {
  if (!color) return "#7c3aed";
  const hex = color.toString(16).padStart(6, "0");
  return `#${hex}`;
}

function hexToInt(hex) {
  return parseInt(hex.replace("#", ""), 16) || null;
}

function resetTicketEditor() {
  ticketForm.reset();
  document.getElementById("ticket-id").value = "";
  document.getElementById("ticket-color").value = "#7c3aed";
  document.getElementById("ticket-editor-title").textContent = "New Ticket Panel";
  populateCategories("ticket-category", "");
  populateRoles("ticket-staff-role", "");
  populateChannels("ticket-transcript", "", "-- None --");
  populateChannels("ticket-send-channel", "", "-- Select a channel --");
  ticketEditor.hidden = false;
}

function hideTicketEditor() {
  ticketEditor.hidden = true;
  document.getElementById("ticket-form").reset();
  document.getElementById("ticket-id").value = "";
}

function getTicketPanelPayload() {
  return {
    name: document.getElementById("ticket-name").value.trim(),
    type: document.getElementById("ticket-type").value,
    title: document.getElementById("ticket-title").value.trim() || null,
    description: document.getElementById("ticket-description").value.trim() || null,
    color: hexToInt(document.getElementById("ticket-color").value),
    imageUrl: document.getElementById("ticket-image").value.trim() || null,
    thumbnailUrl: document.getElementById("ticket-thumbnail").value.trim() || null,
    attachmentUrl: document.getElementById("ticket-attachment").value.trim() || null,
    useDominantColor: document.getElementById("ticket-use-dominant").checked,
    buttonLabel: document.getElementById("ticket-button-label").value.trim() || "Create Ticket",
    buttonColor: document.getElementById("ticket-button-color").value,
    categoryId: document.getElementById("ticket-category").value || null,
    staffRoleId: document.getElementById("ticket-staff-role").value || null,
    transcriptChannelId: document.getElementById("ticket-transcript").value || null,
    welcomeMessage: document.getElementById("ticket-welcome").value.trim() || null,
  };
}

function fillTicketEditor(panel) {
  document.getElementById("ticket-id").value = panel.id || "";
  document.getElementById("ticket-name").value = panel.name || "";
  document.getElementById("ticket-type").value = panel.type || "embed";
  document.getElementById("ticket-title").value = panel.title || "";
  document.getElementById("ticket-description").value = panel.description || "";
  document.getElementById("ticket-color").value = intToHex(panel.color);
  document.getElementById("ticket-image").value = panel.imageUrl || "";
  document.getElementById("ticket-thumbnail").value = panel.thumbnailUrl || "";
  document.getElementById("ticket-attachment").value = panel.attachmentUrl || "";
  document.getElementById("ticket-use-dominant").checked = panel.useDominantColor;
  document.getElementById("ticket-button-label").value = panel.buttonLabel || "Create Ticket";
  document.getElementById("ticket-button-color").value = panel.buttonColor || "green";

  populateCategories("ticket-category", panel.categoryId || "");
  populateRoles("ticket-staff-role", panel.staffRoleId || "");
  populateChannels("ticket-transcript", panel.transcriptChannelId || "", "-- None --");
  populateChannels("ticket-send-channel", "", "-- Select a channel --");

  document.getElementById("ticket-welcome").value = panel.welcomeMessage || "";
  document.getElementById("ticket-editor-title").textContent = panel.id ? "Edit Ticket Panel" : "New Ticket Panel";
  ticketEditor.hidden = false;
}

window.editTicketPanel = async (id) => {
  if (!currentGuild) return;
  const panel = await json(`/api/tickets/panels/${currentGuild}/${id}`);
  fillTicketEditor(panel);
};

window.deleteTicketPanel = async (id) => {
  if (!currentGuild) return;
  await json(`/api/tickets/panels/${currentGuild}/${id}`, { method: "DELETE" });
  refreshSection();
  showToast("Panel deleted", "success");
};

document.getElementById("ticket-new-btn").addEventListener("click", () => {
  resetTicketEditor();
});

document.getElementById("ticket-cancel-btn").addEventListener("click", hideTicketEditor);

ticketForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const id = document.getElementById("ticket-id").value;
  const payload = getTicketPanelPayload();
  const url = id ? `/api/tickets/panels/${currentGuild}/${id}` : `/api/tickets/panels/${currentGuild}`;
  const method = id ? "POST" : "POST";

  try {
    await json(url, { method, body: JSON.stringify(payload) });
    showToast(id ? "Panel updated" : "Panel created", "success");
    hideTicketEditor();
    refreshSection();
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.getElementById("ticket-send-btn").addEventListener("click", async () => {
  if (!currentGuild) return;
  const id = document.getElementById("ticket-id").value;
  if (!id) {
    showToast("Save the panel before sending", "error");
    return;
  }
  const channelId = document.getElementById("ticket-send-channel").value;
  if (!channelId) {
    showToast("Select a channel to send the panel to", "error");
    return;
  }

  try {
    await json(`/api/tickets/panels/${currentGuild}/${id}/send`, {
      method: "POST",
      body: JSON.stringify({ channelId }),
    });
    showToast("Panel sent", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Init
loadGuilds().then(() => showSection("overview"));
