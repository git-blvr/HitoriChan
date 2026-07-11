import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { convertPrimaryToSecondary, convertSecondaryToPrimary, getGuildEconomyConfig, getExchangeRate } from "../../utils/economyManager.js";
import { createBasicEmbed } from '../../utils/basicEmbed.js'

const FROM_CHOICES = [
  { name: "Convert from Starry Coins to FOLTs", value: "primary" },
  { name: "Convert from FOLTs to Starry Coins", value: "secondary" },
];

export default {
  data: new SlashCommandBuilder()
    .setName("exchange")
    .setDescription("Convert between Starry Coins and FOLTs at the current exchange rate")
    .addIntegerOption((option) => option.setName("amount").setDescription("Amount to convert").setRequired(true).setMinValue(1))
    .addStringOption((option) =>
      option
        .setName("from")
        .setDescription("Currency to convert from")
        .addChoices(...FROM_CHOICES)
    ),
  prefixName: "exchange",
  aliases: ["convert", "trade"],
  syntax: "{prefix}exchange <amount> [from]",
  example: "{prefix}exchange 10 coins",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply("This command only works in a server.");
      return;
    }

    const amount = Number(ctx.getOption("amount", 0));
    const rawFrom = ctx.getOption("from", 1) ?? ctx.args?.[1] ?? "primary";
    const from = String(rawFrom).toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply("Please provide a valid amount to convert.");
      return;
    }

    const config = await getGuildEconomyConfig(ctx.guild.id);
    const rate = getExchangeRate(ctx.guild.id);

    let direction = "primary";
    if (from === "secondary" || from === "folts" || from === "f" || from === "s") {
      direction = "secondary";
    }

    try {
      let result;
      let description;

      if (direction === "secondary") {
        result = await convertSecondaryToPrimary(ctx.guild.id, ctx.user.id, amount);
        description = `Converted ${config.secondary.symbol}${amount.toLocaleString()} ${config.secondary.name} into ${config.primary.symbol}${result.converted.toLocaleString()} ${config.primary.name} at a rate of 1 ${config.primary.name} = ${rate} ${config.secondary.name}.`;
      } else {
        result = await convertPrimaryToSecondary(ctx.guild.id, ctx.user.id, amount);
        description = `Converted ${config.primary.symbol}${amount.toLocaleString()} ${config.primary.name} into ${config.secondary.symbol}${result.converted.toLocaleString()} ${config.secondary.name} at a rate of 1 ${config.primary.name} = ${rate} ${config.secondary.name}.`;
      }

      await ctx.reply({
        embeds: [
          createBasicEmbed("Exchange Completed", description)
            .addFields(
              { name: `New ${config.primary.name} Balance`, value: `${config.primary.symbol}${result.account.primary.toLocaleString()}`, inline: true },
              { name: `New ${config.secondary.name} Balance`, value: `${config.secondary.symbol}${result.account.secondary.toLocaleString()}`, inline: true }
            ),
        ],
      });
    } catch (error) {
      await ctx.reply(error.message || "Could not complete exchange.");
    }
  },
};
