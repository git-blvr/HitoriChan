import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { getPrefix, setPrefix } from "../../utils/prefixManager.js";

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
      await ctx.reply("This command only works in a server.");
      return;
    }

    const newPrefix = ctx.getOption("new_prefix", 0);

    if (!newPrefix) {
      const current = await getPrefix(ctx.guild.id);
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle("Current Prefix")
            .setDescription(`The prefix for this server is \`${current}\``),
        ],
      });
      return;
    }

    if (!ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
      await ctx.reply("You need the Manage Server permission to change the prefix.");
      return;
    }

    if (newPrefix.length > 5) {
      await ctx.reply("Prefix must be 5 characters or fewer.");
      return;
    }

    await setPrefix(ctx.guild.id, newPrefix);

    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle("Prefix Updated")
          .setDescription(`The prefix is now \`${newPrefix}\``),
      ],
    });
  },
};