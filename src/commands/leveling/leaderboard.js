import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getLevelLeaderboard } from "../../models/EconomyAccount.js";

export default {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top users by level/XP.")
    .addIntegerOption((option) =>
      option.setName("limit").setDescription("How many users to show (max 25).").setMinValue(1).setMaxValue(25).setRequired(false)
    ),
  prefixName: "leaderboard",
  category: "leveling",
  async execute(ctx) {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = ctx.guild?.id;
    if (!guildId) {
      return ctx.editReply("This command only works in a server.");
    }

    const limit = Math.min(25, Math.max(1, Number(ctx.getOption("limit", 0)) || 10));
    const rows = await getLevelLeaderboard(guildId, limit);

    if (!rows.length) {
      return ctx.editReply("No users have earned XP yet.");
    }

    const fields = await Promise.all(rows.map(async (entry, i) => {
      try {
        const user = await ctx.client.users.fetch(entry.userId);
        return {
          name: `${i + 1}. ${user?.username || "Unknown"}`,
          value: `Level **${entry.level}** · ${entry.totalXp.toLocaleString()} XP`,
          inline: false,
        };
      } catch {
        return null;
      }
    }));

    const payload = cv2({
      color: 0xf59e0b,
      title: "Level Leaderboard",
      description: `Top **${fields.filter(Boolean).length}** users by total XP`,
      fields: fields.filter(Boolean),
      separators: true,
      thumbnail: ctx.guild?.iconURL?.({ size: 128 }) ?? null,
    });

    return ctx.editReply(payload);
  },
};
