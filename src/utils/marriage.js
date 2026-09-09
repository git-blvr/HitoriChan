import { MessageFlags, ButtonStyle, ActionRowBuilder, ButtonBuilder } from "discord.js";
import * as MarriageSettings from "../models/MarriageSettings.js";
import * as Marriage from "../models/Marriage.js";
import * as ShopItem from "../models/ShopItem.js";
import * as ShopPurchase from "../models/ShopPurchase.js";
import { cv2 } from "../helpers/cv2.js";
import { replacePlaceholders } from "../helpers/placeholders.js";

export async function getSettings(guildId) {
  return MarriageSettings.getOrCreate(guildId);
}

async function findItemByIdOrName(guildId, value) {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const byId = await ShopItem.getById(Number(value));
    if (byId && byId.guildId === guildId) return byId;
  }
  const items = await ShopItem.getByGuild(guildId);
  const match = items.find((i) => i.name.toLowerCase() === value.toLowerCase());
  if (match) return match;
  return null;
}

async function findPurchasesForItem(guildId, userId, itemId) {
  if (!itemId) return [];
  const purchases = await ShopPurchase.getActiveByUser(guildId, userId);
  return purchases.filter((p) => String(p.itemId) === String(itemId) && p.quantity > 0);
}

async function hasItem(guildId, userId, itemId) {
  const purchases = await findPurchasesForItem(guildId, userId, itemId);
  return purchases.reduce((sum, p) => sum + (p.quantity || 1), 0) > 0;
}

export async function hasItemsForProposal(guildId, userId, settings) {
  const [ring, contract] = await Promise.all([
    hasItem(guildId, userId, settings.ringItemId),
    hasItem(guildId, userId, settings.contractItemId),
  ]);
  return { ring, contract };
}

export async function consumeItem(guildId, userId, itemId, amount = 1) {
  if (!itemId) return;
  const purchases = await findPurchasesForItem(guildId, userId, itemId);
  let remaining = amount;
  for (const purchase of purchases) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, purchase.quantity || 1);
    const newQuantity = (purchase.quantity || 1) - take;
    remaining -= take;
    if (newQuantity <= 0) {
      await ShopPurchase.remove(purchase.id);
    } else {
      await ShopPurchase.updateQuantity?.(purchase.id, newQuantity);
    }
  }
}

export async function consumeProposalItems(guildId, userId, settings) {
  await consumeItem(guildId, userId, settings.ringItemId, 1);
  await consumeItem(guildId, userId, settings.contractItemId, 1);
}

export function resolveItemInput(guildId, value) {
  return findItemByIdOrName(guildId, value);
}

export function buildProposalPayload(settings, proposer, target) {
  const text = replacePlaceholders(settings.proposalMessage || "{user} is proposing to {target}!", {
    member: proposer,
    user: proposer?.user || proposer,
    target: target,
    guild: proposer?.guild,
  });
  return cv2({
    color: 0xff69b4,
    title: "💍 Marriage Proposal",
    description: text,
    thumbnail: proposer?.displayAvatarURL?.({ size: 128 }) ?? null,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`marriage:accept:${proposer.id}:${target.id}:${proposer.guild.id}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`marriage:decline:${proposer.id}:${target.id}:${proposer.guild.id}`)
          .setLabel("Decline")
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  });
}

export function buildMarriagePayload(settings, user1, user2) {
  const text = replacePlaceholders(settings.marriedMessage || "💍 {user} and {target} are now married!", {
    member: user1,
    user: user1?.user || user1,
    target: user2,
    guild: user1?.guild,
  });
  return cv2({
    color: 0xff69b4,
    title: "Just Married",
    description: text,
    thumbnail: user1?.displayAvatarURL?.({ size: 128 }) ?? null,
    image: user2?.displayAvatarURL?.({ size: 128 }) ?? null,
  });
}

export async function sendLog(client, guildId, channelId, content) {
  if (!channelId) return;
  try {
    const channel = client?.channels?.cache?.get(channelId);
    if (channel?.isTextBased()) await channel.send({ content, flags: MessageFlags.SuppressEmbeds });
  } catch (err) {
    console.error("[marriage] Log send error:", err.message);
  }
}

export async function handleButton(interaction, client) {
  const [action, proposerId, targetId, guildId] = interaction.customId.replace("marriage:", "").split(":");
  if (!action || !proposerId || !targetId || !guildId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = await getSettings(guildId);
  if (!settings.enabled) {
    return interaction.editReply("Marriage is not enabled on this server.");
  }

  const target = await interaction.guild?.members?.fetch?.(targetId).catch(() => null);
  const proposer = await interaction.guild?.members?.fetch?.(proposerId).catch(() => null);

  if (action === "decline") {
    if (proposer) {
      try {
        await proposer.send("Your marriage proposal was declined.").catch(() => {});
      } catch {}
    }
    return interaction.editReply("You declined the proposal.");
  }

  if (action !== "accept") return;

  if (interaction.user.id !== targetId) {
    return interaction.editReply("Only the person who was proposed to can accept.");
  }

  if (await Marriage.isMarried(guildId, proposerId) || await Marriage.isMarried(guildId, targetId)) {
    return interaction.editReply("One of you is already married.");
  }

  const hasItems = await hasItemsForProposal(guildId, proposerId, settings);
  if (!hasItems.ring || !hasItems.contract) {
    return interaction.editReply("The proposer no longer has the required ring and contract.");
  }

  await consumeProposalItems(guildId, proposerId, settings);
  const marriage = await Marriage.create(guildId, proposerId, targetId);

  if (settings.marriedRoleId) {
    try {
      await proposer?.roles?.add?.(settings.marriedRoleId).catch(() => {});
      await target?.roles?.add?.(settings.marriedRoleId).catch(() => {});
    } catch (err) {
      console.error("[marriage] Role add error:", err.message);
    }
  }

  const payload = buildMarriagePayload(settings, proposer, target);
  await interaction.editReply(payload);

  const channel = interaction.channel || interaction.guild?.channels?.cache?.get(settings.logChannelId);
  if (channel?.isTextBased()) {
    try {
      await channel.send(payload);
    } catch (err) {
      console.error("[marriage] Married message send error:", err.message);
    }
  }

  return marriage;
}
