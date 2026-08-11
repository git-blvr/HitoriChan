import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { transferBalance, getGuildEconomyConfig, CURRENCY_TYPES } from "../../utils/economyManager.js";
import { createDescBasicEmbed } from "../../utils/basicEmbed.js";

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
      await ctx.reply(createDescBasicEmbed("This command only works in a server."));
      return;
    }

    const recipientOption = ctx.getOption("user", 0);
    const amountOption = ctx.getOption("amount", 1);
    const currencyOption = ctx.getOption("currency", 2) ?? CURRENCY_TYPES.PRIMARY;
    const recipient = await resolveRecipient(ctx, recipientOption);

    if (!recipient) {
      await ctx.reply(createDescBasicEmbed("Could not find that recipient."));
      return;
    }

    const amount = Number(amountOption);
    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply(createDescBasicEmbed("Please provide a valid amount greater than zero."));
      return;
    }

    if (recipient.id === ctx.user.id) {
      await ctx.reply(createDescBasicEmbed("You cannot pay yourself."));
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
      await ctx.reply(createDescBasicEmbed(error.message || "Could not complete the payment."));
    }
  },
};

async function resolveRecipient(ctx, userOption) {
  if (ctx.isInteraction && userOption) {
    return userOption;
  }

  if (!ctx.guild) return null;

  const raw = String(userOption ?? "");
  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : raw;
  return ctx.guild.members.fetch(id).catch(() => null);
}
