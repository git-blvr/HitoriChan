import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
} from "discord.js";
import { get_dominant_color } from "../utils/color_utils.js";
import { replacePlaceholders } from "./placeholders.js";
import { cv2 } from "./cv2.js";

function buildButton(customId, label, color) {
  const styleMap = {
    green: ButtonStyle.Success,
    red: ButtonStyle.Danger,
    blue: ButtonStyle.Primary,
    gray: ButtonStyle.Secondary,
  };
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(styleMap[color] ?? ButtonStyle.Success);
}

function buildCategorySelect(customId, categories, placeholder) {
  const options = categories
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => String(c.label).trim())
    .map(({ c, i }) => {
      const label = String(c.label).trim().slice(0, 100);
      const builder = new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(i));
      const desc = String(c.description || "").trim().slice(0, 100);
      if (desc) builder.setDescription(desc);
      return builder;
    });

  if (!options.length) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder || "Select a category")
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

export async function resolveTicketPanelColor(panel) {
  if (!panel.useDominantColor) return panel.color;

  const imageUrl = findImageUrl(panel, true);
  if (!imageUrl) return panel.color;

  try {
    return await get_dominant_color(imageUrl);
  } catch {
    return panel.color;
  }
}

export function findImageUrl(panel, preferComponent = false) {
  if (panel.type === "cv2" && Array.isArray(panel.components)) {
    for (let i = panel.components.length - 1; i >= 0; i--) {
      const c = panel.components[i];
      if (c?.type === "image" && c.url) return c.url;
    }
  }
  return panel.imageUrl || panel.thumbnailUrl || null;
}

function toColorInt(color) {
  if (color === null || color === undefined || color === "") return null;
  if (typeof color === "number") return color;
  const str = String(color).replace("#", "");
  return parseInt(str, 16) || null;
}

function escapeBold(str) {
  return String(str).replace(/\*/g, "\\*");
}

function buildText(content) {
  return new TextDisplayBuilder().setContent(content);
}

function buildThumbnail(url) {
  if (!url) return null;
  return new ThumbnailBuilder({ media: { url } });
}

function buildSection(text, thumbUrl = null) {
  const section = new SectionBuilder().addTextDisplayComponents(buildText(text));
  if (thumbUrl) {
    const thumb = buildThumbnail(thumbUrl);
    if (thumb) section.setThumbnailAccessory(thumb);
  }
  return section;
}

export function getStaffRoleIds(panel) {
  const ids = [];
  if (panel.staffRoleId) ids.push(panel.staffRoleId);
  if (Array.isArray(panel.staffRoleIds)) {
    for (const id of panel.staffRoleIds) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export function isStaffRole(member, panel) {
  const ids = getStaffRoleIds(panel);
  if (!ids.length) return false;
  return ids.some((id) => member?.roles?.cache?.has?.(id));
}

async function resolveWelcomeColor(panel) {
  if (!panel.welcomeUseDominantColor) return toColorInt(panel.welcomeColor ?? panel.color ?? 0x7c3aed);
  const imageUrl = panel.welcomeImageUrl || panel.welcomeThumbnailUrl;
  if (!imageUrl) return toColorInt(panel.welcomeColor ?? panel.color ?? 0x7c3aed);
  try {
    return await get_dominant_color(imageUrl);
  } catch {
    return toColorInt(panel.welcomeColor ?? panel.color ?? 0x7c3aed);
  }
}

export async function buildTicketWelcomeMessage(panel, user, member, guild, channel, ticket, claimerId, actionRow) {
  const createdAt = ticket?.createdAt?.getTime?.() ?? Date.now();
  const category = ticket?.category ?? null;
  const title = panel.welcomeTitle || "A ticket is open";
  const description = panel.welcomeMessage || `By <@${user.id}>`;
  const color = await resolveWelcomeColor(panel);
  const image = panel.welcomeImageUrl || null;
  const thumbnail = panel.welcomeThumbnailUrl || null;

  const context = { member, user, guild, channel, client: guild?.client };
  const resolvedTitle = replacePlaceholders(title, context);
  const resolvedDescription = replacePlaceholders(description, context);

  const fields = [
    { name: "Category", value: category || "—", inline: true },
    { name: "Claimed by", value: claimerId ? `<@${claimerId}>` : "No one", inline: true },
    { name: "Created", value: `<t:${Math.floor(createdAt / 1000)}:F>`, inline: false },
  ];

  if (panel.welcomeType === "cv2") {
    return cv2({
      color,
      title: resolvedTitle,
      description: resolvedDescription,
      image,
      thumbnail,
      fields,
      components: [actionRow],
      ephemeral: false,
    });
  }

  const embed = new EmbedBuilder();
  if (resolvedTitle) embed.setTitle(resolvedTitle);
  if (resolvedDescription) embed.setDescription(resolvedDescription);
  if (color != null) embed.setColor(color);
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  for (const f of fields) {
    if (f.name && f.value) embed.addFields(f);
  }
  return { embeds: [embed], components: [actionRow] };
}

export async function buildTicketPanelPayload(panel, customId) {
  const color = toColorInt(await resolveTicketPanelColor(panel));
  const selectRow = panel.useCategoryDropdown
    ? buildCategorySelect(`ticket:select_category:${panel.id}`, panel.categories, panel.buttonLabel)
    : null;
  const buttonRow = !selectRow
    ? new ActionRowBuilder().addComponents(buildButton(customId, panel.buttonLabel, panel.buttonColor))
    : null;

  if (panel.type === "cv2") {
    const container = new ContainerBuilder();
    if (color != null) container.setAccentColor(color);

    if (panel.title) {
      const titleParts = [];
      if (panel.title) titleParts.push(`**${escapeBold(panel.title)}**`);
      if (panel.description) titleParts.push(String(panel.description));
      const text = titleParts.join("\n\n");
      if (panel.thumbnailUrl) {
        container.addSectionComponents(buildSection(text, panel.thumbnailUrl));
      } else {
        container.addTextDisplayComponents(buildText(text));
      }
    } else if (panel.description) {
      container.addTextDisplayComponents(buildText(String(panel.description)));
    }

    if (Array.isArray(panel.components)) {
      for (const c of panel.components) {
        if (!c || !c.type) continue;
        if (c.type === "text" && c.content) {
          container.addTextDisplayComponents(buildText(String(c.content)));
        } else if (c.type === "image" && c.url) {
          const gallery = new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder({ media: { url: c.url } })
          );
          container.addMediaGalleryComponents(gallery);
        } else if (c.type === "separator") {
          container.addSeparatorComponents(new SeparatorBuilder().setDivider(Boolean(c.divider)).setSpacing(c.large ? 2 : 1));
        } else if (c.type === "ticket" && !selectRow) {
          const b = buildButton(customId, c.label || panel.buttonLabel, c.color || panel.buttonColor);
          container.addActionRowComponents(new ActionRowBuilder().addComponents(b));
        }
      }
    }

    if (selectRow) {
      container.addActionRowComponents(selectRow);
    } else if (buttonRow) {
      container.addActionRowComponents(buttonRow);
    }

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  const embed = new EmbedBuilder();
  if (panel.title) embed.setTitle(panel.title);
  if (panel.description) embed.setDescription(panel.description);
  if (color != null) embed.setColor(color);
  if (panel.imageUrl) embed.setImage(panel.imageUrl);
  if (panel.thumbnailUrl) embed.setThumbnail(panel.thumbnailUrl);

  if (Array.isArray(panel.fields)) {
    for (const f of panel.fields) {
      if (f?.name && f?.value) {
        embed.addFields({ name: f.name, value: f.value, inline: Boolean(f.inline) });
      }
    }
  }

  return { embeds: [embed], components: [selectRow || buttonRow] };
}
