import { readdirSync, statSync } from "fs";
import { join } from "path";

export function walkDirectory(dir) {
  let results = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      results = results.concat(walkDirectory(fullPath));
    } else if (entry.endsWith(".js")) {
      results.push(fullPath);
    }
  }

  return results;
}