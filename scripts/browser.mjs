// Minimal headless-Chrome driver over CDP — zero dependencies (Node ≥22).
// Usage:
//   node scripts/browser.mjs shot <url> <out.png> [--w=1280 --h=900 --wait=3000 --mobile --full --cookie name=val --eval <expr|@file>]
//   node scripts/browser.mjs eval <url> <expr|@file> [same opts]
//   node scripts/browser.mjs errors <url> [same opts]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error("No Chrome/Edge found — set CHROME_PATH");
}

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) return process.argv[idx + 1];
  return dflt;
}
const has = (name) => process.argv.includes(`--${name}`);

const [, , cmd, url, out] = process.argv;
if (!cmd || !url) {
  console.error("usage: browser.mjs shot|eval|errors <url> [out.png|expr] [opts]");
  process.exit(2);
}

const W = Number(arg("w", has("mobile") ? "375" : "1280"));
const H = Number(arg("h", has("mobile") ? "812" : "900"));
const WAIT = Number(arg("wait", "2500"));
const cookieArg = arg("cookie", null);
let evalExpr = cmd === "eval" ? out : arg("eval", null);
if (evalExpr?.startsWith("@")) evalExpr = readFileSync(evalExpr.slice(1), "utf8");

const chrome = findChrome();
const profile = mkdtempSync(join(tmpdir(), "hc-cdp-"));
const proc = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-extensions",
  "--mute-audio",
  `about:blank`,
]);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  const onData = (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { proc.stderr.off("data", onData); resolve(m[1]); }
  };
  proc.stderr.on("data", onData);
  proc.on("exit", () => reject(new Error("chrome exited early")));
  setTimeout(() => reject(new Error("chrome ws timeout\n" + buf)), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let idSeq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};

function send(method, params = {}, sessionId = undefined) {
  const id = ++idSeq;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 20000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);

  await s("Page.enable");
  await s("Runtime.enable");
  await s("Network.enable");
  await s("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: has("mobile"),
  });

  if (cookieArg) {
    const eq = cookieArg.indexOf("=");
    await s("Network.setCookie", {
      name: cookieArg.slice(0, eq),
      value: cookieArg.slice(eq + 1),
      url,
    });
  }

  const loginArg = arg("login", null); // user:pass → POST /api/login on origin
  if (loginArg) {
    const origin = new URL(url).origin;
    const [lu, lp] = loginArg.split(":");
    await s("Page.navigate", { url: `${origin}/` });
    await sleep(1200);
    const loginRes = await s("Runtime.evaluate", {
      expression: `fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:${JSON.stringify(lu)},password:${JSON.stringify(lp)}})}).then(r=>r.status)`,
      awaitPromise: true, returnByValue: true,
    });
    const status = loginRes.result?.value;
    if (status !== 200) console.error(`[login] /api/login returned ${JSON.stringify(status)}`);
    await sleep(300);
  }

  await s("Page.navigate", { url });
  await sleep(WAIT);

  if (cmd === "shot" && evalExpr) {
    await s("Runtime.evaluate", { expression: evalExpr, returnByValue: true, awaitPromise: true });
    await sleep(600);
  }

  if (cmd === "shot") {
    const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: has("full") });
    writeFileSync(out, Buffer.from(data, "base64"));
    console.log(out);
  } else if (cmd === "eval") {
    const res = await s("Runtime.evaluate", {
      expression: evalExpr,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log(JSON.stringify(res.result?.value ?? res.result ?? null, null, 2));
  }

  if (cmd === "errors" || true) {
    const problems = [];
    for (const e of events) {
      if (e.method === "Runtime.exceptionThrown") {
        problems.push(`exception: ${e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text}`);
      }
      if (e.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(e.params.type)) {
        problems.push(`${e.params.type}: ${(e.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
      }
      if (e.method === "Network.responseReceived" && e.params.response.status >= 400) {
        problems.push(`http ${e.params.response.status}: ${e.params.response.url}`);
      }
    }
    if (problems.length) console.error("[console/network]\n" + problems.join("\n"));
  }
} finally {
  ws.close();
  proc.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
}
process.exit(0);
