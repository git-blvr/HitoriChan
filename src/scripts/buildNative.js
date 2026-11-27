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
try {
  fs.copyFileSync(src, dest);
} catch (err) {
  if (err.code === "EBUSY" || err.code === "EPERM") {
    // A running bot has the module loaded — Windows forbids overwriting an
    // in-use DLL but still allows renaming it, so sideline the old one.
    const sideline = `${dest}.old-${Date.now()}`;
    fs.renameSync(dest, sideline);
    fs.copyFileSync(src, dest);
    console.warn(`[native] existing module was in use — moved to ${path.basename(sideline)} (safe to delete)`);
  } else {
    throw err;
  }
}
console.log(`[native] ${artifact} -> native/hitori_native.node`);
