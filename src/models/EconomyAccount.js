import { Schema, model } from "mongoose";

const economyAccountSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    primary: { type: Number, default: 0 },
    secondary: { type: Number, default: 0 },
    lastDaily: { type: Date, default: null },
  },
  { timestamps: true }
);

economyAccountSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export default model("EconomyAccount", economyAccountSchema);
