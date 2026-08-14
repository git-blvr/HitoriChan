import express from "express";
import cookieParser from "cookie-parser";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { verifyCredentials, createSessionToken, generateInitialPassword } from "./auth.js";
import { requireAuth } from "./middleware/auth.js";
import api from "./routes/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

export function startWebServer(client, port = process.env.WEB_PORT || 12948) {
  generateInitialPassword();

  const app = express();
  app.set("client", client);
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(PUBLIC_DIR));

  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    if (!verifyCredentials(username, password)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const token = createSessionToken();
    res.cookie("token", token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: "strict", secure: req.secure });
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ ok: true });
  });

  app.use("/api", api);

  app.get("/dashboard", (req, res) => {
    res.sendFile(join(PUBLIC_DIR, "dashboard.html"));
  });

  app.get("/", (req, res) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  const host = "0.0.0.0";
  const publicUrl = process.env.PUBLIC_URL;
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      const url = publicUrl || `http://${host}:${port}`;
      console.log(`🌐 Dashboard running at ${url}`);
      resolve(server);
    });
  });
}
