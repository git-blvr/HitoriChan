import { Schema, model } from "mongoose";

const aiSettingsSchema = new Schema({
  guildId:   { type: String, required: true, unique: true },
  enabled:   { type: Boolean, default: false },
  mode:      { type: String, enum: ["everywhere", "channel"], default: "everywhere" },
  channelId: { type: String, default: null },
});

export default model("AISettings", aiSettingsSchema);