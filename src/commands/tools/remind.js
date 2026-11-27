import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr, embSuc } from "../../helpers/embeds.js";
import { parseDuration, formatDuration, timestampSeconds } from "../../helpers/time.js";
import * as Reminder from "../../models/Reminder.js";

const COLOR = 0xffb224;
const MAX_REMIND_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export default {
  data: new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Set a reminder — the bot pings you when it fires.")
    .addSubcommand((sub) =>
      sub.setName("me")
        .setDescription("Create a reminder")
        .addStringOption((o) => o.setName("in").setDescription("When — e.g. 10m, 2h, 1d").setRequired(true))
        .addStringOption((o) => o.setName("message").setDescription("What to remind you about").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List your pending reminders"))
    .addSubcommand((sub) =>
      sub.setName("cancel")
        .setDescription("Cancel a reminder by id")
        .addIntegerOption((o) => o.setName("id").setDescription("Reminder id (see /remind list)").setRequired(true))
    ),
  prefixName: "remind",
  aliases: ["remindme", "reminder"],
  syntax: "{prefix}remind <in> <message> | {prefix}remind list | {prefix}remind cancel <id>",
  example: "{prefix}remind 30m check the oven",
  async execute(ctx) {
    const sub = ctx.isInteraction ? ctx.source.options.getSubcommand(false) : (ctx.args?.[0] ?? "").toLowerCase();

    if (sub === "list" || (!ctx.isInteraction && sub === "list")) {
      const items = Reminder.getForUser(ctx.user.id);
      if (!items.length) {
        await ctx.reply(cv2({ color: COLOR, title: "Reminders", description: "You have no pending reminders." }));
        return;
      }
      const lines = items.map(
        (r) => `**#${r.id}** — <t:${timestampSeconds(new Date(r.remindAt))}:R> · ${r.message}`
      );
      await ctx.reply(cv2({ color: COLOR, title: "Your reminders", description: lines.join("\n"), ephemeral: ctx.isInteraction }));
      return;
    }

    if (sub === "cancel") {
      const id = ctx.isInteraction ? ctx.getOption("id") : Number(ctx.args?.[1]);
      if (!Number.isInteger(id)) {
        await ctx.reply(embErr("Give a reminder id — see `/remind list`."));
        return;
      }
      const ok = Reminder.cancel(id, ctx.user.id);
      await ctx.reply(
        ok
          ? embSuc(`Reminder #${id} cancelled.`)
          : embErr(`No reminder #${id} found for you.`)
      );
      return;
    }

    // Create — slash "me" subcommand, or prefix: {prefix}remind 10m message…
    let durationRaw, message;
    if (ctx.isInteraction) {
      durationRaw = ctx.getOption("in");
      message = ctx.getOption("message");
    } else {
      durationRaw = ctx.args?.[0];
      message = (ctx.args || []).slice(1).join(" ");
    }

    const ms = parseDuration(String(durationRaw || ""));
    if (!ms || ms < 10_000) {
      await ctx.reply(embErr("Give a duration like `10m`, `2h`, `1d` — minimum 10 seconds."));
      return;
    }
    if (ms > MAX_REMIND_MS) {
      await ctx.reply(embErr("Reminders can be at most 30 days out."));
      return;
    }
    message = String(message || "").trim();
    if (!message) {
      await ctx.reply(embErr("Give a message to remind you about."));
      return;
    }
    if (message.length > 500) message = message.slice(0, 497) + "…";

    const remindAt = Date.now() + ms;
    const reminder = Reminder.create({
      guildId: ctx.guild?.id ?? null,
      channelId: ctx.channel?.id ?? null,
      userId: ctx.user.id,
      message,
      remindAt,
    });

    await ctx.reply(cv2({
      color: COLOR,
      title: "Reminder set",
      description: `I'll ping you <t:${timestampSeconds(new Date(remindAt))}:R> (**${formatDuration(ms)}**): ${message}`,
      footer: { text: `Reminder #${reminder.id}` },
    }));
  },
};
