import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, getCasesForUser, resolveTarget, requireModerator } from "./moderationHelpers.js";

export default {
  data: new SlashCommandBuilder()
    .setName("warns")
    .setDescription("List active warnings for a member")
    .addUserOption((o) => o.setName("target").setDescription("Member to inspect").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  prefixName: "warns",
  syntax: "{prefix}warns <@member>",
  example: "{prefix}warns @user",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const target = await resolveTarget(ctx, 0);
    if (!target) {
      await ctx.reply({ embeds: [buildEmbed("Please mention a valid member.")] });
      return;
    }

    const cases = (await getCasesForUser(ctx.guild.id, target.id)).filter((c) => c.action === "warn");
    if (!cases.length) {
      await ctx.reply({ embeds: [buildEmbed(`${target} has no active warnings.`)] });
      return;
    }

    const lines = cases.map((c) => `\`${c.caseId}\` | <@${c.moderatorId}>: ${c.reason}`).join("\n");
    await ctx.reply({ embeds: [buildEmbed(`**Warnings for ${target}**\n\n${lines}`)] });
  },
};