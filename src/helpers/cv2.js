import {
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";

const SPACING_SMALL = 1;
const SPACING_LARGE = 2;

function toURL(input) {
  if (typeof input === "string") return input;
  return input?.url ?? input?.media?.url ?? null;
}

function escapeBold(str) {
  return String(str).replace(/\*/g, "\\*");
}

function buildThumbnail(input) {
  const url = toURL(input);
  if (!url) return null;
  return new ThumbnailBuilder({ media: { url } });
}

function buildTextDisplay(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

export function section(textContent, accessory = null) {
  const section = new SectionBuilder().addTextDisplayComponents(buildTextDisplay(textContent));
  if (accessory) {
    const thumb = buildThumbnail(accessory);
    if (thumb) section.setThumbnailAccessory(thumb);
  }
  return section;
}

export function separator(large = false, divider = true) {
  return new SeparatorBuilder()
    .setDivider(divider)
    .setSpacing(large ? SPACING_LARGE : SPACING_SMALL);
}

export function mediaGallery(urls) {
  const gallery = new MediaGalleryBuilder();
  const list = Array.isArray(urls) ? urls : [urls];
  for (const item of list) {
    const url = toURL(item);
    if (!url) continue;
    gallery.addItems(new MediaGalleryItemBuilder({ media: { url } }));
  }
  return gallery;
}

export function cv2({
  color = null,
  title = null,
  url = null,
  description = null,
  thumbnail = null,
  image = null,
  author = null,
  footer = null,
  fields = [],
  components = [],
  separators = false,
  timestamp = false,
  ephemeral = false,
} = {}) {
  const container = new ContainerBuilder();
  if (color != null) container.setAccentColor(color);

  // Author
  if (author?.name) {
    const authorText = author.url
      ? `[**${escapeBold(author.name)}**](${author.url})`
      : `**${escapeBold(author.name)}**`;
    const section = new SectionBuilder().addTextDisplayComponents(buildTextDisplay(authorText));
    if (author.iconURL) {
      const thumb = buildThumbnail(author.iconURL);
      if (thumb) section.setThumbnailAccessory(thumb);
    }
    container.addSectionComponents(section);
  }

  // Title + description, optionally with a thumbnail
  const headerParts = [];
  if (title) {
    headerParts.push(url ? `[**${escapeBold(title)}**](${url})` : `**${escapeBold(title)}**`);
  }
  if (description) {
    headerParts.push(String(description));
  }

  if (headerParts.length) {
    const headerText = headerParts.join("\n\n");
    if (thumbnail) {
      const thumb = buildThumbnail(thumbnail);
      if (thumb) {
        container.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(buildTextDisplay(headerText))
            .setThumbnailAccessory(thumb)
        );
      } else {
        container.addTextDisplayComponents(buildTextDisplay(headerText));
      }
    } else {
      container.addTextDisplayComponents(buildTextDisplay(headerText));
    }
  }

  // Fields
  if (fields.length) {
    if (separators) container.addSeparatorComponents(separator(false, false));

    // Group consecutive inline fields, then render each block
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f) continue;

      const block = [`**${escapeBold(f.name)}**`, String(f.value)];
      if (f.inline && i + 1 < fields.length && fields[i + 1]?.inline) {
        const next = fields[i + 1];
        block.push(`\n**${escapeBold(next.name)}**`, String(next.value));
        i++;
      }
      container.addTextDisplayComponents(buildTextDisplay(block.join("\n")));
    }
  }

  // Images
  if (image) {
    container.addMediaGalleryComponents(mediaGallery(image));
  }

  // Footer + timestamp
  if (footer || timestamp) {
    const parts = [];
    if (footer?.text) parts.push(String(footer.text));
    if (footer?.iconURL) parts.push(`[icon](${footer.iconURL})`); // v2 can't show icon in footer easily
    if (timestamp) {
      const date = timestamp instanceof Date ? timestamp : new Date();
      parts.push(`<t:${Math.floor(date.getTime() / 1000)}:f>`);
    }
    if (parts.length) {
      if (separators) container.addSeparatorComponents(separator(false, false));
      container.addTextDisplayComponents(buildTextDisplay(parts.join(" • ")));
    }
  }

  // Extra action rows / components
  if (components.length) {
    for (const c of components) {
      if (c instanceof ActionRowBuilder) {
        container.addActionRowComponents(c);
      } else if (c?.toJSON) {
        // if it's another builder, wrap it in an ActionRow
        const row = new ActionRowBuilder().addComponents(c);
        container.addActionRowComponents(row);
      } else if (c?.type === 17) {
        // already a container component object
        // can't nest containers, skip
      } else {
        container.addActionRowComponents(c);
      }
    }
  }

  const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
  return {
    components: [container],
    flags,
  };
}

export function isCV2Payload(payload) {
  return payload?.flags === MessageFlags.IsComponentsV2 && Array.isArray(payload?.components);
}
