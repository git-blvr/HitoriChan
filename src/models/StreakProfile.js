import { Schema, model } from "mongoose";

const streakProfileSchema = new Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastStreakDate: { type: Date, default: null },
  totalDays: { type: Number, default: 0 },
  dailyMessageCount: { type: Number, default: 0 },
  dailyMessageDate: { type: String, default: null },
});

streakProfileSchema.index({ userId: 1, guildId: 1 }, { unique: true });

export default model("StreakProfile", streakProfileSchema);