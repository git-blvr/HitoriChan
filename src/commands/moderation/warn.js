import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, createCase, resolveTarget, resolveReason, resolveAttachment, requireModerator, checkHierarchy, notifyTarget, sendLog } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption((o) => o.setName("target").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the warning").setRequired(true))
    .addAttachmentOption((o) => o.setName("attachment").setDescription("Evidence attachment"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  prefixName: "warn",
  syntax: "{prefix}warn <@member> <reason>",
  example: "{prefix}warn @user Spamming",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const target = await resolveTarget(ctx, 0);
    if (!target) {
      await ctx.reply({ embeds: [buildEmbed("Please mention a valid member.")] });
      return;
    }

    if (!(await checkHierarchy(ctx, target))) return;

    const reason = resolveReason(ctx, 1);
    const attachment = resolveAttachment(ctx);

    const doc = await createCase({
      guildId: ctx.guild.id,
      action: "warn",
      moderatorId: ctx.user.id,
      targetId: target.id,
      reason,
      attachment,
    });

    await notifyTarget(target, "warn", reason, doc.caseId);

    const embed = buildEmbed(`${target} has been **warned** | ${reason}\nCase ID: \`${doc.caseId}\``, "warn");
    await ctx.reply({ embeds: [embed] });

    const logEmbed = buildEmbed(
      `**Warn** | Case \`${doc.caseId}\`\n**Target:** ${target} (${target.id})\n**Moderator:** <@${ctx.user.id}>\n**Reason:** ${reason}${attachment ? `\n**Attachment:** ${attachment}` : ""}`,
      "warn"
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};