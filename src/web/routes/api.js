import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import os from "os";
import { ChannelType } from "discord.js";
import * as EconomyAccount from "../../models/EconomyAccount.js";
import * as AISettings from "../../models/AISettings.js";
import * as StreakSettings from "../../models/StreakSettings.js";
import * as ModerationSettings from "../../models/ModerationSettings.js";
import * as GuildSettings from "../../models/GuildSettings.js";
import * as CommandLog from "../../models/CommandLog.js";
import * as MessageLog from "../../models/MessageLog.js";
import * as VoiceSession from "../../models/VoiceSession.js";
import * as Trigger from "../../models/Trigger.js";
import * as ModerationCase from "../../models/ModerationCase.js";
import * as TicketPanel from "../../models/TicketPanel.js";
import * as Ticket from "../../models/Ticket.js";
import * as ShopCategory from "../../models/ShopCategory.js";
import * as ShopItem from "../../models/ShopItem.js";
import * as BoostSettings from "../../models/BoostSettings.js";
import { buildTicketPanelPayload } from "../../helpers/ticketPanels.js";
import { get_dominant_color } from "../../utils/color_utils.js";
import * as User from "../../models/User.js";
import { requirePermission } from "../middleware/auth.js";

const router = Router();

// Guilds list
router.get("/guilds", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guilds = Array.from(client.guilds.cache.values()).map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL?.() ?? null,
    memberCount: g.memberCount,
  }));
  res.json(guilds);
});

// Guild channels & roles for the dashboard dropdowns
router.get("/guilds/:guildId/channels", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: "Guild not found" });

  const channels = Array.from(guild.channels.cache.values())
    .filter((c) => c.isTextBased())
    .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId }));

  res.json(channels);
});

router.get("/guilds/:guildId/roles", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: "Guild not found" });

  const roles = Array.from(guild.roles.cache.values())
    .filter((r) => !r.managed && r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }));

  res.json(roles);
});

router.get("/guilds/:guildId/members", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: "Guild not found" });

  const query = req.query.q?.trim();
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  let members;

  try {
    if (query) {
      members = await guild.members.fetch({ query, limit: Math.min(limit, 100) });
    } else if (guild.memberCount <= limit) {
      members = await guild.members.fetch({ limit });
    } else {
      members = guild.members.cache;
    }
  } catch (err) {
    console.error("Guild members fetch failed:", err.message);
    members = guild.members.cache;
  }

  const result = Array.from(members.values())
    .filter((m) => !m.user.bot)
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      username: m.user.username,
      avatar: m.user.displayAvatarURL?.({ size: 64 }) ?? null,
      roles: m.roles.cache.map((r) => r.id),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  res.json(result);
});

router.post("/guilds/:guildId/resolve", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: "Guild not found" });

  const { users = [], roles = [], channels = [] } = req.body || {};
  const result = { users: {}, roles: {}, channels: {} };

  for (const id of users) {
    const member = guild.members.cache.get(id) || client.users.cache.get(id);
    if (member) {
      const user = member.user || member;
      result.users[id] = {
        id,
        displayName: member.displayName ?? user.username,
        username: user.username,
        avatar: user.displayAvatarURL?.({ size: 64 }) ?? member.displayAvatarURL?.({ size: 64 }) ?? null,
      };
    }
  }

  for (const id of roles) {
    const role = guild.roles.cache.get(id);
    if (role) result.roles[id] = { id, name: role.name, color: role.color };
  }

  for (const id of channels) {
    const channel = client.channels.cache.get(id) || guild.channels.cache.get(id);
    if (channel) result.channels[id] = { id, name: channel.name, type: channel.type };
  }

  res.json(result);
});

// Economy
router.get("/economy/:guildId", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  const top = await EconomyAccount.getLeaderboard(req.params.guildId, 50);
  const leaderboard = top.map((r) => {
    const user = client.users.cache.get(r.userId);
    const member = guild?.members.cache.get(r.userId);
    return {
      ...r,
      userName: member?.displayName ?? user?.username ?? r.userId,
      userAvatar: user?.displayAvatarURL?.({ size: 128 }) ?? null,
    };
  });
  const settings = await GuildSettings.getOrCreate(req.params.guildId);
  res.json({ settings, leaderboard });
});

router.post("/economy/:guildId", requireAuth, async (req, res) => {
  const {
    primaryName, primarySymbol, primaryEmoji,
    secondaryName, secondarySymbol, secondaryEmoji,
    dailyMin, dailyMax,
  } = req.body;
  await GuildSettings.save(req.params.guildId, {
    primaryName, primarySymbol, primaryEmoji,
    secondaryName, secondarySymbol, secondaryEmoji,
    dailyMin: dailyMin !== undefined ? Number(dailyMin) : undefined,
    dailyMax: dailyMax !== undefined ? Number(dailyMax) : undefined,
  });
  res.json({ ok: true });
});

// Emojis
router.get("/emojis/:guildId", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);

  const defaults = [
    "💰", "🪙", "💵", "💎", "⭐", "🌟", "✨", "🔮", "🧧", "🎟️",
    "🍀", "🌸", "🍬", "🍭", "🍫", "🍪", "🥇", "🥈", "🏆", "🎁",
  ];

  const guildEmojis = guild
    ? Array.from(guild.emojis.cache.values()).map((e) => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        value: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
        url: e.imageURL(),
      }))
    : [];

  res.json({ defaults, guild: guildEmojis });
});

// AI settings
router.get("/ai/:guildId", requireAuth, async (req, res) => {
  const settings = await AISettings.getOrCreate(req.params.guildId);
  res.json(settings);
});

router.post("/ai/:guildId", requireAuth, async (req, res) => {
  const { enabled, mode, channelId, customPrompt } = req.body;
  await AISettings.set(req.params.guildId, { enabled, mode, channelId, customPrompt });
  res.json({ ok: true });
});

// Streak settings
router.get("/streak/:guildId", requireAuth, async (req, res) => {
  const settings = await StreakSettings.getOrCreate(req.params.guildId);
  res.json(settings);
});

router.post("/streak/:guildId", requireAuth, async (req, res) => {
  const { enabled, trackChannelId, notifyChannelId } = req.body;
  await StreakSettings.set(req.params.guildId, { enabled, trackChannelId, notifyChannelId });
  res.json({ ok: true });
});

// Moderation cases
router.get("/moderation/cases/:guildId", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const rows = await ModerationCase.getForGuild(req.params.guildId, limit);
  const cases = rows.map((c) => {
    const target = client.users.cache.get(c.targetId);
    const moderator = client.users.cache.get(c.moderatorId);
    const targetMember = guild?.members.cache.get(c.targetId);
    const moderatorMember = guild?.members.cache.get(c.moderatorId);
    return {
      ...c,
      targetName: targetMember?.displayName ?? target?.username ?? c.targetId,
      targetAvatar: target?.displayAvatarURL?.({ size: 128 }) ?? null,
      moderatorName: moderatorMember?.displayName ?? moderator?.username ?? c.moderatorId,
      moderatorAvatar: moderator?.displayAvatarURL?.({ size: 128 }) ?? null,
    };
  });
  res.json(cases);
});

// Moderation settings
router.get("/moderation/:guildId", requireAuth, async (req, res) => {
  const settings = await ModerationSettings.getOrCreate(req.params.guildId);
  res.json(settings);
});

router.post("/moderation/:guildId", requireAuth, async (req, res) => {
  const { logChannelId, modRoleId } = req.body;
  await ModerationSettings.set(req.params.guildId, { logChannelId, modRoleId });
  res.json({ ok: true });
});

// Prefix
router.get("/prefix/:guildId", requireAuth, async (req, res) => {
  const settings = await GuildSettings.getOrCreate(req.params.guildId);
  res.json({ prefix: settings.prefix });
});

router.post("/prefix/:guildId", requireAuth, async (req, res) => {
  const { prefix } = req.body;
  await GuildSettings.setPrefix(req.params.guildId, prefix);
  res.json({ ok: true });
});

// Logs
router.get("/logs/commands/:guildId", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const { user, command, success } = req.query;
  let successVal;
  if (success === "yes") successVal = true;
  else if (success === "no") successVal = false;
  const rows = await CommandLog.getForGuild(req.params.guildId, { limit, user, command, success: successVal });
  res.json(rows);
});

router.get("/logs/messages/:guildId", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const { user, content } = req.query;
  const rows = await MessageLog.getForGuild(req.params.guildId, { limit, user, content });
  res.json(rows);
});

// Commands
router.get("/commands/:guildId", requireAuth, (req, res) => {
  const client = req.app.get("client");
  const commands = [];
  const seen = new Set();

  for (const cmd of client.commands.values()) {
    if (seen.has(cmd.data.name)) continue;
    seen.add(cmd.data.name);

    const names = new Set([cmd.data.name]);
    if (cmd.prefixName) names.add(cmd.prefixName);
    if (Array.isArray(cmd.aliases)) {
      for (const alias of cmd.aliases) names.add(alias);
    }

    commands.push({
      name: cmd.data.name,
      category: cmd.category || "misc",
      prefixName: cmd.prefixName || cmd.data.name,
      aliases: Array.isArray(cmd.aliases) ? cmd.aliases : [],
      names: Array.from(names),
    });
  }

  commands.sort((a, b) => a.name.localeCompare(b.name));
  res.json(commands);
});

// Triggers
router.get("/triggers/:guildId", requireAuth, async (req, res) => {
  const rows = await Trigger.getForGuild(req.params.guildId);
  res.json(rows);
});

router.post("/triggers/:guildId", requireAuth, async (req, res) => {
  const { keyword, commandName } = req.body;
  if (!keyword || !commandName) return res.status(400).json({ error: "keyword and commandName required" });
  await Trigger.create(req.params.guildId, keyword, commandName);
  res.json({ ok: true });
});

router.delete("/triggers/:guildId/:keyword", requireAuth, async (req, res) => {
  await Trigger.removeByKeyword(req.params.guildId, req.params.keyword);
  res.json({ ok: true });
});

// Overview
router.get("/overview", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  const msgStats = MessageLog.getStats(null, now - oneWeek);
  const voiceStats = VoiceSession.getVoiceStats(null, now - oneWeek);

  res.json({
    bot: {
      tag: client.user?.tag,
      status: client.user?.status ?? "online",
      guilds: client.guilds.cache.size,
      users: Array.from(client.guilds.cache.values()).reduce((acc, g) => acc + (g.memberCount || 0), 0),
      uptime: Math.floor(process.uptime()),
    },
    system: {
      platform: process.platform,
      node: process.version,
      memoryUsed: process.memoryUsage().heapUsed,
      memoryTotal: os.totalmem(),
      memoryFree: os.freemem(),
      cpuCount: os.cpus().length,
    },
    totals: {
      messages: msgStats.total,
      collaborators: msgStats.uniqueUsers,
      voiceHours: voiceStats.hours,
    },
  });
});

// Stats for chart
router.get("/stats", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const { days = "7" } = req.query;
  const daysNum = Math.min(Math.max(Number(days) || 7, 1), 90);
  const since = Date.now() - daysNum * 24 * 60 * 60 * 1000;

  const guilds = Array.from(client.guilds.cache.values());
  const data = await Promise.all(guilds.map(async (g) => {
    const msgStats = MessageLog.getStats(g.id, since);
    const voiceStats = VoiceSession.getVoiceStats(g.id, since);
    return {
      guildId: g.id,
      name: g.name,
      messages: msgStats.total,
      voiceHours: voiceStats.hours,
      collaborators: msgStats.uniqueUsers,
    };
  }));

  res.json({ days: daysNum, since, data });
});

router.get("/stats/:guildId", requireAuth, async (req, res) => {
  const { days = "7" } = req.query;
  const daysNum = Math.min(Math.max(Number(days) || 7, 1), 90);
  const since = Date.now() - daysNum * 24 * 60 * 60 * 1000;

  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  const msgStats = MessageLog.getStats(req.params.guildId, since);
  const voiceStats = VoiceSession.getVoiceStats(req.params.guildId, since);

  res.json({
    days: daysNum,
    since,
    data: [{
      guildId: req.params.guildId,
      name: guild?.name ?? req.params.guildId,
      messages: msgStats.total,
      voiceHours: voiceStats.hours,
      collaborators: msgStats.uniqueUsers,
    }],
  });
});

// Guild categories for ticket panels
router.get("/guilds/:guildId/categories", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return res.status(404).json({ error: "Guild not found" });

  const categories = Array.from(guild.channels.cache.values())
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }));

  res.json(categories);
});

// Ticket panels
function parsePanelBody(body) {
  return {
    name: body.name?.trim(),
    type: body.type === "cv2" ? "cv2" : "embed",
    title: body.title?.trim() || null,
    description: body.description?.trim() || null,
    color: body.color !== undefined && body.color !== null && body.color !== "" ? Number(body.color) : null,
    imageUrl: body.imageUrl?.trim() || null,
    thumbnailUrl: body.thumbnailUrl?.trim() || null,
    useDominantColor: Boolean(body.useDominantColor),
    buttonLabel: body.buttonLabel?.trim() || "Create Ticket",
    buttonColor: body.buttonColor?.trim() || "green",
    categoryId: body.categoryId?.trim() || null,
    staffRoleId: body.staffRoleId?.trim() || null,
    transcriptChannelId: body.transcriptChannelId?.trim() || null,
    welcomeMessage: body.welcomeMessage?.trim() || null,
    fields: Array.isArray(body.fields) ? body.fields.filter((f) => f?.name && f?.value) : [],
    components: Array.isArray(body.components) ? body.components : [],
    categories: Array.isArray(body.categories) ? body.categories.filter((c) => c?.label?.trim()) : [],
  };
}

router.get("/tickets/panels/:guildId", requireAuth, async (req, res) => {
  const panels = await TicketPanel.getForGuild(req.params.guildId);
  res.json(panels);
});

router.post("/tickets/panels/:guildId", requireAuth, async (req, res) => {
  const data = parsePanelBody(req.body);
  if (!data.name) return res.status(400).json({ error: "Panel name is required" });

  const existing = await TicketPanel.getByName(req.params.guildId, data.name);
  if (existing) return res.status(409).json({ error: "A panel with that name already exists" });

  const panel = await TicketPanel.create({ ...data, guildId: req.params.guildId });
  res.json(panel);
});

router.get("/tickets/panels/:guildId/:panelId", requireAuth, async (req, res) => {
  const panel = await TicketPanel.get(req.params.panelId);
  if (!panel || panel.guildId !== req.params.guildId) return res.status(404).json({ error: "Panel not found" });
  res.json(panel);
});

router.post("/tickets/panels/:guildId/:panelId", requireAuth, async (req, res) => {
  const panel = await TicketPanel.get(req.params.panelId);
  if (!panel || panel.guildId !== req.params.guildId) return res.status(404).json({ error: "Panel not found" });

  const data = parsePanelBody(req.body);
  if (data.name) {
    const existing = await TicketPanel.getByName(req.params.guildId, data.name);
    if (existing && existing.id !== panel.id) return res.status(409).json({ error: "A panel with that name already exists" });
  }

  const updated = await TicketPanel.update(req.params.panelId, data);
  res.json(updated);
});

router.delete("/tickets/panels/:guildId/:panelId", requireAuth, async (req, res) => {
  const panel = await TicketPanel.get(req.params.panelId);
  if (!panel || panel.guildId !== req.params.guildId) return res.status(404).json({ error: "Panel not found" });
  await TicketPanel.remove(req.params.panelId);
  res.json({ ok: true });
});

router.post("/tickets/dominant-color/:guildId", requireAuth, async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
  try {
    const color = await get_dominant_color(imageUrl);
    res.json({ color });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/tickets/panels/:guildId/preview", requireAuth, async (req, res) => {
  const data = parsePanelBody(req.body);
  const panel = { ...data, id: 0, guildId: req.params.guildId };
  const payload = await buildTicketPanelPayload(panel, "ticket:create:preview");
  res.json({ payload });
});

router.post("/tickets/panels/:guildId/:panelId/preview", requireAuth, async (req, res) => {
  const panel = await TicketPanel.get(req.params.panelId);
  if (!panel || panel.guildId !== req.params.guildId) return res.status(404).json({ error: "Panel not found" });

  const customId = `ticket:create:${panel.id}`;
  const payload = await buildTicketPanelPayload(panel, customId);
  res.json({ payload });
});

router.post("/tickets/panels/:guildId/:panelId/send", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const panel = await TicketPanel.get(req.params.panelId);
  if (!panel || panel.guildId !== req.params.guildId) return res.status(404).json({ error: "Panel not found" });

  const { channelId } = req.body;
  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return res.status(400).json({ error: "Invalid channel" });

  const customId = `ticket:create:${panel.id}`;
  const payload = await buildTicketPanelPayload(panel, customId);

  await channel.send(payload);
  res.json({ ok: true });
});

// Tickets
router.get("/tickets/:guildId", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const rows = await Ticket.getForGuild(req.params.guildId, limit);
  res.json(rows);
});

function parseSpecialCommands(input) {
  if (Array.isArray(input)) return input.map((s) => String(s).trim()).filter(Boolean);
  if (typeof input === "string" && input.trim()) {
    return input.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// Shop categories
router.get("/shop/categories/:guildId", requireAuth, async (req, res) => {
  const categories = await ShopCategory.getByGuild(req.params.guildId);
  const items = await ShopItem.getByGuild(req.params.guildId);
  const withItems = categories.map((c) => ({ ...c, items: items.filter((i) => i.categoryId === c.id) }));
  res.json(withItems);
});

router.post("/shop/categories/:guildId", requireAuth, async (req, res) => {
  const { name, description, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Category name is required" });
  const category = await ShopCategory.create({
    guildId: req.params.guildId,
    name: name.trim(),
    description: description?.trim() || "",
    sortOrder: Number(sortOrder) || 0,
  });
  res.json(category);
});

router.put("/shop/categories/:guildId/:categoryId", requireAuth, async (req, res) => {
  const category = await ShopCategory.getById(Number(req.params.categoryId));
  if (!category || category.guildId !== req.params.guildId) return res.status(404).json({ error: "Category not found" });
  const { name, description, sortOrder } = req.body;
  const updated = await ShopCategory.update(category.id, {
    name: name?.trim() ?? category.name,
    description: description?.trim() ?? category.description,
    sortOrder: sortOrder !== undefined ? Number(sortOrder) : category.sortOrder,
  });
  res.json(updated);
});

router.delete("/shop/categories/:guildId/:categoryId", requireAuth, async (req, res) => {
  const category = await ShopCategory.getById(Number(req.params.categoryId));
  if (!category || category.guildId !== req.params.guildId) return res.status(404).json({ error: "Category not found" });
  const items = await ShopItem.getByCategory(req.params.guildId, category.id);
  for (const item of items) await ShopItem.remove(item.id);
  await ShopCategory.remove(category.id);
  res.json({ ok: true });
});

// Shop items
router.post("/shop/items/:guildId/:categoryId", requireAuth, async (req, res) => {
  const category = await ShopCategory.getById(Number(req.params.categoryId));
  if (!category || category.guildId !== req.params.guildId) return res.status(404).json({ error: "Category not found" });

  const {
    name, description, price, priceSecondary, roleId,
    multiplierType, multiplierValue, specialCommands, stock, maxPurchases, requiresRoleId, sortOrder,
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "Item name is required" });

  const asNumberOrNull = (v) => (v === undefined || v === null || v === "" ? null : Math.max(0, Number(v)));

  const item = await ShopItem.create({
    guildId: req.params.guildId,
    categoryId: category.id,
    name: name.trim(),
    description: description?.trim() || "",
    price: Math.max(0, Number(price) || 0),
    priceSecondary: asNumberOrNull(priceSecondary),
    roleId: roleId?.trim() || null,
    multiplierType: ["earnings", "level"].includes(multiplierType) ? multiplierType : null,
    multiplierValue: multiplierValue !== undefined && multiplierValue !== null && multiplierValue !== "" ? Number(multiplierValue) : null,
    specialCommands: parseSpecialCommands(specialCommands),
    stock: asNumberOrNull(stock),
    maxPurchases: asNumberOrNull(maxPurchases),
    requiresRoleId: requiresRoleId?.trim() || null,
    sortOrder: Number(sortOrder) || 0,
  });
  res.json(item);
});

router.put("/shop/items/:guildId/:itemId", requireAuth, async (req, res) => {
  const item = await ShopItem.getById(Number(req.params.itemId));
  if (!item || item.guildId !== req.params.guildId) return res.status(404).json({ error: "Item not found" });

  const {
    name, description, price, priceSecondary, roleId,
    multiplierType, multiplierValue, specialCommands, stock, maxPurchases, requiresRoleId, sortOrder,
  } = req.body;

  const asNumberOrNull = (v) => (v === undefined || v === null || v === "" ? null : Math.max(0, Number(v)));

  const values = {};
  if (name !== undefined) values.name = name.trim();
  if (description !== undefined) values.description = description?.trim() || "";
  if (price !== undefined) values.price = Math.max(0, Number(price) || 0);
  if (priceSecondary !== undefined) values.priceSecondary = asNumberOrNull(priceSecondary);
  if (roleId !== undefined) values.roleId = roleId?.trim() || null;
  if (multiplierType !== undefined) values.multiplierType = ["earnings", "level"].includes(multiplierType) ? multiplierType : null;
  if (multiplierValue !== undefined) values.multiplierValue = multiplierValue !== undefined && multiplierValue !== null && multiplierValue !== "" ? Number(multiplierValue) : null;
  if (specialCommands !== undefined) values.specialCommands = parseSpecialCommands(specialCommands);
  if (stock !== undefined) values.stock = asNumberOrNull(stock);
  if (maxPurchases !== undefined) values.maxPurchases = asNumberOrNull(maxPurchases);
  if (requiresRoleId !== undefined) values.requiresRoleId = requiresRoleId?.trim() || null;
  if (sortOrder !== undefined) values.sortOrder = Number(sortOrder) || 0;

  const updated = await ShopItem.update(item.id, values);
  res.json(updated);
});

router.delete("/shop/items/:guildId/:itemId", requireAuth, async (req, res) => {
  const item = await ShopItem.getById(Number(req.params.itemId));
  if (!item || item.guildId !== req.params.guildId) return res.status(404).json({ error: "Item not found" });
  await ShopItem.remove(item.id);
  res.json({ ok: true });
});

// Shop settings (channel + enabled)
router.get("/shop/settings/:guildId", requireAuth, async (req, res) => {
  const settings = await GuildSettings.getOrCreate(req.params.guildId);
  res.json({
    shopChannelId: settings.shopChannelId,
    shopMessageId: settings.shopMessageId,
    shopInterfaceEnabled: settings.shopInterfaceEnabled,
    shopInterfaceComponents: settings.shopInterfaceComponents,
    shopInterfaceColor: settings.shopInterfaceColor,
    shopInterfaceUseDominantColor: settings.shopInterfaceUseDominantColor,
  });
});

router.post("/shop/settings/:guildId", requireAuth, async (req, res) => {
  const { shopChannelId, shopInterfaceEnabled, shopInterfaceComponents, shopInterfaceColor, shopInterfaceUseDominantColor } = req.body;
  await GuildSettings.save(req.params.guildId, {
    shopChannelId: shopChannelId?.trim() || null,
    shopInterfaceEnabled: shopInterfaceEnabled !== undefined ? Boolean(shopInterfaceEnabled) : undefined,
    shopInterfaceComponents: Array.isArray(shopInterfaceComponents) ? shopInterfaceComponents : undefined,
    shopInterfaceColor: shopInterfaceColor !== undefined && shopInterfaceColor !== "" ? Number(shopInterfaceColor) : undefined,
    shopInterfaceUseDominantColor: shopInterfaceUseDominantColor !== undefined ? Boolean(shopInterfaceUseDominantColor) : undefined,
  });
  res.json({ ok: true });
});

// Users
router.get("/users", requireAuth, requirePermission("users"), async (req, res) => {
  const users = await User.getAll();
  res.json(users.map((u) => ({ id: u.id, username: u.username, permissions: u.permissions, createdAt: u.createdAt })));
});

router.get("/users/permissions", requireAuth, (req, res) => {
  res.json({ permissions: User.ALL_PERMISSIONS, user: req.user });
});

router.get("/users/:id", requireAuth, requirePermission("users"), async (req, res) => {
  const user = await User.get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, username: user.username, permissions: user.permissions, createdAt: user.createdAt });
});

router.post("/users", requireAuth, requirePermission("users"), async (req, res) => {
  const { username, password, permissions } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const existing = await User.getByUsername(username);
  if (existing) return res.status(409).json({ error: "Username already exists" });
  try {
    const user = await User.create({ username, password, permissions });
    res.json({ id: user.id, username: user.username, permissions: user.permissions, createdAt: user.createdAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/users/:id", requireAuth, requirePermission("users"), async (req, res) => {
  const user = await User.get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  const { username, password, permissions } = req.body || {};
  try {
    const updated = await User.update(user.id, { username, password, permissions });
    res.json({ id: updated.id, username: updated.username, permissions: updated.permissions, createdAt: updated.createdAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/users/:id", requireAuth, requirePermission("users"), async (req, res) => {
  const user = await User.get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  await User.remove(user.id);
  res.json({ ok: true });
});

// Boost settings
router.get("/boost/:guildId", requireAuth, async (req, res) => {
  const settings = await BoostSettings.getOrCreate(req.params.guildId);
  res.json(settings);
});

router.post("/boost/:guildId", requireAuth, async (req, res) => {
  const {
    enabled, rewardPrimary, rewardSecondary, roleId,
    earningsMultiplier, level, specialCommands, messageChannelId, thankMessage,
  } = req.body;

  await BoostSettings.save(req.params.guildId, {
    enabled: enabled !== undefined ? Boolean(enabled) : undefined,
    rewardPrimary: rewardPrimary !== undefined ? Math.max(0, Number(rewardPrimary) || 0) : undefined,
    rewardSecondary: rewardSecondary !== undefined ? Math.max(0, Number(rewardSecondary) || 0) : undefined,
    roleId: roleId?.trim() || null,
    earningsMultiplier: earningsMultiplier !== undefined ? Number(earningsMultiplier) || 0 : undefined,
    level: level !== undefined ? Number(level) || 0 : undefined,
    specialCommands: specialCommands !== undefined ? parseSpecialCommands(specialCommands) : undefined,
    messageChannelId: messageChannelId?.trim() || null,
    thankMessage: thankMessage?.trim() || null,
  });

  res.json({ ok: true });
});

export default router;
