import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, createCase, resolveTarget, resolveReason, resolveAttachment, requireModerator, checkHierarchy, notifyTarget, sendLog } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from the server")
    .addUserOption((o) => o.setName("target").setDescription("Member to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the ban").setRequired(true))
    .addIntegerOption((o) => o.setName("delete_days").setDescription("Days of messages to delete (0-7)").setMinValue(0).setMaxValue(7))
    .addAttachmentOption((o) => o.setName("attachment").setDescription("Evidence attachment"))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  prefixName: "ban",
  syntax: "{prefix}ban <@member> <reason>",
  example: "{prefix}ban @user Raiding",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const target = await resolveTarget(ctx, 0);
    if (!target) {
      await ctx.reply({ embeds: [buildEmbed("Please mention a valid member.")] });
      return;
    }

    if (!target.bannable) {
      await ctx.reply({ embeds: [buildEmbed("I cannot ban that member.")] });
      return;
    }

    if (!(await checkHierarchy(ctx, target))) return;

    const reason = resolveReason(ctx, 1);
    const attachment = resolveAttachment(ctx);
    const deleteMessageSeconds = (ctx.isInteraction ? (ctx.source?.options?.getInteger("delete_days") ?? 0) : 0) * 86400;

    await notifyTarget(target, "banned", reason, "N/A");
    await target.ban({ reason, deleteMessageSeconds });

    const doc = await createCase({
      guildId: ctx.guild.id,
      action: "ban",
      moderatorId: ctx.user.id,
      targetId: target.id,
      reason,
      attachment,
    });

    const embed = buildEmbed(`${target} has been **banned** | ${reason}\nCase ID: \`${doc.caseId}\``, "ban");
    await ctx.reply({ embeds: [embed] });

    const logEmbed = buildEmbed(
      `**Ban** | Case \`${doc.caseId}\`\n**Target:** ${target} (${target.id})\n**Moderator:** <@${ctx.user.id}>\n**Reason:** ${reason}${attachment ? `\n**Attachment:** ${attachment}` : ""}`,
      "ban"
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};