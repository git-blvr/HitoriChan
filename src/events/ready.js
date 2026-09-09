import { syncClientCommands } from "../helpers/commands.js";
import { startVoiceXpLoop } from "../utils/leveling.js";

export default {
  name: "clientReady",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    await syncClientCommands(client).catch((err) => console.error("Command sync failed:", err));
    startVoiceXpLoop(client);
  },
};
