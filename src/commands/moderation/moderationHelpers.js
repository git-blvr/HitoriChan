import { cv2 } from "../../helpers/cv2.js";
import * as ModerationCase from "../../models/ModerationCase.js";
import * as ModerationSettings from "../../models/ModerationSettings.js";

const ACTION_COLORS = {
  warn: 0xf5a623,
  mute: 0x9b59b6,
  unmute: 0x57f287,
  kick: 0xff7b00,
  ban: 0xff3333,
  default: 0x5865f2,
};

export function buildEmbed(description, action = "default") {
  return cv2({
    color: ACTION_COLORS[action] ?? ACTION_COLORS.default,
    description,
  });
}

export async function createCase(data) {
  return ModerationCase.create(data);
}

export async function deleteCase(guildId, caseId) {
  return ModerationCase.deactivate(guildId, caseId);
}

export async function getCasesForUser(guildId, targetId) {
  return ModerationCase.getForUser(guildId, targetId);
}

export async function getSettings(guildId) {
  return ModerationSettings.get(guildId);
}

export async function sendLog(client, guildId, payload) {
  const settings = await getSettings(guildId);
  if (!settings?.logChannelId) return;
  const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(payload).catch(() => {});
  }
}

export async function requireModerator(ctx) {
  const settings = await getSettings(ctx.guild.id);
  const member = ctx.member;

  const hasModRole = settings?.modRoleId && member?.roles?.cache?.has(settings.modRoleId);
  const hasPermission = member?.permissions?.has("ModerateMembers");

  if (!hasModRole && !hasPermission) {
    await ctx.reply(buildEmbed("You don't have permission to use moderation commands."));
    return false;
  }
  return true;
}

export async function checkHierarchy(ctx, target) {
  const botMember = ctx.guild.members.me;
  if (target.id === ctx.user.id) {
    await ctx.reply(buildEmbed("You cannot moderate yourself."));
    return false;
  }
  if (target.id === ctx.guild.ownerId) {
    await ctx.reply(buildEmbed("You cannot moderate the server owner."));
    return false;
  }
  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply(buildEmbed("My role is too low to moderate that member."));
    return false;
  }
  if (ctx.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply(buildEmbed("Your role is too low to moderate that member."));
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

  const mentionMatch = String(raw).match(/<@!?(\d+)>$/);
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
  return ctx.source?.attachments?.first?.()?.url ?? null;
}

export async function notifyTarget(target, action, reason, caseId) {
  const payload = buildEmbed(
    `You have been **${action}** in **${target.guild.name}**\n**Reason:** ${reason}\n**Case ID:** \`${caseId}\``,
    action
  );
  await target.send(payload).catch(() => {});
}

export { parseDuration, formatDuration } from "../../helpers/time.js";
