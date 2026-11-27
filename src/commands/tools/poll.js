import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { embErr } from "../../helpers/embeds.js";
import { parseDuration } from "../../helpers/time.js";
import * as Poll from "../../models/Poll.js";
import { buildPollComponents } from "../../utils/pollManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a poll with voting buttons.")
    .addStringOption((option) =>
      option.setName("question").setDescription("The question to ask").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("options").setDescription("Options separated by | (2-10)").setRequired(true)
    )
    .addBooleanOption((option) =>
      option.setName("multi").setDescription("Allow voting for multiple options")
    )
    .addStringOption((option) =>
      option.setName("duration").setDescription("Auto-close after e.g. 10m, 2h, 1d")
    ),
  prefixName: "poll",
  syntax: "{prefix}poll <question> | <option1> | <option2> [| more options]",
  example: "{prefix}poll Best fruit? | Apple | Banana | Cherry",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply(embErr("This command only works in a server."));
      return;
    }

    let question;
    let options;
    let multi = false;
    let durationMs = null;

    if (ctx.isInteraction) {
      question = ctx.getOption("question");
      multi = Boolean(ctx.getOption("multi"));
      const rawOptions = String(ctx.getOption("options") || "");
      options = rawOptions.split("|").map((s) => s.trim()).filter(Boolean);
      const duration = ctx.getOption("duration");
      if (duration) {
        durationMs = parseDuration(duration);
        if (!durationMs) {
          await ctx.reply(embErr("Invalid duration. Use formats like `10m`, `2h`, `1d`."));
          return;
        }
      }
    } else {
      const parts = (ctx.args || []).join(" ").split("|").map((s) => s.trim()).filter(Boolean);
      question = parts.shift();
      options = parts;
    }

    if (!question || options.length < 2) {
      await ctx.reply(embErr("Provide a question and at least 2 options separated by `|`."));
      return;
    }
    if (options.length > 10) {
      await ctx.reply(embErr("Polls support at most 10 options."));
      return;
    }
    if (question.length > 256) question = question.slice(0, 253) + "…";
    options = options.slice(0, 10).map((o) => (o.length > 80 ? o.slice(0, 77) + "…" : o));

    const endsAt = durationMs ? Date.now() + durationMs : null;
    const poll = Poll.create({
      guildId: ctx.guild.id,
      channelId: ctx.channel.id,
      authorId: ctx.user.id,
      question,
      options,
      multi,
      endsAt,
    });

    const payload = {
      components: buildPollComponents(poll),
      flags: MessageFlags.IsComponentsV2,
    };

    if (ctx.isInteraction) {
      await ctx.reply(payload);
      const msg = await ctx.fetchReplyMessage();
      if (msg?.id) Poll.setMessageId(poll.id, msg.id);
    } else {
      const msg = await ctx.reply(payload);
      if (msg?.id) Poll.setMessageId(poll.id, msg.id);
    }
  },
};
