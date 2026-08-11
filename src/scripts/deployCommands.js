import "dotenv/config";
import { REST } from "discord.js";
import { loadLocalCommands, getDeployRoute } from "../helpers/commands.js";

async function main() {
  if (!process.env.TOKEN) {
    console.error("Missing TOKEN environment variable.");
    process.exit(1);
  }

  if (!process.env.CLIENT_ID) {
    console.error("Missing CLIENT_ID environment variable.");
    process.exit(1);
  }

  const localMap = await loadLocalCommands();
  const body = [...localMap.values()];
  const route = getDeployRoute(process.env.CLIENT_ID);
  const scope = process.env.GUILD_ID ? `guild ${process.env.GUILD_ID}` : "global";

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(route, { body });

  console.log(`🚀 Force-deployed ${body.length} ${scope} command(s):`);
  console.log(body.map((c) => `  /${c.name}`).join("\n"));

  if (!process.env.GUILD_ID) {
    console.log("⚠️  Global commands can take up to an hour to fully propagate.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
