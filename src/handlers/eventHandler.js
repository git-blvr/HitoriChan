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

    const handler = (...args) =>
      Promise.resolve(event.execute(...args, client)).catch((err) =>
        console.error(`[event:${event.name}]`, err)
      );

    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }
  }
}