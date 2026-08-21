import { applyBoostPerks } from "../utils/boostManager.js";

export default {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember, client) {
    if (oldMember.guild.id !== newMember.guild.id) return;

    const wasBoosting = oldMember.premiumSince !== null;
    const isBoosting = newMember.premiumSince !== null;

    if (!wasBoosting && isBoosting) {
      await applyBoostPerks(newMember.guild.id, newMember.id, newMember, client);
    }
  },
};
