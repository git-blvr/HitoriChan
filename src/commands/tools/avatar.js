import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { extractImageColor } from "../../utils/image_color.js";

const DEFAULT_ACCENT = 0x5865f2;
const CANVAS_W = 1024;
const CANVAS_H = 400;
const AVATAR_R = 120;
const GLOW_R = 180;

export default {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a member's avatar as a styled card.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The member to show (defaults to you)")
        .setRequired(false)
    ),
  prefixName: "avatar",
  aliases: ["av"],
  triggers: ["av"],
  syntax: "{prefix}avatar [@user]",
  example: "{prefix}avatar @someone",
  async execute(ctx) {
    const raw = ctx.getOption("user", 0);
    const target = await resolveTarget(ctx, raw);

    const displayName = target.displayName ?? target.globalName ?? target.username;
    const avatarUrl = target.displayAvatarURL({
      size: 512,
      extension: "png",
      forceStatic: true,
    });

    try {
      const [accent, img] = await Promise.all([
        extractImageColor(avatarUrl).catch(() => null),
        loadImage(avatarUrl),
      ]);

      const finalAccent = accent ?? target.user?.accentColor ?? target.accentColor ?? DEFAULT_ACCENT;
      const cardBuffer = await renderAvatarCard(img, finalAccent);
      const attachment = new AttachmentBuilder(cardBuffer, { name: "avatar.png" });

      const payload = cv2({
        color: finalAccent,
        title: `Avatar of ${displayName}`,
        description: `Requested by ${ctx.user.username}`,
        image: { url: "attachment://avatar.png" },
      });
      payload.files = [attachment];

      await ctx.reply(payload);
    } catch (error) {
      console.error("Avatar command error:", error);
      await ctx.reply(embErr("Could not generate the avatar card. Please try again later."));
    }
  },
};

async function resolveTarget(ctx, raw) {
  if (!raw) return ctx.user;

  let id;
  if (ctx.isInteraction) {
    id = raw;
  } else {
    const mention = String(raw).match(/^<@!?(\d+)>$/);
    id = mention ? mention[1] : raw;
  }

  if (!/^\d{17,20}$/.test(id)) return ctx.user;

  try {
    if (ctx.guild) {
      const member = await ctx.guild.members.fetch(id);
      return member;
    }
  } catch {
    // fall through to global user fetch
  }

  try {
    return await ctx.client.users.fetch(id);
  } catch {
    return ctx.user;
  }
}

function rgbFromInt(color) {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

async function renderAvatarCard(img, accent) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const canvasCtx = canvas.getContext("2d");

  canvasCtx.fillStyle = "#0a0a0a";
  canvasCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const { r, g, b } = rgbFromInt(accent);

  canvasCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.14)`;
  canvasCtx.beginPath();
  canvasCtx.arc(CANVAS_W / 2, CANVAS_H / 2, GLOW_R, 0, Math.PI * 2);
  canvasCtx.fill();

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;

  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.arc(cx, cy, AVATAR_R, 0, Math.PI * 2);
  canvasCtx.closePath();
  canvasCtx.clip();
  canvasCtx.drawImage(img, cx - AVATAR_R, cy - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
  canvasCtx.restore();

  canvasCtx.beginPath();
  canvasCtx.arc(cx, cy, AVATAR_R, 0, Math.PI * 2);
  canvasCtx.lineWidth = 12;
  canvasCtx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
  canvasCtx.stroke();

  canvasCtx.beginPath();
  canvasCtx.arc(cx, cy, AVATAR_R - 6, 0, Math.PI * 2);
  canvasCtx.lineWidth = 3;
  canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  canvasCtx.stroke();

  return Buffer.from(await canvas.encode("png"));
}
