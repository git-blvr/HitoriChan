import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency, adjustBalance } from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a 1-100 number. Over 60 wins 1.5x.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to bet").setMinValue(1).setRequired(true)),
  prefixName: "roll",
  aliases: ["d100"],
  syntax: "{prefix}roll <amount>",
  example: "{prefix}roll 100",

  async execute(ctx) {
    const amount = Number(ctx.getOption("amount", 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply(embErr("Please enter a valid amount greater than 0."));
    }

    const [config, account] = await Promise.all([
      getGuildEconomyConfig(ctx.guild.id),
      getEconomyAccount(ctx.guild.id, ctx.user.id),
    ]);

    if (account.primary < amount) {
      return ctx.reply(
        embErr(`You don't have enough ${formatCurrency(amount, config.primary)}.\nBalance: ${formatCurrency(account.primary, config.primary)}`)
      );
    }

    const roll = Math.floor(Math.random() * 100) + 1;
    const won = roll > 60;
    const payout = Math.floor(amount * 1.5);

    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", won ? payout - amount : -amount);
    const updated = await getEconomyAccount(ctx.guild.id, ctx.user.id);

    await ctx.reply(cv2({
      color: won ? 0x57f287 : 0xff3333,
      title: won ? "🎲 You Rolled High!" : "🎲 You Rolled Low",
      description: `You rolled **${roll}**. ${won ? "You win 1.5x!" : "You needed over 60."}`,
      fields: [
        { name: won ? "Payout" : "You lost", value: formatCurrency(won ? payout : amount, config.primary), inline: true },
        { name: "New balance", value: formatCurrency(updated.primary, config.primary), inline: true },
      ],
    }));
  },
};
