import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr, embWrn } from "../../helpers/embeds.js";
import {
  getEconomyAccount, getGameConfig, getGuildEconomyConfig, formatCurrency,
} from "../../utils/economyManager.js";
import { checkCooldown } from "../../utils/cooldowns.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import * as EconomyAccount from "../../models/EconomyAccount.js";

const COOLDOWN_MS = 30 * 60 * 1000;
const SUCCESS_CHANCE = 0.45;
const STEAL_MIN_PCT = 0.05;
const STEAL_MAX_PCT = 0.15;
const FINE_PCT = 0.10;
const MIN_TARGET_WALLET = 250; // don't let robbers farm brand-new accounts

export default {
  data: new SlashCommandBuilder()
    .setName("rob")
    .setDescription("Attempt to steal coins from someone's wallet — banked coins are safe")
    .addUserOption((o) => o.setName("user").setDescription("Who to rob").setRequired(true)),
  prefixName: "rob",
  aliases: ["steal", "mug"],
  syntax: "{prefix}rob @user",
  example: "{prefix}rob @someone",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));

    const games = await getGameConfig(ctx.guild.id);
    if (!games.robEnabled) return ctx.reply(embErr("Robbing is disabled on this server."));

    const { target } = await resolveTarget(ctx, { optionName: "user", argIndex: 0, fallbackToAuthor: false });
    if (!target) return ctx.reply(embErr("Mention someone to rob."));
    const targetId = target.user?.id ?? target.id;
    if (targetId === ctx.user.id) return ctx.reply(embErr("You can't rob yourself."));
    if ((target.user ?? target).bot) return ctx.reply(embErr("Bots keep their coins in a vault you can't crack."));

    const remaining = checkCooldown(ctx.user.id, "rob", COOLDOWN_MS);
    if (remaining > 0) {
      return ctx.reply(embWrn(`You're laying low — try again in ${Math.ceil(remaining / 60)}m.`));
    }

    const config = await getGuildEconomyConfig(ctx.guild.id);
    const [robber, victim] = await Promise.all([
      getEconomyAccount(ctx.guild.id, ctx.user.id),
      getEconomyAccount(ctx.guild.id, targetId),
    ]);

    if (victim.primary < MIN_TARGET_WALLET) {
      return ctx.reply(embWrn(`<@${targetId}> only has ${formatCurrency(victim.primary, config.primary)} in their wallet — nothing worth taking.`));
    }

    const success = Math.random() < SUCCESS_CHANCE;

    if (success) {
      const pct = STEAL_MIN_PCT + Math.random() * (STEAL_MAX_PCT - STEAL_MIN_PCT);
      const stolen = Math.max(1, Math.floor(victim.primary * pct));
      victim.primary -= stolen;
      robber.primary += stolen;
      await Promise.all([EconomyAccount.save(victim), EconomyAccount.save(robber)]);
      return ctx.reply(cv2({
        color: 0x57f287,
        title: "🦹 Clean getaway",
        description: `You slipped **${formatCurrency(stolen, config.primary)}** out of <@${targetId}>'s wallet.`,
        fields: [
          { name: "Your wallet", value: formatCurrency(robber.primary, config.primary), inline: true },
        ],
      }));
    }

    const fine = Math.max(0, Math.floor(robber.primary * FINE_PCT));
    if (fine > 0) {
      robber.primary -= fine;
      victim.primary += fine;
      await Promise.all([EconomyAccount.save(victim), EconomyAccount.save(robber)]);
    }
    return ctx.reply(cv2({
      color: 0xff4d4f,
      title: "🚨 Busted",
      description: `<@${targetId}> caught you in the act.${fine ? ` You paid them **${formatCurrency(fine, config.primary)}** in damages.` : " They let you off with a warning — you had nothing to pay."}`,
    }));
  },
};
