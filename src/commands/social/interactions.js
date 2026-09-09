import { SlashCommandBuilder } from "discord.js";
import { embErr } from "../../helpers/embeds.js";
import { buildInteractionPayload, getInteractionDefaults, DEFAULT_INTERACTIONS } from "../../utils/interactions.js";

const INTERACTION_TYPES = Object.keys(DEFAULT_INTERACTIONS);

function createCommand(type) {
  const defaults = getInteractionDefaults(type);

  const data = new SlashCommandBuilder()
    .setName(type)
    .setDescription(defaults.requiresTarget ? `${type} another user` : `React with ${type}`);

  if (defaults.requiresTarget) {
    data.addUserOption((option) =>
      option.setName("user").setDescription("The user").setRequired(true)
    );
  }

  return {
    data,
    execute: async (ctx) => {
      const guildId = ctx.guild?.id;
      if (!guildId) return ctx.reply(embErr("This command only works in a server."));

      await ctx.deferReply();

      const defaults = getInteractionDefaults(type);
      let target = null;
      if (defaults.requiresTarget) {
        const targetUser = ctx.getOption("user", 0);
        if (!targetUser) return ctx.editReply(embErr("Please mention a user."));
        target = await ctx.client.users.fetch(targetUser).catch(() => null);
        if (!target) return ctx.editReply(embErr("Could not find that user."));
      }

      const payload = await buildInteractionPayload(type, ctx.user, target, ctx.guild);
      await ctx.editReply(payload);
    },
  };
}

export default {
  commands: INTERACTION_TYPES.map(createCommand),
};
