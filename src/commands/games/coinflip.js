import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency } from "../../utils/economyManager.js";
import { createDescBasicEmbed } from "../../utils/basicEmbed.js";

const VALID_SIDES = ["heads", "tails"];

export default {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin and win or lose Starry Coins")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to bet").setMinValue(1).setRequired(true))
    .addStringOption((o) =>
      o.setName("side")
        .setDescription("Side to bet on")
        .setRequired(true)
        .addChoices(
          { name: "Heads", value: "heads" },
          { name: "Tails", value: "tails" }
        )
    ),
  prefixName: "coinflip",
  aliases: ["cf", "cflip", "flipcoin"],
  syntax: "{prefix}coinflip <amount> <heads|tails>",
  example: "{prefix}coinflip 100 heads",

  async execute(ctx) {
    const amount = ctx.getOption("amount", 0);
    const side   = ctx.getOption("side", 1)?.toLowerCase();

    if (!VALID_SIDES.includes(side)) {
      await ctx.reply(createDescBasicEmbed(`Invalid side. Choose "heads" or "tails".`, 0xff0000));
      return;
    }

    if (!amount || amount <= 0) {
      await ctx.reply(createDescBasicEmbed(`Please enter a valid amount greater than 0.`, 0xff0000));
      return;
    }

    const [config, account] = await Promise.all([
      getGuildEconomyConfig(ctx.guild.id),
      getEconomyAccount(ctx.guild.id, ctx.user.id),
    ]);

    if (account.starryCoins < amount) {
      await ctx.reply(
        createDescBasicEmbed(
          `You don't have enough ${formatCurrency(amount, "starryCoin", config)}.\nBalance: ${formatCurrency(account.starryCoins, "starryCoin", config)}`,
          0xff0000
        )
      );
      return;
    }

    const result = VALID_SIDES[Math.floor(Math.random() * VALID_SIDES.length)];
    const won    = result === side;

    if (won) {
      account.starryCoins += amount;
    } else {
      account.starryCoins -= amount;
    }

    await account.save();

    const embed = new EmbedBuilder()
      .setColor(won ? 0x57f287 : 0xff3333)
      .setTitle(won ? "🪙 You Won!" : "🪙 You Lost!")
      .setDescription(`You chose **${side}** — it landed on **${result}**!`)
      .addFields(
        {
          name: won ? "You earned" : "You lost",
          value: formatCurrency(amount, "starryCoin", config),
          inline: true,
        },
        {
          name: "New balance",
          value: formatCurrency(account.starryCoins, "starryCoin", config),
          inline: true,
        }
      );

    await ctx.reply({ embeds: [embed] });
  },
};