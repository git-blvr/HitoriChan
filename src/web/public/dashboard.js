const guildSelect = document.getElementById("guild-select");
const sectionTitle = document.getElementById("section-title");
const navLinks = document.querySelectorAll(".nav-links a");

let currentGuild = "";
let currentSection = "overview";
let allGuilds = [];
let allCommands = [];
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

  refreshSelectFilter(guildSelect);
  return allGuilds;
}

async function loadCommands(guildId) {
  if (!guildId) return [];
  if (allCommands.length) return allCommands;
  try {
    allCommands = await json(`/api/commands/${guildId}`);
  } catch (err) {
    console.error("Failed to load commands:", err);
    allCommands = [];
  }
  return allCommands;
}

function populateCommandDatalist(datalistId) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) return;
  const options = [];
  for (const c of allCommands) {
    options.push({ value: c.name, label: `${c.category}: ${c.name}` });
    for (const alias of c.aliases) {
      options.push({ value: alias, label: `${c.category}: ${alias} (alias of ${c.name})` });
    }
  }
  datalist.innerHTML = options.map((o) => `
    <option value="${escapeHtml(o.value)}" label="${escapeHtml(o.label)}"></option>
  `).join("");
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
  refreshSelectFilter(select);
}

function populateRoles(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = guildData.roles.map((r) =>
    `<option value="${r.id}" ${r.id === selectedId ? "selected" : ""}>${escapeHtml(r.name)}</option>`
  ).join("");
  select.innerHTML = '<option value="">-- None --</option>' + options;
  refreshSelectFilter(select);
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
  refreshSelectFilter(select);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function makeSelectSearchable(select) {
  if (select._searchFilter) return;

  const wrapper = document.createElement("div");
  wrapper.className = "searchable-select";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const filter = document.createElement("input");
  filter.type = "text";
  filter.className = "select-filter";
  filter.placeholder = "Filter...";
  wrapper.insertBefore(filter, select);

  const saveOptions = () => {
    select._allOptions = Array.from(select.options).map((o) => ({
      value: o.value,
      text: o.textContent,
      disabled: o.disabled,
    }));
  };

  const renderOptions = () => {
    const q = filter.value.trim().toLowerCase();
    const options = select._allOptions || [];
    const placeholder = options[0];
    const matches = options.filter((o, i) => i === 0 || o.text.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
    const selected = select.value;
    select.innerHTML = matches.map((o) => `
      <option value="${escapeHtml(o.value)}" ${o.value === selected || (o.value === "" && !selected) ? "selected" : ""} ${o.disabled ? "disabled" : ""}>
        ${escapeHtml(o.text)}
      </option>
    `).join("");
  };

  filter.addEventListener("input", renderOptions);

  select._searchFilter = filter;
  select._refreshFilter = () => {
    saveOptions();
    renderOptions();
  };
  select._setFilter = (value) => {
    filter.value = value;
    renderOptions();
  };

  saveOptions();
}

function refreshSelectFilter(select) {
  select?._refreshFilter?.();
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function parsePayloadToComponents(raw) {
  let payload;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error("Invalid JSON payload.");
  }

  const out = [];
  let color = null;

  if (payload.content) out.push({ type: "text", content: String(payload.content) });

  if (payload.embeds?.length) {
    for (const embed of payload.embeds) out.push(...parseEmbedToComponents(embed));
    if (payload.embeds[0].color) color = payload.embeds[0].color;
  } else if (payload.embed) {
    out.push(...parseEmbedToComponents(payload.embed));
    if (payload.embed.color) color = payload.embed.color;
  }

  if (payload.components?.length) {
    for (const top of payload.components) {
      const accent = top?.accent_color ?? top?.accentColor;
      if (accent != null && color === null) color = accent;
      const extracted = parseContainerToComponents(top);
      out.push(...extracted.components);
      if (extracted.color != null && color === null) color = extracted.color;
    }
  }

  return { components: out, color };
}

function parseEmbedToComponents(embed) {
  const out = [];
  const parts = [];
  if (embed.author?.name) parts.push(`**${embed.author.name}**`);
  if (embed.title) {
    let title = embed.title;
    if (embed.url) title = `[${title}](${embed.url})`;
    parts.push(`**${title}**`);
  }
  if (embed.description) parts.push(embed.description);
  if (parts.length) out.push({ type: "text", content: parts.join("\n\n") });

  if (embed.image?.url) out.push({ type: "image", url: embed.image.url });
  else if (embed.thumbnail?.url) out.push({ type: "image", url: embed.thumbnail.url });

  if (embed.fields?.length) {
    out.push({
      type: "text",
      content: embed.fields.map((f) => `**${f.name}**\n${f.value}`).join("\n\n"),
    });
  }

  if (embed.footer?.text || embed.timestamp) {
    const footer = [];
    if (embed.footer?.text) footer.push(embed.footer.text);
    if (embed.timestamp) footer.push(new Date(embed.timestamp).toLocaleString());
    if (footer.length) out.push({ type: "text", content: footer.join(" • ") });
  }

  return out;
}

function parseContainerToComponents(container) {
  const components = [];
  let color = container?.accent_color ?? container?.accentColor ?? null;

  const children = container?.components ?? (Array.isArray(container) ? container : []);
  for (const c of children) {
    if (!c) continue;

    // TextDisplay (type 10)
    if (c.content != null) {
      components.push({ type: "text", content: String(c.content) });
      continue;
    }

    // Section (type 11) with text components + optional thumbnail accessory
    if (c.components?.length) {
      const textParts = c.components.filter((x) => x?.content != null).map((x) => String(x.content));
      if (textParts.length) components.push({ type: "text", content: textParts.join("\n\n") });
      if (c.accessory?.media?.url) components.push({ type: "image", url: c.accessory.media.url });
      continue;
    }

    // MediaGallery (type 12)
    if (c.items?.length) {
      const urls = c.items.map((i) => i?.media?.url ?? i?.url).filter(Boolean);
      if (urls.length === 1) components.push({ type: "image", url: urls[0] });
      else if (urls.length > 1) components.push({ type: "media_gallery", urls });
      continue;
    }

    // Separator (type 13)
    if (c.divider != null || c.type === 13) {
      components.push({ type: "separator" });
      continue;
    }

    // Nested container (type 17)
    if (c.type === 17 || c.accent_color != null) {
      const nested = parseContainerToComponents(c);
      components.push(...nested.components);
      if (nested.color != null && color === null) color = nested.color;
    }
  }

  return { components, color };
}

function parsePayloadToEmbed(raw) {
  let payload;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error("Invalid JSON payload.");
  }

  let embed = null;
  if (payload.embeds?.length) embed = payload.embeds[0];
  else if (payload.embed) embed = payload.embed;
  else if (payload.title != null || payload.description != null || payload.color != null) embed = payload;

  if (!embed) throw new Error("No embed found in payload.");

  const descriptionParts = [];
  if (embed.author?.name) descriptionParts.push(`*${embed.author.name}*`);
  if (embed.description) descriptionParts.push(embed.description);
  if (embed.footer?.text) descriptionParts.push(`_${embed.footer.text}_`);
  if (embed.timestamp) descriptionParts.push(new Date(embed.timestamp).toLocaleString());

  const fields = (embed.fields || []).map((f) => ({
    name: String(f.name || ""),
    value: String(f.value || ""),
    inline: Boolean(f.inline),
  }));

  return {
    title: embed.title || "",
    description: descriptionParts.join("\n\n"),
    color: embed.color ? intToHex(embed.color) : "#7c3aed",
    image: embed.image?.url || "",
    thumbnail: embed.thumbnail?.url || "",
    fields,
  };
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

  shop: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);

    const settings = await json(`/api/shop/settings/${currentGuild}`);
    document.getElementById("shop-enabled").checked = settings.shopInterfaceEnabled;
    populateChannels("shop-channel", settings.shopChannelId || "", "-- None --");
    document.getElementById("shop-interface-color").value = intToHex(settings.shopInterfaceColor);
    document.getElementById("shop-use-dominant").checked = settings.shopInterfaceUseDominantColor;

    renderShopInterfaceComponents(settings.shopInterfaceComponents || []);

    await renderShopCategories();
    hideShopItemEditor();
  },

  boost: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);

    const settings = await json(`/api/boost/${currentGuild}`);
    document.getElementById("boost-enabled").checked = settings.enabled;
    document.getElementById("boost-reward-primary").value = settings.rewardPrimary;
    document.getElementById("boost-reward-secondary").value = settings.rewardSecondary;
    populateRoles("boost-role", settings.roleId || "");
    document.getElementById("boost-earnings").value = settings.earningsMultiplier;
    document.getElementById("boost-level").value = settings.level;
    document.getElementById("boost-commands").value = (settings.specialCommands || []).join("\n");
    populateChannels("boost-channel", settings.messageChannelId || "", "-- None --");
    document.getElementById("boost-message").value = settings.thankMessage || "";
  },

  triggers: async () => {
    if (!currentGuild) return;
    await loadCommands(currentGuild);
    populateCommandDatalist("trigger-commands-datalist");
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
  const openPicker = async () => {
    if (!currentGuild) {
      showToast("Select a server first", "error");
      return;
    }
    activeEmojiInput = input;
    const picker = document.getElementById("emoji-picker");
    picker.hidden = false;
    positionPicker(input);
    await loadEmojiPicker(currentGuild);
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

function getTicketImageSource() {
  const type = document.getElementById("ticket-type").value;
  if (type === "cv2") {
    const components = getTicketComponents();
    for (let i = components.length - 1; i >= 0; i--) {
      if (components[i].type === "image" && components[i].url) return components[i].url;
    }
  }
  return document.getElementById("ticket-image").value.trim() || document.getElementById("ticket-thumbnail").value.trim() || null;
}

function updateTicketTypeVisibility() {
  const type = document.getElementById("ticket-type").value;
  document.getElementById("ticket-embed-fields").hidden = type !== "embed";
  document.getElementById("ticket-cv2-components").hidden = type !== "cv2";
}

function resetTicketEditor() {
  ticketForm.reset();
  document.getElementById("ticket-id").value = "";
  document.getElementById("ticket-color").value = "#7c3aed";
  document.getElementById("ticket-editor-title").textContent = "New Ticket Panel";
  document.getElementById("ticket-payload-preview").hidden = true;
  populateCategories("ticket-category", "");
  populateRoles("ticket-staff-role", "");
  populateChannels("ticket-transcript", "", "-- None --");
  populateChannels("ticket-send-channel", "", "-- Select a channel --");
  renderTicketFields([]);
  renderTicketComponents([]);
  renderTicketCategories([]);
  updateTicketTypeVisibility();
  ticketEditor.hidden = false;
}

function hideTicketEditor() {
  ticketEditor.hidden = true;
  document.getElementById("ticket-form").reset();
  document.getElementById("ticket-id").value = "";
  document.getElementById("ticket-payload-preview").hidden = true;
  renderTicketFields([]);
  renderTicketComponents([]);
  renderTicketCategories([]);
}

function getTicketFields() {
  return Array.from(document.querySelectorAll(".ticket-field")).map((el) => ({
    name: el.querySelector(".field-name").value.trim(),
    value: el.querySelector(".field-value").value.trim(),
    inline: el.querySelector(".field-inline").checked,
  })).filter((f) => f.name && f.value);
}

function getTicketComponents() {
  return Array.from(document.querySelectorAll(".ticket-component")).map((el) => {
    const type = el.dataset.type;
    const base = { type };
    if (type === "text") base.content = el.querySelector(".comp-content").value.trim();
    if (type === "image") base.url = el.querySelector(".comp-url").value.trim();
    if (type === "separator") {
      base.divider = el.querySelector(".comp-divider").checked;
      base.large = el.querySelector(".comp-large").checked;
    }
    if (type === "ticket") {
      base.label = el.querySelector(".comp-label").value.trim();
      base.color = el.querySelector(".comp-color").value;
    }
    return base;
  });
}

function getTicketCategories() {
  return Array.from(document.querySelectorAll(".ticket-category")).map((el) => ({
    label: el.querySelector(".cat-label").value.trim(),
    description: el.querySelector(".cat-desc").value.trim() || null,
  })).filter((c) => c.label);
}

function renderTicketCategories(categories) {
  const list = document.getElementById("ticket-categories-list");
  list.innerHTML = (categories || []).map((c, i) => `
    <div class="ticket-category reorder-item">
      <div class="inline-fields" style="width:100%">
        <label class="grow">Label <input type="text" class="cat-label" value="${escapeHtml(c.label)}" placeholder="Bug report" /></label>
        <label class="grow">Description <input type="text" class="cat-desc" value="${escapeHtml(c.description || "")}" placeholder="Short description (optional)" /></label>
      </div>
      <button type="button" class="save-btn" onclick="removeTicketCategory(${i})">Remove</button>
    </div>
  `).join("");
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
    useDominantColor: document.getElementById("ticket-use-dominant").checked,
    buttonLabel: document.getElementById("ticket-button-label")?.value?.trim() || "Create Ticket",
    buttonColor: document.getElementById("ticket-button-color")?.value || "green",
    categoryId: document.getElementById("ticket-category").value || null,
    staffRoleId: document.getElementById("ticket-staff-role").value || null,
    transcriptChannelId: document.getElementById("ticket-transcript").value || null,
    welcomeMessage: document.getElementById("ticket-welcome").value.trim() || null,
    fields: getTicketFields(),
    components: getTicketComponents(),
    categories: getTicketCategories(),
  };
}

function renderTicketPreview() {
  const type = document.getElementById("ticket-type").value;
  const color = document.getElementById("ticket-color").value || "#7c3aed";
  const title = document.getElementById("ticket-title").value.trim();
  const description = document.getElementById("ticket-description").value.trim();
  const imageUrl = document.getElementById("ticket-image").value.trim();
  const thumbnailUrl = document.getElementById("ticket-thumbnail").value.trim();
  const buttonLabel = document.getElementById("ticket-button-label")?.value?.trim() || "Create Ticket";
  const buttonColor = document.getElementById("ticket-button-color")?.value || "green";
  const fields = getTicketFields();
  const components = getTicketComponents();
  const box = document.getElementById("ticket-preview-box");

  if (type === "embed") {
    const fieldsHtml = fields.length ? `
      <div class="embed-fields">
        ${fields.map((f) => `
          <div class="embed-field" style="grid-column: ${f.inline ? 'span 1' : '1 / -1'}">
            <h4>${escapeHtml(f.name)}</h4>
            <p>${escapeHtml(f.value)}</p>
          </div>
        `).join("")}
      </div>
    ` : "";

    box.innerHTML = `
      <div class="ticket-embed-preview" style="border-left-color: ${escapeHtml(color)}">
        <div style="padding: 14px">
          ${thumbnailUrl ? `<img src="${escapeHtml(thumbnailUrl)}" class="ticket-embed-thumb" alt="" />` : ""}
          ${title ? `<div class="embed-title">${escapeHtml(title)}</div>` : ""}
          ${description ? `<div class="embed-description">${escapeHtml(description).replace(/\n/g, "<br>")}</div>` : ""}
          ${fieldsHtml}
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" class="embed-image" alt="" />` : ""}
          <button type="button" class="cv2-button ${escapeHtml(buttonColor)}" style="margin-top: 12px">${escapeHtml(buttonLabel)}</button>
        </div>
      </div>
    `;
    return;
  }

  // CV2 preview
  let html = `<div class="ticket-cv2-preview" style="border-top-color: ${escapeHtml(color)}">`;
  if (title) html += `<div class="cv2-title">${escapeHtml(title)}</div>`;
  if (description) html += `<div class="cv2-text">${escapeHtml(description).replace(/\n/g, "<br>")}</div>`;

  if (components.length) {
    for (const c of components) {
      if (!c || !c.type) continue;
      if (c.type === "text" && c.content) html += `<div class="cv2-text">${escapeHtml(c.content).replace(/\n/g, "<br>")}</div>`;
      if (c.type === "image" && c.url) html += `<img src="${escapeHtml(c.url)}" class="cv2-image" alt="" />`;
      if (c.type === "separator") html += `<div class="cv2-separator" style="height: ${c.large ? 16 : 8}px; background: ${c.divider ? "rgba(255,255,255,0.1)" : "transparent"}"></div>`;
      if (c.type === "ticket") {
        const cColor = c.color || buttonColor;
        html += `<button type="button" class="cv2-button ${escapeHtml(cColor)}">${escapeHtml(c.label || buttonLabel)}</button>`;
      }
    }
  } else {
    html += `<button type="button" class="cv2-button ${escapeHtml(buttonColor)}">${escapeHtml(buttonLabel)}</button>`;
  }

  html += "</div>";
  box.innerHTML = html;
}

function renderTicketFields(fields) {
  const list = document.getElementById("ticket-fields-list");
  list.innerHTML = fields.map((f, i) => `
    <div class="reorder-item ticket-field" data-index="${i}">
      <header>Field ${i + 1} <button type="button" class="remove-btn" onclick="removeTicketField(${i})">Remove</button></header>
      <div class="inline-fields">
        <label class="grow">Name <input type="text" class="field-name" value="${escapeHtml(f.name)}" /></label>
        <label class="grow"><input type="checkbox" class="field-inline" ${f.inline ? "checked" : ""} /> Inline</label>
      </div>
      <label>Value <input type="text" class="field-value" value="${escapeHtml(f.value)}" /></label>
    </div>
  `).join("");
}

function renderTicketComponents(components) {
  const list = document.getElementById("ticket-components-list");
  list.innerHTML = components.map((c, i) => {
    if (c.type === "text") return `
      <div class="reorder-item ticket-component" data-type="text" data-index="${i}">
        <header>Text <button type="button" class="remove-btn" onclick="removeTicketComponent(${i})">Remove</button></header>
        <textarea class="comp-content" rows="3">${escapeHtml(c.content || "")}</textarea>
      </div>
    `;
    if (c.type === "image") return `
      <div class="reorder-item ticket-component" data-type="image" data-index="${i}">
        <header>Image <button type="button" class="remove-btn" onclick="removeTicketComponent(${i})">Remove</button></header>
        <input type="text" class="comp-url" value="${escapeHtml(c.url || "")}" placeholder="https://..." />
      </div>
    `;
    if (c.type === "separator") return `
      <div class="reorder-item ticket-component" data-type="separator" data-index="${i}">
        <header>Separator <button type="button" class="remove-btn" onclick="removeTicketComponent(${i})">Remove</button></header>
        <label><input type="checkbox" class="comp-divider" ${c.divider ? "checked" : ""} /> Divider</label>
        <label><input type="checkbox" class="comp-large" ${c.large ? "checked" : ""} /> Large spacing</label>
      </div>
    `;
    if (c.type === "ticket") return `
      <div class="reorder-item ticket-component" data-type="ticket" data-index="${i}">
        <header>Ticket Button <button type="button" class="remove-btn" onclick="removeTicketComponent(${i})">Remove</button></header>
        <div class="inline-fields">
          <label class="grow">Label <input type="text" class="comp-label" value="${escapeHtml(c.label || "Create Ticket")}" /></label>
          <label class="grow">Color
            <select class="comp-color">
              <option value="green" ${c.color === "green" ? "selected" : ""}>Green</option>
              <option value="blue" ${c.color === "blue" ? "selected" : ""}>Blue</option>
              <option value="red" ${c.color === "red" ? "selected" : ""}>Red</option>
              <option value="gray" ${c.color === "gray" ? "selected" : ""}>Gray</option>
            </select>
          </label>
        </div>
      </div>
    `;
    return "";
  }).join("");
}

window.removeTicketField = (i) => {
  const fields = getTicketFields();
  fields.splice(i, 1);
  renderTicketFields(fields);
};

window.removeTicketComponent = (i) => {
  const components = getTicketComponents();
  components.splice(i, 1);
  renderTicketComponents(components);
};

window.removeTicketCategory = (i) => {
  const categories = getTicketCategories();
  categories.splice(i, 1);
  renderTicketCategories(categories);
};

function fillTicketEditor(panel) {
  document.getElementById("ticket-id").value = panel.id || "";
  document.getElementById("ticket-name").value = panel.name || "";
  document.getElementById("ticket-type").value = panel.type || "embed";
  document.getElementById("ticket-title").value = panel.title || "";
  document.getElementById("ticket-description").value = panel.description || "";
  document.getElementById("ticket-color").value = intToHex(panel.color);
  document.getElementById("ticket-image").value = panel.imageUrl || "";
  document.getElementById("ticket-thumbnail").value = panel.thumbnailUrl || "";
  document.getElementById("ticket-use-dominant").checked = panel.useDominantColor;
  document.getElementById("ticket-button-label").value = panel.buttonLabel || "Create Ticket";
  document.getElementById("ticket-button-color").value = panel.buttonColor || "green";

  populateCategories("ticket-category", panel.categoryId || "");
  populateRoles("ticket-staff-role", panel.staffRoleId || "");
  populateChannels("ticket-transcript", panel.transcriptChannelId || "", "-- None --");
  populateChannels("ticket-send-channel", "", "-- Select a channel --");

  document.getElementById("ticket-welcome").value = panel.welcomeMessage || "";
  renderTicketFields(panel.fields || []);
  renderTicketComponents(panel.components || []);
  renderTicketCategories(panel.categories || []);
  updateTicketTypeVisibility();
  document.getElementById("ticket-payload-preview").hidden = true;
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

document.getElementById("ticket-type").addEventListener("change", updateTicketTypeVisibility);

document.getElementById("ticket-add-field").addEventListener("click", () => {
  const fields = getTicketFields();
  fields.push({ name: "", value: "", inline: false });
  renderTicketFields(fields);
});

document.getElementById("ticket-embed-import-toggle").addEventListener("click", () => {
  const panel = document.getElementById("ticket-embed-import-panel");
  panel.hidden = !panel.hidden;
});

document.getElementById("ticket-embed-import-btn").addEventListener("click", () => {
  try {
    const raw = document.getElementById("ticket-embed-payload-input").value;
    const embed = parsePayloadToEmbed(raw);

    document.getElementById("ticket-title").value = embed.title || "";
    document.getElementById("ticket-description").value = embed.description || "";
    document.getElementById("ticket-color").value = embed.color || "#7c3aed";
    document.getElementById("ticket-image").value = embed.image || "";
    document.getElementById("ticket-thumbnail").value = embed.thumbnail || "";
    renderTicketFields(embed.fields || []);
    renderTicketPreview();
    document.getElementById("ticket-payload-preview").hidden = false;

    showToast(`Imported embed with ${(embed.fields || []).length} field(s)`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.getElementById("ticket-add-text").addEventListener("click", () => {
  const components = getTicketComponents();
  components.push({ type: "text", content: "" });
  renderTicketComponents(components);
});

document.getElementById("ticket-add-image").addEventListener("click", () => {
  const components = getTicketComponents();
  components.push({ type: "image", url: "" });
  renderTicketComponents(components);
});

document.getElementById("ticket-add-separator").addEventListener("click", () => {
  const components = getTicketComponents();
  components.push({ type: "separator", divider: true, large: false });
  renderTicketComponents(components);
});

document.getElementById("ticket-add-ticket").addEventListener("click", () => {
  const components = getTicketComponents();
  components.push({ type: "ticket", label: "Create Ticket", color: "green" });
  renderTicketComponents(components);
});

document.getElementById("ticket-add-category").addEventListener("click", () => {
  const categories = getTicketCategories();
  categories.push({ label: "", description: "" });
  renderTicketCategories(categories);
});

document.getElementById("ticket-import-toggle").addEventListener("click", () => {
  document.getElementById("ticket-import-panel").hidden = !document.getElementById("ticket-import-panel").hidden;
});

document.getElementById("ticket-import-btn").addEventListener("click", () => {
  try {
    const raw = document.getElementById("ticket-payload-input").value;
    const { components, color } = parsePayloadToComponents(raw);
    if (!components.length) {
      showToast("No supported components found in the payload.", "error");
      return;
    }
    // Ticket CV2 builder doesn't support media galleries; flatten to images
    const flat = components.flatMap((c) =>
      c.type === "media_gallery" ? c.urls.map((url) => ({ type: "image", url })) : [c]
    );
    renderTicketComponents(flat);
    if (color != null) document.getElementById("ticket-color").value = intToHex(color);
    showToast(`Imported ${flat.length} component(s)`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.getElementById("ticket-dominant-btn").addEventListener("click", async () => {
  const source = getTicketImageSource();
  if (!source) {
    showToast("No image found to sample. Add an image URL or CV2 image component first.", "error");
    return;
  }
  try {
    const { color } = await json(`/api/tickets/dominant-color/${currentGuild}`, {
      method: "POST",
      body: JSON.stringify({ imageUrl: source }),
    });
    document.getElementById("ticket-color").value = intToHex(color);
    showToast("Dominant color applied", "success");
  } catch (err) {
    showToast(err.message || "Could not get dominant color", "error");
  }
});

document.getElementById("ticket-preview-btn").addEventListener("click", () => {
  renderTicketPreview();
  document.getElementById("ticket-payload-preview").hidden = false;
});

ticketForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const id = document.getElementById("ticket-id").value;
  const payload = getTicketPanelPayload();
  const url = id ? `/api/tickets/panels/${currentGuild}/${id}` : `/api/tickets/panels/${currentGuild}`;

  try {
    await json(url, { method: "POST", body: JSON.stringify(payload) });
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

// Shop functions
let shopCategories = [];

async function renderShopCategories() {
  const tbody = document.querySelector("#shop-categories-table tbody");
  shopCategories = await json(`/api/shop/categories/${currentGuild}`);

  tbody.innerHTML = shopCategories.map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.description || "—")}</td>
      <td>${c.items ? c.items.length : 0}</td>
      <td>
        <button onclick="showShopCategoryItems(${c.id})">View</button>
        <button onclick="editShopCategory(${c.id})">Edit</button>
        <button onclick="deleteShopCategory(${c.id})">Delete</button>
        <button onclick="newShopItem(${c.id})">Add Item</button>
      </td>
    </tr>
  `).join("") || '<tr><td colspan="4">No categories</td></tr>';

  const itemsTbody = document.querySelector("#shop-items-table tbody");
  if (itemsTbody) itemsTbody.innerHTML = '<tr><td colspan="6">Select a category</td></tr>';
}

function getShopCategoryPayload() {
  return {
    name: document.getElementById("shop-category-name").value.trim(),
    description: document.getElementById("shop-category-desc").value.trim() || null,
    sortOrder: Number(document.getElementById("shop-category-sort").value) || 0,
  };
}

function resetShopCategoryForm() {
  document.getElementById("shop-category-id").value = "";
  document.getElementById("shop-category-name").value = "";
  document.getElementById("shop-category-desc").value = "";
  document.getElementById("shop-category-sort").value = "0";
  document.getElementById("shop-category-btn").textContent = "Add Category";
}

window.editShopCategory = async (id) => {
  const category = shopCategories.find((c) => c.id === id);
  if (!category) return;
  document.getElementById("shop-category-id").value = category.id;
  document.getElementById("shop-category-name").value = category.name;
  document.getElementById("shop-category-desc").value = category.description || "";
  document.getElementById("shop-category-sort").value = category.sortOrder;
  document.getElementById("shop-category-btn").textContent = "Update Category";
};

window.deleteShopCategory = async (id) => {
  if (!confirm("Delete this category and all its items?")) return;
  await json(`/api/shop/categories/${currentGuild}/${id}`, { method: "DELETE" });
  resetShopCategoryForm();
  refreshSection();
  showToast("Category deleted", "success");
};

function hideShopItemEditor() {
  document.getElementById("shop-item-editor").hidden = true;
  document.getElementById("shop-item-form").reset();
  document.getElementById("shop-item-id").value = "";
  document.getElementById("shop-item-category-id").value = "";
}

function getShopItemPayload() {
  return {
    name: document.getElementById("shop-item-name").value.trim(),
    description: document.getElementById("shop-item-desc").value.trim() || null,
    price: Number(document.getElementById("shop-item-price").value) || 0,
    priceSecondary: document.getElementById("shop-item-price-sec").value === "" ? null : Math.max(0, Number(document.getElementById("shop-item-price-sec").value)),
    roleId: document.getElementById("shop-item-role").value || null,
    multiplierType: document.getElementById("shop-item-multiplier-type").value || null,
    multiplierValue: document.getElementById("shop-item-multiplier-value").value === "" ? null : Number(document.getElementById("shop-item-multiplier-value").value),
    requiresRoleId: document.getElementById("shop-item-requires-role").value || null,
    stock: document.getElementById("shop-item-stock").value === "" ? null : Math.max(0, Number(document.getElementById("shop-item-stock").value)),
    maxPurchases: document.getElementById("shop-item-max").value === "" ? null : Math.max(0, Number(document.getElementById("shop-item-max").value)),
    specialCommands: document.getElementById("shop-item-commands").value.split(/\n+/).map((s) => s.trim()).filter(Boolean),
    sortOrder: Number(document.getElementById("shop-item-sort").value) || 0,
  };
}

window.newShopItem = (categoryId) => {
  document.getElementById("shop-item-editor").hidden = false;
  document.getElementById("shop-item-editor-title").textContent = "New Shop Item";
  document.getElementById("shop-item-id").value = "";
  document.getElementById("shop-item-category-id").value = categoryId;
  document.getElementById("shop-item-form").reset();
  populateRoles("shop-item-role", "");
  populateRoles("shop-item-requires-role", "");
  document.getElementById("shop-item-btn").textContent = "Create Item";
  window.scrollTo({ top: document.getElementById("shop-item-editor").offsetTop - 80, behavior: "smooth" });
};

window.editShopItem = async (categoryId, itemId) => {
  await loadGuildData(currentGuild);
  const category = shopCategories.find((c) => c.id === categoryId);
  const item = category?.items?.find((i) => i.id === itemId);
  if (!item) return;

  document.getElementById("shop-item-editor").hidden = false;
  document.getElementById("shop-item-editor-title").textContent = "Edit Shop Item";
  document.getElementById("shop-item-id").value = item.id;
  document.getElementById("shop-item-category-id").value = categoryId;
  document.getElementById("shop-item-name").value = item.name;
  document.getElementById("shop-item-desc").value = item.description || "";
  document.getElementById("shop-item-sort").value = item.sortOrder;
  document.getElementById("shop-item-price").value = item.price;
  document.getElementById("shop-item-price-sec").value = item.priceSecondary ?? "";
  populateRoles("shop-item-role", item.roleId || "");
  document.getElementById("shop-item-multiplier-type").value = item.multiplierType || "";
  document.getElementById("shop-item-multiplier-value").value = item.multiplierValue ?? "";
  populateRoles("shop-item-requires-role", item.requiresRoleId || "");
  document.getElementById("shop-item-stock").value = item.stock ?? "";
  document.getElementById("shop-item-max").value = item.maxPurchases ?? "";
  document.getElementById("shop-item-commands").value = (item.specialCommands || []).join("\n");
  document.getElementById("shop-item-btn").textContent = "Update Item";
};

window.deleteShopItem = async (itemId) => {
  if (!confirm("Delete this item?")) return;
  await json(`/api/shop/items/${currentGuild}/${itemId}`, { method: "DELETE" });
  refreshSection();
  showToast("Item deleted", "success");
};

window.showShopCategoryItems = (categoryId) => {
  const category = shopCategories.find((c) => c.id === categoryId);
  if (!category) return;
  const container = document.getElementById("shop-items-panel");
  if (!container) return;
  container.hidden = false;
  const tbody = document.querySelector("#shop-items-table tbody");
  tbody.innerHTML = category.items?.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${item.price}</td>
      <td>${item.priceSecondary ?? "—"}</td>
      <td>${escapeHtml((item.specialCommands || []).join(", ") || "—")}</td>
      <td>
        <button onclick="editShopItem(${category.id}, ${item.id})">Edit</button>
        <button onclick="deleteShopItem(${item.id})">Delete</button>
      </td>
    </tr>
  `).join("") || '<tr><td colspan="5">No items</td></tr>';
};

// Shop interface builder
function getShopInterfaceComponents() {
  return Array.from(document.querySelectorAll(".shop-interface-component")).map((el) => {
    const type = el.dataset.type;
    if (type === "text") return { type, content: el.querySelector(".shop-comp-content").value };
    if (type === "image") return { type, url: el.querySelector(".shop-comp-url").value.trim() };
    if (type === "media_gallery") return { type, urls: el.querySelector(".shop-comp-urls").value.split(/\n+/).map((s) => s.trim()).filter(Boolean) };
    if (type === "separator") return { type };
    return { type };
  }).filter((c) => {
    if (c.type === "text" || c.type === "image") return c.content || c.url;
    if (c.type === "media_gallery") return c.urls?.length;
    return true;
  });
}

function renderShopInterfaceComponents(components) {
  const list = document.getElementById("shop-interface-list");
  list.innerHTML = (components || []).map((c, i) => {
    if (c.type === "text") return `
      <div class="reorder-item shop-interface-component" data-type="text" data-index="${i}">
        <header>Text <button type="button" class="remove-btn" onclick="removeShopInterfaceComponent(${i})">Remove</button></header>
        <textarea class="shop-comp-content" rows="3">${escapeHtml(c.content || "")}</textarea>
      </div>
    `;
    if (c.type === "image") return `
      <div class="reorder-item shop-interface-component" data-type="image" data-index="${i}">
        <header>Image <button type="button" class="remove-btn" onclick="removeShopInterfaceComponent(${i})">Remove</button></header>
        <input type="text" class="shop-comp-url" value="${escapeHtml(c.url || "")}" placeholder="https://..." />
      </div>
    `;
    if (c.type === "media_gallery") return `
      <div class="reorder-item shop-interface-component" data-type="media_gallery" data-index="${i}">
        <header>Media Gallery <button type="button" class="remove-btn" onclick="removeShopInterfaceComponent(${i})">Remove</button></header>
        <textarea class="shop-comp-urls" rows="3" placeholder="One image URL per line">${escapeHtml((c.urls || []).join("\n"))}</textarea>
      </div>
    `;
    if (c.type === "separator") return `
      <div class="reorder-item shop-interface-component" data-type="separator" data-index="${i}">
        <header>Separator <button type="button" class="remove-btn" onclick="removeShopInterfaceComponent(${i})">Remove</button></header>
      </div>
    `;
    return "";
  }).join("");
}

window.removeShopInterfaceComponent = (i) => {
  const components = getShopInterfaceComponents();
  components.splice(i, 1);
  renderShopInterfaceComponents(components);
};

document.getElementById("shop-add-text").addEventListener("click", () => {
  const components = getShopInterfaceComponents();
  components.push({ type: "text", content: "" });
  renderShopInterfaceComponents(components);
});

document.getElementById("shop-add-image").addEventListener("click", () => {
  const components = getShopInterfaceComponents();
  components.push({ type: "image", url: "" });
  renderShopInterfaceComponents(components);
});

document.getElementById("shop-add-gallery").addEventListener("click", () => {
  const components = getShopInterfaceComponents();
  components.push({ type: "media_gallery", urls: [] });
  renderShopInterfaceComponents(components);
});

document.getElementById("shop-add-separator").addEventListener("click", () => {
  const components = getShopInterfaceComponents();
  components.push({ type: "separator" });
  renderShopInterfaceComponents(components);
});

document.getElementById("shop-import-toggle").addEventListener("click", () => {
  document.getElementById("shop-import-panel").hidden = !document.getElementById("shop-import-panel").hidden;
});

document.getElementById("shop-import-btn").addEventListener("click", () => {
  try {
    const raw = document.getElementById("shop-payload-input").value;
    const { components, color } = parsePayloadToComponents(raw);
    if (!components.length) {
      showToast("No supported components found in the payload.", "error");
      return;
    }
    renderShopInterfaceComponents(components);
    if (color != null) {
      document.getElementById("shop-interface-color").value = intToHex(color);
      document.getElementById("shop-use-dominant").checked = false;
    }
    showToast(`Imported ${components.length} component(s)`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Shop forms
document.getElementById("shop-settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/shop/settings/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({
      shopChannelId: document.getElementById("shop-channel").value || null,
      shopInterfaceEnabled: document.getElementById("shop-enabled").checked,
      shopInterfaceComponents: getShopInterfaceComponents(),
      shopInterfaceColor: hexToInt(document.getElementById("shop-interface-color").value),
      shopInterfaceUseDominantColor: document.getElementById("shop-use-dominant").checked,
    }),
  });
  showToast("Shop settings saved", "success");
});

document.getElementById("shop-dominant-btn").addEventListener("click", async () => {
  if (!currentGuild) return;
  const components = getShopInterfaceComponents();
  const firstImage = components.find((c) => (c.type === "image" && c.url) || (c.type === "media_gallery" && c.urls?.[0]));
  const imageUrl = firstImage?.type === "image" ? firstImage.url : (firstImage?.urls?.[0]);
  if (!imageUrl) {
    showToast("Add an image or media gallery component first.", "error");
    return;
  }
  try {
    const { color } = await json(`/api/tickets/dominant-color/${currentGuild}`, {
      method: "POST",
      body: JSON.stringify({ imageUrl }),
    });
    document.getElementById("shop-interface-color").value = intToHex(color);
    showToast("Dominant color applied", "success");
  } catch (err) {
    showToast(err.message || "Could not sample color", "error");
  }
});

document.getElementById("shop-category-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  const id = document.getElementById("shop-category-id").value;
  const payload = getShopCategoryPayload();
  const url = id ? `/api/shop/categories/${currentGuild}/${id}` : `/api/shop/categories/${currentGuild}`;
  await json(url, { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
  resetShopCategoryForm();
  refreshSection();
  showToast(id ? "Category updated" : "Category created", "success");
});

document.getElementById("shop-category-cancel").addEventListener("click", resetShopCategoryForm);

document.getElementById("shop-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  const itemId = document.getElementById("shop-item-id").value;
  const categoryId = document.getElementById("shop-item-category-id").value;
  if (!categoryId) {
    showToast("Select a category first", "error");
    return;
  }
  const payload = getShopItemPayload();
  const url = itemId ? `/api/shop/items/${currentGuild}/${itemId}` : `/api/shop/items/${currentGuild}/${categoryId}`;
  await json(url, { method: itemId ? "PUT" : "POST", body: JSON.stringify(payload) });
  hideShopItemEditor();
  refreshSection();
  showToast(itemId ? "Item updated" : "Item created", "success");
});

document.getElementById("shop-item-cancel").addEventListener("click", hideShopItemEditor);

document.getElementById("boost-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const commands = document.getElementById("boost-commands").value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  await json(`/api/boost/${currentGuild}`, {
    method: "POST",
    body: JSON.stringify({
      enabled: document.getElementById("boost-enabled").checked,
      rewardPrimary: document.getElementById("boost-reward-primary").value,
      rewardSecondary: document.getElementById("boost-reward-secondary").value,
      roleId: document.getElementById("boost-role").value || null,
      earningsMultiplier: document.getElementById("boost-earnings").value,
      level: document.getElementById("boost-level").value,
      specialCommands: commands,
      messageChannelId: document.getElementById("boost-channel").value || null,
      thankMessage: document.getElementById("boost-message").value.trim() || null,
    }),
  });
  showToast("Boost settings saved", "success");
});

function initSelectFilters() {
  const excluded = new Set([
    "chart-range",
    "ai-mode",
    "ticket-type",
    "ticket-button-color",
    "shop-item-multiplier-type",
    "cmd-filter-success",
  ]);
  document.querySelectorAll("select").forEach((select) => {
    if (select.id && excluded.has(select.id)) return;
    makeSelectSearchable(select);
  });
}

// Init
initSelectFilters();
loadGuilds().then(() => showSection("overview"));
