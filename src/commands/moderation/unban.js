import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, createCase, resolveReason, requireModerator, sendLog } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by ID")
    .addStringOption((o) => o.setName("user_id").setDescription("User ID to unban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the unban").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  prefixName: "unban",
  syntax: "{prefix}unban <userId> <reason>",
  example: "{prefix}unban 123456789012345678 Appeal accepted",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const userId = ctx.isInteraction ? ctx.source?.options?.getString("user_id") : ctx.args?.[0];
    if (!userId) {
      await ctx.reply({ embeds: [buildEmbed("Please provide a valid user ID.")] });
      return;
    }

    const ban = await ctx.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      await ctx.reply({ embeds: [buildEmbed(`No ban found for user ID \`${userId}\`.`)] });
      return;
    }

    const reason = ctx.isInteraction ? resolveReason(ctx, 1) : (ctx.args ?? []).slice(1).join(" ").trim() || "No reason provided";

    await ctx.guild.members.unban(userId, reason);

    const doc = await createCase({
      guildId: ctx.guild.id,
      action: "unban",
      moderatorId: ctx.user.id,
      targetId: userId,
      reason,
    });

    const embed = buildEmbed(`<@${userId}> has been **unbanned** | ${reason}\nCase ID: \`${doc.caseId}\``, "unmute");
    await ctx.reply({ embeds: [embed] });

    const logEmbed = buildEmbed(
      `**Unban** | Case \`${doc.caseId}\`\n**Target:** <@${userId}> (${userId})\n**Moderator:** <@${ctx.user.id}>\n**Reason:** ${reason}`,
      "unmute"
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};