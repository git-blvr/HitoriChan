import { MessageFlags } from "discord.js";

export function createCtx(source, args = []) {
  const isInteraction = typeof source.isChatInputCommand === "function" && source.isChatInputCommand();
  let replyMessage = null;

  return {
    isInteraction,
    user: isInteraction ? source.user : source.author,
    member: source.member,
    guild: source.guild,
    channel: source.channel,
    args,
    client: source.client,

    async reply(payload) {
      const data = normalizePayload(payload);
      if (isInteraction) {
        if (source.deferred || source.replied) {
          return source.followUp(data);
        }
        return source.reply(data);
      }
      replyMessage = await source.reply(data);
      return replyMessage;
    },

    async deferReply(ephemeral = false) {
      if (isInteraction) {
        return source.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : undefined);
      }
      return null;
    },

    async editReply(payload) {
      const data = normalizePayload(payload);
      if (isInteraction) {
        return source.editReply(data);
      }
      if (replyMessage) {
        return replyMessage.edit(data);
      }
      replyMessage = await source.reply(data);
      return replyMessage;
    },

    async fetchReplyMessage() {
      if (isInteraction) {
        return source.fetchReply().catch(() => null);
      }
      return replyMessage;
    },

    getOption(name, index) {
      if (isInteraction) {
        return source.options.get(name)?.value ?? null;
      }
      return args[index] ?? null;
    },
  };
}

function normalizePayload(payload) {
  return typeof payload === "string" ? { content: payload } : payload;
}