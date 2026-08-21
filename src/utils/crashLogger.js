import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "..", "data");
const LOG_FILE = join(LOG_DIR, "crash.log");

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function logCrash(error, context = "crash") {
  ensureLogDir();

  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : "(no stack trace)";
  const entry = `[${timestamp}] [${context}] ${message}\n${stack}\n\n`;

  try {
    appendFileSync(LOG_FILE, entry);
  } catch (err) {
    console.error("Failed to write crash log:", err);
  }

  console.error(entry.trim());
}
