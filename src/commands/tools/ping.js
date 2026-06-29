import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

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

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Pong!")
      .addFields(
        { name: "Latency", value: `${Date.now() - sent}ms`, inline: true },
        { name: "API Latency", value: `${Math.round(ctx.client.ws.ping)}ms`, inline: true }
      );

    await ctx.editReply({ embeds: [embed] });
  },
};