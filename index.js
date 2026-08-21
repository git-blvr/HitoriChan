import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { closeDatabase } from "./src/database/db.js";
import { loadCommands, registerCommandListeners } from "./src/handlers/commandHandler.js";
import { loadEvents } from "./src/handlers/eventHandler.js";
import { startWebServer } from "./src/web/server.js";
import { logCrash } from "./src/utils/crashLogger.js";

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
  await startWebServer(client);
}

process.on("uncaughtException", (error) => {
  logCrash(error, "uncaughtException");
  closeDatabase();
  client.destroy();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logCrash(error, "unhandledRejection");
});

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

client.on("error", (error) => logCrash(error, "clientError"));
client.on("warn", (info) => console.warn("[Discord warning]", info));

main().catch((error) => {
  logCrash(error, "main");
  closeDatabase();
  process.exit(1);
});
