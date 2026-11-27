import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { getGameConfig, setGameConfig } from "../../utils/economyManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("econfig")
    .setDescription("Configure gambling, work, weekly, and bank settings for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName("gambling").setDescription("Allow wager games"))
    .addIntegerOption((o) => o.setName("max_bet").setDescription("Maximum bet (0 = unlimited)").setMinValue(0))
    .addBooleanOption((o) => o.setName("rob").setDescription("Allow /rob"))
    .addIntegerOption((o) => o.setName("work_min").setDescription("Minimum /work payout").setMinValue(0))
    .addIntegerOption((o) => o.setName("work_max").setDescription("Maximum /work payout").setMinValue(0))
    .addIntegerOption((o) => o.setName("work_cooldown").setDescription("/work cooldown in minutes").setMinValue(1))
    .addIntegerOption((o) => o.setName("weekly_min").setDescription("Minimum /weekly payout").setMinValue(0))
    .addIntegerOption((o) => o.setName("weekly_max").setDescription("Maximum /weekly payout").setMinValue(0))
    .addNumberOption((o) => o.setName("bank_interest").setDescription("Daily bank interest % (0-10)").setMinValue(0).setMaxValue(10)),
  prefixName: "econfig",
  aliases: ["economyconfig", "gameconfig"],
  syntax: "{prefix}econfig [key value]…",
  example: "{prefix}econfig gambling on  maxbet 5000",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      return ctx.reply(embErr("You need the Manage Server permission to change economy settings."));
    }

    if (!ctx.isInteraction) {
      // Prefix mode: econfig <key> <value> — keep it simple key/value pairs.
      const [key, ...rest] = ctx.args;
      const value = rest.join(" ");
      if (!key) return showCurrent(ctx);
      const patch = parsePrefixKV(key, value);
      if (!patch) {
        return ctx.reply(embErr("Keys: gambling on/off, maxbet <n>, rob on/off, workmin <n>, workmax <n>, workcd <minutes>, weeklymin <n>, weeklymax <n>, interest <%>"));
      }
      const saved = await setGameConfig(ctx.guild.id, patch);
      return ctx.reply(cv2({ color: 0x57f287, title: "Economy settings updated", description: describe(saved) }));
    }

    const gambling = ctx.getOption("gambling");
    const maxBet = ctx.getOption("max_bet");
    const rob = ctx.getOption("rob");
    const workMin = ctx.getOption("work_min");
    const workMax = ctx.getOption("work_max");
    const workCd = ctx.getOption("work_cooldown");
    const weeklyMin = ctx.getOption("weekly_min");
    const weeklyMax = ctx.getOption("weekly_max");
    const interest = ctx.getOption("bank_interest");

    const patch = {};
    if (gambling !== null) patch.gamblingEnabled = Boolean(gambling);
    if (maxBet !== null) patch.gamblingMaxBet = Number(maxBet) === 0 ? null : Number(maxBet);
    if (rob !== null) patch.robEnabled = Boolean(rob);
    if (workMin !== null) patch.workMin = Number(workMin);
    if (workMax !== null) patch.workMax = Number(workMax);
    if (workCd !== null) patch.workCooldownSeconds = Number(workCd) * 60;
    if (weeklyMin !== null) patch.weeklyMin = Number(weeklyMin);
    if (weeklyMax !== null) patch.weeklyMax = Number(weeklyMax);
    if (interest !== null) patch.bankInterestRate = Number(interest);

    if (!Object.keys(patch).length) return showCurrent(ctx);

    const saved = await setGameConfig(ctx.guild.id, patch);
    return ctx.reply(cv2({ color: 0x57f287, title: "Economy settings updated", description: describe(saved) }));
  },
};

async function showCurrent(ctx) {
  const cfg = await getGameConfig(ctx.guild.id);
  return ctx.reply(cv2({
    color: 0x5865f2,
    title: "Economy & game settings",
    description: describe(cfg),
  }));
}

function describe(c) {
  return [
    `Gambling: **${c.gamblingEnabled ? "enabled" : "disabled"}**${c.gamblingMaxBet != null ? ` (max bet ${c.gamblingMaxBet.toLocaleString()})` : ""}`,
    `Robbing: **${c.robEnabled ? "enabled" : "disabled"}**`,
    `Work: **${c.workMin.toLocaleString()}–${c.workMax.toLocaleString()}** every **${Math.round(c.workCooldownSeconds / 60)}m**`,
    `Weekly: **${c.weeklyMin.toLocaleString()}–${c.weeklyMax.toLocaleString()}**`,
    `Bank interest: **${c.bankInterestRate}%/day**`,
  ].join("\n");
}

function parsePrefixKV(key, value) {
  const k = String(key).toLowerCase();
  const n = Number(value);
  const on = /^(on|true|enable|enabled|yes)$/i.test(value);
  const off = /^(off|false|disable|disabled|no)$/i.test(value);
  switch (k) {
    case "gambling": case "gamble":
      if (on) return { gamblingEnabled: true };
      if (off) return { gamblingEnabled: false };
      return null;
    case "rob":
      if (on) return { robEnabled: true };
      if (off) return { robEnabled: false };
      return null;
    case "maxbet": case "max_bet":
      if (!Number.isFinite(n) || n < 0) return null;
      return { gamblingMaxBet: n === 0 ? null : Math.floor(n) };
    case "workmin": return Number.isFinite(n) && n >= 0 ? { workMin: Math.floor(n) } : null;
    case "workmax": return Number.isFinite(n) && n >= 0 ? { workMax: Math.floor(n) } : null;
    case "workcd": case "workcooldown": return Number.isFinite(n) && n >= 1 ? { workCooldownSeconds: Math.floor(n) * 60 } : null;
    case "weeklymin": return Number.isFinite(n) && n >= 0 ? { weeklyMin: Math.floor(n) } : null;
    case "weeklymax": return Number.isFinite(n) && n >= 0 ? { weeklyMax: Math.floor(n) } : null;
    case "interest": case "bankinterest": return Number.isFinite(n) && n >= 0 && n <= 10 ? { bankInterestRate: n } : null;
    default: return null;
  }
}
