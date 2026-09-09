import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { formatDuration } from "../../helpers/time.js";

export default {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Show information about the bot."),
  prefixName: "info",
  aliases: ["botinfo", "stats"],
  syntax: "{prefix}info",
  example: "{prefix}info",
  async execute(ctx) {
    await ctx.deferReply();

    const client = ctx.client;
    const guilds = client.guilds.cache.size;
    const users = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
    const ping = Math.round(client.ws.ping ?? 0);
    const uptime = client.uptime ?? 0;
    const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    const fields = [
      { name: "Servers", value: guilds.toLocaleString(), inline: true },
      { name: "Users", value: users.toLocaleString(), inline: true },
      { name: "Gateway Ping", value: `${ping}ms`, inline: true },
      { name: "Uptime", value: formatDuration(uptime), inline: true },
      { name: "Memory", value: `${memory} MB`, inline: true },
      { name: "Node.js", value: process.version, inline: true },
    ];

    const payload = cv2({
      color: 0x5865f2,
      title: client.user?.tag || "HitoriChan",
      description: "Bot information and statistics.",
      thumbnail: client.user?.displayAvatarURL?.({ size: 128 }) ?? null,
      fields,
    });

    await ctx.editReply(payload);
  },
};
