import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { getGuildEconomyConfig, setGuildCurrencies } from "../../utils/economyManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("currency")
    .setDescription("View or customize this server's economy currency names and symbols")
    .addStringOption((option) =>
      option.setName("primary_name").setDescription("Name of the primary currency")
    )
    .addStringOption((option) =>
      option.setName("primary_symbol").setDescription("Symbol for the primary currency")
    )
    .addStringOption((option) =>
      option.setName("secondary_name").setDescription("Name of the secondary currency")
    )
    .addStringOption((option) =>
      option.setName("secondary_symbol").setDescription("Symbol for the secondary currency")
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  prefixName: "currency",
  aliases: ["currencies", "moneyconfig"],
  syntax: "{prefix}currency [primary_name] [primary_symbol] [secondary_name] [secondary_symbol]",
  example: "{prefix}currency StarryCoins $C FOLTs £T",
  
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply("This command only works in a server.");
      return;
    }

    const primaryName = ctx.getOption("primary_name", 0);
    const primarySymbol = ctx.getOption("primary_symbol", 1);
    const secondaryName = ctx.getOption("secondary_name", 2);
    const secondarySymbol = ctx.getOption("secondary_symbol", 3);

    const config = await getGuildEconomyConfig(ctx.guild.id);

    if (!primaryName && !primarySymbol && !secondaryName && !secondarySymbol) {
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("Currency Configuration")
            .addFields(
              { name: "Primary Currency", value: `${config.primary.name} (${config.primary.symbol})`, inline: true },
              { name: "Secondary Currency", value: `${config.secondary.name} (${config.secondary.symbol})`, inline: true }
            )
            .setDescription("Use this command with options to customize currency names and symbols.")
        ],
      });
      return;
    }

    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await ctx.reply("You need the Manage Server permission to update currency settings.");
      return;
    }

    const updated = await setGuildCurrencies(ctx.guild.id, {
      primaryName,
      primarySymbol,
      secondaryName,
      secondarySymbol,
    });

    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Currency Settings Updated")
          .addFields(
            { name: "Primary Currency", value: `${updated.primaryCurrency.name} (${updated.primaryCurrency.symbol})`, inline: true },
            { name: "Secondary Currency", value: `${updated.secondaryCurrency.name} (${updated.secondaryCurrency.symbol})`, inline: true }
          ),
      ],
    });
  },
};
