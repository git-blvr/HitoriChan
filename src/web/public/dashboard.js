const guildSelect = document.getElementById("guild-select");
const sectionTitle = document.getElementById("section-title");
const navLinks = document.querySelectorAll(".nav-links a");

let currentGuild = "";
let currentSection = "overview";
let allGuilds = [];
let allCommands = [];
let allPermissions = [];
let currentUser = { isAdmin: false, permissions: [] };
let activityChart = null;
let guildData = { id: null, channels: [], roles: [], categories: [], members: [] };
const resolvedCache = { users: {}, roles: {}, channels: {} };

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

function canAccessSection(section) {
  if (currentUser.isAdmin) return true;
  if (section === "overview") return true;
  return currentUser.permissions.includes(section);
}

async function initUser() {
  try {
    const { permissions, user } = await json("/api/users/permissions");
    allPermissions = permissions || [];
    currentUser = user || { isAdmin: false, permissions: [] };
    updateNavVisibility();
  } catch {
    currentUser = { isAdmin: false, permissions: [] };
  }
}

function updateNavVisibility() {
  document.querySelectorAll(".nav-links a").forEach((link) => {
    const section = link.dataset.section;
    if (section === "users" && !canAccessSection("users")) {
      link.hidden = true;
      return;
    }
    link.hidden = !canAccessSection(section);
  });
}

function permissionCheckbox(perm) {
  return `
    <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer">
      <input type="checkbox" id="perm-${perm}" name="permissions" value="${perm}" />
      <span>${perm[0].toUpperCase() + perm.slice(1)}</span>
    </label>
  `;
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
    guildData = { id: null, channels: [], roles: [], categories: [], members: [] };
    return;
  }
  if (guildData.id === guildId) return;

  const [channels, roles, categories, members] = await Promise.all([
    json(`/api/guilds/${guildId}/channels`),
    json(`/api/guilds/${guildId}/roles`),
    json(`/api/guilds/${guildId}/categories`),
    json(`/api/guilds/${guildId}/members?limit=1000`),
  ]);

  guildData = { id: guildId, channels, roles, categories, members: members || [] };
  resolvedCache.users = {};
  resolvedCache.roles = {};
  resolvedCache.channels = {};
}

async function resolveEntityIds(guildId, users = [], roles = [], channels = []) {
  const missingUsers = users.filter((id) => !resolvedCache.users[id] && !guildData.members.find((m) => m.id === id));
  const missingRoles = roles.filter((id) => !resolvedCache.roles[id] && !guildData.roles.find((r) => r.id === id));
  const missingChannels = channels.filter((id) => !resolvedCache.channels[id] && !guildData.channels.find((c) => c.id === id));

  if (missingUsers.length || missingRoles.length || missingChannels.length) {
    try {
      const res = await json(`/api/guilds/${guildId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ users: missingUsers, roles: missingRoles, channels: missingChannels }),
      });
      Object.assign(resolvedCache.users, res.users || {});
      Object.assign(resolvedCache.roles, res.roles || {});
      Object.assign(resolvedCache.channels, res.channels || {});
    } catch {
      // ignore resolution failures; display raw IDs
    }
  }
}

function resolveUser(id) {
  if (guildData.members) {
    const member = guildData.members.find((m) => m.id === id);
    if (member) return member;
  }
  return resolvedCache.users[id] || null;
}

function resolveChannel(id) {
  const channel = guildData.channels.find((c) => c.id === id);
  if (channel) return channel;
  return resolvedCache.channels[id] || null;
}

function resolveRole(id) {
  const role = guildData.roles.find((r) => r.id === id);
  if (role) return role;
  return resolvedCache.roles[id] || null;
}

function userCell(id, fallback = null) {
  const user = resolveUser(id);
  const name = escapeHtml(user?.displayName || user?.username || fallback || id);
  const avatar = user?.avatar;
  return `
    <div class="user-cell" title="${escapeHtml(id)}">
      ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" class="table-avatar" />` : ""}
      <span>${name}</span>
    </div>
  `;
}

function channelPill(id, fallback = null) {
  const channel = resolveChannel(id);
  const name = escapeHtml(channel?.name ? `#${channel.name}` : (fallback || id));
  return `<span class="entity-pill" title="${escapeHtml(id)}">${name}</span>`;
}

function rolePill(id, fallback = null) {
  const role = resolveRole(id);
  const color = role?.color ? `#${role.color.toString(16).padStart(6, "0")}` : "var(--text)";
  const name = escapeHtml(role?.name || fallback || id);
  return `<span class="entity-pill" style="color:${color}" title="${escapeHtml(id)}">${name}</span>`;
}

function populateUserSelect(selectId, selectedId, placeholder = "-- Any user --") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = (guildData.members || [])
    .slice()
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username))
    .map((m) => `<option value="${m.id}" ${m.id === selectedId ? "selected" : ""}>${escapeHtml(m.displayName || m.username)}</option>`)
    .join("");
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options;
  if (select.dataset.searchable === "true") refreshSelectFilter(select);
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

function populateMultiChannels(selectId, selectedIds = [], placeholder = "-- None --") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selectedSet = new Set(selectedIds);
  const options = guildData.channels.map((c) =>
    `<option value="${c.id}" ${selectedSet.has(c.id) ? "selected" : ""}>#${escapeHtml(c.name)}</option>`
  ).join("");
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options;
  refreshSelectFilter(select);
}

function populateMultiRoles(selectId, selectedIds = [], placeholder = "-- None --") {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selectedSet = new Set(selectedIds);
  const options = guildData.roles.map((r) =>
    `<option value="${r.id}" ${selectedSet.has(r.id) ? "selected" : ""}>${escapeHtml(r.name)}</option>`
  ).join("");
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + options;
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
  if (select._combobox) return;

  const originalDisplay = select.style.display;
  select.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = "combobox";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "combobox-input";
  input.placeholder = "Type to filter...";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  wrapper.appendChild(input);

  const list = document.createElement("ul");
  list.className = "combobox-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrapper.appendChild(list);

  let activeIndex = -1;
  let allOptions = [];

  const saveOptions = () => {
    allOptions = Array.from(select.options).map((o) => ({
      value: o.value,
      text: o.textContent,
      disabled: o.disabled,
    }));
  };

  const getSelectedText = () => {
    const selected = allOptions.find((o) => o.value === select.value);
    return selected ? selected.text : "";
  };

  const renderList = (filter = "") => {
    const q = filter.trim().toLowerCase();
    const matches = allOptions.filter((o, i) =>
      i === 0 || o.text.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );

    list.innerHTML = matches.map((o, i) => `
      <li class="combobox-option ${o.value === select.value ? "selected" : ""}"
          role="option"
          data-value="${escapeHtml(o.value)}"
          data-index="${i}"
          ${o.disabled ? "aria-disabled=\"true\"" : ""}>
        ${escapeHtml(o.text)}
      </li>
    `).join("");

    activeIndex = matches.findIndex((o) => o.value === select.value);
    if (activeIndex < 0) activeIndex = 0;
    updateActive();
    return matches;
  };

  const updateActive = () => {
    list.querySelectorAll(".combobox-option").forEach((opt, i) => {
      opt.classList.toggle("active", i === activeIndex);
      opt.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    });
  };

  const open = () => {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.value = "";
    renderList("");
  };

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.value = getSelectedText();
  };

  const setValue = (value, text) => {
    select.value = value;
    input.value = text;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  input.addEventListener("focus", () => {
    input.value = "";
    open();
  });

  input.addEventListener("input", () => {
    if (list.hidden) open();
    renderList(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    const options = list.querySelectorAll(".combobox-option");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, options.length - 1);
      updateActive();
      options[activeIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
      options[activeIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) {
        setValue(opt.dataset.value, opt.textContent.trim());
      } else {
        close();
      }
    } else if (e.key === "Escape") {
      close();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    // Delay so clicks on options register first
    setTimeout(() => {
      if (document.activeElement !== input) close();
    }, 150);
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combobox-option");
    if (!opt) return;
    e.preventDefault();
    setValue(opt.dataset.value, opt.textContent.trim());
  });

  select._combobox = { input, list, refresh: () => { saveOptions(); close(); } };
  select._refreshFilter = () => select._combobox.refresh();
  select._setFilter = (value) => {
    select.value = value;
    close();
  };

  saveOptions();
  close();
}

function getMultiSelectValues(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return [];
  return Array.from(select.selectedOptions).map((o) => o.value);
}

function makeMultiSelectCombobox(select) {
  if (select._comboboxMulti) return;

  select.style.display = "none";

  const wrapper = document.createElement("div");
  wrapper.className = "combobox combobox-multi";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const pills = document.createElement("div");
  pills.className = "combobox-pills";
  wrapper.appendChild(pills);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "combobox-input";
  input.placeholder = "Type to filter and pick...";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  wrapper.appendChild(input);

  const list = document.createElement("ul");
  list.className = "combobox-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrapper.appendChild(list);

  let activeIndex = -1;
  let allOptions = [];

  const saveOptions = () => {
    allOptions = Array.from(select.options).map((o) => ({
      value: o.value,
      text: o.textContent,
      selected: o.selected,
      disabled: o.disabled,
    }));
  };

  const selectedValues = () => Array.from(select.selectedOptions).map((o) => o.value);

  const renderPills = () => {
    const selected = allOptions.filter((o) => o.selected && o.value !== "");
    if (!selected.length) {
      pills.innerHTML = "";
      return;
    }
    pills.innerHTML = selected.map((o) => `
      <span class="combobox-pill" data-value="${escapeHtml(o.value)}">
        ${escapeHtml(o.text)}
        <button type="button" class="combobox-pill-remove" aria-label="Remove" data-value="${escapeHtml(o.value)}">×</button>
      </span>
    `).join("");
    pills.querySelectorAll(".combobox-pill-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleValue(btn.dataset.value, false);
      });
    });
  };

  const renderList = (filter = "") => {
    const q = filter.trim().toLowerCase();
    const matches = allOptions.filter((o, i) =>
      i === 0 || q === "" || o.text.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );

    list.innerHTML = matches.map((o, i) => `
      <li class="combobox-option ${o.selected ? "selected" : ""}"
          role="option"
          data-value="${escapeHtml(o.value)}"
          data-index="${i}"
          ${o.disabled ? "aria-disabled=\"true\"" : ""}>
        ${escapeHtml(o.text)}
      </li>
    `).join("");

    activeIndex = q ? 0 : -1;
    updateActive();
  };

  const updateActive = () => {
    list.querySelectorAll(".combobox-option").forEach((opt, i) => {
      opt.classList.toggle("active", i === activeIndex);
      opt.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    });
  };

  const toggleValue = (value, isSelected) => {
    if (!value) return;
    const option = select.querySelector(`option[value="${CSS.escape(value)}"]`);
    if (!option) return;
    option.selected = isSelected;
    saveOptions();
    renderPills();
    renderList(input.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const open = () => {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderList("");
  };

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.value = "";
  };

  input.addEventListener("focus", () => {
    input.value = "";
    open();
  });

  input.addEventListener("input", () => {
    if (list.hidden) open();
    renderList(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    const options = list.querySelectorAll(".combobox-option");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, options.length - 1);
      updateActive();
      options[activeIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
      options[activeIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) {
        const value = opt.dataset.value;
        const currentlySelected = allOptions.find((o) => o.value === value)?.selected;
        toggleValue(value, !currentlySelected);
      } else {
        close();
      }
    } else if (e.key === "Escape") {
      close();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== input) close();
    }, 150);
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".combobox-option");
    if (!opt) return;
    e.preventDefault();
    const value = opt.dataset.value;
    const currentlySelected = allOptions.find((o) => o.value === value)?.selected;
    toggleValue(value, !currentlySelected);
  });

  select._comboboxMulti = { input, list, refresh: () => { saveOptions(); renderPills(); renderList(""); } };
  select._refreshFilter = () => select._comboboxMulti.refresh();
  select._setFilter = (values) => {
    Array.from(select.options).forEach((o) => { o.selected = values.includes(o.value); });
    saveOptions();
    renderPills();
    renderList("");
  };

  saveOptions();
  renderPills();
  renderList("");
  close();
}

function refreshSelectFilter(select) {
  if (select.multiple) {
    select?._comboboxMulti?.refresh?.();
  } else {
    select?._refreshFilter?.();
  }
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
    document.getElementById("sys-api").textContent = overview.bot.apiStatus;
    document.getElementById("sys-ping").textContent = overview.bot.ping >= 0 ? `${overview.bot.ping}ms` : "-";
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
    const userIds = [...new Set([...rows.map((c) => c.targetId), ...rows.map((c) => c.moderatorId)].filter(Boolean))];
    await resolveEntityIds(currentGuild, userIds, [], []);

    const tbody = document.querySelector("#cases-table tbody");
    tbody.innerHTML = rows.map((c) => `
      <tr>
        <td>${escapeHtml(c.caseId)}</td>
        <td>${escapeHtml(c.action)}</td>
        <td>${userCell(c.targetId, c.targetName)}</td>
        <td>${userCell(c.moderatorId, c.moderatorName)}</td>
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

  welcome: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const settings = await json(`/api/welcome/${currentGuild}`);

    document.getElementById("welcome-enabled").checked = settings.welcomeEnabled;
    populateChannels("welcome-channel", settings.welcomeChannelId || "", "-- System channel --");
    document.getElementById("welcome-color").value = intToHex(settings.welcomeColor);
    document.getElementById("welcome-dominant").checked = settings.welcomeUseDominantColor;
    renderWelcomeComponents(settings.welcomeComponents || []);

    document.getElementById("goodbye-enabled").checked = settings.goodbyeEnabled;
    populateChannels("goodbye-channel", settings.goodbyeChannelId || "", "-- System channel --");
    document.getElementById("goodbye-color").value = intToHex(settings.goodbyeColor);
    document.getElementById("goodbye-dominant").checked = settings.goodbyeUseDominantColor;
    renderGoodbyeComponents(settings.goodbyeComponents || []);
  },

  logs: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    populateUserSelect("cmd-filter-user", document.getElementById("cmd-filter-user").value);
    populateUserSelect("msg-filter-user", document.getElementById("msg-filter-user").value);
    await Promise.all([loadCommandLogs(), loadMessageLogs()]);
  },

  quests: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const [quests, board] = await Promise.all([
      json(`/api/quests/${currentGuild}`),
      json(`/api/quests/${currentGuild}/board`),
    ]);
    const tbody = document.querySelector("#quests-table tbody");
    tbody.innerHTML = quests.map((q) => `
      <tr>
        <td>${escapeHtml(q.name)}</td>
        <td>${escapeHtml(q.schedule)}</td>
        <td>${q.enabled ? "Yes" : "No"}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(q.dsl)}">${escapeHtml(q.dsl)}</td>
        <td>
          <button onclick="editQuest(${q.id})">Edit</button>
          <button onclick="deleteQuest(${q.id})">Delete</button>
        </td>
      </tr>
    `).join("") || '<tr><td colspan="5">No quests</td></tr>';

    resetQuestEditor();
    populateChannels("quest-board-channel", board?.channelId || "", "-- Disabled --");
    document.getElementById("quest-board-enabled").checked = board?.enabled ?? true;
    document.getElementById("quest-help-panel").hidden = false;
  },

  leveling: async () => {
    if (!currentGuild) return;
    await loadGuildData(currentGuild);
    const [settings, leaderboard] = await Promise.all([
      json(`/api/leveling/${currentGuild}/settings`),
      json(`/api/leveling/${currentGuild}/leaderboard?limit=10`),
    ]);

    await resolveEntityIds(currentGuild, leaderboard.map((row) => row.userId), [], []);

    document.getElementById("leveling-enabled").checked = settings.enabled;
    document.getElementById("leveling-min-xp").value = settings.minXp;
    document.getElementById("leveling-max-xp").value = settings.maxXp;
    document.getElementById("leveling-cooldown").value = settings.cooldownSeconds;
    document.getElementById("leveling-base-xp").value = settings.baseXp;
    document.getElementById("leveling-multiplier").value = settings.multiplier;
    populateMultiChannels("leveling-channels", settings.channels || []);
    populateMultiRoles("leveling-roles", settings.roles || []);
    document.getElementById("leveling-notify-enabled").checked = settings.notifyEnabled;
    populateChannels("leveling-notify-channel", settings.notifyChannelId || "", "-- Same channel --");
    document.getElementById("leveling-notify-message").value = settings.notifyMessage;
    document.getElementById("leveling-voice-enabled").checked = settings.voiceEnabled;
    document.getElementById("leveling-voice-xp").value = settings.voiceXp;
    document.getElementById("leveling-voice-mute-skip").checked = settings.voiceMuteSkip;
    document.getElementById("leveling-voice-afk-skip").checked = settings.voiceAfkSkip;
    document.getElementById("leveling-voice-streaming").value = settings.voiceStreamingMultiplier;
    document.getElementById("leveling-voice-video").value = settings.voiceVideoMultiplier;

    const tbody = document.querySelector("#leveling-leaderboard-table tbody");
    tbody.innerHTML = leaderboard.map((row, i) => {
      const user = resolveUser(row.userId);
      const name = user?.displayName || user?.username || row.userId;
      return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td>${row.level}</td>
        <td>${row.totalXp.toLocaleString()}</td>
      </tr>
    `;
    }).join("") || '<tr><td colspan="4">No XP yet</td></tr>';
  },

  users: async () => {
    const [users, perms] = await Promise.all([json("/api/users"), json("/api/users/permissions")]);
    allPermissions = perms.permissions || [];

    const permissionsHtml = allPermissions.map(permissionCheckbox).join("");
    document.getElementById("user-permissions").innerHTML = permissionsHtml;

    const tbody = document.querySelector("#users-table tbody");
    tbody.innerHTML = users.map((u) => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml((u.permissions || []).join(", "))}</td>
        <td>${formatDate(u.createdAt)}</td>
        <td>
          <button onclick="editUser(${u.id})">Edit</button>
          <button onclick="deleteUser(${u.id})">Delete</button>
        </td>
      </tr>
    `).join("") || '<tr><td colspan="4">No users</td></tr>';

    resetUserEditor();
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
  const userIds = [...new Set(cmdLogs.map((l) => l.userId).filter(Boolean))];
  await resolveEntityIds(currentGuild, userIds, [], []);

  const cmdBody = document.querySelector("#command-logs-table tbody");
  cmdBody.innerHTML = cmdLogs.map((l) => `
    <tr>
      <td>${formatDate(l.createdAt)}</td>
      <td>${userCell(l.userId, l.userName)}</td>
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
  const userIds = [...new Set(msgLogs.map((l) => l.userId).filter(Boolean))];
  const channelIds = [...new Set(msgLogs.map((l) => l.channelId).filter(Boolean))];
  await resolveEntityIds(currentGuild, userIds, [], channelIds);

  const msgBody = document.querySelector("#message-logs-table tbody");
  msgBody.innerHTML = msgLogs.map((l) => `
    <tr>
      <td>${formatDate(l.createdAt)}</td>
      <td>${userCell(l.userId, l.userName)}</td>
      <td>${channelPill(l.channelId)}</td>
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

const sectionDisplayNames = {
  ai: "AI Config",
  welcome: "System Messages",
  leveling: "Leveling",
};

const sectionActiveTabs = new Map();

function getPanelLabel(panel) {
  const heading = panel.querySelector("h2, h3");
  if (heading) return heading.textContent.trim();
  const id = panel.id || panel.dataset.id;
  if (id) return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return "Panel";
}

function updateSectionTabs(section) {
  const tabBar = section.querySelector(":scope > .section-tabs");
  if (!tabBar) return;
  const panels = Array.from(section.querySelectorAll(":scope > .section-tab-content"));
  const activeIndex = sectionActiveTabs.get(section.id) ?? 0;
  const buttons = tabBar.querySelectorAll(".section-tab");
  buttons.forEach((btn, i) => btn.classList.toggle("active", i === activeIndex));
  panels.forEach((panel, i) => panel.classList.toggle("active", i === activeIndex));
}

function applySectionTabs(name) {
  const section = document.getElementById(name);
  if (!section || section.dataset.noAutoTabs) return;
  const panels = Array.from(section.children).filter((el) =>
    el.classList.contains("panel") || el.classList.contains("chart-panel")
  );
  if (panels.length <= 1) return;

  if (section.querySelector(":scope > .section-tabs")) {
    updateSectionTabs(section);
    return;
  }

  const tabBar = document.createElement("div");
  tabBar.className = "section-tabs";
  tabBar.setAttribute("role", "tablist");
  tabBar.style.marginTop = "0";
  section.insertBefore(tabBar, panels[0]);

  panels.forEach((panel, i) => {
    panel.classList.add("section-tab-content");
    const label = getPanelLabel(panel);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "section-tab";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      sectionActiveTabs.set(section.id, i);
      updateSectionTabs(section);
    });
    tabBar.appendChild(btn);
  });

  updateSectionTabs(section);
}

function showSection(name) {
  if (!canAccessSection(name)) {
    showToast("You don't have permission to access this section.", "error");
    name = "overview";
  }
  currentSection = name;
  const display = sectionDisplayNames[name] || (name[0].toUpperCase() + name.slice(1));
  sectionTitle.textContent = display;
  document.querySelectorAll(".content-section").forEach((el) => el.classList.remove("active"));
  document.getElementById(name).classList.add("active");
  navLinks.forEach((l) => l.classList.toggle("active", l.dataset.section === name));

  const activeLink = document.querySelector(`.nav-links a[data-section="${name}"]`);
  if (activeLink) {
    activeLink.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  applySectionTabs(name);
  refreshSection();
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    if (!link.dataset.section) return;
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

function parseDurationInput(str) {
  if (!str || !str.trim()) return null;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  let total = 0;
  const matches = str.matchAll(/(\d+)([smhdw])/gi);
  for (const match of matches) total += parseInt(match[1]) * (units[match[2].toLowerCase()] || 0);
  return total || null;
}

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
        <label class="grow">Name <input type="text" class="field-name" value="${escapeHtml(f.name)}" placeholder="Field name" /></label>
        <label class="grow"><input type="checkbox" class="field-inline" ${f.inline ? "checked" : ""} /> Inline</label>
      </div>
      <label>Value <input type="text" class="field-value" value="${escapeHtml(f.value)}" placeholder="Field value" /></label>
    </div>
  `).join("");
}

function renderTicketComponents(components) {
  const list = document.getElementById("ticket-components-list");
  list.innerHTML = components.map((c, i) => {
    if (c.type === "text") return `
      <div class="reorder-item ticket-component" data-type="text" data-index="${i}">
        <header>Text <button type="button" class="remove-btn" onclick="removeTicketComponent(${i})">Remove</button></header>
        <textarea class="comp-content" rows="3" placeholder="Text content">${escapeHtml(c.content || "")}</textarea>
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
          <label class="grow">Label <input type="text" class="comp-label" value="${escapeHtml(c.label || "Create Ticket")}" placeholder="Button label" /></label>
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
    expiryDuration: parseDurationInput(document.getElementById("shop-item-expiry").value),
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
  document.getElementById("shop-item-expiry").value = item.expiryDuration ? formatDuration(Math.floor(item.expiryDuration / 1000)) : "";
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
        <textarea class="shop-comp-content" rows="3" placeholder="Text content">${escapeHtml(c.content || "")}</textarea>
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

// System messages (welcome/goodbye) CV2 builder
function renderSystemComponents(listId, components) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = (components || []).map((c, i) => {
    if (c.type === "text") return `
      <div class="reorder-item system-component" data-type="text" data-index="${i}">
        <header>Text <button type="button" class="remove-btn" onclick="removeSystemComponent('${listId}', ${i})">Remove</button></header>
        <textarea class="system-comp-content" rows="3" data-payload-import="text" placeholder="Text content">${escapeHtml(c.content || "")}</textarea>
      </div>
    `;
    if (c.type === "image") return `
      <div class="reorder-item system-component" data-type="image" data-index="${i}">
        <header>Image <button type="button" class="remove-btn" onclick="removeSystemComponent('${listId}', ${i})">Remove</button></header>
        <input type="text" class="system-comp-url" value="${escapeHtml(c.url || "")}" placeholder="https://..." />
      </div>
    `;
    if (c.type === "media_gallery") return `
      <div class="reorder-item system-component" data-type="media_gallery" data-index="${i}">
        <header>Media Gallery <button type="button" class="remove-btn" onclick="removeSystemComponent('${listId}', ${i})">Remove</button></header>
        <textarea class="system-comp-urls" rows="3" placeholder="One image URL per line">${escapeHtml((c.urls || []).join("\n"))}</textarea>
      </div>
    `;
    if (c.type === "separator") return `
      <div class="reorder-item system-component" data-type="separator" data-index="${i}">
        <header>Separator <button type="button" class="remove-btn" onclick="removeSystemComponent('${listId}', ${i})">Remove</button></header>
      </div>
    `;
    return "";
  }).join("");
  initPayloadImportButtons();
}

function getSystemComponents(listId) {
  return Array.from(document.querySelectorAll(`#${listId} .system-component`)).map((el) => {
    const type = el.dataset.type;
    if (type === "text") return { type, content: el.querySelector(".system-comp-content").value };
    if (type === "image") return { type, url: el.querySelector(".system-comp-url").value.trim() };
    if (type === "media_gallery") return { type, urls: el.querySelector(".system-comp-urls").value.split(/\n+/).map((s) => s.trim()).filter(Boolean) };
    if (type === "separator") return { type };
    return null;
  }).filter(Boolean);
}

function addSystemComponent(listId, type) {
  const list = document.getElementById(listId);
  const components = getSystemComponents(listId);
  if (type === "text") components.push({ type, content: "" });
  else if (type === "image") components.push({ type, url: "" });
  else if (type === "media_gallery") components.push({ type, urls: [] });
  else if (type === "separator") components.push({ type });
  renderSystemComponents(listId, components);
}

function importSystemPayload(listId, inputId, colorId, dominantId) {
  try {
    const raw = document.getElementById(inputId).value;
    const { components, color } = parsePayloadToComponents(raw);
    if (!components.length) {
      showToast("No supported components found in the payload.", "error");
      return;
    }
    renderSystemComponents(listId, components);
    if (color != null) {
      document.getElementById(colorId).value = intToHex(color);
      document.getElementById(dominantId).checked = false;
    }
    showToast(`Imported ${components.length} component(s)`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

window.removeSystemComponent = (listId, i) => {
  const components = getSystemComponents(listId);
  components.splice(i, 1);
  renderSystemComponents(listId, components);
};

function renderWelcomeComponents(components) {
  renderSystemComponents("welcome-components-list", components);
}

function renderGoodbyeComponents(components) {
  renderSystemComponents("goodbye-components-list", components);
}

function getWelcomeGoodbyeBody() {
  return {
    welcomeEnabled: document.getElementById("welcome-enabled").checked,
    welcomeChannelId: document.getElementById("welcome-channel").value || null,
    welcomeColor: hexToInt(document.getElementById("welcome-color").value),
    welcomeUseDominantColor: document.getElementById("welcome-dominant").checked,
    welcomeComponents: getSystemComponents("welcome-components-list"),
    goodbyeEnabled: document.getElementById("goodbye-enabled").checked,
    goodbyeChannelId: document.getElementById("goodbye-channel").value || null,
    goodbyeColor: hexToInt(document.getElementById("goodbye-color").value),
    goodbyeUseDominantColor: document.getElementById("goodbye-dominant").checked,
    goodbyeComponents: getSystemComponents("goodbye-components-list"),
  };
}

document.getElementById("welcome-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/welcome/${currentGuild}`, { method: "POST", body: JSON.stringify(getWelcomeGoodbyeBody()) });
  showToast("Welcome settings saved", "success");
});

document.getElementById("goodbye-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;
  await json(`/api/welcome/${currentGuild}`, { method: "POST", body: JSON.stringify(getWelcomeGoodbyeBody()) });
  showToast("Goodbye settings saved", "success");
});

["welcome", "goodbye"].forEach((kind) => {
  document.getElementById(`${kind}-add-text`).addEventListener("click", () => addSystemComponent(`${kind}-components-list`, "text"));
  document.getElementById(`${kind}-add-image`).addEventListener("click", () => addSystemComponent(`${kind}-components-list`, "image"));
  document.getElementById(`${kind}-add-gallery`).addEventListener("click", () => addSystemComponent(`${kind}-components-list`, "media_gallery"));
  document.getElementById(`${kind}-add-separator`).addEventListener("click", () => addSystemComponent(`${kind}-components-list`, "separator"));
  document.getElementById(`${kind}-import-toggle`).addEventListener("click", () => {
    document.getElementById(`${kind}-import-panel`).hidden = !document.getElementById(`${kind}-import-panel`).hidden;
  });
  document.getElementById(`${kind}-import-btn`).addEventListener("click", () => {
    importSystemPayload(`${kind}-components-list`, `${kind}-payload-input`, `${kind}-color`, `${kind}-dominant`);
  });
});

function getUserFormPermissions() {
  return Array.from(document.querySelectorAll('input[name="permissions"]:checked')).map((cb) => cb.value);
}

function resetUserEditor() {
  document.getElementById("user-form").reset();
  document.getElementById("user-id").value = "";
  document.getElementById("user-password").value = "";
  document.getElementById("user-password").placeholder = "Leave empty when editing to keep current";
  document.getElementById("user-save-btn").textContent = "Create User";
}

window.editUser = async (id) => {
  const user = await json(`/api/users/${id}`);
  document.getElementById("user-id").value = user.id;
  document.getElementById("user-username").value = user.username;
  document.getElementById("user-password").value = "";
  document.getElementById("user-password").placeholder = "Enter new password (leave empty to keep current)";
  document.getElementById("user-save-btn").textContent = "Update User";

  document.querySelectorAll('input[name="permissions"]').forEach((cb) => {
    cb.checked = (user.permissions || []).includes(cb.value);
  });
};

window.deleteUser = async (id) => {
  if (!confirm("Delete this user?")) return;
  await json(`/api/users/${id}`, { method: "DELETE" });
  refreshSection();
  showToast("User deleted", "success");
};

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("user-id").value;
  const username = document.getElementById("user-username").value.trim();
  const password = document.getElementById("user-password").value;
  const permissions = getUserFormPermissions();

  const body = { username, permissions };
  if (password) body.password = password;

  if (id) {
    await json(`/api/users/${id}`, { method: "POST", body: JSON.stringify(body) });
    showToast("User updated", "success");
  } else {
    if (!password) {
      showToast("Password is required when creating a user", "error");
      return;
    }
    await json("/api/users", { method: "POST", body: JSON.stringify(body) });
    showToast("User created", "success");
  }

  resetUserEditor();
  refreshSection();
});

document.getElementById("user-cancel-btn").addEventListener("click", resetUserEditor);

// Leveling
document.getElementById("leveling-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const parseIdList = (value) =>
    String(value || "")
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const body = {
    enabled: document.getElementById("leveling-enabled").checked,
    minXp: Number(document.getElementById("leveling-min-xp").value) || 1,
    maxXp: Number(document.getElementById("leveling-max-xp").value) || 1,
    cooldownSeconds: Number(document.getElementById("leveling-cooldown").value) || 0,
    baseXp: Number(document.getElementById("leveling-base-xp").value) || 100,
    multiplier: Number(document.getElementById("leveling-multiplier").value) || 1,
    channels: getMultiSelectValues("leveling-channels"),
    roles: getMultiSelectValues("leveling-roles"),
    notifyEnabled: document.getElementById("leveling-notify-enabled").checked,
    notifyChannelId: document.getElementById("leveling-notify-channel").value || null,
    notifyMessage: document.getElementById("leveling-notify-message").value.trim() || null,
    voiceEnabled: document.getElementById("leveling-voice-enabled").checked,
    voiceXp: Number(document.getElementById("leveling-voice-xp").value) || 0,
    voiceMuteSkip: document.getElementById("leveling-voice-mute-skip").checked,
    voiceAfkSkip: document.getElementById("leveling-voice-afk-skip").checked,
    voiceStreamingMultiplier: Number(document.getElementById("leveling-voice-streaming").value) || 1,
    voiceVideoMultiplier: Number(document.getElementById("leveling-voice-video").value) || 1,
  };

  try {
    await json(`/api/leveling/${currentGuild}/settings`, { method: "POST", body: JSON.stringify(body) });
    showToast("Leveling settings saved", "success");
  } catch (err) {
    showToast(err.message || "Failed to save leveling settings", "error");
  }
});

// Quests
const QUEST_CONDITION_CONFIG = {
  message: {
    label: "Message",
    fields: {
      content: { label: "Content", type: "string", ops: ["INCLUDE", "STARTS_WITH", "ENDS_WITH", "=", "!="] },
      channel: { label: "Channel", type: "channel", ops: ["=", "!="] },
      author: { label: "Author", type: "user", ops: ["=", "!="] },
      attachments: { label: "Attachment count", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
    },
  },
  messages: {
    label: "Messages (tracked)",
    fields: {
      sent: { label: "Total sent", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
      in_channel: { label: "Sent in channel", type: "channel", ops: ["=", ">="] },
      with_content: { label: "Containing text", type: "string", ops: ["INCLUDE", "STARTS_WITH", "ENDS_WITH"] },
    },
  },
  user: {
    label: "User",
    fields: {
      id: { label: "User ID", type: "user", ops: ["=", "!="] },
      username: { label: "Username", type: "string", ops: ["INCLUDE", "STARTS_WITH", "ENDS_WITH", "=", "!="] },
      display_name: { label: "Display name", type: "string", ops: ["INCLUDE", "=", "!="] },
      is_bot: { label: "Is bot", type: "boolean", ops: ["="] },
      boosted: { label: "Is boosting", type: "boolean", ops: ["="] },
      has_role: { label: "Has role", type: "role", ops: ["="] },
      has_any_role: { label: "Has any role", type: "role_list", ops: ["="] },
      in_channel: { label: "In channel", type: "channel", ops: ["="] },
    },
  },
  voice: {
    label: "Voice",
    fields: {
      minutes: { label: "Minutes", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
      joined: { label: "Joins", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
    },
  },
  commands: {
    label: "Commands",
    fields: {
      count: { label: "Total used", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
      used: { label: "Used command", type: "string", ops: ["=", "!=", "INCLUDE"] },
    },
  },
  reactions: {
    label: "Reactions",
    fields: {
      count: { label: "Total reactions", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
    },
  },
  invites: {
    label: "Invites",
    fields: {
      count: { label: "Count", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
    },
  },
  economy: {
    label: "Economy",
    fields: {
      primary: { label: "Primary balance", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
      secondary: { label: "Secondary balance", type: "number", ops: [">=", "<=", ">", "<", "=", "!="] },
    },
  },
  channel: {
    label: "Channel",
    fields: {
      message: { label: "Message content", type: "string", ops: ["INCLUDE", "STARTS_WITH", "ENDS_WITH", "=", "!="] },
    },
  },
  guild: {
    label: "Guild",
    fields: {
      id: { label: "Guild ID", type: "string", ops: ["=", "!="] },
    },
  },
};

// Quest conditions UI
function buildQuestConditions(condition = { match: "all", blocks: [] }) {
  const list = document.getElementById("quest-conditions-list");
  if (!list) return;
  list.innerHTML = "";
  document.getElementById("quest-match").value = condition.match || "all";
  for (const block of condition.blocks || []) {
    addQuestConditionBlock(block);
  }
}

function addQuestConditionBlock(block = {}) {
  const list = document.getElementById("quest-conditions-list");
  if (!list) return;

  const card = document.createElement("div");
  card.className = "quest-condition-card";
  card.dataset.not = block.not ? "1" : "";

  const entityOptions = Object.entries(QUEST_CONDITION_CONFIG).map(([k, v]) =>
    `<option value="${k}" ${k === (block.entity || "message") ? "selected" : ""}>${v.label}</option>`
  ).join("");

  card.innerHTML = `
    <div class="inline-fields" style="align-items:flex-end">
      <label style="white-space:nowrap"><input type="checkbox" class="quest-condition-not" ${block.not ? "checked" : ""} /> NOT</label>
      <label class="grow">Entity
        <select class="quest-condition-entity">${entityOptions}</select>
      </label>
      <label class="grow">Field
        <select class="quest-condition-field"></select>
      </label>
      <label class="grow">Operator
        <select class="quest-condition-op"></select>
      </label>
      <button type="button" class="save-btn quest-remove-condition" style="background:var(--surface-2)">Remove</button>
    </div>
    <div class="quest-condition-value" style="margin-top:10px"></div>
  `;

  card.querySelector(".quest-remove-condition").addEventListener("click", () => card.remove());
  card.querySelector(".quest-condition-entity").addEventListener("change", () => {
    const entity = card.querySelector(".quest-condition-entity").value;
    const firstField = Object.keys(QUEST_CONDITION_CONFIG[entity].fields)[0];
    renderConditionField(card, entity, firstField);
  });
  card.querySelector(".quest-condition-field").addEventListener("change", () => {
    const entity = card.querySelector(".quest-condition-entity").value;
    const field = card.querySelector(".quest-condition-field").value;
    renderConditionOpAndValue(card, entity, field);
  });
  card.querySelector(".quest-condition-op").addEventListener("change", () => {
    const entity = card.querySelector(".quest-condition-entity").value;
    const field = card.querySelector(".quest-condition-field").value;
    renderConditionValue(card, entity, field);
  });

  renderConditionField(card, block.entity || "message", block.field);
  setTimeout(() => {
    const entity = card.querySelector(".quest-condition-entity").value;
    const field = card.querySelector(".quest-condition-field").value;
    const op = block.op || QUEST_CONDITION_CONFIG[entity].fields[field].ops[0];
    const opSelect = card.querySelector(".quest-condition-op");
    if (opSelect) opSelect.value = op;
    renderConditionValue(card, entity, field, block.value);
  }, 0);

  list.appendChild(card);
}

function renderConditionField(card, entity, selectedField) {
  const config = QUEST_CONDITION_CONFIG[entity];
  const fieldSelect = card.querySelector(".quest-condition-field");
  fieldSelect.innerHTML = Object.entries(config.fields).map(([k, v]) =>
    `<option value="${k}" ${k === selectedField ? "selected" : ""}>${v.label}</option>`
  ).join("");

  const field = fieldSelect.value;
  renderConditionOpAndValue(card, entity, field);
}

function renderConditionOpAndValue(card, entity, field) {
  const config = QUEST_CONDITION_CONFIG[entity].fields[field];
  const opSelect = card.querySelector(".quest-condition-op");
  opSelect.innerHTML = (config.ops || ["="]).map((op) =>
    `<option value="${op}">${op}</option>`
  ).join("");
  renderConditionValue(card, entity, field);
}

function renderConditionValue(card, entity, field, selectedValue = "") {
  const config = QUEST_CONDITION_CONFIG[entity].fields[field];
  const op = card.querySelector(".quest-condition-op")?.value || config.ops[0];
  const container = card.querySelector(".quest-condition-value");
  if (!container) return;

  let html = "";
  const value = selectedValue ?? "";

  if (config.type === "string") {
    html = `<input type="text" class="quest-condition-value-input" placeholder="value or $variable" value="${escapeHtml(String(value))}" />`;
  } else if (config.type === "number") {
    html = `<input type="number" class="quest-condition-value-input" value="${escapeHtml(String(value))}" placeholder="0" />`;
  } else if (config.type === "boolean") {
    const checked = value === true || value === "true" ? "checked" : "";
    html = `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="quest-condition-value-check" ${checked} /> Yes / True</label>`;
  } else if (config.type === "channel") {
    html = `<select class="quest-condition-value-select" data-searchable="true"><option value="">-- None --</option></select>`;
  } else if (config.type === "role") {
    html = `<select class="quest-condition-value-select" data-searchable="true"><option value="">-- None --</option></select>`;
  } else if (config.type === "role_list") {
    html = `<input type="text" class="quest-condition-value-input" placeholder="role-id-1, role-id-2" value="${escapeHtml(String(value))}" />`;
  } else if (config.type === "user") {
    html = `<select class="quest-condition-value-select" data-searchable="true"><option value="">-- None --</option></select>`;
  }

  container.innerHTML = html;

  const select = container.querySelector(".quest-condition-value-select");
  if (select) {
    makeSelectSearchableIfNeeded(select);
    if (config.type === "channel") populateChannelsForEl(select, value);
    else if (config.type === "role" || config.type === "role_list") populateRolesForEl(select, value);
    else if (config.type === "user") populateUsersForEl(select, value);
  }
}

function populateUsersForEl(select, selectedId) {
  select.innerHTML = '<option value="">-- None --</option>' +
    (guildData.members || []).map((m) =>
      `<option value="${m.id}" ${m.id === selectedId ? "selected" : ""}>${escapeHtml(m.displayName || m.username)}</option>`
    ).join("");
  refreshSelectFilter(select);
}

function getQuestConditions() {
  const match = document.getElementById("quest-match").value || "all";
  const blocks = [];
  document.querySelectorAll(".quest-condition-card").forEach((card) => {
    const not = card.querySelector(".quest-condition-not")?.checked || false;
    const entity = card.querySelector(".quest-condition-entity")?.value;
    const field = card.querySelector(".quest-condition-field")?.value;
    const op = card.querySelector(".quest-condition-op")?.value;
    if (!entity || !field) return;

    const config = QUEST_CONDITION_CONFIG[entity].fields[field];
    let value = "";

    if (config.type === "boolean") {
      value = card.querySelector(".quest-condition-value-check")?.checked || false;
    } else if (config.type === "channel" || config.type === "role" || config.type === "user") {
      value = card.querySelector(".quest-condition-value-select")?.value || "";
    } else if (config.type === "number") {
      value = Number(card.querySelector(".quest-condition-value-input")?.value) || 0;
    } else {
      value = card.querySelector(".quest-condition-value-input")?.value.trim() || "";
    }

    blocks.push({ not, entity, field, op, value });
  });
  return { match, blocks };
}

// Quest variables UI
function buildQuestVariables(data = {}) {
  const list = document.getElementById("quest-variables-list");
  if (!list) return;
  list.innerHTML = "";
  for (const [key, value] of Object.entries(data)) {
    addQuestVariableRow(key, value);
  }
}

function addQuestVariableRow(key = "", value = "") {
  const list = document.getElementById("quest-variables-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "quest-variable-row";
  row.innerHTML = `
    <input type="text" class="quest-var-key" placeholder="name" value="${escapeHtml(key)}" />
    <input type="text" class="quest-var-value" placeholder="value" value="${escapeHtml(String(value))}" />
    <button type="button" class="save-btn quest-remove-variable" style="background:var(--surface-2)">Remove</button>
  `;
  row.querySelector(".quest-remove-variable").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

function getQuestVariables() {
  const result = {};
  document.querySelectorAll(".quest-variable-row").forEach((row) => {
    const key = row.querySelector(".quest-var-key")?.value.trim();
    const value = row.querySelector(".quest-var-value")?.value.trim();
    if (key) {
      let parsed = value;
      if (value === "true") parsed = true;
      else if (value === "false") parsed = false;
      else if (value && !isNaN(Number(value)) && value !== "") parsed = Number(value);
      result[key] = parsed;
    }
  });
  return result;
}

// Quest tasks UI
const QUEST_TASK_TYPES = {
  send_message: "Send Message",
  send_dm: "Send DM",
  give_role: "Give Role",
  remove_role: "Remove Role",
  give_currency: "Give Currency",
};

function buildQuestTasks(tasks = []) {
  const list = document.getElementById("quest-tasks-list");
  if (!list) return;
  list.innerHTML = "";
  for (const task of tasks) {
    addQuestTaskCard(task);
  }
}

function makeSelectSearchableIfNeeded(select) {
  if (select && !select._searchFilter) makeSelectSearchable(select);
}

function addQuestTaskCard(task = { name: "", type: "send_message", payload: {} }) {
  const list = document.getElementById("quest-tasks-list");
  if (!list) return;

  const card = document.createElement("div");
  card.className = "quest-task-card";
  card.dataset.type = task.type;

  const typeOptions = Object.entries(QUEST_TASK_TYPES).map(([k, l]) =>
    `<option value="${k}" ${k === task.type ? "selected" : ""}>${l}</option>`
  ).join("");

  card.innerHTML = `
    <div class="inline-fields">
      <label class="grow">Task Name <input type="text" class="quest-task-name" value="${escapeHtml(task.name)}" required placeholder="Task name" /></label>
      <label class="grow">Type
        <select class="quest-task-type">${typeOptions}</select>
      </label>
      <button type="button" class="save-btn quest-remove-task" style="background:var(--surface-2); align-self:flex-end">Remove</button>
    </div>
    <div class="quest-task-payload"></div>
  `;

  card.querySelector(".quest-remove-task").addEventListener("click", () => card.remove());
  const typeSelect = card.querySelector(".quest-task-type");
  typeSelect.addEventListener("change", () => renderTaskPayload(card, {}));

  renderTaskPayload(card, task.payload);
  list.appendChild(card);
}

function renderTaskPayload(card, payload = {}) {
  const type = card.querySelector(".quest-task-type").value;
  card.dataset.type = type;
  const container = card.querySelector(".quest-task-payload");
  if (!container) return;
  let html = "";

  if (type === "send_message") {
    const channelId = payload.channelId || "";
    const content = payload.content || "";
    html = `
      <label>Channel
        <select class="quest-task-channel" data-searchable="true"><option value="">-- None --</option></select>
      </label>
      <label>Message <textarea class="quest-task-content" rows="2" placeholder="Hello {user}!">${escapeHtml(content)}</textarea></label>
    `;
  } else if (type === "send_dm") {
    html = `<label>Message <textarea class="quest-task-content" rows="2" placeholder="Hello {user}!">${escapeHtml(payload.content || "")}</textarea></label>`;
  } else if (type === "give_role" || type === "remove_role") {
    html = `<label>Role <select class="quest-task-role" data-searchable="true"><option value="">-- None --</option></select></label>`;
  } else if (type === "give_currency") {
    const currency = payload.currency || "primary";
    const amount = payload.amount || 0;
    html = `
      <div class="inline-fields">
        <label class="grow">Currency
          <select class="quest-task-currency">
            <option value="primary" ${currency === "primary" ? "selected" : ""}>Primary</option>
            <option value="secondary" ${currency === "secondary" ? "selected" : ""}>Secondary</option>
          </select>
        </label>
        <label class="grow">Amount <input type="number" class="quest-task-amount" min="0" value="${amount}" placeholder="0" /></label>
      </div>
    `;
  }

  container.innerHTML = html;

  if (type === "send_message") {
    const channelSelect = container.querySelector(".quest-task-channel");
    if (channelSelect) {
      makeSelectSearchableIfNeeded(channelSelect);
      populateChannelsForEl(channelSelect, payload.channelId || "");
    }
  } else if (type === "give_role" || type === "remove_role") {
    const roleSelect = container.querySelector(".quest-task-role");
    if (roleSelect) {
      makeSelectSearchableIfNeeded(roleSelect);
      populateRolesForEl(roleSelect, payload.roleId || "");
    }
  }
}

function populateChannelsForEl(select, selectedId) {
  select.innerHTML = '<option value="">-- None --</option>' +
    (guildData.channels || []).map((c) =>
      `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>#${escapeHtml(c.name)}</option>`
    ).join("");
  refreshSelectFilter(select);
}

function populateRolesForEl(select, selectedId) {
  select.innerHTML = '<option value="">-- None --</option>' +
    (guildData.roles || []).map((r) =>
      `<option value="${r.id}" ${r.id === selectedId ? "selected" : ""}>${escapeHtml(r.name)}</option>`
    ).join("");
  refreshSelectFilter(select);
}

function getQuestTasks() {
  const tasks = [];
  document.querySelectorAll(".quest-task-card").forEach((card) => {
    const name = card.querySelector(".quest-task-name")?.value.trim();
    if (!name) return;
    const type = card.querySelector(".quest-task-type")?.value;
    const payload = {};

    if (type === "send_message") {
      payload.channelId = card.querySelector(".quest-task-channel")?.value || null;
      payload.content = card.querySelector(".quest-task-content")?.value.trim() || "";
    } else if (type === "send_dm") {
      payload.content = card.querySelector(".quest-task-content")?.value.trim() || "";
    } else if (type === "give_role" || type === "remove_role") {
      payload.roleId = card.querySelector(".quest-task-role")?.value || null;
    } else if (type === "give_currency") {
      payload.currency = card.querySelector(".quest-task-currency")?.value || "primary";
      payload.amount = Number(card.querySelector(".quest-task-amount")?.value) || 0;
    }

    tasks.push({ name, type, payload });
  });
  return tasks;
}

function buildQuestCompletionMessage(cm = {}) {
  const channelSelect = document.getElementById("quest-completion-channel");
  document.getElementById("quest-completion-enabled").checked = cm.enabled || false;
  document.getElementById("quest-completion-dm").checked = cm.dm || false;
  document.getElementById("quest-completion-title").value = cm.title || "";
  document.getElementById("quest-completion-desc").value = cm.description || "";
  document.getElementById("quest-completion-color").value = cm.color || "#8b5cf6";
  document.getElementById("quest-completion-dominant").checked = cm.useDominantColor || false;
  makeSelectSearchableIfNeeded(channelSelect);
  populateChannelsForEl(channelSelect, cm.channelId || "");
}

function getQuestCompletionMessage() {
  return {
    enabled: document.getElementById("quest-completion-enabled")?.checked || false,
    dm: document.getElementById("quest-completion-dm")?.checked || false,
    channelId: document.getElementById("quest-completion-channel")?.value || null,
    title: document.getElementById("quest-completion-title")?.value.trim() || null,
    description: document.getElementById("quest-completion-desc")?.value.trim() || null,
    color: document.getElementById("quest-completion-color")?.value || null,
    useDominantColor: document.getElementById("quest-completion-dominant")?.checked || false,
  };
}

function setQuestTab(name) {
  document.querySelectorAll(".quest-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.questTab === name));
  document.querySelectorAll(".quest-tab-content").forEach((content) => content.classList.toggle("active", content.dataset.questTab === name));
}

function resetQuestEditor() {
  document.getElementById("quest-form").reset();
  document.getElementById("quest-id").value = "";
  document.getElementById("quest-enabled").value = "1";
  document.getElementById("quest-reward-amount").value = "0";
  document.getElementById("quest-save-btn").textContent = "Create Quest";
  buildQuestConditions({ match: "all", blocks: [] });
  buildQuestVariables({});
  buildQuestTasks([]);
  buildQuestCompletionMessage({});
  setQuestTab("details");
}

window.editQuest = async (id) => {
  const q = await json(`/api/quests/${currentGuild}/${id}`);
  document.getElementById("quest-id").value = q.id;
  document.getElementById("quest-name").value = q.name;
  document.getElementById("quest-desc").value = q.description || "";
  document.getElementById("quest-schedule").value = q.schedule;
  document.getElementById("quest-enabled").value = q.enabled ? "1" : "0";
  document.getElementById("quest-reward-type").value = q.rewardType || "";
  document.getElementById("quest-reward-value").value = q.rewardValue || "";
  document.getElementById("quest-reward-amount").value = q.rewardAmount || 0;
  document.getElementById("quest-save-btn").textContent = "Update Quest";

  buildQuestConditions(q.condition || { match: "all", blocks: [] });
  buildQuestVariables(q.variables || {});
  buildQuestTasks(q.tasks || []);
  buildQuestCompletionMessage(q.completionMessage || {});
  setQuestTab("details");
};

window.deleteQuest = async (id) => {
  if (!confirm("Delete this quest?")) return;
  await json(`/api/quests/${currentGuild}/${id}`, { method: "DELETE" });
  refreshSection();
  showToast("Quest deleted", "success");
};

document.getElementById("quest-add-variable").addEventListener("click", () => addQuestVariableRow());
document.getElementById("quest-add-task").addEventListener("click", () => addQuestTaskCard());
document.getElementById("quest-add-condition").addEventListener("click", () => addQuestConditionBlock());

document.getElementById("quest-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentGuild) return;

  const id = document.getElementById("quest-id").value;
  const condition = getQuestConditions();
  const variables = getQuestVariables();
  const tasks = getQuestTasks();
  const completionMessage = getQuestCompletionMessage();

  const body = {
    name: document.getElementById("quest-name").value.trim(),
    description: document.getElementById("quest-desc").value.trim(),
    schedule: document.getElementById("quest-schedule").value,
    enabled: document.getElementById("quest-enabled").value === "1",
    condition,
    variables,
    tasks,
    completionMessage,
    rewardType: document.getElementById("quest-reward-type").value || null,
    rewardValue: document.getElementById("quest-reward-value").value.trim() || null,
    rewardAmount: Number(document.getElementById("quest-reward-amount").value) || 0,
  };

  try {
    if (id) {
      await json(`/api/quests/${currentGuild}/${id}`, { method: "POST", body: JSON.stringify(body) });
      showToast("Quest updated", "success");
    } else {
      await json(`/api/quests/${currentGuild}`, { method: "POST", body: JSON.stringify(body) });
      showToast("Quest created", "success");
    }
    resetQuestEditor();
    refreshSection();
  } catch (err) {
    showToast(err.message || "Failed to save quest", "error");
  }
});

document.getElementById("quest-cancel-btn").addEventListener("click", resetQuestEditor);

document.querySelectorAll(".quest-tab").forEach((btn) => {
  btn.addEventListener("click", () => setQuestTab(btn.dataset.questTab));
});

document.getElementById("quest-board-save").addEventListener("click", async () => {
  if (!currentGuild) return;
  const body = {
    channelId: document.getElementById("quest-board-channel").value || null,
    enabled: document.getElementById("quest-board-enabled").checked,
  };
  try {
    const res = await json(`/api/quests/${currentGuild}/board`, { method: "POST", body: JSON.stringify(body) });
    if (res.messageId) {
      showToast("Quest board posted/updated", "success");
    } else if (body.channelId) {
      showToast("Quest board saved", "success");
    } else {
      showToast("Quest board disabled", "success");
    }
  } catch (err) {
    showToast(err.message || "Failed to save quest board", "error");
  }
});

const payloadModal = document.getElementById("payload-import-modal");
const payloadText = document.getElementById("payload-import-text");
let payloadImportTarget = null;

function extractTextFromPayload(payload) {
  if (!payload) return "";

  // Plain message
  if (typeof payload.content === "string" && payload.content) return payload.content;

  // Embed
  if (payload.embeds?.length) {
    const embed = payload.embeds[0];
    if (embed.description) return embed.description;
    if (embed.title) return embed.title;
  }

  // CV2 Container / components
  const components = Array.isArray(payload) ? payload : payload.components;
  if (components?.length) {
    for (const top of components) {
      const container = top?.components || (top?.type === 17 ? top.components : null);
      if (!Array.isArray(container)) continue;
      for (const c of container) {
        if (c?.content) return c.content;
        if (c?.components) {
          for (const inner of c.components) {
            if (inner?.content) return inner.content;
          }
        }
      }
    }
  }

  // Fallback to JSON string if it looks short
  const str = typeof payload === "string" ? payload : JSON.stringify(payload);
  return str.length < 2000 ? str : "";
}

function openPayloadImport(target) {
  payloadImportTarget = target;
  payloadText.value = "";
  payloadModal.hidden = false;
  payloadText.focus();
}

function closePayloadImport() {
  payloadModal.hidden = true;
  payloadImportTarget = null;
}

function applyPayloadImport() {
  if (!payloadImportTarget) return;
  const raw = payloadText.value.trim();
  if (!raw) {
    showToast("Paste a payload first", "error");
    return;
  }

  try {
    const payload = JSON.parse(raw);
    const text = extractTextFromPayload(payload);
    if (!text) {
      showToast("Could not find text content in payload", "error");
      return;
    }
    payloadImportTarget.value = text;
    payloadImportTarget.dispatchEvent(new Event("input", { bubbles: true }));
    showToast("Payload imported", "success");
    closePayloadImport();
  } catch (err) {
    showToast("Invalid JSON: " + err.message, "error");
  }
}

document.getElementById("payload-import-confirm")?.addEventListener("click", applyPayloadImport);
document.getElementById("payload-import-cancel")?.addEventListener("click", closePayloadImport);
payloadModal?.querySelector(".payload-modal-backdrop")?.addEventListener("click", closePayloadImport);

function initPayloadImportButtons() {
  document.querySelectorAll('input[data-payload-import], textarea[data-payload-import]').forEach((el) => {
    if (el.parentElement?.querySelector('.payload-import-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'payload-import-btn';
    btn.textContent = 'Import payload';
    btn.addEventListener('click', () => openPayloadImport(el));
    el.parentElement?.appendChild(btn);
  });
}

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
    if (select.multiple) makeMultiSelectCombobox(select);
    else makeSelectSearchable(select);
  });
}

// Init
initSelectFilters();
initPayloadImportButtons();
initUser().then(() => loadGuilds().then(() => showSection("overview")));
