import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import os from "os";
import * as EconomyAccount from "../../models/EconomyAccount.js";
import * as AISettings from "../../models/AISettings.js";
import * as StreakSettings from "../../models/StreakSettings.js";
import * as ModerationSettings from "../../models/ModerationSettings.js";
import * as GuildSettings from "../../models/GuildSettings.js";
import * as CommandLog from "../../models/CommandLog.js";
import * as MessageLog from "../../models/MessageLog.js";
import * as VoiceSession from "../../models/VoiceSession.js";
import * as Trigger from "../../models/Trigger.js";

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

// Economy
router.get("/economy/:guildId", requireAuth, async (req, res) => {
  const top = await EconomyAccount.getLeaderboard(req.params.guildId, 50);
  res.json(top);
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
  const rows = await CommandLog.getForGuild(req.params.guildId, limit);
  res.json(rows);
});

router.get("/logs/messages/:guildId", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const rows = await MessageLog.getForGuild(req.params.guildId, limit);
  res.json(rows);
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

  const msgStats = MessageLog.getStats(req.params.guildId, since);
  const voiceStats = VoiceSession.getVoiceStats(req.params.guildId, since);

  res.json({
    days: daysNum,
    since,
    data: [{
      guildId: req.params.guildId,
      messages: msgStats.total,
      voiceHours: voiceStats.hours,
      collaborators: msgStats.uniqueUsers,
    }],
  });
});

export default router;
