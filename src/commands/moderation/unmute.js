import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, createCase, resolveTarget, resolveReason, requireModerator, checkHierarchy, notifyTarget, sendLog } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove a timeout from a member")
    .addUserOption((o) => o.setName("target").setDescription("Member to unmute").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for unmute").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  prefixName: "unmute",
  syntax: "{prefix}unmute <@member> <reason>",
  example: "{prefix}unmute @user Appeal accepted",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const target = await resolveTarget(ctx, 0);
    if (!target) {
      await ctx.reply({ embeds: [buildEmbed("Please mention a valid member.")] });
      return;
    }

    if (!target.isCommunicationDisabled()) {
      await ctx.reply({ embeds: [buildEmbed(`${target} is not currently muted.`)] });
      return;
    }

    if (!(await checkHierarchy(ctx, target))) return;

    const reason = resolveReason(ctx, 1);

    await target.timeout(null, reason);

    const doc = await createCase({
      guildId: ctx.guild.id,
      action: "unmute",
      moderatorId: ctx.user.id,
      targetId: target.id,
      reason,
    });

    await notifyTarget(target, "unmuted", reason, doc.caseId);

    const embed = buildEmbed(`${target} has been **unmuted** | ${reason}`, "unmute");
    await ctx.reply({ embeds: [embed] });

    const logEmbed = buildEmbed(
      `**Unmute** | Case \`${doc.caseId}\`\n**Target:** ${target} (${target.id})\n**Moderator:** <@${ctx.user.id}>\n**Reason:** ${reason}`,
      "unmute"
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};