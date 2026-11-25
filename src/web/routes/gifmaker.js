// GIF maker routes — render a scene spec to a GIF through the Rust engine.
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { renderGifScene, gifEngineInfo } from "../../utils/gifRenderer.js";

const router = Router();

const renderLimit = rateLimit({ windowMs: 60_000, maxRequests: 12, suffix: "gif-render" });

router.get("/engine", requireAuth, requirePermission("gifmaker"), (req, res) => {
  res.json(gifEngineInfo());
});

router.post("/render", requireAuth, requirePermission("gifmaker"), renderLimit, async (req, res, next) => {
  try {
    const spec = req.body?.spec ?? req.body;
    const { gif, meta } = await renderGifScene(spec);
    res.setHeader("Content-Type", "image/gif");
    res.setHeader("X-Gif-Engine", meta.engine);
    res.setHeader("X-Gif-Cache", meta.cached ? "hit" : "miss");
    res.setHeader("X-Gif-Frames", String(meta.frames));
    res.setHeader("X-Gif-Fps", String(meta.fps));
    res.setHeader("X-Gif-Bytes", String(meta.bytes));
    res.send(gif);
  } catch (err) {
    if (err instanceof SyntaxError || /required|invalid|limit|too large/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
