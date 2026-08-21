import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import * as TicketPanel from "../models/TicketPanel.js";
import * as Ticket from "../models/Ticket.js";
import { cv2 } from "../helpers/cv2.js";
import { embErr, embWrn } from "../helpers/embeds.js";
import { buildShopInterface, buildItemPreview, purchaseItem } from "../utils/shopManager.js";

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
    return interaction.update(await buildShopInterface(guildId, categoryId));
  }

  // Item select: shop_item:guildId:categoryId
  if (parts[0] === "shop_item") {
    const itemId = Number(interaction.values[0]);
    if (!itemId) {
      return interaction.update(await buildShopInterface(guildId));
    }
    try {
      const preview = await buildItemPreview(guildId, itemId, true);
      return interaction.reply(preview);
    } catch (err) {
      return interaction.reply({ content: err.message, flags: MessageFlags.Ephemeral });
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

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    if (interaction.isStringSelectMenu()) {
      return handleShopInteraction(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("shop_")) {
        return handleShopInteraction(interaction);
      }
    } else {
      return;
    }

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

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const channel = await createTicketChannel(interaction.guild, interaction.user, panel);
        const ticket = await Ticket.create({
          guildId: interaction.guildId,
          panelId: panel.id,
          channelId: channel.id,
          userId: interaction.user.id,
          status: "open",
        });

        const row = new ActionRowBuilder().addComponents(
          ticketButton(`ticket:close:${ticket.id}`, "Close Ticket", "red")
        );

        const welcome = panel.welcomeMessage?.replace(/\{user\}/g, `<@${interaction.user.id}>`) || `Ticket opened by <@${interaction.user.id}>.`;
        await channel.send({ content: welcome, components: [row] });

        return interaction.editReply({ content: `Ticket created: <#${channel.id}>` });
      } catch (err) {
        console.error("Ticket creation error:", err);
        return interaction.editReply({ content: "Could not create the ticket. Check bot permissions." });
      }
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

        // Reply before deleting the channel, otherwise the original deferred message becomes unreachable.
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
  },
};
