import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const candidates = [
  path.join(__dirname, "..", "..", "native", "hitori_native.node"),
  path.join(__dirname, "..", "..", "native", "target", "release", "hitori_native.node"),
];

let native = null;
if (process.env.NATIVE_DISABLE === "1" || process.env.NATIVE_DISABLE === "true") {
  console.warn("[native] Disabled via NATIVE_DISABLE — using JS fallbacks");
} else {
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      native = require(candidate);
      break;
    } catch (err) {
      console.warn(`[native] Failed to load ${candidate}: ${err.message}`);
    }
  }
}

if (!native) {
  console.warn("[native] Rust module not loaded — using JS fallbacks. Build it with: npm run build:native");
}

export const nativeAvailable = Boolean(native);
export default native;
