import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} from "discord.js";
import { getPrefix, DEFAULT_PREFIX } from "../utils/prefixManager.js";

const COLOR = 0x5865f2;
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

    await ctx.reply({
      embeds: [buildHomeEmbed(categories)],
      components: [buildCategorySelect(categories)],
    });

    const message = await ctx.fetchReplyMessage();
    if (!message) return;

    const collector = message.createMessageComponentCollector({ time: 120_000 });

    collector.on("collect", async (interaction) => {
      if (interaction.user.id !== ctx.user.id) {
        await interaction.reply({ content: "This menu isn't for you.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.customId === "help_category_select") {
        const category = interaction.values[0];
        const commands = categories.get(category) ?? [];
        await interaction.update({
          embeds: [buildCategoryEmbed(category, commands)],
          components: [buildCommandSelect(commands), buildBackRow()],
        });
        return;
      }

      if (interaction.customId === "help_command_select") {
        const command = ctx.client.commands.get(interaction.values[0]);
        if (!command) return;
        await interaction.update({
          embeds: [buildCommandEmbed(command, prefix)],
          components: [buildBackRow(command.category)],
        });
        return;
      }

      if (interaction.customId.startsWith("help_back")) {
        const [, target] = interaction.customId.split(":");
        if (target) {
          const commands = categories.get(target) ?? [];
          await interaction.update({
            embeds: [buildCategoryEmbed(target, commands)],
            components: [buildCommandSelect(commands), buildBackRow()],
          });
        } else {
          await interaction.update({
            embeds: [buildHomeEmbed(categories)],
            components: [buildCategorySelect(categories)],
          });
        }
      }
    });

    collector.on("end", () => {
      message.edit({ components: [] }).catch(() => {});
    });
  },
};

function groupByCategory(commands) {
  const map = new Map();
  for (const command of commands.values()) {
    const category = command.category ?? "misc";
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(command);
  }
  return map;
}

function buildHomeEmbed(categories) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("HitoriChan Commands")
    .setDescription("Select a category below to see its commands.");

  for (const [category, commands] of categories) {
    embed.addFields({ name: categoryLabel(category), value: `${commands.length} command(s)`, inline: true });
  }

  return embed;
}

function buildCategoryEmbed(category, commands) {
  const list = commands.map((cmd) => `\`${cmd.data.name}\` — ${cmd.data.description}`).join("\n");

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${categoryLabel(category)} Commands`)
    .setDescription(list || "No commands in this category.");
}

function buildCommandEmbed(command, prefix) {
  const aliases = command.aliases?.length
    ? command.aliases.map((alias) => `\`${prefix}${alias}\``).join(", ")
    : "None";
  const syntax = (command.syntax ?? "{prefix}" + command.data.name).replaceAll("{prefix}", prefix);
  const example = (command.example ?? syntax).replaceAll("{prefix}", prefix);

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(command.data.name)
    .addFields(
      { name: "Description", value: command.data.description },
      { name: "Aliases", value: aliases },
      { name: "Syntax", value: `\`${syntax}\`` },
      { name: "Example", value: `\`${example}\`` }
    );
}

function buildCategorySelect(categories) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("help_category_select")
    .setPlaceholder("Choose a category")
    .addOptions(
      [...categories.keys()].map((category) => ({
        label: categoryLabel(category),
        value: category,
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function buildCommandSelect(commands) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("help_command_select")
    .setPlaceholder("Choose a command")
    .addOptions(
      commands.map((cmd) => ({
        label: cmd.data.name,
        value: cmd.data.name,
        description: cmd.data.description?.slice(0, 100),
      }))
    );

  return new ActionRowBuilder().addComponents(select);
}

function buildBackRow(category) {
  const button = new ButtonBuilder()
    .setCustomId(category ? `help_back:${category}` : "help_back")
    .setLabel("⬅ Back")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(button);
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}