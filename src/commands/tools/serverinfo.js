import { SlashCommandBuilder, ChannelType } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";

const COLOR = 0x5865f2;

export default {
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Show information about this server."),
  prefixName: "serverinfo",
  aliases: ["server", "guildinfo"],
  syntax: "{prefix}serverinfo",
  example: "{prefix}serverinfo",
  async execute(ctx) {
    const guild = ctx.guild;
    if (!guild) {
      await ctx.reply(cv2({ color: 0xff0000, description: "This command only works in a server." }));
      return;
    }

    await ctx.deferReply();

    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const counts = (type) => channels.filter((c) => c.type === type).size;

    const fields = [
      { name: "Owner", value: owner ? `${owner.user.tag}` : "Unknown", inline: true },
      { name: "Members", value: `${guild.memberCount.toLocaleString()}`, inline: true },
      { name: "Boosts", value: `${guild.premiumSubscriptionCount ?? 0} (tier ${guild.premiumTier})`, inline: true },
      { name: "Text channels", value: `${counts(ChannelType.GuildText)}`, inline: true },
      { name: "Voice channels", value: `${counts(ChannelType.GuildVoice)}`, inline: true },
      { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
      { name: "Emojis", value: `${guild.emojis.cache.size}`, inline: true },
      { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      { name: "Server ID", value: `\`${guild.id}\``, inline: true },
    ];

    await ctx.editReply(cv2({
      color: COLOR,
      title: guild.name,
      description: guild.description || undefined,
      thumbnail: guild.iconURL?.({ size: 256 }) ?? null,
      image: guild.bannerURL?.({ size: 1024 }) ?? null,
      fields,
    }));
  },
};
