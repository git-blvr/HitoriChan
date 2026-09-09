import { SlashCommandBuilder } from "discord.js";
import * as Marriage from "../../models/Marriage.js";
import * as MarriageSettings from "../../models/MarriageSettings.js";
import { replacePlaceholders } from "../../helpers/placeholders.js";

export default {
  data: new SlashCommandBuilder()
    .setName("divorce")
    .setDescription("Divorce your current partner.")
    .addStringOption((option) =>
      option.setName("confirm").setDescription("Type 'yes' to confirm").setRequired(false)
    ),
  prefixName: "divorce",
  category: "social",
  async execute(ctx) {
    await ctx.deferReply({ flags: 64 });

    const guildId = ctx.guild?.id;
    if (!guildId) return ctx.editReply("This command only works in a server.");

    const settings = await MarriageSettings.getOrCreate(guildId);
    const partnerId = await Marriage.getPartner(guildId, ctx.user.id);
    if (!partnerId) return ctx.editReply("You are not married.");

    const confirm = (ctx.getOption("confirm", 0) || "").toLowerCase();
    if (confirm !== "yes") {
      return ctx.editReply("Type `yes` to confirm the divorce.");
    }

    await Marriage.removeByUser(guildId, ctx.user.id);

    const text = replacePlaceholders(settings.divorceMessage || "{user} and {target} are no longer married.", {
      member: ctx.member,
      user: ctx.user,
      target: await ctx.client.users.fetch(partnerId).catch(() => null),
      guild: ctx.guild,
    });

    await ctx.editReply(text);
  },
};
