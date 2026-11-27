import { applyBoostPerks } from "../utils/boostManager.js";
import * as questEngine from "../utils/questEngine.js";

export default {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember, client) {
    if (oldMember.guild.id !== newMember.guild.id) return;

    await questEngine.onMemberUpdate(client, oldMember, newMember);

    const wasBoosting = Boolean(oldMember.premiumSince);
    const isBoosting = Boolean(newMember.premiumSince);

    if (!wasBoosting && isBoosting) {
      await applyBoostPerks(newMember.guild.id, newMember.id, newMember, client);
    }
  },
};
