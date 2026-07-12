import { Schema, model } from "mongoose";

const streakSettingsSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  trackChannelId: { type: String, default: null },
  notifyChannelId: { type: String, default: null },
});

export default model("StreakSettings", streakSettingsSchema);