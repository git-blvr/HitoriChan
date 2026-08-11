import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { closeDatabase } from "./src/database/db.js";
import { loadCommands, registerCommandListeners } from "./src/handlers/commandHandler.js";
import { loadEvents } from "./src/handlers/eventHandler.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

async function main() {
  console.log("Connected to SQLite database");

  await loadCommands(client);
  await loadEvents(client);
  registerCommandListeners(client);

  await client.login(process.env.TOKEN);
}

process.on("SIGINT", () => {
  closeDatabase();
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDatabase();
  client.destroy();
  process.exit(0);
});

main().catch((error) => {
  console.error(error);
  closeDatabase();
  process.exit(1);
});
