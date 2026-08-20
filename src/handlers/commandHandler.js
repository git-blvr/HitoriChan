import { join, dirname, relative, sep } from "path";
import { fileURLToPath } from "url";
import { Collection, MessageFlags } from "discord.js";
import { walkDirectory } from "../utils/fileWalker.js";
import { createCtx } from "../utils/ctx.js";
import { getPrefix } from "../utils/prefixManager.js";
import { hasShopCommand } from "../utils/shopManager.js";
import { embErr } from "../helpers/embeds.js";
import { handleStreak } from "./streakHandler.js";
import { handleChat } from "./chatHandler.js";
import { handleTrigger } from "./triggerHandler.js";
import * as CommandLog from "../models/CommandLog.js";
import * as MessageLog from "../models/MessageLog.js";

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

    if (command.shopItem) {
      const shopItems = Array.isArray(command.shopItem) ? command.shopItem : [command.shopItem];
      const results = await Promise.all(shopItems.map((name) => hasShopCommand(ctx.guild?.id, ctx.user.id, name)));
      if (!results.some(Boolean)) {
        return interaction.reply(embErr(`This command is locked. Buy it from the shop first.`, true));
      }
    }

    try {
      await command.execute(ctx);
      await CommandLog.create({
        guildId: ctx.guild?.id,
        channelId: ctx.channel?.id,
        userId: ctx.user.id,
        userName: ctx.user.username,
        commandName: command.data.name,
        source: "slash",
        input: interaction.options.data.map((o) => `${o.name}: ${o.value}`).join(", "),
        success: true,
      });
    } catch (error) {
      console.error(error);
      await CommandLog.create({
        guildId: ctx.guild?.id,
        channelId: ctx.channel?.id,
        userId: ctx.user.id,
        userName: ctx.user.username,
        commandName: command.data.name,
        source: "slash",
        input: interaction.options.data.map((o) => `${o.name}: ${o.value}`).join(", "),
        success: false,
        errorMessage: error.message,
      });
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

    await logMessage(message);
    await handleStreak(message);
    await handleChat(message);
    await handleTrigger(message);

    const prefix = await getPrefix(message.guild.id);
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    const command = client.prefixCommands.get(commandName);
    if (!command) return;

    const ctx = createCtx(message, args);

    if (command.shopItem) {
      const shopItems = Array.isArray(command.shopItem) ? command.shopItem : [command.shopItem];
      const results = await Promise.all(shopItems.map((name) => hasShopCommand(ctx.guild?.id, ctx.user.id, name)));
      if (!results.some(Boolean)) {
        return message.reply(embErr(`This command is locked. Buy it from the shop first.`, false));
      }
    }

    try {
      await command.execute(ctx);
      await CommandLog.create({
        guildId: ctx.guild?.id,
        channelId: ctx.channel?.id,
        userId: ctx.user.id,
        userName: ctx.user.username,
        commandName: command.data.name,
        source: "prefix",
        input: args.join(" "),
        success: true,
      });
    } catch (error) {
      console.error(error);
      await CommandLog.create({
        guildId: ctx.guild?.id,
        channelId: ctx.channel?.id,
        userId: ctx.user.id,
        userName: ctx.user.username,
        commandName: command.data.name,
        source: "prefix",
        input: args.join(" "),
        success: false,
        errorMessage: error.message,
      });
      await message.reply("Something went wrong running that command.");
    }
  });
}

async function logMessage(message) {
  try {
    await MessageLog.create({
      guildId: message.guild.id,
      channelId: message.channel.id,
      messageId: message.id,
      userId: message.author.id,
      userName: message.author.username,
      content: message.content,
      attachments: message.attachments.map((a) => a.url),
    });
    MessageLog.prune(5000);
  } catch (error) {
    console.error("Failed to log message:", error.message);
  }
}
