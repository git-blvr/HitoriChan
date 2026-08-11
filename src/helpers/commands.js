import { REST, Routes } from "discord.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { walkDirectory } from "../utils/fileWalker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsPath = join(__dirname, "..", "commands");

const IS_GUILD = !!process.env.GUILD_ID;
const SKIP_DEPLOY = ["1", "true", "yes"].includes(process.env.SKIP_AUTO_DEPLOY?.toLowerCase?.());

export function normalizeCommand(cmd) {
  const options = (cmd.options ?? []).map((o) => normalizeOption(o));
  return JSON.stringify({
    name: cmd.name,
    description: cmd.description ?? "",
    options,
    dm_permission: cmd.dm_permission ?? true,
    default_member_permissions: cmd.default_member_permissions ?? null,
    nsfw: cmd.nsfw ?? false,
  });
}

function normalizeOption(option) {
  const base = {
    name: option.name,
    description: option.description ?? "",
    type: option.type,
    required: option.required ?? false,
    choices: (option.choices ?? []).map((c) => ({ name: c.name, value: c.value })),
    options: (option.options ?? []).map((o) => normalizeOption(o)),
    autocomplete: option.autocomplete ?? false,
    channel_types: option.channel_types ?? [],
    min_value: option.min_value ?? null,
    max_value: option.max_value ?? null,
    min_length: option.min_length ?? null,
    max_length: option.max_length ?? null,
  };

  for (const key of Object.keys(base)) {
    if (base[key] === null || base[key] === undefined) delete base[key];
  }
  return base;
}

export async function loadLocalCommands() {
  const files = walkDirectory(commandsPath);
  const map = new Map();

  for (const file of files) {
    const mod = await import(`file://${file}`);
    const command = mod.default;
    if (command?.data?.name) {
      map.set(command.data.name, command.data.toJSON());
    }
  }

  return map;
}

export function commandsAreDifferent(localMap, remoteMap) {
  if (localMap.size !== remoteMap.size) return true;

  for (const [name, localData] of localMap) {
    const remote = remoteMap.get(name);
    if (!remote) return true;
    if (normalizeCommand(localData) !== normalizeCommand(remote)) return true;
  }

  return false;
}

export function getDeployRoute(applicationId) {
  if (IS_GUILD) {
    return Routes.applicationGuildCommands(applicationId, process.env.GUILD_ID);
  }
  return Routes.applicationCommands(applicationId);
}

export async function syncApplicationCommands(applicationId, token, localMap) {
  const rest = new REST({ version: "10" }).setToken(token);
  const route = getDeployRoute(applicationId);
  const scope = IS_GUILD ? `guild ${process.env.GUILD_ID}` : "global";

  const registered = await rest.get(route);
  const remoteMap = new Map(registered.map((c) => [c.name, c]));

  if (!commandsAreDifferent(localMap, remoteMap)) {
    console.log(`✨ Slash commands up to date (${scope}).`);
    return { created: 0, updated: 0, deleted: 0 };
  }

  const body = [...localMap.values()];
  await rest.put(route, { body });

  const created = [...localMap.keys()].filter((n) => !remoteMap.has(n));
  const deleted = [...remoteMap.keys()].filter((n) => !localMap.has(n));
  const updated = [...localMap.keys()].filter(
    (n) => remoteMap.has(n) && normalizeCommand(localMap.get(n)) !== normalizeCommand(remoteMap.get(n))
  );

  console.log("─".repeat(48));
  console.log(`🚀 Bulk deployed ${body.length} ${scope} command(s)`);
  if (created.length) console.log(`🆕 New      →  ${created.join(", ")}`);
  if (updated.length) console.log(`✏️  Updated  →  ${updated.join(", ")}`);
  if (deleted.length) console.log(`🗑️  Deleted  →  ${deleted.join(", ")}`);
  console.log("─".repeat(48));

  if (!IS_GUILD) {
    console.log("⚠️  Global commands can take up to an hour to fully propagate.");
  }

  return { created: created.length, updated: updated.length, deleted: deleted.length };
}

export async function syncClientCommands(client) {
  if (SKIP_DEPLOY) {
    console.log("⏭️  Auto-deploy disabled (SKIP_AUTO_DEPLOY is set).");
    return;
  }

  const localMap = await loadLocalCommands();
  return syncApplicationCommands(client.user.id, process.env.TOKEN, localMap);
}
