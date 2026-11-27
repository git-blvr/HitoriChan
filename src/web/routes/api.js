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
import { fetchGuildMembers } from "../../utils/discordCache.js";
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
import * as Session from "../../models/DashboardSession.js";
import * as Audit from "../../models/AuditLog.js";
import { revokeAllSessionsForUser } from "../auth.js";
import { MAIN_GUILD_ID } from "../oauth.js";
import * as Quest from "../../models/Quest.js";
import * as QuestProgress from "../../models/QuestProgress.js";
import * as QuestBoard from "../../models/QuestBoard.js";
import { updateQuestBoard } from "../../utils/questBoard.js";
import * as LevelingSettings from "../../models/LevelingSettings.js";
import * as LevelReward from "../../models/LevelReward.js";
import * as XpModifier from "../../models/XpModifier.js";
import { invalidateModifierCache } from "../../utils/leveling.js";
import * as MarriageSettings from "../../models/MarriageSettings.js";
import * as InteractionSettings from "../../models/InteractionSettings.js";
import * as MessageTemplate from "../../models/MessageTemplate.js";
import { DEFAULT_INTERACTIONS } from "../../utils/interactions.js";
import { requirePermission, sessionGuildEntry } from "../middleware/auth.js";
import { buildCV2Components } from "../../helpers/cv2.js";
import { cv2 } from "../../helpers/cv2.js";
import { safeFetch } from "../../utils/safeFetch.js";
import { ActivityType } from "discord.js";
import gifmakerRouter from "./gifmaker.js";

const router = Router();

router.use("/gifmaker", gifmakerRouter);

// ---------------------------------------------------------------------------
// Auth / session management (any authenticated user)
// ---------------------------------------------------------------------------
router.get("/auth/me", requireAuth, (req, res) => {
  res.json({
    user: {
      username: req.user.username,
      displayName: req.user.displayName,
      avatar: req.user.avatar,
      discordId: req.user.discordId,
      authType: req.user.authType,
      isDeveloper: req.user.isDeveloper,
      mainGuildId: req.user.isDeveloper ? MAIN_GUILD_ID : null,
      isAdmin: req.user.isAdmin,
      permissions: req.user.permissions,
      guilds: req.user.guilds,
    },
    session: {
      id: req.session.id,
      createdAt: req.session.createdAt,
      lastSeenAt: req.session.lastSeenAt,
      expiresAt: req.session.expiresAt,
      ip: req.session.ip,
      userAgent: req.session.userAgent,
    },
  });
});

router.post("/auth/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (req.user.authType === "discord") {
    return res.status(400).json({ error: "This account signs in with Discord — there is no local password." });
  }
  if (req.user.isAdmin) {
    return res.status(400).json({
      error: "The bootstrap admin password is generated at startup. Set DASHBOARD_PASSWORD in the environment to choose a persistent one.",
    });
  }
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Current and new password are required" });
  }
  const user = await User.getByUsername(req.user.username);
  if (!user) return res.status(404).json({ error: "User not found" });
  const verified = await User.verify(user.username, currentPassword);
  if (!verified) return res.status(401).json({ error: "Current password is incorrect" });
  const policyError = User.passwordPolicyError(newPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  await User.update(user.id, { password: newPassword });
  revokeAllSessionsForUser(user.username, req.session.id);
  Audit.add({ actor: req.user.username, action: "auth.password.change", ip: req.ip });
  res.json({ ok: true });
});

router.get("/auth/sessions", requireAuth, (req, res) => {
  const sessions = Session.listForUser(req.user.username).map((s) => ({ ...s, current: s.id === req.session.id }));
  res.json(sessions);
});

router.delete("/auth/sessions/:id", requireAuth, (req, res) => {
  const session = Session.getById(Number(req.params.id));
  if (!session || session.username !== req.user.username) {
    return res.status(404).json({ error: "Session not found" });
  }
  Session.revoke(session.id);
  Audit.add({ actor: req.user.username, action: "auth.session.revoke", detail: `session=${session.id}`, ip: req.ip });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Security administration (privileged)
// ---------------------------------------------------------------------------
router.get("/security/sessions", requireAuth, requirePermission("users"), (req, res) => {
  const sessions = Session.listAll().map((s) => ({ ...s, current: s.id === req.session.id }));
  res.json(sessions);
});

router.delete("/security/sessions/:id", requireAuth, requirePermission("users"), (req, res) => {
  const session = Session.getById(Number(req.params.id));
  if (!session) return res.status(404).json({ error: "Session not found" });
  Session.revoke(session.id);
  Audit.add({ actor: req.user.username, action: "security.session.revoke", detail: `session=${session.id} user=${session.username}`, ip: req.ip });
  res.json({ ok: true });
});

router.get("/security/audit", requireAuth, requirePermission("security"), (req, res) => {
  const { limit, action, actor } = req.query;
  res.json(Audit.list({ limit, action, actor }));
});

// Guilds the session is allowed to see. Admins/developers/local users get
// everything; Discord sign-ins get only the guilds they owned or managed at
// login. Session entries are { id, role } objects (plain ids in old sessions).
function accessibleGuilds(client, user) {
  const all = Array.from(client.guilds.cache.values());
  if (!user || user.isAdmin || user.isDeveloper || user.guilds == null) return all;
  const allowed = new Set(user.guilds.map((g) => String(g?.id ?? g)));
  return all.filter((g) => allowed.has(g.id));
}

// Persisted channel/role references must belong to the guild being edited —
// otherwise a scoped owner could point logs/welcomes/transcripts at channels
// in a guild outside their ACL.
async function channelBelongsToGuild(client, guildId, channelId) {
  if (channelId == null || channelId === "") return true;
  let channel = client.channels.cache.get(channelId);
  if (!channel && typeof client.channels.fetch === "function") {
    channel = await client.channels.fetch(channelId).catch(() => null);
  }
  const owner = channel?.guildId ?? channel?.guild?.id ?? null;
  return owner === guildId;
}

async function roleBelongsToGuild(guild, roleId) {
  if (roleId == null || roleId === "") return true;
  if (!guild) return false;
  if (guild.roles.cache.has(roleId)) return true;
  if (typeof guild.roles.fetch === "function") {
    return Boolean(await guild.roles.fetch(roleId).catch(() => null));
  }
  return false;
}

async function channelsInGuild(req, ids) {
  const client = req.app.get("client");
  for (const id of ids) {
    if (!(await channelBelongsToGuild(client, req.params.guildId, id))) return false;
  }
  return true;
}

// Guilds list
router.get("/guilds", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guilds = accessibleGuilds(client, req.user).map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL?.() ?? null,
    memberCount: g.memberCount,
    // Owner/manager badge for scoped Discord sessions; null when unrestricted.
    role: sessionGuildEntry(req.user, g.id)?.role ?? null,
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
  const members = await fetchGuildMembers(guild, { query, limit });

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
    const member = guild.members.cache.get(id) || (req.user.guilds == null ? client.users.cache.get(id) : null);
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
    const channel = guild.channels.cache.get(id);
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
  if (!(await channelsInGuild(req, [channelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
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
  if (!(await channelsInGuild(req, [trackChannelId, notifyChannelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
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
  if (!(await channelsInGuild(req, [logChannelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
  const guild = req.app.get("client").guilds.cache.get(req.params.guildId);
  if (!(await roleBelongsToGuild(guild, modRoleId))) {
    return res.status(400).json({ error: "Role does not belong to this server" });
  }
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

  const scope = accessibleGuilds(client, req.user);
  const globalScope = scope.length === client.guilds.cache.size;
  const msgStats = globalScope
    ? MessageLog.getStats(null, now - oneWeek)
    : scope.reduce((acc, g) => {
        const s = MessageLog.getStats(g.id, now - oneWeek);
        acc.total += s.total;
        acc.uniqueUsers += s.uniqueUsers;
        return acc;
      }, { total: 0, uniqueUsers: 0 });
  const voiceStats = globalScope
    ? VoiceSession.getVoiceStats(null, now - oneWeek)
    : scope.reduce((acc, g) => {
        const s = VoiceSession.getVoiceStats(g.id, now - oneWeek);
        acc.hours += s.hours;
        return acc;
      }, { hours: 0 });

  res.json({
    bot: {
      tag: client.user?.tag,
      status: client.user?.status ?? "online",
      guilds: scope.length,
      users: scope.reduce((acc, g) => acc + (g.memberCount || 0), 0),
      uptime: Math.floor(process.uptime()),
      ping: client.ws.ping ?? -1,
      apiStatus: client.ws.ping >= 0 ? "ok" : "degraded",
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

// Live vitals for the overview hero (per-guild when :guildId is given)
router.get(["/vitals", "/vitals/:guildId"], requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const guildId = req.params.guildId || null;
  const guild = guildId ? client.guilds.cache.get(guildId) : null;

  const scope = accessibleGuilds(client, req.user);

  const now = Date.now();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  const body = {
    bot: {
      tag: client.user?.tag ?? "—",
      avatar: client.user?.displayAvatarURL?.({ size: 64 }) ?? null,
      status: client.user?.status ?? "online",
      ping: client.ws.ping ?? -1,
      uptime: Math.floor(process.uptime()),
      guilds: scope.length,
      users: scope.reduce((acc, g) => acc + (g.memberCount || 0), 0),
    },
    commands: {
      registered: client.commands?.size ?? 0,
      today: guildId ? CommandLog.countForGuild(guildId, dayStart) : null,
      yesterday: guildId ? CommandLog.countForGuild(guildId, dayStart - dayMs, dayStart) : null,
    },
    tickets: { open: guildId ? await Ticket.countByStatus(guildId, "open") : null },
  };

  if (guild) {
    const channels = Array.from(guild.channels.cache.values());
    const voiceChannels = channels.filter((c) => c.isVoiceBased?.() ?? (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice));
    const activeTimeouts = guild.members.cache.filter(
      (m) => m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > now
    ).size;

    body.guild = {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL?.() ?? null,
      memberCount: guild.memberCount ?? null,
      boostCount: guild.premiumSubscriptionCount ?? null,
      boostTier: guild.premiumTier ?? null,
      roleCount: guild.roles.cache.size,
      channelCount: guild.channels.cache.size,
      afkChannelId: guild.afkChannelId ?? null,
      afkMembers: guild.afkChannel?.members?.size ?? 0,
      voiceActive: voiceChannels.reduce((acc, c) => acc + (c.members?.size ?? 0), 0),
      activeTimeouts,
    };
  } else {
    body.guild = null;
  }

  res.json(body);
});

// Stats for chart
router.get("/stats", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const { days = "7" } = req.query;
  const daysNum = Math.min(Math.max(Number(days) || 7, 1), 90);
  const since = Date.now() - daysNum * 24 * 60 * 60 * 1000;

  const guilds = accessibleGuilds(client, req.user);
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
    useCategoryDropdown: Boolean(body.useCategoryDropdown),
    buttonLabel: body.buttonLabel?.trim() || "Create Ticket",
    buttonColor: body.buttonColor?.trim() || "green",
    categoryId: body.categoryId?.trim() || null,
    staffRoleId: body.staffRoleId?.trim() || null,
    staffRoleIds: Array.isArray(body.staffRoleIds) ? body.staffRoleIds.filter(Boolean) : [],
    transcriptChannelId: body.transcriptChannelId?.trim() || null,
    welcomeMessage: body.welcomeMessage?.trim() || null,
    welcomeType: body.welcomeType === "cv2" ? "cv2" : "embed",
    welcomeTitle: body.welcomeTitle?.trim() || null,
    welcomeColor: body.welcomeColor !== undefined && body.welcomeColor !== null && body.welcomeColor !== "" ? Number(body.welcomeColor) : null,
    welcomeImageUrl: body.welcomeImageUrl?.trim() || null,
    welcomeThumbnailUrl: body.welcomeThumbnailUrl?.trim() || null,
    welcomeUseDominantColor: Boolean(body.welcomeUseDominantColor),
    fields: Array.isArray(body.fields) ? body.fields.filter((f) => f?.name && f?.value) : [],
    components: Array.isArray(body.components) ? body.components : [],
    categories: Array.isArray(body.categories) ? body.categories.filter((c) => c?.label?.trim()) : [],
  };
}

router.get("/tickets/panels/:guildId", requireAuth, async (req, res) => {
  const panels = await TicketPanel.getForGuild(req.params.guildId);
  res.json(panels);
});

async function panelRefsValid(req, data) {
  if (!(await channelsInGuild(req, [data.categoryId, data.transcriptChannelId]))) return false;
  const guild = req.app.get("client").guilds.cache.get(req.params.guildId);
  for (const id of [data.staffRoleId, ...(data.staffRoleIds || [])]) {
    if (!(await roleBelongsToGuild(guild, id))) return false;
  }
  return true;
}

router.post("/tickets/panels/:guildId", requireAuth, async (req, res) => {
  const data = parsePanelBody(req.body);
  if (!data.name) return res.status(400).json({ error: "Panel name is required" });
  if (!(await panelRefsValid(req, data))) {
    return res.status(400).json({ error: "Channel or role does not belong to this server" });
  }

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
  if (!(await panelRefsValid(req, data))) {
    return res.status(400).json({ error: "Channel or role does not belong to this server" });
  }
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
  const channelGuildId = channel.guildId ?? channel.guild?.id ?? null;
  if (channelGuildId !== req.params.guildId) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }

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
    multiplierType, multiplierValue, specialCommands, stock, maxPurchases, requiresRoleId, sortOrder, expiryDuration,
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
    expiryDuration: asNumberOrNull(expiryDuration),
  });
  res.json(item);
});

router.put("/shop/items/:guildId/:itemId", requireAuth, async (req, res) => {
  const item = await ShopItem.getById(Number(req.params.itemId));
  if (!item || item.guildId !== req.params.guildId) return res.status(404).json({ error: "Item not found" });

  const {
    name, description, price, priceSecondary, roleId,
    multiplierType, multiplierValue, specialCommands, stock, maxPurchases, requiresRoleId, sortOrder, expiryDuration,
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
  if (expiryDuration !== undefined) values.expiryDuration = asNumberOrNull(expiryDuration);

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
  if (!(await channelsInGuild(req, [shopChannelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
  await GuildSettings.save(req.params.guildId, {
    shopChannelId: shopChannelId?.trim() || null,
    shopInterfaceEnabled: shopInterfaceEnabled !== undefined ? Boolean(shopInterfaceEnabled) : undefined,
    shopInterfaceComponents: Array.isArray(shopInterfaceComponents) ? shopInterfaceComponents : undefined,
    shopInterfaceColor: shopInterfaceColor !== undefined && shopInterfaceColor !== "" ? Number(shopInterfaceColor) : undefined,
    shopInterfaceUseDominantColor: shopInterfaceUseDominantColor !== undefined ? Boolean(shopInterfaceUseDominantColor) : undefined,
  });
  res.json({ ok: true });
});

// Welcome / Goodbye settings
router.get("/welcome/:guildId", requireAuth, async (req, res) => {
  const settings = await GuildSettings.getOrCreate(req.params.guildId);
  res.json({
    welcomeEnabled: settings.welcomeEnabled,
    welcomeChannelId: settings.welcomeChannelId,
    welcomeTitle: settings.welcomeTitle,
    welcomeDescription: settings.welcomeDescription,
    welcomeColor: settings.welcomeColor,
    welcomeUseDominantColor: settings.welcomeUseDominantColor,
    welcomeComponents: settings.welcomeComponents,
    goodbyeEnabled: settings.goodbyeEnabled,
    goodbyeChannelId: settings.goodbyeChannelId,
    goodbyeTitle: settings.goodbyeTitle,
    goodbyeDescription: settings.goodbyeDescription,
    goodbyeColor: settings.goodbyeColor,
    goodbyeUseDominantColor: settings.goodbyeUseDominantColor,
    goodbyeComponents: settings.goodbyeComponents,
  });
});

router.post("/welcome/:guildId", requireAuth, async (req, res) => {
  const values = req.body || {};
  if (!(await channelsInGuild(req, [values.welcomeChannelId, values.goodbyeChannelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
  await GuildSettings.save(req.params.guildId, {
    welcomeEnabled: values.welcomeEnabled !== undefined ? Boolean(values.welcomeEnabled) : undefined,
    welcomeChannelId: values.welcomeChannelId !== undefined ? (values.welcomeChannelId?.trim() || null) : undefined,
    welcomeTitle: values.welcomeTitle !== undefined ? (values.welcomeTitle?.trim() || null) : undefined,
    welcomeDescription: values.welcomeDescription !== undefined ? (values.welcomeDescription?.trim() || null) : undefined,
    welcomeColor: values.welcomeColor !== undefined && values.welcomeColor !== "" ? Number(values.welcomeColor) : undefined,
    welcomeUseDominantColor: values.welcomeUseDominantColor !== undefined ? Boolean(values.welcomeUseDominantColor) : undefined,
    welcomeComponents: values.welcomeComponents !== undefined ? (Array.isArray(values.welcomeComponents) ? values.welcomeComponents : []) : undefined,
    goodbyeEnabled: values.goodbyeEnabled !== undefined ? Boolean(values.goodbyeEnabled) : undefined,
    goodbyeChannelId: values.goodbyeChannelId !== undefined ? (values.goodbyeChannelId?.trim() || null) : undefined,
    goodbyeTitle: values.goodbyeTitle !== undefined ? (values.goodbyeTitle?.trim() || null) : undefined,
    goodbyeDescription: values.goodbyeDescription !== undefined ? (values.goodbyeDescription?.trim() || null) : undefined,
    goodbyeColor: values.goodbyeColor !== undefined && values.goodbyeColor !== "" ? Number(values.goodbyeColor) : undefined,
    goodbyeUseDominantColor: values.goodbyeUseDominantColor !== undefined ? Boolean(values.goodbyeUseDominantColor) : undefined,
    goodbyeComponents: values.goodbyeComponents !== undefined ? (Array.isArray(values.goodbyeComponents) ? values.goodbyeComponents : []) : undefined,
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
  if (User.isReservedUsername(username)) return res.status(400).json({ error: "That username is reserved" });
  const usernameError = User.usernamePolicyError(username);
  if (usernameError) return res.status(400).json({ error: usernameError });
  const passwordError = User.passwordPolicyError(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const existing = await User.getByUsername(username);
  if (existing) return res.status(409).json({ error: "Username already exists" });
  try {
    const user = await User.create({ username, password, permissions });
    Audit.add({ actor: req.user.username, action: "user.create", detail: `user=${user.username}`, ip: req.ip });
    res.json({ id: user.id, username: user.username, permissions: user.permissions, createdAt: user.createdAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/users/:id", requireAuth, requirePermission("users"), async (req, res) => {
  const user = await User.get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  const { username, password, permissions } = req.body || {};
  if (username !== undefined && User.isReservedUsername(username)) {
    return res.status(400).json({ error: "That username is reserved" });
  }
  if (username !== undefined) {
    const usernameError = User.usernamePolicyError(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const clash = await User.getByUsername(username);
    if (clash && clash.id !== user.id) return res.status(409).json({ error: "Username already exists" });
  }
  if (password !== undefined && password !== "") {
    const passwordError = User.passwordPolicyError(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
  }
  try {
    const updated = await User.update(user.id, { username, password: password || undefined, permissions });
    revokeAllSessionsForUser(user.username);
    if (username && username !== user.username) revokeAllSessionsForUser(username);
    Audit.add({ actor: req.user.username, action: "user.update", detail: `user=${updated.username}`, ip: req.ip });
    res.json({ id: updated.id, username: updated.username, permissions: updated.permissions, createdAt: updated.createdAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/users/:id", requireAuth, requirePermission("users"), async (req, res) => {
  const user = await User.get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  await User.remove(user.id);
  revokeAllSessionsForUser(user.username);
  Audit.add({ actor: req.user.username, action: "user.delete", detail: `user=${user.username}`, ip: req.ip });
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

  if (!(await channelsInGuild(req, [messageChannelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
  const guild = req.app.get("client").guilds.cache.get(req.params.guildId);
  if (!(await roleBelongsToGuild(guild, roleId))) {
    return res.status(400).json({ error: "Role does not belong to this server" });
  }

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

// Quests
router.get("/quests/:guildId", requireAuth, async (req, res) => {
  const quests = await Quest.getAllForGuild(req.params.guildId);
  res.json(quests);
});

router.post("/quests/:guildId", requireAuth, requirePermission("quests"), async (req, res) => {
  const { name, description, schedule, dsl, condition, variables, tasks, rewardType, rewardValue, rewardAmount, completionMessage, enabled } = req.body || {};
  if (!name || !schedule) return res.status(400).json({ error: "Name and schedule are required" });
  try {
    const quest = await Quest.create({
      guildId: req.params.guildId,
      name,
      description,
      schedule,
      dsl,
      condition,
      variables,
      tasks,
      rewardType,
      rewardValue,
      rewardAmount,
      completionMessage,
      enabled,
    });
    await updateQuestBoard(req.app.get("client"), req.params.guildId);
    res.json(quest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/quests/:guildId/:id/progress", requireAuth, requirePermission("quests"), async (req, res) => {
  const quest = await Quest.get(Number(req.params.id));
  if (!quest || quest.guildId !== req.params.guildId) return res.status(404).json({ error: "Quest not found" });
  const progress = await QuestProgress.getAllForQuest(quest.id);
  res.json(progress);
});

router.get("/quests/:guildId/board", requireAuth, requirePermission("quests"), async (req, res) => {
  const board = await QuestBoard.getOrCreate(req.params.guildId);
  res.json(board);
});

router.post("/quests/:guildId/board", requireAuth, requirePermission("quests"), async (req, res) => {
  const { channelId, enabled } = req.body || {};
  if (!(await channelsInGuild(req, [channelId]))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }
  await QuestBoard.save(req.params.guildId, { channelId, enabled });
  const messageId = await updateQuestBoard(req.app.get("client"), req.params.guildId);
  res.json({ ok: true, messageId });
});

router.get("/quests/:guildId/:id", requireAuth, async (req, res) => {
  const quest = await Quest.get(Number(req.params.id));
  if (!quest || quest.guildId !== req.params.guildId) return res.status(404).json({ error: "Quest not found" });
  res.json(quest);
});

router.post("/quests/:guildId/:id", requireAuth, requirePermission("quests"), async (req, res) => {
  const quest = await Quest.get(Number(req.params.id));
  if (!quest || quest.guildId !== req.params.guildId) return res.status(404).json({ error: "Quest not found" });
  try {
    const updated = await Quest.update(quest.id, req.body);
    await updateQuestBoard(req.app.get("client"), req.params.guildId);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/quests/:guildId/:id", requireAuth, requirePermission("quests"), async (req, res) => {
  const quest = await Quest.get(Number(req.params.id));
  if (!quest || quest.guildId !== req.params.guildId) return res.status(404).json({ error: "Quest not found" });
  await Quest.remove(quest.id);
  await QuestProgress.deleteForQuest(quest.id);
  await updateQuestBoard(req.app.get("client"), req.params.guildId);
  res.json({ ok: true });
});

// Leveling
router.get("/leveling/:guildId/settings", requireAuth, requirePermission("leveling"), async (req, res) => {
  const settings = await LevelingSettings.getOrCreate(req.params.guildId);
  res.json(settings);
});

router.post("/leveling/:guildId/settings", requireAuth, requirePermission("leveling"), async (req, res) => {
  try {
    const settings = await LevelingSettings.save(req.params.guildId, req.body || {});
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/leveling/:guildId/leaderboard", requireAuth, requirePermission("leveling"), async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const leaderboard = await EconomyAccount.getLevelLeaderboard(req.params.guildId, limit);
  res.json(leaderboard);
});

// Level rewards — roles or currency granted when a member reaches a level.
async function validateLevelReward(req, values, existing = {}) {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return { error: "Guild not found", status: 404 };

  const rewardType = values.rewardType ?? existing.rewardType;
  if (!LevelReward.REWARD_TYPES.includes(rewardType)) {
    return { error: "Reward type must be role or currency" };
  }

  const level = values.level ?? existing.level;
  if (!Number.isFinite(Number(level)) || Number(level) < 1 || Number(level) > 9999) {
    return { error: "Level must be between 1 and 9999" };
  }

  const body = { level: Math.floor(Number(level)), rewardType };

  if (rewardType === "role") {
    const roleId = values.roleId ?? existing.roleId;
    if (!roleId) return { error: "Pick a role for the reward" };
    if (!(await roleBelongsToGuild(guild, roleId))) {
      return { error: "Role does not belong to this server" };
    }
    body.roleId = roleId;
    body.currency = null;
    body.amount = 0;
  } else {
    const currency = values.currency ?? existing.currency;
    if (!LevelReward.CURRENCIES.includes(currency)) {
      return { error: "Currency must be primary or secondary" };
    }
    const amount = values.amount ?? existing.amount;
    if (!Number.isFinite(Number(amount)) || Number(amount) < 1) {
      return { error: "Amount must be a positive number" };
    }
    body.currency = currency;
    body.amount = Math.floor(Number(amount));
    body.roleId = null;
  }

  if (values.enabled !== undefined) body.enabled = Boolean(values.enabled);
  return { body };
}

router.get("/leveling/:guildId/rewards", requireAuth, requirePermission("leveling"), async (req, res) => {
  res.json(await LevelReward.listForGuild(req.params.guildId));
});

router.post("/leveling/:guildId/rewards", requireAuth, requirePermission("leveling"), async (req, res) => {
  const { body, error, status } = await validateLevelReward(req, req.body || {});
  if (error) return res.status(status || 400).json({ error });
  const reward = await LevelReward.create(req.params.guildId, { ...body, enabled: req.body?.enabled });
  res.json(reward);
});

router.post("/leveling/:guildId/rewards/:id", requireAuth, requirePermission("leveling"), async (req, res) => {
  const reward = await LevelReward.get(Number(req.params.id));
  if (!reward || reward.guildId !== req.params.guildId) {
    return res.status(404).json({ error: "Reward not found" });
  }
  const { body, error, status } = await validateLevelReward(req, req.body || {}, reward);
  if (error) return res.status(status || 400).json({ error });
  res.json(await LevelReward.update(reward.id, body));
});

router.delete("/leveling/:guildId/rewards/:id", requireAuth, requirePermission("leveling"), async (req, res) => {
  const reward = await LevelReward.get(Number(req.params.id));
  if (!reward || reward.guildId !== req.params.guildId) {
    return res.status(404).json({ error: "Reward not found" });
  }
  await LevelReward.remove(reward.id);
  res.json({ ok: true });
});

// XP modifiers — per-channel / per-role / per-user multipliers for text or voice XP.
async function validateXpModifier(req, values, existing = {}) {
  const client = req.app.get("client");
  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return { error: "Guild not found", status: 404 };

  const targetType = values.targetType ?? existing.targetType;
  if (!XpModifier.TARGET_TYPES.includes(targetType)) {
    return { error: "Target type must be channel, role or user" };
  }

  const targetId = values.targetId ?? existing.targetId;
  if (!targetId) return { error: "Pick a target" };

  if (targetType === "channel") {
    if (!(await channelBelongsToGuild(client, req.params.guildId, targetId))) {
      return { error: "Channel does not belong to this server" };
    }
  } else if (targetType === "role") {
    if (!(await roleBelongsToGuild(guild, targetId))) {
      return { error: "Role does not belong to this server" };
    }
  } else {
    const member = guild.members.cache.get(targetId)
      || (typeof guild.members.fetch === "function" ? await guild.members.fetch(targetId).catch(() => null) : null);
    if (!member) return { error: "Member not found in this server" };
  }

  const multiplier = values.multiplier ?? existing.multiplier;
  if (!Number.isFinite(Number(multiplier)) || Number(multiplier) < 0 || Number(multiplier) > 100) {
    return { error: "Multiplier must be between 0 and 100" };
  }

  const appliesTo = values.appliesTo ?? existing.appliesTo ?? "all";
  if (!XpModifier.APPLIES_TO.includes(appliesTo)) {
    return { error: "Applies-to must be all, text or voice" };
  }

  const body = { targetType, targetId: String(targetId), multiplier: Number(multiplier), appliesTo };
  if (values.enabled !== undefined) body.enabled = Boolean(values.enabled);
  return { body };
}

router.get("/leveling/:guildId/modifiers", requireAuth, requirePermission("leveling"), async (req, res) => {
  res.json(await XpModifier.listForGuild(req.params.guildId));
});

router.post("/leveling/:guildId/modifiers", requireAuth, requirePermission("leveling"), async (req, res) => {
  const { body, error, status } = await validateXpModifier(req, req.body || {});
  if (error) return res.status(status || 400).json({ error });
  const modifier = await XpModifier.create(req.params.guildId, { ...body, enabled: req.body?.enabled });
  invalidateModifierCache(req.params.guildId);
  res.json(modifier);
});

router.post("/leveling/:guildId/modifiers/:id", requireAuth, requirePermission("leveling"), async (req, res) => {
  const modifier = await XpModifier.get(Number(req.params.id));
  if (!modifier || modifier.guildId !== req.params.guildId) {
    return res.status(404).json({ error: "Modifier not found" });
  }
  const { body, error, status } = await validateXpModifier(req, req.body || {}, modifier);
  if (error) return res.status(status || 400).json({ error });
  const updated = await XpModifier.update(modifier.id, body);
  invalidateModifierCache(req.params.guildId);
  res.json(updated);
});

router.delete("/leveling/:guildId/modifiers/:id", requireAuth, requirePermission("leveling"), async (req, res) => {
  const modifier = await XpModifier.get(Number(req.params.id));
  if (!modifier || modifier.guildId !== req.params.guildId) {
    return res.status(404).json({ error: "Modifier not found" });
  }
  await XpModifier.remove(modifier.id);
  invalidateModifierCache(req.params.guildId);
  res.json({ ok: true });
});

// Marriage settings
router.get("/marriage/:guildId", requireAuth, async (req, res) => {
  const settings = await MarriageSettings.getOrCreate(req.params.guildId);
  res.json(settings);
});

router.post("/marriage/:guildId", requireAuth, requirePermission("leveling"), async (req, res) => {
  const values = req.body || {};
  const settings = await MarriageSettings.save(req.params.guildId, values);
  res.json({ ok: true, settings });
});

// Interactions
router.get("/interactions/:guildId", requireAuth, async (req, res) => {
  const settings = await InteractionSettings.getOrCreate(req.params.guildId);
  res.json({ defaults: DEFAULT_INTERACTIONS, interactions: settings.interactions });
});

router.post("/interactions/:guildId", requireAuth, requirePermission("interactions"), async (req, res) => {
  const { interactions } = req.body || {};
  if (!interactions || typeof interactions !== "object") {
    return res.status(400).json({ error: "Invalid interactions" });
  }
  const settings = await InteractionSettings.save(req.params.guildId, interactions);
  res.json({ ok: true, interactions: settings.interactions });
});

// ---------------------------------------------------------------------------
// Bot profile — view and update the bot's global Discord profile + presence.
// ---------------------------------------------------------------------------
const ACTIVITY_TYPES = {
  playing: ActivityType.Playing,
  streaming: ActivityType.Streaming,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
};
const PRESENCE_STATUSES = new Set(["online", "idle", "dnd", "invisible"]);

router.get("/bot/profile", requireAuth, requirePermission("bot"), async (req, res) => {
  const client = req.app.get("client");
  const user = client.user;
  if (!user) return res.status(503).json({ error: "Bot is not connected" });
  const presence = user.presence;
  res.json({
    id: user.id,
    username: user.username,
    tag: user.tag,
    avatar: user.displayAvatarURL?.({ size: 256 }) ?? null,
    banner: user.bannerURL?.({ size: 1024 }) ?? null,
    accentColor: user.accentColor ?? null,
    createdAt: user.createdAt,
    status: presence?.status ?? "online",
    activities: (presence?.activities ?? []).map((a) => ({ name: a.name, type: a.type })),
  });
});

router.post("/bot/profile", requireAuth, requirePermission("bot"), async (req, res) => {
  const client = req.app.get("client");
  const user = client.user;
  if (!user) return res.status(503).json({ error: "Bot is not connected" });
  const { username, avatar, banner } = req.body || {};
  const changed = [];

  try {
    if (typeof username === "string" && username.trim() && username.trim() !== user.username) {
      const name = username.trim().slice(0, 32);
      if (!/^.{2,32}$/.test(name)) return res.status(400).json({ error: "Username must be 2-32 characters" });
      await user.setUsername(name);
      changed.push("username");
    }

    const resolveImage = async (input, label) => {
      if (typeof input !== "string" || !input.trim()) return undefined;
      const v = input.trim();
      if (v === "null" || v === "remove") return null;
      if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) {
        if (v.length > 14_000_000) throw new Error(`${label} image is too large`);
        return v;
      }
      if (/^https?:\/\//i.test(v)) {
        const { buffer, contentType } = await safeFetch(v, { maxBytes: 10 * 1024 * 1024 });
        const mime = /^image\//.test(contentType || "") ? contentType : "image/png";
        return `data:${mime};base64,${buffer.toString("base64")}`;
      }
      throw new Error(`${label} must be an https URL or a data image`);
    };

    const avatarData = await resolveImage(avatar, "Avatar");
    if (avatarData !== undefined) {
      await user.setAvatar(avatarData);
      changed.push("avatar");
    }

    const bannerData = await resolveImage(banner, "Banner");
    if (bannerData !== undefined) {
      await user.setBanner(bannerData);
      changed.push("banner");
    }
  } catch (err) {
    Audit.add({ actor: req.user.username, action: "bot.profile.fail", detail: String(err.message).slice(0, 200), ip: req.ip });
    return res.status(400).json({ error: err.message || "Could not update the bot profile" });
  }

  Audit.add({ actor: req.user.username, action: "bot.profile.update", detail: changed.join(",") || "none", ip: req.ip });
  res.json({ ok: true, changed });
});

router.post("/bot/presence", requireAuth, requirePermission("bot"), async (req, res) => {
  const client = req.app.get("client");
  const user = client.user;
  if (!user) return res.status(503).json({ error: "Bot is not connected" });
  const { status, activityType, activityName, activityUrl } = req.body || {};

  const presence = {};
  if (typeof status === "string" && PRESENCE_STATUSES.has(status)) presence.status = status;

  if (typeof activityName === "string") {
    const name = activityName.trim().slice(0, 128);
    if (!name) {
      presence.activities = [];
    } else {
      const type = ACTIVITY_TYPES[String(activityType || "playing").toLowerCase()] ?? ActivityType.Playing;
      const activity = { name, type };
      if (type === ActivityType.Streaming && /^https?:\/\/(www\.)?(twitch\.tv|youtube\.com)/i.test(String(activityUrl || ""))) {
        activity.url = activityUrl;
      }
      presence.activities = [activity];
    }
  }

  try {
    user.setPresence(presence);
    Audit.add({ actor: req.user.username, action: "bot.presence.update", detail: `status=${presence.status ?? "-"} activity=${activityName ?? "-"}`, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not update presence" });
  }
});

// ---------------------------------------------------------------------------
// Message studio — saved CV2 message templates + send-to-channel.
// ---------------------------------------------------------------------------
function sanitizeTemplatePayload(body) {
  const src = body?.payload ?? body ?? {};
  const components = (Array.isArray(src.components) ? src.components : []).slice(0, 20).map((c) => {
    const type = String(c?.type || "text");
    const out = { type };
    if (type === "text") out.content = String(c.content ?? "").slice(0, 2000);
    else if (type === "section") {
      out.content = String(c.content ?? "").slice(0, 2000);
      out.thumbnail = String(c.thumbnail ?? "").slice(0, 2048);
    } else if (type === "image") out.url = String(c.url ?? "").slice(0, 2048);
    else if (type === "media_gallery") out.urls = (Array.isArray(c.urls) ? c.urls : [c.url]).filter(Boolean).slice(0, 10).map((u) => String(u).slice(0, 2048));
    else if (type === "buttons") {
      out.buttons = (Array.isArray(c.buttons) ? c.buttons : []).slice(0, 5).map((b) => ({
        label: String(b?.label ?? "").slice(0, 80),
        url: String(b?.url ?? "").slice(0, 512),
        emoji: b?.emoji ? String(b.emoji).slice(0, 64) : undefined,
      })).filter((b) => b.label && /^https?:\/\//i.test(b.url));
    } else if (type === "separator") {
      out.divider = c.divider !== false;
      out.large = Boolean(c.large);
    }
    return out;
  }).filter((c) => {
    if (c.type === "text" || c.type === "section") return c.content.trim().length > 0;
    if (c.type === "image") return /^https?:\/\//i.test(c.url);
    if (c.type === "media_gallery") return c.urls.length > 0;
    if (c.type === "buttons") return c.buttons.length > 0;
    return c.type === "separator";
  });

  const color = src.color;
  return {
    title: typeof src.title === "string" ? src.title.slice(0, 256) : "",
    color: color === null || color === "" || color === undefined ? null : (Number(color) || null),
    components,
  };
}

function templateToMessagePayload(payload) {
  const parts = [];
  if (payload.title) parts.push({ type: "section", content: `**${payload.title}**` });
  const built = buildCV2Components([...parts, ...payload.components]);
  return cv2({ color: payload.color ?? undefined, cv2Components: built });
}

router.get("/messages/:guildId", requireAuth, async (req, res) => {
  res.json(MessageTemplate.list(req.params.guildId));
});

router.post("/messages/:guildId", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 64);
  if (!name) return res.status(400).json({ error: "Template name required" });
  if (MessageTemplate.getByName(req.params.guildId, name)) {
    return res.status(409).json({ error: "A template with that name already exists" });
  }
  const payload = sanitizeTemplatePayload(req.body);
  const tpl = MessageTemplate.create(req.params.guildId, name, payload);
  res.json(tpl);
});

router.put("/messages/:guildId/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = MessageTemplate.get(req.params.guildId, id);
  if (!existing) return res.status(404).json({ error: "Template not found" });
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 64) : undefined;
  if (name !== undefined && !name) return res.status(400).json({ error: "Name cannot be empty" });
  if (name && name !== existing.name) {
    const clash = MessageTemplate.getByName(req.params.guildId, name);
    if (clash && clash.id !== id) return res.status(409).json({ error: "A template with that name already exists" });
  }
  const payload = req.body?.payload !== undefined ? sanitizeTemplatePayload(req.body) : undefined;
  res.json(MessageTemplate.update(req.params.guildId, id, { name, payload }));
});

router.delete("/messages/:guildId/:id", requireAuth, async (req, res) => {
  const ok = MessageTemplate.remove(req.params.guildId, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Template not found" });
  res.json({ ok: true });
});

router.post("/messages/:guildId/send", requireAuth, async (req, res) => {
  const client = req.app.get("client");
  const channelId = String(req.body?.channelId || "").trim();
  if (!channelId) return res.status(400).json({ error: "Channel required" });
  if (!(await channelBelongsToGuild(client, req.params.guildId, channelId))) {
    return res.status(400).json({ error: "Channel does not belong to this server" });
  }

  let payload;
  if (req.body?.templateId != null) {
    const tpl = MessageTemplate.get(req.params.guildId, Number(req.body.templateId));
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    payload = tpl.payload;
  } else {
    payload = sanitizeTemplatePayload(req.body);
  }
  if (!payload.components.length && !payload.title) {
    return res.status(400).json({ error: "Add at least one component before sending" });
  }

  const channel = client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return res.status(404).json({ error: "Channel not found" });

  try {
    const message = await channel.send(templateToMessagePayload(payload));
    Audit.add({ actor: req.user.username, action: "messages.send", detail: `guild=${req.params.guildId} channel=${channelId} message=${message.id}`, ip: req.ip });
    res.json({ ok: true, messageId: message.id, channelId });
  } catch (err) {
    res.status(400).json({ error: `Could not send: ${err.message}` });
  }
});

export default router;
