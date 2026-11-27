import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import * as Poll from "../models/Poll.js";

const ACCENT = 0x5865f2;
const MAX_OPTIONS_PER_ROW = 5;
const BAR_WIDTH = 12;

function bar(fraction) {
  const filled = Math.round(fraction * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

export function buildPollComponents(poll, { closed = poll.closed } = {}) {
  const counts = Poll.getVotes(poll.id);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const voters = Poll.getVoterCount(poll.id);

  const container = new ContainerBuilder().setAccentColor(ACCENT);

  const status = closed
    ? "Poll closed"
    : poll.endsAt
      ? `Ends <t:${Math.floor(poll.endsAt / 1000)}:R>`
      : "Open";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 📊 ${poll.question}`),
    new TextDisplayBuilder().setContent(
      `-# ${status} · ${voters} voter${voters === 1 ? "" : "s"}${poll.multi ? " · multiple choice" : ""}`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const lines = poll.options.map((opt, i) => {
    const n = counts[i] ?? 0;
    const frac = total ? n / total : 0;
    const pct = Math.round(frac * 100);
    return `**${i + 1}.** ${opt}\n\`${bar(frac)}\` **${n}** (${pct}%)`;
  });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n\n")));

  if (!closed) {
    const row = new ActionRowBuilder();
    poll.options.slice(0, MAX_OPTIONS_PER_ROW).forEach((opt, i) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll:vote:${poll.id}:${i}`)
          .setLabel(`${i + 1}`)
          .setStyle(ButtonStyle.Primary)
      );
    });
    if (poll.options.length <= MAX_OPTIONS_PER_ROW) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`poll:end:${poll.id}`).setLabel("End").setStyle(ButtonStyle.Secondary)
      );
      container.addActionRowComponents(row);
    } else {
      container.addActionRowComponents(row);
      const row2 = new ActionRowBuilder();
      poll.options.slice(MAX_OPTIONS_PER_ROW, 10).forEach((opt, j) => {
        const i = j + MAX_OPTIONS_PER_ROW;
        row2.addComponents(
          new ButtonBuilder()
            .setCustomId(`poll:vote:${poll.id}:${i}`)
            .setLabel(`${i + 1}`)
            .setStyle(ButtonStyle.Primary)
        );
      });
      row2.addComponents(
        new ButtonBuilder().setCustomId(`poll:end:${poll.id}`).setLabel("End").setStyle(ButtonStyle.Secondary)
      );
      container.addActionRowComponents(row2);
    }
  } else {
    const winnerIdx = poll.options.reduce(
      (best, _, i) => ((counts[i] ?? 0) > (counts[best] ?? 0) ? i : best),
      0
    );
    if (total > 0) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`🏆 **${poll.options[winnerIdx]}** wins with ${counts[winnerIdx] ?? 0} vote${(counts[winnerIdx] ?? 0) === 1 ? "" : "s"}.`)
      );
    }
  }

  return [container];
}

export async function refreshPollMessage(client, poll) {
  if (!poll?.messageId || !poll?.channelId) return;
  const channel = client.channels.cache.get(poll.channelId)
    ?? (await client.channels.fetch(poll.channelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(poll.messageId).catch(() => null);
  if (!message) return;
  await message.edit({
    components: buildPollComponents(poll),
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
}

export async function closePoll(client, pollId, byUserId = null) {
  const poll = Poll.get(pollId);
  if (!poll || poll.closed) return poll;
  Poll.close(pollId);
  const updated = Poll.get(pollId);
  await refreshPollMessage(client, updated);
  return updated;
}

export async function closeDuePolls(client) {
  const due = Poll.getDue();
  for (const poll of due) {
    try {
      await closePoll(client, poll.id);
    } catch (err) {
      console.error("[poll] auto-close failed:", err);
    }
  }
  return due.length;
}

export async function handlePollButton(interaction) {
  const [, action, pollIdRaw, optionRaw] = interaction.customId.split(":");
  const pollId = Number(pollIdRaw);
  const poll = Poll.get(pollId);

  if (!poll) {
    return interaction.reply({ content: "This poll no longer exists.", flags: MessageFlags.Ephemeral });
  }

  if (action === "end") {
    const canEnd =
      interaction.user.id === poll.authorId ||
      interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages);
    if (!canEnd) {
      return interaction.reply({ content: "Only the poll author or a moderator can end this poll.", flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    await closePoll(interaction.client, pollId, interaction.user.id);
    return;
  }

  if (action !== "vote") return;

  if (poll.closed) {
    return interaction.reply({ content: "This poll is closed.", flags: MessageFlags.Ephemeral });
  }
  if (poll.endsAt && Date.now() > poll.endsAt) {
    await interaction.deferUpdate();
    await closePoll(interaction.client, pollId);
    return;
  }

  const optionIndex = Number(optionRaw);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return interaction.reply({ content: "Invalid option.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const mine = Poll.getUserVotes(pollId, interaction.user.id);
  if (mine.includes(optionIndex)) {
    Poll.unvote(pollId, interaction.user.id, optionIndex);
  } else {
    if (!poll.multi) Poll.clearUserVotes(pollId, interaction.user.id);
    Poll.vote(pollId, interaction.user.id, optionIndex);
  }

  await refreshPollMessage(interaction.client, Poll.get(pollId));
}
