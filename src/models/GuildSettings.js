import { Schema, model } from "mongoose";

const guildSettingsSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  prefix: { type: String, default: "_" },
  primaryCurrency: {
    name: { type: String, default: "Starry Coins" },
    symbol: { type: String, default: "coins " },
  },
  secondaryCurrency: {
    name: { type: String, default: "FOLTs" },
    symbol: { type: String, default: "folts " },
  },
});

export default model("GuildSettings", guildSettingsSchema);
