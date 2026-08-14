import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, getGuildEconomyConfig, getExchangeRate } from "../../utils/economyManager.js";
import { embErr } from "../../helpers/embeds.js";

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
      await ctx.reply(embErr("This command only works in a server."));
      return;
    }

    const userOption = ctx.getOption("user", 0);
    const target = await resolveTarget(ctx, userOption);
    if (!target) {
      await ctx.reply(embErr("Could not find that member."));
      return;
    }

    const config = await getGuildEconomyConfig(ctx.guild.id);
    const account = await getEconomyAccount(ctx.guild.id, target.id);
    const rate = getExchangeRate(ctx.guild.id);

    const displayName = target.user ? target.user.username : target.username;
    const avatarUrl = (target.user ? target.user : target).displayAvatarURL?.({ size: 1024 }) ?? null;

    let status;

    if (account.primary === 0 && account.secondary === 0) {
      status = `Broke ahh :sob:`;
    } else if (account.primary === 0) {
      status = `It seems like ${target} either exchanged it to play games or they're so broke.`;
    } else if (account.secondary === 0) {
      status = `It seems like ${target} either played too much or exchanged all the ${config.secondary.name}.`;
    } else if (account.primary === 67 || account.secondary === 67) {
      status = `67 :fire:`;
    } else if (account.primary === account.secondary) {
      status = `Oh! ${target} has equal amounts of both, perfect and balanced.`;
    } else if (account.primary > account.secondary) {
      status = `${target} currently has more ${config.primary.name}, seems balanced.`;
    } else {
      status = `${target} currently has more ${config.secondary.name}, it seems like ${displayName} is playing too many games.`;
    }

    await ctx.reply(cv2({
      color: 0x5865f2,
      title: `${displayName}'s Balance`,
      description: status,
      thumbnail: avatarUrl,
      fields: [
        { name: `${config.primary.name}`, value: `${account.primary}`, inline: true },
        { name: `${config.secondary.name}`, value: `${account.secondary}`, inline: true },
      ],
      footer: { text: `Exchange Rate: 1 ${config.primary.name} = ${rate} ${config.secondary.name}` },
      timestamp: true,
    }));
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
