import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as MarriageSettings from "../../models/MarriageSettings.js";
import * as Marriage from "../../models/Marriage.js";
import { hasItemsForProposal, buildProposalPayload, buildMarriagePayload, consumeProposalItems } from "../../utils/marriage.js";

export default {
  data: new SlashCommandBuilder()
    .setName("propose")
    .setDescription("Propose to another user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user you want to marry").setRequired(true)
    ),
  prefixName: "propose",
  category: "social",
  async execute(ctx) {
    await ctx.deferReply();

    const guildId = ctx.guild?.id;
    if (!guildId) return ctx.editReply("This command only works in a server.");

    const settings = await MarriageSettings.getOrCreate(guildId);
    if (!settings.enabled) return ctx.editReply("Marriage is not enabled on this server.");

    const target = ctx.getOption("user", 0) ? await ctx.client.users.fetch(ctx.getOption("user", 0)) : null;
    if (!target) return ctx.editReply("Could not find that user.");
    if (target.id === ctx.user.id) return ctx.editReply("You can't marry yourself.");
    if (target.bot) return ctx.editReply("You can't marry a bot.");

    if (await Marriage.isMarried(guildId, ctx.user.id)) return ctx.editReply("You are already married.");
    if (await Marriage.isMarried(guildId, target.id)) return ctx.editReply("That user is already married.");

    const has = await hasItemsForProposal(guildId, ctx.user.id, settings);
    if (!has.ring || !has.contract) {
      const missing = [];
      if (!has.ring) missing.push("ring");
      if (!has.contract) missing.push("marriage contract");
      return ctx.editReply(`You need a **${missing.join("** and **")}** in your inventory to propose.`);
    }

    const targetMember = await ctx.guild?.members?.fetch?.(target.id).catch(() => null);
    if (!targetMember) return ctx.editReply("That user is not in this server.");

    const proposerMember = ctx.member;

    const payload = buildProposalPayload(settings, proposerMember, targetMember);
    await ctx.editReply(payload);
  },
};
