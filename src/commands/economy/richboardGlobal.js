import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
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

    await ctx.reply(cv2({
      color: 0x5865f2,
      title: "Global Richboard",
      description: rows.join("\n"),
    }));
  },
};
