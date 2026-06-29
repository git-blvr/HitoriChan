import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import mongoose from "mongoose";
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
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  await loadCommands(client);
  await loadEvents(client);
  registerCommandListeners(client);

  await client.login(process.env.TOKEN);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});