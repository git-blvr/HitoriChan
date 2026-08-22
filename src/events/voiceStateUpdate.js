import * as VoiceSession from "../models/VoiceSession.js";
import * as questEngine from "../utils/questEngine.js";

export default {
  name: "voiceStateUpdate",
  once: false,
  execute(oldState, newState, client) {
    const userId = oldState.id || newState.id;
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    if (oldChannel && !newChannel) {
      VoiceSession.end(oldChannel.guild.id, userId);
    } else if (!oldChannel && newChannel) {
      VoiceSession.start(newChannel.guild.id, userId, newChannel.id);
    } else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
      VoiceSession.end(oldChannel.guild.id, userId);
      VoiceSession.start(newChannel.guild.id, userId, newChannel.id);
    }

    questEngine.onVoiceStateUpdate(client, oldState, newState).catch(() => {});
  },
};
