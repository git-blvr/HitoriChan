import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { getPrefix, setPrefix } from "../../utils/prefixManager.js";
import { embErr } from "../../helpers/embeds.js";

const COLOR = 0x5865f2;

export default {
  data: new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("View or change this server's command prefix")
    .addStringOption((option) =>
      option.setName("new_prefix").setDescription("The new prefix to use").setMaxLength(5)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  prefixName: "prefix",
  syntax: "{prefix}prefix [new_prefix]",
  example: "{prefix}prefix ?",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply(embErr("This command only works in a server."));
      return;
    }

    const newPrefix = ctx.getOption("new_prefix", 0);

    if (!newPrefix) {
      const current = await getPrefix(ctx.guild.id);
      await ctx.reply(cv2({
        color: COLOR,
        title: "Current Prefix",
        description: `The prefix for this server is \`${current}\``,
      }));
      return;
    }

    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await ctx.reply(embErr("You need the Manage Server permission to change the prefix."));
      return;
    }

    if (newPrefix.length > 5) {
      await ctx.reply(embErr("Prefix must be 5 characters or fewer."));
      return;
    }

    await setPrefix(ctx.guild.id, newPrefix);

    await ctx.reply(cv2({
      color: COLOR,
      title: "Prefix Updated",
      description: `The prefix is now \`${newPrefix}\``,
    }));
  },
};
