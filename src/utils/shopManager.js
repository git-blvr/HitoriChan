import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import * as ShopCategory from "../models/ShopCategory.js";
import * as ShopItem from "../models/ShopItem.js";
import * as ShopPurchase from "../models/ShopPurchase.js";
import * as EconomyAccount from "../models/EconomyAccount.js";
import * as GuildSettings from "../models/GuildSettings.js";
import { cv2, text, mediaGallery, separator } from "../helpers/cv2.js";
import { getGuildEconomyConfig } from "./economyManager.js";
import { get_dominant_color } from "../utils/color_utils.js";

const CUSTOM_CATEGORY = "shop_cat";
const CUSTOM_ITEM = "shop_item";
const CUSTOM_BUY = "shop_buy";

function parseJson(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export async function getFullShop(guildId) {
  const categories = await ShopCategory.getByGuild(guildId);
  const items = await ShopItem.getByGuild(guildId);
  return categories.map((c) => ({
    ...c,
    items: items.filter((i) => i.categoryId === c.id),
  }));
}

export function getShopCustomIds(guildId) {
  return {
    category: `${CUSTOM_CATEGORY}:${guildId}`,
    item: (categoryId) => `${CUSTOM_ITEM}:${guildId}:${categoryId}`,
    buy: (itemId) => `${CUSTOM_BUY}:${itemId}`,
  };
}

export function formatPriceShort(item, config) {
  const parts = [];
  if (item.price > 0) parts.push(`${item.price.toLocaleString()} ${config.primary.name}`);
  if (item.priceSecondary > 0) parts.push(`${item.priceSecondary.toLocaleString()} ${config.secondary.name}`);
  return parts.length ? parts.join(" + ") : "Free";
}

export function buildItemDetails(item, config) {
  const lines = [item.description || "No description."];
  lines.push(`\n**Price:** ${formatPriceShort(item, config)}`);
  if (item.roleId) lines.push(`**Role:** <@&${item.roleId}>`);
  if (item.multiplierType) {
    lines.push(`**Multiplier:** +${item.multiplierValue ?? 0} ${item.multiplierType}`);
  }
  if (item.specialCommands?.length) {
    lines.push(`**Unlocks:** ${item.specialCommands.join(", ")}`);
  }
  if (item.stock !== null) lines.push(`**Stock:** ${item.stock} total`);
  if (item.maxPurchases !== null) lines.push(`**Limit:** ${item.maxPurchases} per person`);
  if (item.requiresRoleId) lines.push(`**Requires:** <@&${item.requiresRoleId}>`);
  return lines.join("\n");
}

function buildInterfaceComponents(components) {
  if (!Array.isArray(components)) return [];
  const out = [];
  for (const c of components) {
    if (!c?.type) continue;
    try {
      if (c.type === "text" && c.content) out.push(text(c.content));
      if (c.type === "image" && c.url) out.push(mediaGallery(c.url));
      if (c.type === "media_gallery" && (c.urls?.length || c.url)) {
        const urls = Array.isArray(c.urls) ? c.urls : [c.url].filter(Boolean);
        out.push(mediaGallery(urls));
      }
      if (c.type === "separator") out.push(separator());
    } catch (err) {
      console.warn("Failed to build shop interface component:", err);
    }
  }
  return out;
}

function findFirstImageUrl(components) {
  for (const c of components || []) {
    if (c.type === "image" && c.url) return c.url;
    if (c.type === "media_gallery") {
      const urls = Array.isArray(c.urls) ? c.urls : [c.url].filter(Boolean);
      if (urls[0]) return urls[0];
    }
  }
  return null;
}

async function resolveShopColor(settings) {
  if (settings.shopInterfaceUseDominantColor) {
    const imageUrl = findFirstImageUrl(settings.shopInterfaceComponents);
    if (imageUrl) {
      try {
        return await get_dominant_color(imageUrl);
      } catch (err) {
        console.warn("Could not get dominant color for shop interface:", err.message);
      }
    }
  }
  return settings.shopInterfaceColor ?? 0xffd700;
}

export async function buildShopInterface(guildId, selectedCategoryId = null) {
  const categories = await ShopCategory.getByGuild(guildId);
  const items = await ShopItem.getByGuild(guildId);
  const config = await getGuildEconomyConfig(guildId);
  const guildSettings = await GuildSettings.getOrCreate(guildId);
  const color = await resolveShopColor(guildSettings);

  const ids = getShopCustomIds(guildId);

  const categoryOptions = categories.map((c) => ({
    label: c.name.slice(0, 100),
    value: String(c.id),
    description: c.description?.slice(0, 100) || undefined,
    default: selectedCategoryId === c.id,
  }));

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ids.category)
      .setPlaceholder("Select a category...")
      .setOptions(categoryOptions.length ? categoryOptions : [{ label: "No categories", value: "0" }])
      .setDisabled(categoryOptions.length === 0)
  );

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const categoryItems = selectedCategory
    ? items.filter((i) => i.categoryId === selectedCategory.id)
    : [];

  const itemOptions = categoryItems.map((item) => ({
    label: `${item.name} - ${formatPriceShort(item, config)}`.slice(0, 100),
    value: String(item.id),
    description: item.description?.slice(0, 100) || undefined,
  }));

  const itemRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(ids.item(selectedCategoryId || 0))
      .setPlaceholder(selectedCategory ? `Items in ${selectedCategory.name}...` : "Select a category first...")
      .setOptions(itemOptions.length ? itemOptions : [{ label: "No items", value: "0" }])
      .setDisabled(!selectedCategory || itemOptions.length === 0)
  );

  const headerText = "**Shop**\nPick a category to see the available items.";
  const cv2Components = [
    text(headerText),
    ...buildInterfaceComponents(guildSettings.shopInterfaceComponents),
  ];

  return cv2({
    color,
    cv2Components,
    components: [categoryRow, itemRow],
  });
}

export async function buildItemPreview(guildId, itemId, ephemeral = true) {
  const item = await ShopItem.getById(itemId);
  if (!item) throw new Error("Item not found.");

  const config = await getGuildEconomyConfig(guildId);
  const ids = getShopCustomIds(guildId);

  const details = buildItemDetails(item, config);
  const buyButton = new ButtonBuilder()
    .setCustomId(ids.buy(item.id))
    .setLabel(`Buy for ${formatPriceShort(item, config)}`)
    .setStyle(ButtonStyle.Success);

  const buyRow = new ActionRowBuilder().addComponents(buyButton);

  return cv2({
    color: 0xffd700,
    title: item.name,
    description: details,
    components: [buyRow],
    ephemeral,
  });
}

export async function hasShopItem(guildId, userId, itemId) {
  return (await ShopPurchase.getUserItemCount(guildId, userId, itemId)) > 0;
}

export async function hasShopCommand(guildId, userId, commandName) {
  const account = await EconomyAccount.getOrCreate(guildId, userId);
  if (!account?.shopItemIds?.length) return false;
  for (const id of account.shopItemIds) {
    const item = await ShopItem.getById(id);
    if (item?.specialCommands?.some((c) => c.toLowerCase() === commandName.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export async function purchaseItem(guildId, userId, itemId, member) {
  const item = await ShopItem.getById(itemId);
  if (!item) throw new Error("Item not found.");
  if (item.guildId !== guildId) throw new Error("Item does not belong to this server.");

  const account = await EconomyAccount.getOrCreate(guildId, userId);

  // Currency check
  if (item.price > 0 && account.primary < item.price) {
    throw new Error(`Insufficient ${(await getGuildEconomyConfig(guildId)).primary.name}.`);
  }
  if (item.priceSecondary > 0 && account.secondary < item.priceSecondary) {
    throw new Error(`Insufficient ${(await getGuildEconomyConfig(guildId)).secondary.name}.`);
  }

  // Role requirement
  if (item.requiresRoleId && !member.roles.cache.has(item.requiresRoleId)) {
    throw new Error("You do not meet the role requirement to buy this item.");
  }

  // Stock
  if (item.stock !== null && item.stock !== undefined) {
    const sold = await ShopPurchase.getItemTotalCount(guildId, item.id);
    if (sold >= item.stock) {
      throw new Error("This item is out of stock.");
    }
  }

  // Max purchases per user
  if (item.maxPurchases !== null && item.maxPurchases !== undefined) {
    const userCount = await ShopPurchase.getUserItemCount(guildId, userId, item.id);
    if (userCount >= item.maxPurchases) {
      throw new Error("You have already bought the maximum amount of this item.");
    }
  }

  // Deduct currency
  account.primary -= item.price || 0;
  account.secondary -= item.priceSecondary || 0;

  // Apply effects
  if (item.roleId && member) {
    await member.roles.add(item.roleId).catch(() => {
      throw new Error("Could not assign the role. Make sure the bot's role is higher than the item role.");
    });
  }

  if (item.multiplierType === "earnings" && item.multiplierValue) {
    account.earningsMultiplier = (account.earningsMultiplier || 1) + (item.multiplierValue || 0);
  } else if (item.multiplierType === "level" && item.multiplierValue) {
    account.level = (account.level || 1) + (item.multiplierValue || 0);
  }

  if (!account.shopItemIds) account.shopItemIds = [];
  if (!account.shopItemIds.includes(item.id)) {
    account.shopItemIds.push(item.id);
  }

  await EconomyAccount.save(account);
  await ShopPurchase.create({ guildId, userId, itemId: item.id, quantity: 1 });

  return { account, item };
}

export async function getShopSettings(guildId) {
  const settings = await GuildSettings.getOrCreate(guildId);
  return {
    shopChannelId: settings.shopChannelId,
    shopMessageId: settings.shopMessageId,
    shopInterfaceEnabled: settings.shopInterfaceEnabled,
    shopInterfaceComponents: settings.shopInterfaceComponents,
    shopInterfaceColor: settings.shopInterfaceColor,
    shopInterfaceUseDominantColor: settings.shopInterfaceUseDominantColor,
  };
}

export async function setShopSettings(guildId, values) {
  return GuildSettings.setShop(guildId, values);
}
