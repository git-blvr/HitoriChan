import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from "discord.js";
import * as Ticket from "../../models/Ticket.js";
import * as TicketPanel from "../../models/TicketPanel.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr, embSuc } from "../../helpers/embeds.js";

function ticketButton(customId, label, color = "red") {
  const styleMap = { green: ButtonStyle.Success, red: ButtonStyle.Danger, blue: ButtonStyle.Primary, gray: ButtonStyle.Secondary };
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(styleMap[color] ?? ButtonStyle.Danger);
}

function getSubcommand(ctx) {
  if (ctx.isInteraction) return ctx.source.options.getSubcommand();
  return ctx.args[0] ?? null;
}

async function resolveTicket(ctx) {
  const ticket = await Ticket.getByChannel(ctx.channel.id);
  if (!ticket) return { ticket: null, panel: null };
  const panel = await TicketPanel.get(ticket.panelId);
  return { ticket, panel };
}

function canManageTicket(member, ticket, panel) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (ticket.userId === member.id) return true;
  if (ticket.claimerId === member.id) return true;
  if (panel?.staffRoleId && member.roles.cache.has(panel.staffRoleId)) return true;
  return false;
}

function isStaff(member, panel) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (panel?.staffRoleId && member.roles.cache.has(panel.staffRoleId)) return true;
  return false;
}

async function buildTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = [];
  for (const msg of Array.from(messages.values()).reverse()) {
    const time = new Date(msg.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
    const author = msg.author?.tag || "Unknown";
    const content = msg.content || "";
    const attachments = msg.attachments.map((a) => a.url).join(" ");
    lines.push(`[${time}] ${author}: ${content}${attachments ? ` ${attachments}` : ""}`);
  }
  const text = lines.join("\n");
  const buffer = Buffer.from(text, "utf-8");
  const fileName = `transcript-${channel.name}-${Date.now()}.txt`;
  return new AttachmentBuilder(buffer, { name: fileName });
}

async function closeTicket(ctx, ticket, panel) {
  await ctx.deferReply(true);
  const channel = ctx.client.channels.cache.get(ticket.channelId);
  const transcriptId = panel?.transcriptChannelId;

  try {
    if (transcriptId && channel) {
      const transcriptChannel = ctx.client.channels.cache.get(transcriptId);
      if (transcriptChannel?.isTextBased()) {
        const summary = cv2({
          color: 0x7c3aed,
          title: "Ticket closed",
          description: `Ticket <#${ticket.channelId}> was closed by <@${ctx.user.id}>`,
          fields: [{ name: "User", value: `<@${ticket.userId}>`, inline: true }],
        });
        await transcriptChannel.send(summary);
      }
    }

    await Ticket.close(ticket.id);
    if (channel) await channel.delete("Ticket closed").catch(() => {});
    await ctx.editReply(embSuc("Ticket closed.", true));
  } catch (err) {
    console.error("Ticket close command error:", err);
    await ctx.editReply(embErr("Could not close the ticket."));
  }
}

async function claimTicket(ctx, ticket, panel) {
  if (!isStaff(ctx.member, panel) && ticket.userId !== ctx.user.id && !ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return ctx.reply(embErr("You cannot claim this ticket."));
  }
  if (ticket.claimerId && ticket.claimerId !== ctx.user.id && !isStaff(ctx.member, panel)) {
    return ctx.reply(embErr("This ticket is already claimed."));
  }

  await ctx.deferReply(true);
  try {
    const channel = ctx.client.channels.cache.get(ticket.channelId);
    if (channel) {
      await channel.permissionOverwrites.create(ctx.user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    }

    const updated = await Ticket.claim(ticket.id, ctx.user.id);
    const row = new ActionRowBuilder().addComponents(
      ticketButton(`ticket:unclaim:${updated.id}`, "Unclaim Ticket", "gray"),
      ticketButton(`ticket:close:${updated.id}`, "Close Ticket", "red")
    );

    const welcomeMessage = await channel.messages.fetch({ limit: 10 }).then((msgs) => msgs.find((m) => m.components?.length)).catch(() => null);
    if (welcomeMessage) {
      await welcomeMessage.edit({
        content: welcomeMessage.content + `\n\n**Claimed by <@${updated.claimerId}>**`,
        components: [row],
      });
    }

    await ctx.editReply(embSuc("Ticket claimed.", true));
  } catch (err) {
    console.error("Ticket claim command error:", err);
    await ctx.editReply(embErr("Could not claim the ticket."));
  }
}

async function archiveTicket(ctx, ticket, panel) {
  if (!canManageTicket(ctx.member, ticket, panel)) {
    return ctx.reply(embErr("You cannot archive this ticket."));
  }

  await ctx.deferReply(true);
  const channel = ctx.client.channels.cache.get(ticket.channelId);

  try {
    if (!channel) throw new Error("Channel not found.");

    const attachment = await buildTranscript(channel);
    const transcriptId = panel?.transcriptChannelId;
    if (transcriptId) {
      const transcriptChannel = ctx.client.channels.cache.get(transcriptId);
      if (transcriptChannel?.isTextBased()) {
        await transcriptChannel.send({
          content: `Ticket archive for <#${ticket.channelId}> created by <@${ctx.user.id}>`,
          files: [attachment],
        });
      }
    }

    await Ticket.archive(ticket.id);
    if (channel) await channel.delete("Ticket archived").catch(() => {});
    await ctx.editReply(embSuc("Ticket archived and transcript saved.", true));
  } catch (err) {
    console.error("Ticket archive command error:", err);
    await ctx.editReply(embErr("Could not archive the ticket."));
  }
}

async function addUserToTicket(ctx, ticket, panel) {
  if (!canManageTicket(ctx.member, ticket, panel)) {
    return ctx.reply(embErr("You cannot modify this ticket."));
  }

  const { target } = await resolveTarget(ctx, {
    optionName: "user",
    argIndex: 1,
    fallbackToAuthor: false,
    allowReference: true,
    allowUserFallback: true,
  });

  if (!target) return ctx.reply(embErr("Mention a user to add."));

  let member = target;
  if (!member.guild && ctx.guild) {
    member = await ctx.guild.members.fetch(target.id).catch(() => null);
  }
  if (!member) return ctx.reply(embErr("Could not find that member in this server."));

  try {
    const channel = ctx.client.channels.cache.get(ticket.channelId);
    if (!channel) return ctx.reply(embErr("Ticket channel not found."));

    await channel.permissionOverwrites.create(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });

    await ctx.reply(embSuc(`Added <@${member.id}> to the ticket.`));
  } catch (err) {
    console.error("Ticket add error:", err);
    await ctx.reply(embErr("Could not add that user to the ticket."));
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Ticket management commands.")
    .addSubcommand((sub) => sub.setName("close").setDescription("Close this ticket."))
    .addSubcommand((sub) => sub.setName("claim").setDescription("Claim this ticket."))
    .addSubcommand((sub) => sub.setName("archive").setDescription("Archive this ticket with a transcript."))
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a user to this ticket.")
        .addUserOption((option) => option.setName("user").setDescription("The user to add").setRequired(true))
    ),
  prefixName: "ticket",
  aliases: ["tickets"],
  syntax: "{prefix}ticket <close|claim|archive|add> [@user]",
  example: "{prefix}ticket close",
  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));

    const sub = getSubcommand(ctx);
    if (!sub) return ctx.reply(embErr("Use: `close`, `claim`, `archive`, or `add @user`."));

    const { ticket, panel } = await resolveTicket(ctx);
    if (!ticket) return ctx.reply(embErr("This channel is not a ticket."));

    switch (sub.toLowerCase()) {
      case "close":
        if (!canManageTicket(ctx.member, ticket, panel)) return ctx.reply(embErr("You cannot close this ticket."));
        return closeTicket(ctx, ticket, panel);
      case "claim":
        return claimTicket(ctx, ticket, panel);
      case "archive":
        return archiveTicket(ctx, ticket, panel);
      case "add":
        return addUserToTicket(ctx, ticket, panel);
      default:
        return ctx.reply(embErr("Unknown subcommand. Use: `close`, `claim`, `archive`, or `add`."));
    }
  },
};
