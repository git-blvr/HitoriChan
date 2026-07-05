import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, createCase, resolveTarget, resolveReason, resolveAttachment, requireModerator, checkHierarchy, notifyTarget, sendLog, parseDuration, formatDuration } from "./moderationHelpers.js";

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

export default {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout a member")
    .addUserOption((o) => o.setName("target").setDescription("Member to mute").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("Duration e.g. 1h, 30m, 1d").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the mute").setRequired(true))
    .addAttachmentOption((o) => o.setName("attachment").setDescription("Evidence attachment"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  prefixName: "mute",
  syntax: "{prefix}mute <@member> <duration> <reason>",
  example: "{prefix}mute @user 1h Spamming",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const target = await resolveTarget(ctx, 0);
    if (!target) {
      await ctx.reply({ embeds: [buildEmbed("Please mention a valid member.")] });
      return;
    }

    if (!(await checkHierarchy(ctx, target))) return;

    const rawDuration = ctx.isInteraction
      ? ctx.source?.options?.getString("duration")
      : ctx.args?.[1];

    const durationMs = parseDuration(rawDuration ?? "");
    if (!durationMs) {
      await ctx.reply({ embeds: [buildEmbed("Invalid duration. Use formats like `1h`, `30m`, `1d`.")] });
      return;
    }

    if (durationMs > MAX_TIMEOUT_MS) {
      await ctx.reply({ embeds: [buildEmbed("Duration cannot exceed 28 days.")] });
      return;
    }

    const reason = ctx.isInteraction ? resolveReason(ctx, 1) : (ctx.args ?? []).slice(2).join(" ").trim() || "No reason provided";
    const attachment = resolveAttachment(ctx);
    const formatted = formatDuration(durationMs);

    await target.timeout(durationMs, reason);

    const doc = await createCase({
      guildId: ctx.guild.id,
      action: "mute",
      moderatorId: ctx.user.id,
      targetId: target.id,
      reason,
      attachment,
      duration: durationMs,
    });

    await notifyTarget(target, "muted", reason, doc.caseId);

    const embed = buildEmbed(`${target} has been **muted** for ${formatted} | ${reason}\nCase ID: \`${doc.caseId}\``, "mute");
    await ctx.reply({ embeds: [embed] });

    const logEmbed = buildEmbed(
      `**Mute** | Case \`${doc.caseId}\`\n**Target:** ${target} (${target.id})\n**Moderator:** <@${ctx.user.id}>\n**Duration:** ${formatted}\n**Reason:** ${reason}${attachment ? `\n**Attachment:** ${attachment}` : ""}`,
      "mute"
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};