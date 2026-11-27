import { cv2 } from "./cv2.js";

const DEFAULT_ERROR_COLOR = 0xff0000;
const DEFAULT_WARNING_COLOR = 0xffcc00;
const DEFAULT_SUCCESS_COLOR = 0x57f287;
const DEFAULT_INFO_COLOR = 0x5865f2;

const ALL_TYPES = new Set(["embed", "classic", "rich", "cv2", "v2", "components", "component"]);

function isTypeString(value) {
  return typeof value === "string" && ALL_TYPES.has(value.toLowerCase());
}

function buildPayload(description, color, ephemeral) {
  return cv2({ color, description, ephemeral });
}

function normalizeArgs(color, type, ephemeral) {
  if (isTypeString(color)) {
    if (typeof type === "boolean" && ephemeral === undefined) {
      ephemeral = type;
      type = undefined;
    }
    type = color;
    color = undefined;
  }
  if (typeof color === "boolean" && type === undefined && ephemeral === undefined) {
    ephemeral = color;
    color = undefined;
  }
  if (typeof ephemeral !== "boolean" && typeof type === "boolean") {
    ephemeral = type;
    type = undefined;
  }
  return { color, type, ephemeral };
}

export function embErr(description, color, type, ephemeral) {
  const args = normalizeArgs(color, type, ephemeral);
  return buildPayload(description, args.color ?? DEFAULT_ERROR_COLOR, args.ephemeral);
}

export function embWrn(description, color, type, ephemeral) {
  const args = normalizeArgs(color, type, ephemeral);
  return buildPayload(description, args.color ?? DEFAULT_WARNING_COLOR, args.ephemeral);
}

export function embSuc(description, color, type, ephemeral) {
  const args = normalizeArgs(color, type, ephemeral);
  return buildPayload(description, args.color ?? DEFAULT_SUCCESS_COLOR, args.ephemeral);
}

export function embInf(description, color, type, ephemeral) {
  const args = normalizeArgs(color, type, ephemeral);
  return buildPayload(description, args.color ?? DEFAULT_INFO_COLOR, args.ephemeral);
}
