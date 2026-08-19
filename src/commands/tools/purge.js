import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { buildEmbed, requireModerator, sendLog } from "../moderation/moderationHelpers.js";
import { embErr, embWrn } from "../../helpers/embeds.js";
import { resolveTarget } from "../../utils/resolveTarget.js";

const MAX_PURGE = 100;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export default {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk delete messages in this channel")
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("Number of messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(MAX_PURGE)
    )
    .addUserOption((o) => o.setName("target").setDescription("Only delete messages from this user"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  prefixName: "purge",
  aliases: ["clear"],
  syntax: "{prefix}purge <amount> [@user]",
  example: "{prefix}purge 10",
  async execute(ctx) {
    if (!(await requireModerator(ctx))) return;

    const amount = ctx.isInteraction
      ? ctx.source?.options?.getInteger("amount")
      : parseInt(ctx.args?.[0]);

    if (!amount || isNaN(amount) || amount < 1 || amount > MAX_PURGE) {
      await ctx.reply(embErr(`Please provide a number between 1 and ${MAX_PURGE}.`));
      return;
    }

    const { target, refMessage } = await resolveTarget(ctx, {
      optionName: "target",
      argIndex: 1,
      fallbackToAuthor: false,
      allowReference: true,
      allowUserFallback: true,
    });

    const filterUserId = target?.id ?? null;

    const fetched = await ctx.channel.messages.fetch({ limit: MAX_PURGE });
    const now = Date.now();

    let messages = fetched
      .filter((m) => now - m.createdTimestamp < MAX_AGE_MS)
      .filter((m) => !filterUserId || m.author.id === filterUserId)
      .first(amount);

    if (!messages.length) {
      await ctx.reply(embWrn("No eligible messages found. Messages older than 14 days cannot be deleted."), refMessage);
      return;
    }

    const deleted = await ctx.channel.bulkDelete(messages, true);

    const logEmbed = buildEmbed(
      `**Purge**\n**Channel:** <#${ctx.channel.id}>\n**Moderator:** <@${ctx.user.id}>\n**Deleted:** ${deleted.size} message(s)${filterUserId ? `\n**Filtered User:** <@${filterUserId}>` : ""}`
    );
    await sendLog(ctx.client, ctx.guild.id, logEmbed);
  },
};