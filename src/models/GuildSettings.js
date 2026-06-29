import { Schema, model } from "mongoose";

const guildSettingsSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: "_" },
});

export default model("GuildSettings", guildSettingsSchema);