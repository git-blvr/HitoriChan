import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";

// ← Put the guild ID you want to leave here
const GUILD_ID = "";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
  if (!GUILD_ID) {
    console.error("No GUILD_ID set. Open the script and fill in the GUILD_ID variable.");
    client.destroy();
    return;
  }

  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    console.error(`Bot is not in a server with ID: ${GUILD_ID}`);
    client.destroy();
    return;
  }

  console.log(`Leaving "${guild.name}" (${guild.id})...`);
  await guild.leave();
  console.log(`Done.`);

  client.destroy();
});

client.login(process.env.TOKEN);