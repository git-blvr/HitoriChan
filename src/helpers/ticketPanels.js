import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

export async function buildTicketPanelPayload(panel, customId) {
  const color = toColorInt(await resolveTicketPanelColor(panel));
  const row = new ActionRowBuilder().addComponents(
    buildButton(customId, panel.buttonLabel, panel.buttonColor)
  );

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

    let hasTicketButton = false;
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
        } else if (c.type === "ticket") {
          hasTicketButton = true;
          const b = buildButton(customId, c.label || panel.buttonLabel, c.color || panel.buttonColor);
          container.addActionRowComponents(new ActionRowBuilder().addComponents(b));
        }
      }
    }

    if (!hasTicketButton) {
      container.addActionRowComponents(row);
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

  return { embeds: [embed], components: [row] };
}
