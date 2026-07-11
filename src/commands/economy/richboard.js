import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getLeaderboard, getGuildEconomyConfig, formatCurrency } from "../../utils/economyManager.js";

export default {
  data: new SlashCommandBuilder().setName("richboard").setDescription("Show the top Starry Coins balances in this server"),
  prefixName: "richboard",
  aliases: ["rb"],
  syntax: "{prefix}richboard",
  example: "{prefix}richboard",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply("This command only works in a server.");
      return;
    }

    const config = await getGuildEconomyConfig(ctx.guild.id);
    const leaderboard = await getLeaderboard(ctx.guild.id, 10);

    if (!leaderboard.length) {
      await ctx.reply("No economy data available yet.");
      return;
    }

    const rows = await Promise.all(
      leaderboard.map(async (entry, index) => {
        const member = await ctx.guild.members.fetch(entry.userId).catch(() => null);
        const name = member?.user?.username ?? `Unknown user (${entry.userId})`;
        return `${index + 1}. **${name}** — ${formatCurrency(entry.primary, config.primary)}`;
      })
    );

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Server Richboard")
      .setDescription(rows.join("\n\n"));

    await ctx.reply({ embeds: [embed] });
  },
};
