import { cv2 } from "../helpers/cv2.js";

export function createBasicEmbed(title, description) {
  return cv2({
    color: 0x5865f2,
    title,
    description,
  });
}

export function createDescBasicEmbed(desc, color) {
  return cv2({
    color: color || 0x5865f2,
    description: desc,
  });
}
