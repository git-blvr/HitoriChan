import { MessageFlags } from "discord.js";
import * as LevelingSettings from "../models/LevelingSettings.js";
import * as EconomyAccount from "../models/EconomyAccount.js";
import { replacePlaceholders } from "../helpers/placeholders.js";

const cooldowns = new Map();

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
  let leveledUp = false;
  let newLevel = account.level ?? 1;

  account.xp = (account.xp || 0) + amount;
  account.totalXp = (account.totalXp || 0) + amount;

  while (newLevel < 9999 && account.xp >= xpToNextLevel(newLevel, baseXp, multiplier)) {
    account.xp -= xpToNextLevel(newLevel, baseXp, multiplier);
    newLevel += 1;
    leveledUp = true;
  }

  account.level = newLevel;
  await EconomyAccount.save(account);
  return { account, leveledUp, oldLevel: leveledUp ? account.level - 1 : account.level };
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

async function sendLevelUpNotification(client, settings, result, context) {
  if (!result.leveledUp || !settings.notifyEnabled) return;

  const text = replacePlaceholders(settings.notifyMessage || "GG {user}, you leveled up to level {level}!", {
    member: context.member,
    user: context.user,
    guild: context.guild,
    channel: context.channel,
    level: result.account.level,
    xp: result.account.xp,
  });

  try {
    let channel = settings.notifyChannelId
      ? client?.channels?.cache?.get(settings.notifyChannelId)
      : context.channel;
    if (!channel?.isTextBased()) {
      channel = context.guild?.systemChannel;
    }
    if (channel?.isTextBased()) {
      await channel.send({ content: text, flags: MessageFlags.SuppressEmbeds });
    }
  } catch (err) {
    console.error("[leveling] Level-up notification error:", err.message);
  }
}

export async function handleLeveling(client, message) {
  if (message.author.bot || !message.guild) return false;
  if (!message.content?.trim()) return false;

  const settings = await LevelingSettings.getOrCreate(message.guild.id);
  if (!settings.enabled) return false;

  if (isBlacklisted(settings, message.channel.id, message.member?.roles?.cache?.map((r) => r.id) || [])) return false;
  if (isOnCooldown(message.guild.id, message.author.id, settings.cooldownSeconds)) return false;

  const amount = calculateXpGain(settings);
  const result = await addXP(message.guild.id, message.author.id, amount, settings.baseXp, settings.multiplier);

  setCooldown(message.guild.id, message.author.id);

  await sendLevelUpNotification(client, settings, result, {
    member: message.member,
    user: message.author,
    guild: message.guild,
    channel: message.channel,
  });

  return true;
}

function isVoiceMemberBlacklisted(settings, channelId, member) {
  if (settings.channels?.length && settings.channels.includes(channelId)) return true;
  if (settings.roles?.length) {
    const memberRoleIds = member.roles?.cache?.map((r) => r.id) || [];
    if (memberRoleIds.some((id) => settings.roles.includes(id))) return true;
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

  const multiplier = getVoiceMultiplier(voiceState, settings);
  const amount = Math.floor(base * multiplier);

  const result = await addXP(guild.id, member.id, amount, settings.baseXp, settings.multiplier);

  await sendLevelUpNotification(client, settings, result, {
    member,
    user: member.user,
    guild,
    channel,
  });

  return true;
}

export function startVoiceXpLoop(client) {
  setInterval(async () => {
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
  }, 10_000);
}

export function renderProgressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
