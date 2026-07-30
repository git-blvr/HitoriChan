import { REST, Routes } from "discord.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { walkDirectory } from "../utils/fileWalker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalize(cmd) {
  return JSON.stringify({
    name:                       cmd.name,
    description:                cmd.description ?? "",
    options:                    cmd.options ?? [],
    default_member_permissions: cmd.default_member_permissions ?? null,
  });
}

async function loadLocalCommands() {
  const commandsPath = join(__dirname, "..", "commands");
  const files        = walkDirectory(commandsPath);
  const map          = new Map();

  for (const file of files) {
    const mod     = await import(`file://${file}`);
    const command = mod.default;
    if (command?.data?.name) {
      map.set(command.data.name, command.data.toJSON());
    }
  }

  return map;
}

async function syncCommands(client) {
  const rest          = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const route         = Routes.applicationCommands(client.user.id);
  const registered    = await rest.get(route);
  const registeredMap = new Map(registered.map((c) => [c.name, c]));
  const localMap      = await loadLocalCommands();

  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  for (const [name, localData] of localMap) {
    const remote = registeredMap.get(name);
    if (!remote) {
      toCreate.push(localData);
    } else if (normalize(localData) !== normalize(remote)) {
      toUpdate.push({ id: remote.id, data: localData });
    }
  }

  for (const [name, remote] of registeredMap) {
    if (!localMap.has(name)) toDelete.push(remote);
  }

  if (!toCreate.length && !toUpdate.length && !toDelete.length) {
    console.log("✨ Commands up to date — nothing to deploy.");
    return;
  }

  console.log("─".repeat(48));
  if (toCreate.length) console.log(`🆕 New      →  ${toCreate.map((c) => c.name).join(", ")}`);
  if (toUpdate.length) console.log(`✏️  Edited   →  ${toUpdate.map((c) => c.data.name).join(", ")}`);
  if (toDelete.length) console.log(`🗑️  Deleted  →  ${toDelete.map((c) => c.name).join(", ")}`);
  console.log("─".repeat(48));

  for (const data of toCreate) {
    await rest.post(route, { body: data });
    console.log(`🆕 Created   /${data.name}`);
  }

  for (const { id, data } of toUpdate) {
    await rest.patch(Routes.applicationCommand(client.user.id, id), { body: data });
    console.log(`✏️  Updated   /${data.name}`);
  }

  for (const cmd of toDelete) {
    await rest.delete(Routes.applicationCommand(client.user.id, cmd.id));
    console.log(`🗑️  Deleted   /${cmd.name}`);
  }

  console.log(`✨ ${toCreate.length + toUpdate.length + toDelete.length} change(s) applied.\n`);
}

export default {
  name: "clientReady",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);
    await syncCommands(client).catch((err) => console.error("Command sync failed:", err));
  },
};