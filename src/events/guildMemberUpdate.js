import { applyBoostPerks } from "../utils/boostManager.js";
import * as questEngine from "../utils/questEngine.js";

export default {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember, client) {
    if (oldMember.guild.id !== newMember.guild.id) return;

    await questEngine.onMemberUpdate(client, oldMember, newMember);

    const wasBoosting = oldMember.premiumSince !== null;
    const isBoosting = newMember.premiumSince !== null;

    if (!wasBoosting && isBoosting) {
      await applyBoostPerks(newMember.guild.id, newMember.id, newMember, client);
    }
  },
};
