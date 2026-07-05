import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, createCase, resolveTarget, resolveReason, resolveAttachment, requireModerator, checkHierarchy, notifyTarget, sendLog } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server")
    .addUserOption((o) => o.setName("target").setDescription("Member to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the kick").setRequired(true))
    .addAttachmentOption((o) => o.setName("attachment").setDescription("Evidence attachment"))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  prefixName: "kick",
  syntax: "{prefix}kick <@member> <reason>",
  example: "{prefix}kick @user Breaking rules",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const target = await resolveTarget(ctx, 0);
    if (!target) {
      await ctx.reply({ embeds: [buildEmbed("Please mention a valid member.")] });
      return;
    }

    if (!target.kickable) {
      await ctx.reply({ embeds: [buildEmbed("I cannot kick that member.")] });
      return;
    }

    if (!(await checkHierarchy(ctx, target))) return;

    const reason = resolveReason(ctx, 1);
    const attachment = resolveAttachment(ctx);

    await notifyTarget(target, "kicked", reason, "N/A");
    await target.kick(reason);

    const doc = await createCase({
      guildId: ctx.guild.id,
      action: "kick",
      moderatorId: ctx.user.id,
      targetId: target.id,
      reason,
      attachment,
    });

    const embed = buildEmbed(`${target} has been **kicked** | ${reason}\nCase ID: \`${doc.caseId}\``, "kick");
    await ctx.reply({ embeds: [embed] });

    const logEmbed = buildEmbed(
      `**Kick** | Case \`${doc.caseId}\`\n**Target:** ${target} (${target.id})\n**Moderator:** <@${ctx.user.id}>\n**Reason:** ${reason}${attachment ? `\n**Attachment:** ${attachment}` : ""}`,
      "kick"
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};