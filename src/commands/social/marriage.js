import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import * as Marriage from "../../models/Marriage.js";

export default {
  data: new SlashCommandBuilder()
    .setName("marriage")
    .setDescription("Show your current marriage or another user's.")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to check (defaults to you)").setRequired(false)
    ),
  prefixName: "marriage",
  category: "social",
  async execute(ctx) {
    await ctx.deferReply({ flags: 64 }); // ephemeral

    const guildId = ctx.guild?.id;
    if (!guildId) return ctx.editReply("This command only works in a server.");

    const targetId = ctx.getOption("user", 0) || ctx.user.id;
    const partnerId = await Marriage.getPartner(guildId, targetId);
    if (!partnerId) {
      return ctx.editReply("No active marriage found.");
    }

    const user = await ctx.client.users.fetch(targetId).catch(() => null);
    const partner = await ctx.client.users.fetch(partnerId).catch(() => null);

    const payload = cv2({
      color: 0xff69b4,
      title: "💍 Marriage",
      description: partner ? `**${user?.username || "Unknown"}** is married to **${partner.username}**` : "Married.",
      thumbnail: user?.displayAvatarURL?.({ size: 128 }) ?? null,
      image: partner?.displayAvatarURL?.({ size: 128 }) ?? null,
    });

    await ctx.editReply(payload);
  },
};
