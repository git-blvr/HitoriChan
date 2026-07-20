import "dotenv/config";
import { REST, Routes } from "discord.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { walkDirectory } from "../utils/fileWalker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const commandsPath = join(__dirname, "..", "commands");
  const files = walkDirectory(commandsPath);
  const body = [];

  for (const file of files) {
    const imported = await import(`file://${file}`);
    const command = imported.default;
    if (command?.data?.name) {
      body.push(command.data.toJSON());
    }
  }

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  if (process.env.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body });
    console.log(`Registered ${body.length} guild commands`);
  } else {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
    console.log(`Registered ${body.length} global commands`);
  }
}

main().catch(console.error);