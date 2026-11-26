import { MessageFlags } from "discord.js";
import native from "../native/index.js";
import * as LevelingSettings from "../models/LevelingSettings.js";
import * as EconomyAccount from "../models/EconomyAccount.js";
import * as LevelReward from "../models/LevelReward.js";
import * as XpModifier from "../models/XpModifier.js";
import * as GuildSettings from "../models/GuildSettings.js";
import { replacePlaceholders } from "../helpers/placeholders.js";

const cooldowns = new Map();

// Short-TTL cache for per-guild XP modifiers — they're queried on every
// message, and dashboard edits are fine being a few seconds stale.
const MODIFIER_CACHE_TTL = 5000;
const modifierCache = new Map();

async function getModifiers(guildId) {
  const hit = modifierCache.get(guildId);
  if (hit && Date.now() - hit.ts < MODIFIER_CACHE_TTL) return hit.list;
  const list = await XpModifier.listForGuild(guildId);
  modifierCache.set(guildId, { ts: Date.now(), list });
  return list;
}

export function invalidateModifierCache(guildId) {
  modifierCache.delete(guildId);
}

function memberRoleIds(member) {
  return member?.roles?.cache?.map((r) => r.id) || [];
}

export function isBooster(settings, member) {
  if (!settings?.boosterEnabled) return false;
  if (settings.boosterIncludePremium !== false && member?.premiumSince) return true;
  const ids = settings.boosterRoleIds || [];
  if (!ids.length) return false;
  return memberRoleIds(member).some((id) => ids.includes(id));
}

function matchingModifiers(modifiers, { channelId, roleIds, userId, source }) {
  return (modifiers || []).filter(
    (m) =>
      m.enabled !== false &&
      (m.appliesTo === "all" || m.appliesTo === source) &&
      ((m.targetType === "channel" && m.targetId === channelId) ||
        (m.targetType === "user" && m.targetId === userId) ||
        (m.targetType === "role" && roleIds.includes(m.targetId)))
  );
}

// Final XP multiplier for a member/context: the global multiplier, channel/
// role/user modifiers combined per `modifierStack`, and the booster perk.
export function resolveXpMultiplier(settings, modifiers, { channelId, roleIds = [], userId, source = "text" }, member) {
  let mult = Math.max(0, Number(settings.globalXpMultiplier ?? 1));

  const matched = matchingModifiers(modifiers, { channelId, roleIds, userId, source }).map((m) => Number(m.multiplier));
  if (settings.modifierStack === "highest") {
    if (matched.length) mult *= Math.max(...matched);
  } else {
    for (const m of matched) mult *= m;
  }

  if (member && isBooster(settings, member)) {
    mult *= Math.max(0, Number(settings.boosterXpMultiplier ?? 1.5));
  }

  return Math.max(0, mult);
}

function effectiveCooldown(settings, member) {
  if (isBooster(settings, member) && settings.boosterCooldownSeconds != null) {
    return Math.max(0, Number(settings.boosterCooldownSeconds));
  }
  return settings.cooldownSeconds;
}

export function xpForLevel(level, baseXp = 100, multiplier = 1.5) {
  if (level <= 1) return 0;
  return Math.max(1, Math.floor(baseXp * Math.pow(multiplier, level - 2)));
}

export function xpToNextLevel(level, baseXp = 100, multiplier = 1.5) {
  if (level < 1) level = 1;
  return Math.max(1, Math.floor(baseXp * Math.pow(multiplier, level - 1)));
}

export function progressToNextLevel(xp, level, baseXp = 100, multiplier = 1.5) {
  if (level < 1) level = 1;
  const nextThreshold = Math.max(1, xpToNextLevel(level, baseXp, multiplier));
  const currentXp = Math.max(0, xp);
  return { current: currentXp, needed: nextThreshold, percent: Math.min(100, Math.floor((currentXp / nextThreshold) * 100)) };
}

export function calculateXpGain(settings) {
  const min = Math.max(1, settings.minXp ?? 15);
  const max = Math.max(min, settings.maxXp ?? 25);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function addXP(guildId, userId, amount, baseXp = 100, multiplier = 1.5) {
  const account = await EconomyAccount.getOrCreate(guildId, userId);
  const oldLevel = account.level ?? 1;
  let newLevel = oldLevel;

  account.xp = (account.xp || 0) + amount;
  account.totalXp = (account.totalXp || 0) + amount;

  while (newLevel < 9999 && account.xp >= xpToNextLevel(newLevel, baseXp, multiplier)) {
    account.xp -= xpToNextLevel(newLevel, baseXp, multiplier);
    newLevel += 1;
  }

  account.level = newLevel;
  await EconomyAccount.save(account);
  return { account, leveledUp: newLevel > oldLevel, oldLevel };
}

function isBlacklisted(settings, channelId, roleIds) {
  const channelSet = new Set(settings.channels || []);
  const roleSet = new Set(settings.roles || []);
  if (channelSet.size && channelSet.has(channelId)) return true;
  if (roleSet.size && roleIds.some((id) => roleSet.has(id))) return true;
  return false;
}

function isOnCooldown(guildId, userId, cooldownSeconds) {
  if (!cooldownSeconds || cooldownSeconds <= 0) return false;
  const key = `${guildId}:${userId}`;
  const last = cooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < cooldownSeconds * 1000;
}

function setCooldown(guildId, userId) {
  cooldowns.set(`${guildId}:${userId}`, Date.now());
}

function cleanupCooldowns() {
  const now = Date.now();
  for (const [key, ts] of cooldowns) {
    if (now - ts > 10 * 60 * 1000) cooldowns.delete(key);
  }
}

setInterval(cleanupCooldowns, 60 * 1000).unref?.();

async function sendLevelUpNotification(client, settings, result, context, rewardsText = "") {
  if (!result.leveledUp || !settings.notifyEnabled) return;

  let text = replacePlaceholders(settings.notifyMessage || "GG {user}, you leveled up to level {level}!", {
    member: context.member,
    user: context.user,
    guild: context.guild,
    channel: context.channel,
    level: result.account.level,
    xp: result.account.xp,
  });

  if (/{rewards}/i.test(text)) {
    text = text.replace(/{rewards}/gi, rewardsText).replace(/\n{2,}/g, "\n").trimEnd();
  } else if (rewardsText) {
    text += `\nRewards: ${rewardsText}`;
  }

  try {
    let channel = settings.notifyChannelId
      ? client?.channels?.cache?.get(settings.notifyChannelId)
      : context.channel;
    if (!channel?.isTextBased()) {
      channel = context.guild?.systemChannel;
    }
    if (channel?.isTextBased() && text) {
      await channel.send({ content: text, flags: MessageFlags.SuppressEmbeds });
    }
  } catch (err) {
    console.error("[leveling] Level-up notification error:", err.message);
  }
}

// Grants configured rewards for every level in (oldLevel, newLevel] and, when
// `rewardRemovePrevious` is on, strips role rewards superseded by a higher one.
// Returns a human-readable list like ["Role @Level 10", "500 Starry Coins"].
async function applyLevelRewards(client, settings, result, context) {
  if (!result.leveledUp || !context.guild) return [];

  const rewards = await LevelReward.listForLevels(context.guild.id, result.oldLevel, result.account.level);
  if (!rewards.length) return [];

  const granted = [];
  let highestRoleLevel = 0;
  const guildSettings = await GuildSettings.get(context.guild.id);

  for (const reward of rewards) {
    try {
      if (reward.rewardType === "role") {
        if (!context.member || !reward.roleId) continue;
        if (!context.member.roles.cache.has(reward.roleId)) {
          await context.member.roles.add(reward.roleId);
        }
        const role = context.guild.roles.cache.get(reward.roleId);
        granted.push(`Role ${role ? `@${role.name}` : reward.roleId}`);
        highestRoleLevel = Math.max(highestRoleLevel, reward.level);
      } else if (reward.rewardType === "currency") {
        if (!reward.currency || !reward.amount) continue;
        await EconomyAccount.adjust(context.guild.id, context.user.id, reward.currency, reward.amount);
        const name = reward.currency === "secondary"
          ? guildSettings?.secondaryCurrency?.name
          : guildSettings?.primaryCurrency?.name;
        granted.push(`${reward.amount.toLocaleString()} ${name || reward.currency}`);
      }
    } catch (err) {
      console.error(`[leveling] Level reward ${reward.id} error:`, err.message);
    }
  }

  if (settings.rewardRemovePrevious && highestRoleLevel > 0 && context.member) {
    const superseded = await LevelReward.listRoleRewardsBelow(context.guild.id, highestRoleLevel);
    const toRemove = [...new Set(
      superseded
        .map((r) => r.roleId)
        .filter((roleId) => roleId && context.member.roles.cache.has(roleId))
    )];
    if (toRemove.length) {
      try {
        await context.member.roles.remove(toRemove);
      } catch (err) {
        console.error("[leveling] Reward role removal error:", err.message);
      }
    }
  }

  return granted;
}

export async function handleLeveling(client, message) {
  if (message.author.bot || !message.guild) return false;
  if (!message.content?.trim()) return false;

  const settings = await LevelingSettings.getOrCreate(message.guild.id);
  if (!settings.enabled) return false;

  const roleIds = memberRoleIds(message.member);
  if (isBlacklisted(settings, message.channel.id, roleIds)) return false;
  if (isOnCooldown(message.guild.id, message.author.id, effectiveCooldown(settings, message.member))) return false;

  const modifiers = await getModifiers(message.guild.id);
  const mult = resolveXpMultiplier(
    settings,
    modifiers,
    { channelId: message.channel.id, roleIds, userId: message.author.id, source: "text" },
    message.member
  );
  if (mult <= 0) return false;

  const amount = Math.floor(calculateXpGain(settings) * mult);
  if (amount <= 0) return false;

  const result = await addXP(message.guild.id, message.author.id, amount, settings.baseXp, settings.multiplier);

  setCooldown(message.guild.id, message.author.id);

  const context = {
    member: message.member,
    user: message.author,
    guild: message.guild,
    channel: message.channel,
  };
  const granted = await applyLevelRewards(client, settings, result, context);
  await sendLevelUpNotification(client, settings, result, context, granted.join(", "));

  return true;
}

function isVoiceMemberBlacklisted(settings, channelId, member) {
  if (settings.channels?.length && settings.channels.includes(channelId)) return true;
  if (settings.roles?.length) {
    const roleIds = member.roles?.cache?.map((r) => r.id) || [];
    if (roleIds.some((id) => settings.roles.includes(id))) return true;
  }
  return false;
}

function isVoiceMemberMuted(voiceState) {
  return voiceState.mute || voiceState.selfMute || voiceState.serverMute || voiceState.deaf || voiceState.selfDeaf || voiceState.serverDeaf;
}

function getVoiceMultiplier(voiceState, settings) {
  let multiplier = 1;
  if (voiceState.selfVideo) {
    multiplier = Math.max(multiplier, settings.voiceVideoMultiplier || 2.0);
  }
  if (voiceState.selfStream) {
    multiplier = Math.max(multiplier, settings.voiceStreamingMultiplier || 1.5);
  }
  return multiplier;
}

export async function processVoiceMember(client, settings, guild, channel, member) {
  if (member.user.bot) return false;
  if (isVoiceMemberBlacklisted(settings, channel.id, member)) return false;

  const voiceState = member.voice;
  if (settings.voiceAfkSkip && channel.id === guild.afkChannelId) return false;
  if (settings.voiceMuteSkip && isVoiceMemberMuted(voiceState)) return false;

  const base = Math.max(0, settings.voiceXp || 0);
  if (base <= 0) return false;

  const modifiers = await getModifiers(guild.id);
  const xpMult = resolveXpMultiplier(
    settings,
    modifiers,
    { channelId: channel.id, roleIds: memberRoleIds(member), userId: member.id, source: "voice" },
    member
  );
  if (xpMult <= 0) return false;

  const multiplier = getVoiceMultiplier(voiceState, settings);
  const amount = Math.floor(base * multiplier * xpMult);
  if (amount <= 0) return false;

  const result = await addXP(guild.id, member.id, amount, settings.baseXp, settings.multiplier);

  const context = {
    member,
    user: member.user,
    guild,
    channel,
  };
  const granted = await applyLevelRewards(client, settings, result, context);
  await sendLevelUpNotification(client, settings, result, context, granted.join(", "));

  return true;
}

export function startVoiceXpLoop(client) {
  setInterval(async () => {
    try {
      for (const guild of client.guilds.cache.values()) {
        const settings = await LevelingSettings.get(guild.id);
        if (!settings?.enabled || !settings?.voiceEnabled) continue;

        for (const channel of guild.channels.cache.values()) {
          if (!channel.isVoiceBased() || !channel.members?.size) continue;

          for (const member of channel.members.values()) {
            try {
              await processVoiceMember(client, settings, guild, channel, member);
            } catch (err) {
              console.error("[leveling] Voice XP error:", err.message);
            }
          }
        }
      }
    } catch (err) {
      console.error("[leveling] Voice XP loop error:", err.message);
    }
  }, 10_000).unref();
}

export function renderProgressBar(percent, length = 10) {
  if (native?.renderProgressBar) return native.renderProgressBar(percent, length);
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
