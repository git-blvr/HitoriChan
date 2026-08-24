import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import { getActiveByUser, isExpired } from "../../models/ShopPurchase.js";
import { getById } from "../../models/ShopItem.js";
import { formatDuration } from "../../helpers/time.js";

export default {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Show your inventory or another member's inventory")
    .addUserOption((option) => option.setName("user").setDescription("Member to view")),
  prefixName: "inventory",
  aliases: ["inv", "items"],
  syntax: "{prefix}inventory [@user]",
  example: "{prefix}inventory",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply(embErr("This command only works in a server."));
      return;
    }

    const { target, refMessage } = await resolveTarget(ctx, {
      optionName: "user",
      argIndex: 0,
      fallbackToAuthor: true,
      allowReference: true,
      allowUserFallback: true,
    });
    if (!target) {
      await ctx.reply(embErr("Could not find that member."));
      return;
    }

    const purchases = await getActiveByUser(ctx.guild.id, target.id);

    if (!purchases.length) {
      await ctx.reply(cv2({
        color: 0x8b5cf6,
        title: `${target.user?.username || target.username}'s Inventory`,
        description: "No items owned.",
        thumbnail: target.displayAvatarURL?.({ size: 128 }) || null,
      }), refMessage);
      return;
    }

    // Group active purchases by item and gather expiry
    const itemsMap = new Map();
    for (const p of purchases) {
      const item = await getById(p.itemId);
      if (!item) continue;
      const existing = itemsMap.get(item.id);
      if (!existing) {
        itemsMap.set(item.id, { item, quantity: p.quantity, expiresAt: p.expiresAt });
      } else {
        existing.quantity += p.quantity;
        if (p.expiresAt && (!existing.expiresAt || p.expiresAt < existing.expiresAt)) {
          existing.expiresAt = p.expiresAt;
        }
      }
    }

    const entries = [...itemsMap.values()];
    const lines = entries.map(({ item, quantity, expiresAt }) => {
      let line = `**${item.name}** × ${quantity}`;
      if (item.description) line += `\n${item.description}`;
      if (expiresAt) {
        const remaining = expiresAt - Date.now();
        line += remaining > 0
          ? `\n*Expires in ${formatDuration(remaining)}*`
          : "\n*Expired*";
      }
      return line;
    });

    await ctx.reply(cv2({
      color: 0x8b5cf6,
      title: `${target.user?.username || target.username}'s Inventory`,
      description: lines.join("\n\n"),
      thumbnail: target.displayAvatarURL?.({ size: 128 }) || null,
      separators: true,
    }), refMessage);
  },
};
