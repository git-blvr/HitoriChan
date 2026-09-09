import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as MarriageSettings from "../../models/MarriageSettings.js";
import * as ShopItem from "../../models/ShopItem.js";

export default {
  data: new SlashCommandBuilder()
    .setName("marryconfig")
    .setDescription("Configure the marriage system.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option.setName("ring").setDescription("Shop item name or ID for the ring").setRequired(false)
    )
    .addStringOption((option) =>
      option.setName("contract").setDescription("Shop item name or ID for the marriage contract").setRequired(false)
    )
    .addBooleanOption((option) =>
      option.setName("enabled").setDescription("Enable or disable the marriage system").setRequired(false)
    ),
  prefixName: "marryconfig",
  category: "social",
  async execute(ctx) {
    await ctx.deferReply({ flags: 64 });

    const guildId = ctx.guild?.id;
    if (!guildId) return ctx.editReply("This command only works in a server.");

    if (!ctx.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
      return ctx.editReply("You need Administrator permission to use this.");
    }

    const ringInput = ctx.getOption("ring", 0);
    const contractInput = ctx.getOption("contract", 0);
    const enabled = ctx.getOption("enabled", 0);

    const values = {};
    if (enabled !== null) values.enabled = enabled;

    if (ringInput) {
      const ring = await findItem(guildId, ringInput);
      if (!ring) return ctx.editReply(`Ring item "${ringInput}" not found.`);
      values.ringItemId = String(ring.id);
    }

    if (contractInput) {
      const contract = await findItem(guildId, contractInput);
      if (!contract) return ctx.editReply(`Contract item "${contractInput}" not found.`);
      values.contractItemId = String(contract.id);
    }

    const settings = await MarriageSettings.save(guildId, values);
    await ctx.editReply(
      `Marriage system ${settings.enabled ? "enabled" : "disabled"}.\n` +
        `Ring: ${settings.ringItemId ? "< set >" : "not set"}\n` +
        `Contract: ${settings.contractItemId ? "< set >" : "not set"}`
    );
  },
};

async function findItem(guildId, value) {
  if (/^\d+$/.test(value)) {
    const byId = await ShopItem.getById(Number(value));
    if (byId && byId.guildId === guildId) return byId;
  }
  const items = await ShopItem.getByGuild(guildId);
  return items.find((i) => i.name.toLowerCase() === value.toLowerCase());
}
