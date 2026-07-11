import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getGlobalLeaderboard, formatMoney } from "../../utils/economyManager.js";

export default {
  data: new SlashCommandBuilder().setName("richboardglobal").setDescription("Show the top Starry Coins balances across all servers"),
  prefixName: "richboardglobal",
  aliases: ["rbg", "globalrichboard"],
  syntax: "{prefix}richboardglobal",
  example: "{prefix}richboardglobal",
  async execute(ctx) {
    const leaderboard = await getGlobalLeaderboard(10);

    if (!leaderboard.length) {
      await ctx.reply("No global economy data available yet.");
      return;
    }

    const rows = leaderboard.map((entry, index) => {
      return `${index + 1}. <@${entry._id}> — coins ${formatMoney(entry.totalPrimary)}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Global Richboard")
      .setDescription(rows.join("\n"));

    await ctx.reply({ embeds: [embed] });
  },
};
