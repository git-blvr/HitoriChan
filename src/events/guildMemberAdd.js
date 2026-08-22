import { sendWelcomeOrGoodbye } from "../helpers/welcomeGoodbye.js";

export default {
  name: "guildMemberAdd",
  once: false,
  async execute(member, client) {
    try {
      await sendWelcomeOrGoodbye(client, member, "welcome");
    } catch (err) {
      console.error("[guildMemberAdd] error:", err.message);
    }
  },
};
