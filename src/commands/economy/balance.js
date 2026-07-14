import { SlashCommandBuilder, EmbedBuilder, InviteTargetUsersJobStatus } from "discord.js";
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

    const displayName = target.user ? `${target.user.username}` : target.user ?? target.username;
    const avatarUrl = (target.user ? target.user : target).displayAvatarURL?.({ dynamic: true, size: 1024 }) ?? null;

    let status;

    if (account.primary < account.secondary) {
      status = `${target.user} currently has more ${config.secondary.name}, it seems like ${target.user.username} is playing too much games.`;
    }
    if (account.primary > account.secondary) {
      status = `${target.user} currently has more ${config.primary.name}, seems balanced.`;
    }
    if (account.primary === account.secondary) {
      status = `Oh! ${target.user} has equal amounts of both, perfect and balanced.`;
    }
    if (account.primary === 67 || account.secondary === 67) {
      status = `67 :fire:`;
    }
    if (account.primary === 0) {
      status = `It seems like ${target.user} either exchanged it to play games or they're so broke.`
    }
    if (account.secondary === 0) {
      status = `It seems like ${target.user} either played too much or exchanged all the ${config.secondary.name}`
    }
    if (account.primary === 0 && account.secondary === 0) {
      status = `Broke ahh :sob:`
    }
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${displayName}'s Balance`)
      .setThumbnail(avatarUrl)
      .setDescription(`${status}`)
      .addFields(
        { 
          name: `${config.primary.name}`, 
          value: `${account.primary}`, 
          inline: true 
        },
        { 
          name: `${config.secondary.name}`, 
          value: `${account.secondary}`, 
          inline: true 
        }
      )
      .setTimestamp()
      .setFooter({ text: `Exchanging Rate: 1 ${config.primary.name} = ${rate} ${config.secondary.name}` });

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
