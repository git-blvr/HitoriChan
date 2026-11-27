import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { resolveMember } from "../../helpers/discord.js";

const COLOR = 0x5865f2;

export default {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show information about a member.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The member to inspect (defaults to you)")
    ),
  prefixName: "userinfo",
  aliases: ["whois", "memberinfo"],
  syntax: "{prefix}userinfo [@user]",
  example: "{prefix}userinfo @someone",
  async execute(ctx) {
    const guild = ctx.guild;
    if (!guild) {
      await ctx.reply(cv2({ color: 0xff0000, description: "This command only works in a server." }));
      return;
    }

    await ctx.deferReply();

    const member = (await resolveMember(ctx)) ?? ctx.member;
    if (!member) {
      await ctx.editReply(cv2({ color: 0xff0000, description: "Could not find that member." }));
      return;
    }
    const user = member.user;

    const roles = member.roles.cache
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => `<@&${r.id}>`);
    const roleText = roles.length ? roles.slice(0, 15).join(" ") + (roles.length > 15 ? ` +${roles.length - 15} more` : "") : "None";

    const fields = [
      { name: "Username", value: `@${user.username}`, inline: true },
      { name: "Display name", value: member.displayName, inline: true },
      { name: "ID", value: `\`${user.id}\``, inline: true },
      { name: "Account created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
      { name: "Joined server", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "Unknown", inline: true },
      { name: "Booster since", value: member.premiumSinceTimestamp ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:D>` : "—", inline: true },
      { name: `Roles (${roles.length})`, value: roleText || "None", inline: false },
    ];

    await ctx.editReply(cv2({
      color: member.displayColor || COLOR,
      title: member.displayName,
      thumbnail: user.displayAvatarURL?.({ size: 256 }) ?? null,
      image: user.bannerURL?.({ size: 1024 }) ?? null,
      fields,
    }));
  },
};
