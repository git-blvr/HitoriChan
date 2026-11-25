import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.join(__dirname, "..", "..", "native");

const artifacts = {
  win32: "hitori_native.dll",
  linux: "libhitori_native.so",
  darwin: "libhitori_native.dylib",
};

const artifact = artifacts[process.platform];
if (!artifact) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

console.log("[native] Building hitori_native (cargo build --release)...");
execFileSync("cargo", ["build", "--release"], { cwd: nativeDir, stdio: "inherit" });

const src = path.join(nativeDir, "target", "release", artifact);
const dest = path.join(nativeDir, "hitori_native.node");
fs.copyFileSync(src, dest);
console.log(`[native] ${artifact} -> native/hitori_native.node`);
