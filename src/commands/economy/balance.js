import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getEconomyAccount, getGuildEconomyConfig, formatCurrency, getExchangeRate } from "../../utils/economyManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show your balance or another member's balance")
    .addUserOption((option) => option.setName("user").setDescription("Member to view")),
  prefixName: "balance",
  aliases: ["bal", "money"],
  syntax: "{prefix}balance [@user]",
  example: "{prefix}balance",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply("This command only works in a server.");
      return;
    }

    const userOption = ctx.getOption("user", 0);
    const target = await resolveTarget(ctx, userOption);
    if (!target) {
      await ctx.reply("Could not find that member.");
      return;
    }

    const config = await getGuildEconomyConfig(ctx.guild.id);
    const account = await getEconomyAccount(ctx.guild.id, target.id);
    const rate = getExchangeRate(ctx.guild.id);

    const displayName = target.user ? `${target.user.username}#${target.user.discriminator}` : target.user ?? target.username;
    const avatarUrl = (target.user ? target.user : target).displayAvatarURL?.({ dynamic: true, size: 1024 }) ?? null;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${displayName} — Balance`)
      .setThumbnail(avatarUrl)
      .setDescription(`Here are the current balances for **${displayName.split("#")[0]}**:`)
      .addFields(
        { name: `${config.primary.name}`, value: `${formatCurrency(account.primary, config.primary)}`, inline: true },
        { name: `${config.secondary.name}`, value: `${formatCurrency(account.secondary, config.secondary)}`, inline: true },
        { name: "Exchange Rate", value: `1 ${config.primary.name} = ${rate} ${config.secondary.name}`, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "HitoriChan Economy" });

    await ctx.reply({ embeds: [embed] });
  },
};

async function resolveTarget(ctx, userOption) {
  if (ctx.isInteraction && userOption) {
    return userOption;
  }

  if (!ctx.guild) return null;

  if (userOption) {
    const raw = String(userOption);
    const mentionMatch = raw.match(/^<@!?(\d+)>$/);
    const id = mentionMatch ? mentionMatch[1] : raw;
    return ctx.guild.members.fetch(id).catch(() => null);
  }

  return ctx.member;
}
