import { EmbedBuilder } from "discord.js";
import ModerationCase from "../../models/ModerationCase.js";
import ModerationSettings from "../../models/ModerationSettings.js";

const ACTION_COLORS = {
  warn: 0xf5a623,
  mute: 0x9b59b6,
  unmute: 0x57f287,
  kick: 0xff7b00,
  ban: 0xff3333,
  default: 0x5865f2,
};

export function buildEmbed(description, action = "default") {
  return new EmbedBuilder()
    .setDescription(description)
    .setColor(ACTION_COLORS[action] ?? ACTION_COLORS.default);
}

export async function createCase(data) {
  const doc = await ModerationCase.create(data);
  return doc;
}

export async function deleteCase(guildId, caseId) {
  const doc = await ModerationCase.findOneAndUpdate(
    { guildId, caseId, active: true },
    { active: false },
    { new: true }
  );
  return doc;
}

export async function getCasesForUser(guildId, targetId) {
  return ModerationCase.find({ guildId, targetId, active: true }).sort({ createdAt: -1 });
}

export async function getSettings(guildId) {
  return ModerationSettings.findOne({ guildId });
}

export async function sendLog(client, guildId, embed) {
  const settings = await getSettings(guildId);
  if (!settings?.logChannelId) return;
  const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

export async function requireModerator(ctx) {
  const settings = await getSettings(ctx.guild.id);
  const member = ctx.member;

  const hasModRole = settings?.modRoleId && member?.roles?.cache?.has(settings.modRoleId);
  const hasPermission = member?.permissions?.has("ModerateMembers");

  if (!hasModRole && !hasPermission) {
    await ctx.reply({ embeds: [buildEmbed("You don't have permission to use moderation commands.")] });
    return false;
  }
  return true;
}

export async function checkHierarchy(ctx, target) {
  const botMember = ctx.guild.members.me;
  if (target.id === ctx.user.id) {
    await ctx.reply({ embeds: [buildEmbed("You cannot moderate yourself.")] });
    return false;
  }
  if (target.id === ctx.guild.ownerId) {
    await ctx.reply({ embeds: [buildEmbed("You cannot moderate the server owner.")] });
    return false;
  }
  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply({ embeds: [buildEmbed("My role is too low to moderate that member.")] });
    return false;
  }
  if (ctx.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply({ embeds: [buildEmbed("Your role is too low to moderate that member.")] });
    return false;
  }
  return true;
}

export async function resolveTarget(ctx, argIndex = 0) {
  if (ctx.isInteraction) {
    const user = ctx.source?.options?.getUser?.("target");
    if (!user) return null;
    return ctx.guild.members.fetch(user.id).catch(() => null);
  }

  const raw = ctx.args?.[argIndex];
  if (!raw || !ctx.guild) return null;

  const mentionMatch = String(raw).match(/<@!?(\d+)>/);
  const id = mentionMatch?.[1] ?? raw;
  return ctx.guild.members.fetch(id).catch(() => null);
}

export function resolveReason(ctx, argIndex = 1) {
  if (ctx.isInteraction) {
    return ctx.source?.options?.getString?.("reason") ?? "No reason provided";
  }
  const reason = (ctx.args ?? []).slice(argIndex).join(" ").trim();
  return reason || "No reason provided";
}

export function resolveAttachment(ctx) {
  if (ctx.isInteraction) {
    return ctx.source?.options?.getAttachment?.("attachment")?.url ?? null;
  }
  return ctx.source?.attachments?.first()?.url ?? null;
}

export async function notifyTarget(target, action, reason, caseId) {
  const embed = buildEmbed(
    `You have been **${action}** in **${target.guild.name}**\n**Reason:** ${reason}\n**Case ID:** \`${caseId}\``,
    action
  );
  await target.send({ embeds: [embed] }).catch(() => {});
}

export function parseDuration(str) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const regex = /(\d+)(s|m|h|d|w)/gi;
  let total = 0;
  let match;
  while ((match = regex.exec(str)) !== null) {
    total += parseInt(match[1]) * (units[match[2].toLowerCase()] ?? 0);
  }
  return total || null;
}

export function formatDuration(ms) {
  const units = [
    [604800000, "w"],
    [86400000, "d"],
    [3600000, "h"],
    [60000, "m"],
    [1000, "s"],
  ];
  const parts = [];
  for (const [value, label] of units) {
    if (ms >= value) {
      parts.push(`${Math.floor(ms / value)}${label}`);
      ms %= value;
    }
  }
  return parts.join(" ") || "0s";
}