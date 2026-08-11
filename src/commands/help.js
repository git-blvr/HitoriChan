import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} from "discord.js";
import { cv2 } from "../helpers/cv2.js";
import { getPrefix, DEFAULT_PREFIX } from "../utils/prefixManager.js";

const COLOR = 0xffadd1;

const BANNER_URL = "https://cdn.discordapp.com/attachments/1376242032619684061/1523665999046512810/Untitled1679_20260706152430.png?ex=6a577c0a&is=6a562a8a&hm=c394e529642a22fe7895316be92faef296807c6f7f2ad8a55371c1d1d0dca8af";

const CATEGORY_EMOJIS = {
  moderation: "🔨",
  economy:    "💰",
  games:      "🎮",
  tools:      "🔧",
  ai:         "🤖",
  misc:       "✨",
};

const CATEGORY_LABELS = { ai: "AI" };

export default {
  data: new SlashCommandBuilder().setName("help").setDescription("Browse available commands"),
  prefixName: "help",
  aliases: ["h"],
  syntax: "{prefix}help",
  example: "{prefix}help",
  async execute(ctx) {
    const prefix = ctx.guild ? await getPrefix(ctx.guild.id) : DEFAULT_PREFIX;
    const categories = groupByCategory(ctx.client.commands);

    let currentCategory = null;
    let currentCommand  = null;
    let subIndex        = 0;

    await ctx.reply(buildHomePayload(categories));

    const message = await ctx.fetchReplyMessage();
    if (!message) return;

    const collector = message.createMessageComponentCollector({ time: 120_000 });

    collector.on("collect", async (interaction) => {
      if (interaction.user.id !== ctx.user.id) {
        await interaction.reply({ content: "This menu isn't for you.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.customId === "help_category_select") {
        currentCategory = interaction.values[0];
        currentCommand  = null;
        subIndex        = 0;
        const commands  = categories.get(currentCategory) ?? [];
        await interaction.update(buildCategoryPayload(currentCategory, commands));
        return;
      }

      if (interaction.customId === "help_command_select") {
        currentCommand = ctx.client.commands.get(interaction.values[0]);
        if (!currentCommand) return;
        subIndex       = 0;
        const subs     = getSubcommands(currentCommand);

        if (subs.length > 0) {
          await interaction.update(buildSubcommandPayload(currentCommand, subs[0], 0, subs.length, prefix, currentCategory));
        } else {
          await interaction.update(buildCommandPayload(currentCommand, prefix, currentCategory));
        }
        return;
      }

      if (interaction.customId === "help_sub_prev" || interaction.customId === "help_sub_next") {
        if (!currentCommand) return;
        const subs = getSubcommands(currentCommand);
        subIndex   = interaction.customId === "help_sub_prev"
          ? Math.max(0, subIndex - 1)
          : Math.min(subs.length - 1, subIndex + 1);

        await interaction.update(buildSubcommandPayload(currentCommand, subs[subIndex], subIndex, subs.length, prefix, currentCategory));
        return;
      }

      if (interaction.customId.startsWith("help_back")) {
        const [, target] = interaction.customId.split(":");
        currentCommand   = null;
        subIndex         = 0;

        if (target) {
          currentCategory  = target;
          const commands   = categories.get(target) ?? [];
          await interaction.update(buildCategoryPayload(target, commands));
        } else {
          currentCategory = null;
          await interaction.update(buildHomePayload(categories));
        }
      }
    });

    collector.on("end", () => {
      message.edit(cv2({ color: COLOR, description: "Help menu expired.", components: [] })).catch(() => {});
    });
  },
};

function groupByCategory(commands) {
  const map = new Map();
  for (const command of commands.values()) {
    const cat = command.category ?? "misc";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(command);
  }
  return map;
}

function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

function getSubcommands(command) {
  return (command.data.toJSON().options ?? []).filter((o) => o.type === 1);
}

// CV2 payloads

function buildHomePayload(categories) {
  return cv2({
    color: COLOR,
    title: "Hitori-Chan — HELP",
    description: "Choose a category below to browse commands.",
    footer: { text: "Select a category to get started" },
    image: BANNER_URL,
    components: [buildCategorySelect(categories)],
  });
}

function buildCategoryPayload(category, commands) {
  const emoji = CATEGORY_EMOJIS[category] ?? "📁";
  const list  = commands.map((cmd) => `\`${cmd.data.name}\` — ${cmd.data.description}`).join("\n");

  return cv2({
    color: COLOR,
    title: `${emoji} ${categoryLabel(category)} Commands`,
    description: list || "No commands in this category.",
    footer: { text: `${commands.length} command${commands.length !== 1 ? "s" : ""} • Select one for details` },
    components: [buildCommandSelect(commands), buildBackRow()],
  });
}

function buildCommandPayload(command, prefix, category) {
  const aliases = command.aliases?.length
    ? command.aliases.map((a) => `\`${prefix}${a}\``).join(", ")
    : "None";
  const syntax  = (command.syntax  ?? `{prefix}${command.data.name}`).replaceAll("{prefix}", prefix);
  const example = (command.example ?? syntax).replaceAll("{prefix}", prefix);

  return cv2({
    color: COLOR,
    title: `/${command.data.name}`,
    fields: [
      { name: "Description", value: command.data.description },
      { name: "Aliases",     value: aliases,           inline: true },
      { name: "Syntax",      value: `\`${syntax}\``,   inline: true },
      { name: "Example",     value: `\`${example}\`` },
    ],
    components: [buildBackRow(category)],
  });
}

function buildSubcommandPayload(command, subcommand, index, total, prefix, category) {
  const options = (subcommand.options ?? [])
    .map((o) => `\`${o.name}\`${o.required ? "\\*" : ""} — ${o.description}`)
    .join("\n");

  const fields = options ? [{ name: "Options", value: options }] : [];

  return cv2({
    color: COLOR,
    title: `/${command.data.name} ${subcommand.name}`,
    description: subcommand.description,
    footer: { text: `Subcommand ${index + 1} of ${total}${options ? " • * = required" : ""}` },
    fields,
    components: [buildSubNav(index, total), buildBackRow(category)],
  });
}

// ── Components ─────────────────────────────────────────────────────────────────

function buildCategorySelect(categories) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("help_category_select")
    .setPlaceholder("📂 Choose a category")
    .addOptions(
      [...categories.entries()].map(([cat, cmds]) => ({
        label:       `${categoryLabel(cat)} (${cmds.length})`,
        value:       cat,
        emoji:       CATEGORY_EMOJIS[cat] ?? "📁",
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function buildCommandSelect(commands) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("help_command_select")
    .setPlaceholder("🔍 Choose a command")
    .addOptions(
      commands.map((cmd) => ({
        label:       cmd.data.name,
        value:       cmd.data.name,
        description: cmd.data.description?.slice(0, 100),
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function buildSubNav(index, total) {
  const prev = new ButtonBuilder()
    .setCustomId("help_sub_prev")
    .setLabel("‹")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(index === 0);

  const indicator = new ButtonBuilder()
    .setCustomId("help_sub_indicator")
    .setLabel(`${index + 1} / ${total}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const next = new ButtonBuilder()
    .setCustomId("help_sub_next")
    .setLabel("›")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(index === total - 1);

  return new ActionRowBuilder().addComponents(prev, indicator, next);
}

function buildBackRow(category) {
  const button = new ButtonBuilder()
    .setCustomId(category ? `help_back:${category}` : "help_back")
    .setLabel("⬅ Back")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(button);
}
