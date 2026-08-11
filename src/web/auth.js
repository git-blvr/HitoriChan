import jwt from "jsonwebtoken";
import { randomInt } from "crypto";

const DEFAULT_USER = "Admin";
const PASSWORD_LENGTH = 6;

let adminPassword = null;

export function generateInitialPassword() {
  if (!adminPassword) {
    adminPassword = String(randomInt(0, 1_000_000)).padStart(PASSWORD_LENGTH, "0");
    console.log(`\n🔐 Dashboard login\n   User: ${DEFAULT_USER}\n   Password: ${adminPassword}\n`);
  }
  return adminPassword;
}

export function getPassword() {
  return adminPassword ?? generateInitialPassword();
}

export function verifyCredentials(username, password) {
  return username === DEFAULT_USER && password === getPassword();
}

export function createSessionToken() {
  const secret = process.env.JWT_SECRET ?? "hitorichan-default-secret";
  return jwt.sign({ user: DEFAULT_USER }, secret, { expiresIn: "24h" });
}

export function verifySessionToken(token) {
  const secret = process.env.JWT_SECRET ?? "hitorichan-default-secret";
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}
