import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency, adjustBalance } from "../../utils/economyManager.js";
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
    const amount = Number(ctx.getOption("amount", 0));
    const side   = String(ctx.getOption("side", 1) ?? "").toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply(createDescBasicEmbed(`Please enter a valid amount greater than 0.`, 0xff0000));
      return;
    }

    if (!VALID_SIDES.includes(side)) {
      await ctx.reply(createDescBasicEmbed(`Invalid side. Choose "heads" or "tails".`, 0xff0000));
      return;
    }

    const [config, account] = await Promise.all([
      getGuildEconomyConfig(ctx.guild.id),
      getEconomyAccount(ctx.guild.id, ctx.user.id),
    ]);

    if (account.primary < amount) {
      await ctx.reply(
        createDescBasicEmbed(
          `You don't have enough ${formatCurrency(amount, config.primary)}.\nBalance: ${formatCurrency(account.primary, config.primary)}`,
          0xff0000
        )
      );
      return;
    }

    const result = VALID_SIDES[Math.floor(Math.random() * VALID_SIDES.length)];
    const won    = result === side;

    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", won ? amount : -amount);
    const updated = await getEconomyAccount(ctx.guild.id, ctx.user.id);

    await ctx.reply(cv2({
      color: won ? 0x57f287 : 0xff3333,
      title: won ? "🪙 You Won!" : "🪙 You Lost!",
      description: `You chose **${side}** — it landed on **${result}**!`,
      fields: [
        { name: won ? "You earned" : "You lost", value: formatCurrency(amount, config.primary), inline: true },
        { name: "New balance", value: formatCurrency(updated.primary, config.primary), inline: true },
      ],
    }));
  },
};
