import { sendWelcomeOrGoodbye } from "../helpers/welcomeGoodbye.js";

export default {
  name: "guildMemberRemove",
  once: false,
  async execute(member, client) {
    try {
      await sendWelcomeOrGoodbye(client, member, "goodbye");
    } catch (err) {
      console.error("[guildMemberRemove] error:", err.message);
    }
  },
};
