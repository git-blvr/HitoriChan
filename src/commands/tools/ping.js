import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency"),
  prefixName: "ping",
  aliases: ["pg"],
  syntax: "{prefix}ping",
  example: "{prefix}ping",
  async execute(ctx) {
    const sent = Date.now();
    await ctx.deferReply();

    await ctx.editReply(cv2({
      color: 0x5865f2,
      title: "Pong!",
      fields: [
        { name: "Latency", value: `${Date.now() - sent}ms`, inline: true },
        { name: "API Latency", value: `${Math.round(ctx.client.ws.ping)}ms`, inline: true },
      ],
    }));
  },
};
