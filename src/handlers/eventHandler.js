import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client) {
  const eventsPath = join(__dirname, "..", "events");
  const files = readdirSync(eventsPath).filter((file) => file.endsWith(".js"));

  for (const file of files) {
    const imported = await import(`file://${join(eventsPath, file)}`);
    const event = imported.default;
    if (!event?.name) continue;

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
  }
}