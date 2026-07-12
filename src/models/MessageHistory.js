import { Schema, model } from "mongoose";

const messageHistorySchema = new Schema({
  userId:    { type: String, required: true },
  guildId:   { type: String, required: true },
  channelId: { type: String, required: true },
  messages:  { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now },
});

messageHistorySchema.index({ userId: 1, guildId: 1, channelId: 1 }, { unique: true });

export default model("MessageHistory", messageHistorySchema);