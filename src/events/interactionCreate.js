import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import * as TicketPanel from "../models/TicketPanel.js";
import * as Ticket from "../models/Ticket.js";

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

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    if (!interaction.isButton()) return;

    const [prefix, action, id] = interaction.customId.split(":");
    if (prefix !== "ticket") return;

    if (action === "create") {
      const panel = await TicketPanel.get(id);
      if (!panel || panel.guildId !== interaction.guildId) {
        return interaction.reply({ content: "This ticket panel no longer exists.", ephemeral: true });
      }

      const existing = (await Ticket.getForUser(interaction.guildId, interaction.user.id)).find((t) => t.panelId === panel.id && t.status === "open");
      if (existing) {
        return interaction.reply({ content: `You already have an open ticket: <#${existing.channelId}>`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

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
        return interaction.reply({ content: "This ticket no longer exists.", ephemeral: true });
      }

      const panel = await TicketPanel.get(ticket.panelId);
      const isStaff = panel?.staffRoleId ? interaction.member.roles.cache.has(panel.staffRoleId) : false;
      if (ticket.userId !== interaction.user.id && !isStaff && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ content: "You cannot close this ticket.", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

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

        await Ticket.close(ticket.id);
        if (channel) await channel.delete("Ticket closed").catch(() => {});

        return interaction.editReply({ content: "Ticket closed." });
      } catch (err) {
        console.error("Ticket close error:", err);
        return interaction.editReply({ content: "Could not close the ticket." });
      }
    }
  },
};
