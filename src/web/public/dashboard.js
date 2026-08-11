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

let activityChart = null;

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
        <td>${escapeHtml(r.userName || r.userId)}</td>
        <td>${(settings.primaryCurrency.emoji ? `${settings.primaryCurrency.emoji} ` : "")}${r.primary.toLocaleString()}</td>
        <td>${(settings.secondaryCurrency.emoji ? `${settings.secondaryCurrency.emoji} ` : "")}${r.secondary.toLocaleString()}</td>
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
          backgroundColor: "#f472b6",
          borderRadius: 6,
        },
        {
          label: "Voice Hours",
          data: data.map((d) => d.voiceHours),
          backgroundColor: "#c084fc",
          borderRadius: 6,
        },
        {
          label: "Collaborators",
          data: data.map((d) => d.collaborators),
          backgroundColor: "#22d3ee",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#fff0f5" } },
      },
      scales: {
        x: {
          ticks: {
            color: "#a89bb8",
            maxRotation: 45,
            minRotation: 0,
            callback(value) {
              if (typeof value === "string" && value.length > 18) {
                return value.slice(0, 18) + "…";
              }
              return value;
            },
          },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
        },
        y: {
          ticks: { color: "#a89bb8" },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
        },
      },
    },
  });
}

document.getElementById("chart-range").addEventListener("change", async (e) => {
  await renderChart(currentGuild || "", e.target.value);
});

guildSelect.addEventListener("change", async (e) => {
  currentGuild = e.target.value;
  if (currentSection === "overview") {
    await renderChart(currentGuild || "", document.getElementById("chart-range").value);
  } else {
    refreshSection();
  }
});

// ── Emoji picker ──

let activeEmojiInput = null;

async function loadEmojiPicker(guildId) {
  const picker = document.getElementById("emoji-picker");
  const defaultsEl = document.getElementById("emoji-defaults");
  const guildEl = document.getElementById("emoji-guild");
  const guildHeading = document.getElementById("emoji-guild-heading");

  defaultsEl.innerHTML = "";
  guildEl.innerHTML = "";

  if (!guildId) {
    picker.hidden = true;
    return;
  }

  const { defaults, guild } = await json(`/api/emojis/${guildId}`);

  for (const emoji of defaults) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-btn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => pickEmoji(emoji, btn));
    defaultsEl.appendChild(btn);
  }

  if (guild && guild.length) {
    guildHeading.hidden = false;
    for (const emoji of guild) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-btn";
      btn.textContent = emoji.value;
      btn.title = emoji.name;
      btn.addEventListener("click", () => pickEmoji(emoji.value, btn));
      guildEl.appendChild(btn);
    }
  } else {
    guildHeading.hidden = true;
  }
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
  input.addEventListener("focus", () => {
    activeEmojiInput = input;
    document.getElementById("emoji-picker").hidden = false;
    document.getElementById("emoji-picker-title").textContent = `Pick emoji for ${id.includes("primary") ? "primary" : "secondary"} currency`;
  });
}

document.getElementById("economy-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const min = Number(document.getElementById("econ-daily-min").value);
  const max = Number(document.getElementById("econ-daily-max").value);
  if (min > max) {
    alert("Daily Min cannot be greater than Daily Max");
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
  alert("Economy settings saved");
  refreshSection();
});

// ── Init ──

loadGuilds().then(() => showSection("overview"));
