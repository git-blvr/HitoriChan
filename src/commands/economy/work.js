import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getEconomyAccount, claimWork, getGameConfig, getWorkCooldown, getGuildEconomyConfig } from "../../utils/economyManager.js";
import { embErr, embWrn } from "../../helpers/embeds.js";

const JOBS = [
  "You tuned guitars at the livehouse",
  "You sold merch at the Kessoku Band show",
  "You swept the stage after rehearsal",
  "You mixed a track for a local band",
  "You handed out flyers for STARRY",
  "You repaired a stubborn amp",
  "You taught a beginner their first chords",
  "You carried equipment through Shimokitazawa",
  "You catalogued the studio's vinyl shelf",
  "You wrote lyrics on the last train home",
  "You manned the ticket booth tonight",
  "You fixed the drummer's snare mid-set",
];

function fmtRemaining(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export default {
  data: new SlashCommandBuilder()
    .setName("work")
    .setDescription("Work a shift for coins — available once per hour"),
  prefixName: "work",
  aliases: ["shift", "job"],
  syntax: "{prefix}work",
  example: "{prefix}work",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));

    const [account, games] = await Promise.all([
      getEconomyAccount(ctx.guild.id, ctx.user.id),
      getGameConfig(ctx.guild.id),
    ]);

    const remaining = getWorkCooldown(account, games.workCooldownSeconds);
    if (remaining > 0) {
      return ctx.reply(embWrn(`**Shift already done**\n\nCome back in ${fmtRemaining(remaining)} for your next shift.`));
    }

    const claimed = await claimWork(ctx.guild.id, ctx.user.id);
    if (!claimed) {
      return ctx.reply(embWrn("**Shift already done**\n\nYour shift was already claimed — check back soon."));
    }
    const { account: updated, reward } = claimed;
    const config = await getGuildEconomyConfig(ctx.guild.id);
    const job = JOBS[Math.floor(Math.random() * JOBS.length)];

    await ctx.reply(cv2({
      color: 0x57f287,
      title: "Shift complete",
      description: `${job} — earned **${config.primary.symbol}${reward.toLocaleString()} ${config.primary.name}**.`,
      fields: [
        { name: "Wallet", value: formatWallet(updated, config), inline: true },
        { name: "Next shift", value: `in ${fmtRemaining(games.workCooldownSeconds * 1000)}`, inline: true },
      ],
    }));
  },
};

function formatWallet(account, config) {
  const emoji = config.primary.emoji ? `${config.primary.emoji} ` : "";
  return `${emoji}${(account.primary ?? 0).toLocaleString()}`;
}
