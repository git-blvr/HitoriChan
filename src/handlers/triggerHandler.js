import * as Trigger from "../models/Trigger.js";
import { getPrefix } from "../utils/prefixManager.js";
import { createCtx } from "../utils/ctx.js";

export async function handleTrigger(message) {
  if (message.author.bot || !message.guild) return;

  const prefix = await getPrefix(message.guild.id);
  if (message.content.startsWith(prefix)) return;

  const match = await Trigger.findForMessage(message.guild.id, message.content);
  if (match) {
    const command = message.client.prefixCommands.get(match.commandName);
    if (command) {
      await runTriggeredCommand(message, command, match.keyword);
    }
    return;
  }

  // Default command triggers defined in command metadata (e.g. command.triggers)
  const text = message.content.toLowerCase();
  const seen = new Set();
  for (const command of message.client.prefixCommands.values()) {
    if (seen.has(command.data.name)) continue;
    seen.add(command.data.name);

    if (!Array.isArray(command.triggers)) continue;

    for (const trigger of command.triggers) {
      const t = trigger.toLowerCase();
      if (text.startsWith(t) && (text.length === t.length || /\s/.test(message.content[t.length]))) {
        await runTriggeredCommand(message, command, trigger);
        return;
      }
    }
  }
}

async function runTriggeredCommand(message, command, keyword) {
  const lower = message.content.toLowerCase();
  const index = lower.indexOf(keyword.toLowerCase());
  let args = [];
  if (index !== -1) {
    const remaining = (message.content.slice(0, index) + message.content.slice(index + keyword.length)).trim();
    args = remaining ? remaining.split(/\s+/) : [];
  }

  const ctx = createCtx(message, args);

  try {
    await command.execute(ctx);
  } catch (error) {
    console.error(`Trigger error for ${keyword}:`, error);
  }
}
