import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["80", "443", "8080", "8443"]);
const MAX_REDIRECTS = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 5_000;

function isPrivateIPv4(parts) {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;               // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true;                         // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;                // 172.16/12
  if (a === 192 && b === 168) return true;                         // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT
  if (a === 192 && b === 0) return true;                           // 192.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;            // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true;      // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true;       // TEST-NET-3
  if (a === 192 && b === 0 && parts[2] === 2) return true;         // TEST-NET-1
  if (a >= 224) return true;                                       // multicast + reserved
  return false;
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIPv4(address.split(".").map(Number));
  }
  if (family === 6) {
    let addr = address.toLowerCase();
    if (addr.includes(".")) {
      // IPv4-mapped/compatible IPv6 — check the embedded IPv4 part.
      const v4 = addr.split(":").pop();
      return isPrivateIPv4(v4.split(".").map(Number));
    }
    if (addr === "::" || addr === "::1") return true;
    if (addr.startsWith("fe80") || addr.startsWith("fe90") || addr.startsWith("fea0") || addr.startsWith("feb0")) return true;
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true;
    if (addr.startsWith("ff")) return true;
    return false;
  }
  return true; // not an IP — refuse
}

async function assertPublicHostname(url) {
  const hostname = url.hostname;
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Refusing to fetch a private or reserved address");
    return;
  }
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  if (!records.length) throw new Error(`Could not resolve host: ${hostname}`);
  for (const { address } of records) {
    if (isPrivateAddress(address)) {
      throw new Error("Refusing to fetch a private or reserved address");
    }
  }
}

async function assertSafeUrl(url) {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!ALLOWED_PORTS.has(port)) {
    throw new Error(`Unsupported port: ${port}`);
  }
  if (url.username || url.password) {
    throw new Error("Credentials in URLs are not allowed");
  }
  await assertPublicHostname(url);
}

/**
 * fetch() that refuses private/reserved IP ranges, non-HTTP(S) schemes and
 * credentials, validates every redirect hop, and caps the response body.
 * Intended for fetching user-supplied URLs (image color sampling, etc).
 */
export async function safeFetch(input, { maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "HitoriChan/1.0 (+dashboard)" },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      url = new URL(res.headers.get("location"), url);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url.host}: ${res.status} ${res.statusText}`);
    }

    const length = Number(res.headers.get("content-length") || 0);
    if (length > maxBytes) {
      throw new Error("Remote file is too large");
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error("Remote file is too large");
    }
    return { buffer, url, contentType: res.headers.get("content-type") };
  }
  throw new Error("Too many redirects");
}
