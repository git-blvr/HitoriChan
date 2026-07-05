import { Schema, model } from "mongoose";

const moderationSettingsSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  logChannelId: { type: String, default: null },
  modRoleId: { type: String, default: null },
});

export default model("ModerationSettings", moderationSettingsSchema);