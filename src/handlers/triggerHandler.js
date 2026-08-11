import * as Trigger from "../models/Trigger.js";
import { getPrefix } from "../utils/prefixManager.js";

export async function handleTrigger(message) {
  if (message.author.bot || !message.guild) return;

  const prefix = await getPrefix(message.guild.id);
  if (message.content.startsWith(prefix)) return;

  const match = await Trigger.findForMessage(message.guild.id, message.content);
  if (!match) return;

  const command = message.client.prefixCommands.get(match.commandName);
  if (!command) return;

  const keyword = match.keyword;
  const lower = message.content.toLowerCase();
  const index = lower.indexOf(keyword.toLowerCase());
  let args = [];
  if (index !== -1) {
    const remaining = (message.content.slice(0, index) + message.content.slice(index + keyword.length)).trim();
    args = remaining ? remaining.split(/\s+/) : [];
  }

  const ctx = (await import("../utils/ctx.js")).createCtx(message, args);

  try {
    await command.execute(ctx);
  } catch (error) {
    console.error(`Trigger error for ${match.keyword}:`, error);
  }
}
