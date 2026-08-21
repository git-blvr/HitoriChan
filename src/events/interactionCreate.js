import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import * as TicketPanel from "../models/TicketPanel.js";
import * as Ticket from "../models/Ticket.js";
import { resolveTicketPanelColor } from "../helpers/ticketPanels.js";
import { cv2 } from "../helpers/cv2.js";
import { embErr, embWrn } from "../helpers/embeds.js";
import { buildShopInterface, buildItemSelectMessage, buildItemPreview, purchaseItem } from "../utils/shopManager.js";

function ticketButton(customId, label, color = "red") {
  const styleMap = {
    green: ButtonStyle.Success,
    red: ButtonStyle.Danger,
    blue: ButtonStyle.Primary,
    gray: ButtonStyle.Secondary,
  };
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(styleMap[color] ?? ButtonStyle.Danger);
}

async function createTicketChannel(guild, user, panel) {
  const baseName = `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
  const name = `${baseName}-${Math.floor(Date.now() / 1000) % 100000}`;

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
  ];

  if (panel.staffRoleId) {
    overwrites.push({
      id: panel.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
    });
  }

  return await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: panel.categoryId || undefined,
    permissionOverwrites: overwrites,
  });
}

function buildTicketWelcomeEmbed(panel, userId, category, claimerId, createdAt) {
  const color = panel.color ?? 0x7c3aed;
  const embed = new EmbedBuilder()
    .setTitle("A ticket is open")
    .setDescription(`By <@${userId}>`)
    .setColor(color)
    .addFields(
      { name: "Category", value: category || "—", inline: true },
      { name: "Claimed by", value: claimerId ? `<@${claimerId}>` : "No one", inline: true },
      { name: "Created in", value: `<t:${Math.floor(createdAt / 1000)}:F>`, inline: false }
    );
  return embed;
}

function ticketActionRow(ticket, claimerId) {
  if (claimerId) {
    return new ActionRowBuilder().addComponents(
      ticketButton(`ticket:unclaim:${ticket.id}`, "Unclaim Ticket", "gray"),
      ticketButton(`ticket:close:${ticket.id}`, "Close Ticket", "red")
    );
  }
  return new ActionRowBuilder().addComponents(
    ticketButton(`ticket:claim:${ticket.id}`, "Claim Ticket", "blue"),
    ticketButton(`ticket:close:${ticket.id}`, "Close Ticket", "red")
  );
}

async function createTicketFromInteraction(interaction, panel, category = null) {
  const existing = (await Ticket.getForUser(interaction.guildId, interaction.user.id)).find((t) => t.panelId === panel.id && t.status === "open");
  if (existing) {
    return interaction.editReply({ content: `You already have an open ticket: <#${existing.channelId}>` }).catch(() => {});
  }

  try {
    const channel = await createTicketChannel(interaction.guild, interaction.user, panel);
    const ticket = await Ticket.create({
      guildId: interaction.guildId,
      panelId: panel.id,
      channelId: channel.id,
      userId: interaction.user.id,
      status: "open",
      category,
    });

    const color = await resolveTicketPanelColor(panel);
    if (color != null) panel.color = color;

    const row = ticketActionRow(ticket, null);
    const welcomeEmbed = buildTicketWelcomeEmbed(panel, interaction.user.id, ticket.category, null, ticket.createdAt.getTime());
    await channel.send({ embeds: [welcomeEmbed], components: [row] });

    return interaction.editReply({ content: `Ticket created: <#${channel.id}>` });
  } catch (err) {
    console.error("Ticket creation error:", err);
    return interaction.editReply({ content: "Could not create the ticket. Check bot permissions." });
  }
}

async function handleShopInteraction(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.reply({ content: "The shop only works in a server.", flags: MessageFlags.Ephemeral });
  }

  const customId = interaction.customId;
  const parts = customId.split(":");

  // Category select: shop_cat:guildId
  if (parts[0] === "shop_cat") {
    const categoryId = Number(interaction.values[0]);
    if (!categoryId) {
      return interaction.update(await buildShopInterface(guildId));
    }
    try {
      await interaction.deferUpdate();
      await interaction.editReply(await buildShopInterface(guildId, categoryId));
      await interaction.followUp(await buildItemSelectMessage(guildId, categoryId, true));
      return;
    } catch (err) {
      console.error("Shop category error:", err);
      const error = { content: err.message, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) return interaction.followUp(error);
      return interaction.reply(error);
    }
  }

  // Item select: shop_item:guildId:categoryId
  if (parts[0] === "shop_item") {
    const itemId = Number(interaction.values[0]);
    if (!itemId) {
      return interaction.update(await buildShopInterface(guildId));
    }
    try {
      return interaction.update(await buildItemPreview(guildId, itemId, true));
    } catch (err) {
      return interaction.update(await cv2({
        color: 0xff0000,
        title: "Item Error",
        description: err.message,
        ephemeral: true,
      }));
    }
  }

  // Buy button: shop_buy:itemId
  if (parts[0] === "shop_buy") {
    const itemId = Number(parts[1]);
    if (!itemId) {
      return interaction.reply({ content: "Select an item first.", flags: MessageFlags.Ephemeral });
    }

    try {
      const { item } = await purchaseItem(guildId, interaction.user.id, itemId, interaction.member);
      const currency = await import("../utils/economyManager.js").then((m) => m.getGuildEconomyConfig(guildId));

      const effects = [];
      if (item.roleId) effects.push(`<@&${item.roleId}>`);
      if (item.multiplierType) effects.push(`+${item.multiplierValue} ${item.multiplierType}`);
      if (item.specialCommands?.length) effects.push(`Unlocked: ${item.specialCommands.join(", ")}`);

      const confirm = cv2({
        color: 0x2ecc71,
        title: "Purchase Successful",
        description: `You bought **${item.name}** for ${item.price > 0 ? `${item.price.toLocaleString()} ${currency.primary.name}` : ""}${item.priceSecondary > 0 ? ` + ${item.priceSecondary.toLocaleString()} ${currency.secondary.name}` : ""}.`,
        fields: effects.length ? [{ name: "Effects", value: effects.join("\n"), inline: true }] : [],
        ephemeral: true,
      });
      return interaction.update(confirm);
    } catch (err) {
      const error = cv2({
        color: 0xff0000,
        title: "Purchase Failed",
        description: err.message,
        ephemeral: true,
      });
      return interaction.update(error);
    }
  }
}

async function updateWelcomeMessage(channel, ticket, panel) {
  const welcomeMessage = await channel.messages.fetch({ limit: 10 }).then((msgs) => msgs.find((m) => m.components?.length)).catch(() => null);
  if (!welcomeMessage) return;

  const color = await resolveTicketPanelColor(panel);
  if (color != null) panel.color = color;

  const row = ticketActionRow(ticket, ticket.claimerId);
  const embed = buildTicketWelcomeEmbed(panel, ticket.userId, ticket.category, ticket.claimerId, ticket.createdAt.getTime());
  await welcomeMessage.edit({ embeds: [embed], components: [row] });
}

async function handleTicketSelectMenu(interaction) {
  const [prefix, action, id] = interaction.customId.split(":");
  if (prefix !== "ticket") return;

  if (action === "select_category") {
    const panel = await TicketPanel.get(id);
    if (!panel || panel.guildId !== interaction.guildId) {
      return interaction.reply({ content: "This ticket panel no longer exists.", flags: MessageFlags.Ephemeral });
    }

    const index = Number(interaction.values[0]);
    const category = Array.isArray(panel.categories) && panel.categories[index] ? String(panel.categories[index].label).trim() : null;
    const existing = (await Ticket.getForUser(interaction.guildId, interaction.user.id)).find((t) => t.panelId === panel.id && t.status === "open");
    if (existing) {
      return interaction.reply({ content: `You already have an open ticket: <#${existing.channelId}>`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return createTicketFromInteraction(interaction, panel, category || null);
  }
}

async function handleTicketButton(interaction, client) {
  const [prefix, action, id] = interaction.customId.split(":");
  if (prefix !== "ticket") return;

  if (action === "create") {
    const panel = await TicketPanel.get(id);
    if (!panel || panel.guildId !== interaction.guildId) {
      return interaction.reply({ content: "This ticket panel no longer exists.", flags: MessageFlags.Ephemeral });
    }

    const existing = (await Ticket.getForUser(interaction.guildId, interaction.user.id)).find((t) => t.panelId === panel.id && t.status === "open");
    if (existing) {
      return interaction.reply({ content: `You already have an open ticket: <#${existing.channelId}>`, flags: MessageFlags.Ephemeral });
    }

    if (Array.isArray(panel.categories) && panel.categories.length) {
      const options = panel.categories
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => String(c.label).trim())
        .map(({ c, i }) => {
          const label = String(c.label).trim().slice(0, 100);
          const builder = new StringSelectMenuOptionBuilder()
            .setLabel(label)
            .setValue(String(i));
          const desc = String(c.description || "").trim().slice(0, 100);
          if (desc) builder.setDescription(desc);
          return builder;
        });
      if (!options.length) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return createTicketFromInteraction(interaction, panel, null);
      }
      const select = new StringSelectMenuBuilder()
        .setCustomId(`ticket:select_category:${panel.id}`)
        .setPlaceholder("Select a category")
        .addOptions(options);
      const row = new ActionRowBuilder().addComponents(select);
      return interaction.reply({ content: "Choose a category for your ticket:", components: [row], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return createTicketFromInteraction(interaction, panel, null);
  }

  if (action === "close") {
    const ticket = await Ticket.get(id);
    if (!ticket || ticket.guildId !== interaction.guildId) {
      return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    }

    const panel = await TicketPanel.get(ticket.panelId);
    const isStaff = panel?.staffRoleId ? interaction.member.roles.cache.has(panel.staffRoleId) : false;
    if (ticket.userId !== interaction.user.id && !isStaff && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: "You cannot close this ticket.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = client.channels.cache.get(ticket.channelId);
      const transcriptId = panel?.transcriptChannelId;

      if (transcriptId && channel) {
        const transcriptChannel = client.channels.cache.get(transcriptId);
        if (transcriptChannel?.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle(`Ticket closed`)
            .setDescription(`Ticket <#${ticket.channelId}> was closed by <@${interaction.user.id}>`)
            .setColor(0x7c3aed)
            .setFooter({ text: `User: ${ticket.userId}` })
            .setTimestamp();
          await transcriptChannel.send({ embeds: [embed] });
        }
      }

      const replied = await interaction.editReply({ content: "Ticket closed." }).catch((e) => {
        console.error("editReply failed before delete:", e.message);
        return null;
      });

      await Ticket.close(ticket.id);
      if (channel) await channel.delete("Ticket closed").catch(() => {});

      return replied;
    } catch (err) {
      console.error("Ticket close error:", err);
      return interaction.editReply({ content: "Could not close the ticket." }).catch(() => {});
    }
  }

  if (action === "claim") {
    const ticket = await Ticket.get(id);
    if (!ticket || ticket.guildId !== interaction.guildId) {
      return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    }

    const panel = await TicketPanel.get(ticket.panelId);
    const isStaff = panel?.staffRoleId ? interaction.member.roles.cache.has(panel.staffRoleId) : false;
    if (ticket.claimerId && ticket.claimerId !== interaction.user.id && !isStaff && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: "This ticket is already claimed.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = client.channels.cache.get(ticket.channelId);
      if (channel) {
        await channel.permissionOverwrites.create(interaction.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }

      const updated = await Ticket.claim(ticket.id, interaction.user.id);
      if (channel && panel) await updateWelcomeMessage(channel, updated, panel);

      return interaction.editReply({ content: `You claimed this ticket.` });
    } catch (err) {
      console.error("Ticket claim error:", err);
      return interaction.editReply({ content: "Could not claim the ticket." });
    }
  }

  if (action === "unclaim") {
    const ticket = await Ticket.get(id);
    if (!ticket || ticket.guildId !== interaction.guildId) {
      return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    }
    if (ticket.claimerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: "You cannot unclaim this ticket.", flags: MessageFlags.Ephemeral });
    }

    const panel = await TicketPanel.get(ticket.panelId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = client.channels.cache.get(ticket.channelId);
      if (channel && ticket.claimerId) {
        await channel.permissionOverwrites.delete(ticket.claimerId).catch(() => {});
      }

      const updated = await Ticket.unclaim(ticket.id);
      if (channel && panel) await updateWelcomeMessage(channel, updated, panel);

      return interaction.editReply({ content: "Ticket unclaimed." });
    } catch (err) {
      console.error("Ticket unclaim error:", err);
      return interaction.editReply({ content: "Could not unclaim the ticket." });
    }
  }
}

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("ticket:")) {
        return handleTicketSelectMenu(interaction);
      }
      if (interaction.customId.startsWith("shop_")) {
        return handleShopInteraction(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("shop_")) {
        return handleShopInteraction(interaction);
      }
      return handleTicketButton(interaction, client);
    }
  },
};
