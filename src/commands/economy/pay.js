import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { transferBalance, getGuildEconomyConfig, CURRENCY_TYPES } from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";
import { resolveTarget } from "../../utils/resolveTarget.js";

const currencyChoices = [
  { name: "coins", value: CURRENCY_TYPES.PRIMARY },
  { name: "folts", value: CURRENCY_TYPES.SECONDARY },
];

export default {
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Pay another member in a guild currency")
    .addUserOption((option) => option.setName("user").setDescription("Recipient").setRequired(true))
    .addIntegerOption((option) => option.setName("amount").setDescription("Amount to send").setRequired(true).setMinValue(1))
    .addStringOption((option) =>
      option
        .setName("currency")
        .setDescription("Currency to pay with")
        .addChoices(...currencyChoices)
    ),
  prefixName: "pay",
  aliases: ["send"],
  syntax: "{prefix}pay @user <amount> [currency]",
  example: "{prefix}pay @friend 100 $C",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply(embErr("This command only works in a server."));
      return;
    }

    const { target: recipient, consumed } = await resolveTarget(ctx, {
      optionName: "user",
      argIndex: 0,
      fallbackToAuthor: false,
      allowReference: true,
      allowUserFallback: true,
    });

    const amountOption = ctx.getOption("amount", consumed);
    const currencyOption = ctx.getOption("currency", consumed + 1) ?? CURRENCY_TYPES.PRIMARY;

    if (!recipient) {
      await ctx.reply(embErr("Could not find that recipient."));
      return;
    }

    const amount = Number(amountOption);
    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply(embErr("Please provide a valid amount greater than zero."));
      return;
    }

    if (recipient.id === ctx.user.id) {
      await ctx.reply(embErr("You cannot pay yourself."));
      return;
    }

    try {
      const config = await getGuildEconomyConfig(ctx.guild.id);
      const currencyName = currencyOption === CURRENCY_TYPES.SECONDARY ? config.secondary.name : config.primary.name;

      await transferBalance(ctx.guild.id, ctx.user.id, recipient.id, amount, currencyOption);

      await ctx.reply(cv2({
        color: 0xff61a5,
        title: "Payment Sent!",
        description: `You sent ${amount.toLocaleString()} ${currencyName} to ${recipient.user?.username ?? recipient.username}.`,
      }));
    } catch (error) {
      await ctx.reply(embErr(error.message || "Could not complete the payment."));
    }
  },
};
