import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, deleteCase, requireModerator, sendLog } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("warnremove")
    .setDescription("Remove a warning by case ID")
    .addStringOption((o) => o.setName("case_id").setDescription("Case ID to remove").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  prefixName: "warnremove",
  aliases: ["wr"],
  syntax: "{prefix}warnremove <caseId>",
  example: "{prefix}warnremove A1B2C3",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const caseId = ctx.isInteraction ? ctx.source?.options?.getString("case_id") : (ctx.args?.[0] ?? null);
    if (!caseId) {
      await ctx.reply({ embeds: [buildEmbed("Please provide a valid case ID.")] });
      return;
    }

    const removed = await deleteCase(ctx.guild.id, caseId.toUpperCase());
    if (!removed) {
      await ctx.reply({ embeds: [buildEmbed(`No active warning found with case ID \`${caseId}\`.`)] });
      return;
    }

    await ctx.reply({ embeds: [buildEmbed(`Warning \`${removed.caseId}\` has been removed.`)] });

    const logEmbed = buildEmbed(
      `**Warn Removed** | Case \`${removed.caseId}\`\n**Target:** <@${removed.targetId}>\n**Moderator:** <@${ctx.user.id}>\n**Original Reason:** ${removed.reason}`
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};