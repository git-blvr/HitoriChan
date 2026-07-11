import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getEconomyAccount, claimDaily, getGuildEconomyConfig, DAILY_REWARD, canClaimDaily, getDailyCooldown } from "../../utils/economyManager.js";

export default {
  data: new SlashCommandBuilder().setName("daily").setDescription("Claim your daily economy reward"),
  prefixName: "daily",
  syntax: "{prefix}daily",
  example: "{prefix}daily",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply("This command only works in a server.");
      return;
    }

    const account = await getEconomyAccount(ctx.guild.id, ctx.user.id);
    if (!canClaimDaily(account)) {
      const remainingMs = getDailyCooldown(account);
      const hours = Math.floor(remainingMs / 1000 / 60 / 60);
      const minutes = Math.floor((remainingMs / 1000 / 60) % 60);
      const seconds = Math.floor((remainingMs / 1000) % 60);

      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("Daily Reward Already Claimed")
            .setDescription(`Come back in ${hours}h ${minutes}m ${seconds}s to claim again.`),
        ],
      });
      return;
    }

    const claimedAccount = await claimDaily(ctx.guild.id, ctx.user.id);
    const config = await getGuildEconomyConfig(ctx.guild.id);

    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Daily Reward Claimed")
          .setDescription(
            `You received ${config.primary.symbol}${DAILY_REWARD.primary.toLocaleString()} ${config.primary.name}.`
          )
          .addFields(
            {
              name: `New ${config.primary.name} Balance`,
              value: `${formatBalance(claimedAccount.primary, config.primary)}`,
              inline: true,
            },
            {
              name: `Current ${config.secondary.name} Balance`,
              value: `${formatBalance(claimedAccount.secondary, config.secondary)}`,
              inline: true,
            }
          ),
      ],
    });
  },
};

function formatBalance(amount, config) {
  return `${config.symbol}${Number(amount).toLocaleString()}`;
}
