import { join, dirname, relative, sep } from "path";
import { fileURLToPath } from "url";
import { Collection, MessageFlags } from "discord.js";
import { walkDirectory } from "../utils/fileWalker.js";
import { createCtx } from "../utils/ctx.js";
import { getPrefix } from "../utils/prefixManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client) {
  client.commands = new Collection();
  client.prefixCommands = new Collection();

  const commandsPath = join(__dirname, "..", "commands");
  const files = walkDirectory(commandsPath);

  for (const file of files) {
    const imported = await import(`file://${file}`);
    const command = imported.default;
    if (!command?.data?.name) continue;

    const segments = relative(commandsPath, file).split(sep);
    command.category = segments.length > 1 ? segments[0] : "misc";

    client.commands.set(command.data.name, command);

    const prefixName = command.prefixName ?? command.data.name;
    client.prefixCommands.set(prefixName, command);

    if (Array.isArray(command.aliases)) {
      for (const alias of command.aliases) {
        client.prefixCommands.set(alias, command);
      }
    }
  }
}

export function registerCommandListeners(client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const ctx = createCtx(interaction);

    try {
      await command.execute(ctx);
    } catch (error) {
      console.error(error);
      const payload = { content: "Something went wrong running that command.", flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = await getPrefix(message.guild.id);
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    const command = client.prefixCommands.get(commandName);
    if (!command) return;

    const ctx = createCtx(message, args);

    try {
      await command.execute(ctx);
    } catch (error) {
      console.error(error);
      await message.reply("Something went wrong running that command.");
    }
  });
}