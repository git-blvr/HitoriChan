import { Schema, model } from "mongoose";
import { randomBytes } from "crypto";

const moderationCaseSchema = new Schema({
  caseId: { type: String, default: () => randomBytes(3).toString("hex").toUpperCase() },
  guildId: { type: String, required: true },
  action: { type: String, required: true },
  moderatorId: { type: String, required: true },
  targetId: { type: String, required: true },
  reason: { type: String, default: "No reason provided" },
  attachment: { type: String, default: null },
  duration: { type: Number, default: null },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export default model("ModerationCase", moderationCaseSchema);