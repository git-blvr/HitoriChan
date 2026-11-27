import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig, validateBet } from "../../utils/economyManager.js";
import {
  createSession, bindMessage, customId, ephemeral, buyIn, finishGame, cancelGame, extendDeadline, editGameMessage,
} from "../../utils/gameManager.js";
import { pickTriviaQuestions } from "../../utils/gameLogic.js";

const LOBBY_MS = 30_000;
const QUESTION_MS = 15_000;
const MAX_PLAYERS = 10;

function lobbyRow(game) {
  const done = game.state === "done";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId(game, "join")).setLabel("Join").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(customId(game, "start")).setLabel("Start").setStyle(ButtonStyle.Primary).setDisabled(done),
    new ButtonBuilder().setCustomId(customId(game, "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Secondary).setDisabled(done)
  );
}

async function renderLobby(game) {
  const config = await getGuildEconomyConfig(game.guildId);
  const names = [...game.players.values()].map((p) => `<@${p.id}>`).join(", ") || "—";
  const entry = game.wager > 0 ? `Entry: **${formatCurrency(game.wager, config.primary)}** · Pot: **${formatCurrency(game.pot, config.primary)}**` : "Free to play";
  return cv2({
    color: 0x5865f2,
    title: "🧠 Trivia lobby",
    description: `${entry}\nPlayers (${game.players.size}/${MAX_PLAYERS}): ${names}\n` +
      `${game.data.questions.length} questions · fastest correct answer scores · starts <t:${Math.floor(game.data.startAt / 1000)}:R>`,
    components: [lobbyRow(game)],
  });
}

function answerRow(game, q) {
  const done = game.state !== "active" || q.answeredBy;
  return [
    new ActionRowBuilder().addComponents(
      q.options.slice(0, 2).map((opt, i) =>
        new ButtonBuilder().setCustomId(customId(game, "ans", String(i))).setLabel(opt).setStyle(ButtonStyle.Primary).setDisabled(Boolean(done))
      )
    ),
    new ActionRowBuilder().addComponents(
      q.options.slice(2, 4).map((opt, i) =>
        new ButtonBuilder().setCustomId(customId(game, "ans", String(i + 2))).setLabel(opt).setStyle(ButtonStyle.Secondary).setDisabled(Boolean(done))
      )
    ),
  ];
}

async function renderQuestion(game) {
  const { questions, index, scores } = game.data;
  const q = questions[index];
  const scoreLine = [...game.players.keys()]
    .map((id) => `<@${id}> ${scores.get(id) ?? 0}`)
    .join(" · ");
  return cv2({
    color: 0x5865f2,
    title: `🧠 Question ${index + 1}/${questions.length}`,
    description: `**${q.question}**\n\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\n-# ${scoreLine || "No scores yet"}`,
    components: q.answeredBy ? [] : answerRow(game, q),
  });
}

async function renderResults(game, winnerIds) {
  const config = await getGuildEconomyConfig(game.guildId);
  const { scores } = game.data;
  const rows = [...game.players.values()]
    .map((p) => ({ p, s: scores.get(p.id) ?? 0 }))
    .sort((a, b) => b.s - a.s)
    .map(({ p, s }) => `${winnerIds.includes(p.id) ? "🏆" : "▫️"} <@${p.id}> — **${s}** pt${s === 1 ? "" : "s"}`);
  const prize = game.pot > 0 && winnerIds.length ? ` split **${formatCurrency(game.pot, config.primary)}**` : "";
  return cv2({
    color: 0x57f287,
    title: "🧠 Trivia results",
    description: `${rows.join("\n")}\n\n${winnerIds.length ? `${winnerIds.map((id) => `<@${id}>`).join(", ")} win${winnerIds.length === 1 ? "s" : ""}${prize}!` : "No winner — buy-ins refunded."}`,
  });
}

async function endTrivia(game) {
  const { scores } = game.data;
  const best = Math.max(0, ...scores.values());
  const winners = best > 0 ? [...scores.entries()].filter(([, s]) => s === best).map(([id]) => id) : [];
  if (!winners.length) {
    await cancelGame(game);
    return [];
  }
  await finishGame(game, winners);
  return winners;
}

export default {
  data: new SlashCommandBuilder()
    .setName("trivia")
    .setDescription("Host a trivia match — fastest correct answers win the pot")
    .addIntegerOption((o) => o.setName("wager").setDescription("Optional entry fee per player").setMinValue(1))
    .addIntegerOption((o) => o.setName("questions").setDescription("Number of questions (3-10)").setMinValue(3).setMaxValue(10)),
  prefixName: "trivia",
  aliases: ["quiz", "trivianight"],
  syntax: "{prefix}trivia [wager] [questions]",
  example: "{prefix}trivia 50 5",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const wager = Math.floor(Number(ctx.getOption("wager", 0)) || 0);
    const count = Math.min(10, Math.max(3, Math.floor(Number(ctx.getOption("questions", 1)) || 5)));
    if (wager < 0) return ctx.reply(embErr("The wager can't be negative."));
    if (wager > 0) {
      const check = await validateBet(ctx.guild.id, ctx.user.id, wager);
      if (check.error) return ctx.reply(embErr(check.error));
    }

    const { game, error } = createSession({
      type: "trivia",
      guildId: ctx.guild.id,
      channelId: ctx.channel.id,
      hostId: ctx.user.id,
      wager,
      ttl: LOBBY_MS,
      client: ctx.client,
      data: {
        questions: pickTriviaQuestions(count),
        index: 0,
        scores: new Map(),
        startAt: Date.now() + LOBBY_MS,
      },
    });
    if (error) return ctx.reply(embErr(error));

    try {
      await buyIn(game, ctx.user.id, ctx.user.username);
    } catch (err) {
      await cancelGame(game);
      return ctx.reply(embErr(err.message));
    }

    const startRound = async (g) => {
      const q = g.data.questions[g.data.index];
      q.answeredBy = null;
      q.answers = new Set();
      g.deadline = Date.now() + QUESTION_MS;
    };

    const advance = async (g) => {
      g.data.index += 1;
      if (g.data.index >= g.data.questions.length) {
        g.data.winners = await endTrivia(g);
        g.render = async () => renderResults(g, g.data.winners);
        return true;
      }
      await startRound(g);
      return false;
    };

    const startGame = async (g) => {
      if (g.players.size < 2) {
        return false; // handled by caller
      }
      g.state = "active";
      for (const id of g.players.keys()) g.data.scores.set(id, 0);
      await startRound(g);
      return true;
    };

    game.onButton = async (interaction, action, arg, g) => {
      if (action === "join") {
        if (g.state !== "open") return interaction.reply(ephemeral("This match already started."));
        if (g.players.has(interaction.user.id)) return interaction.reply(ephemeral("You're already in."));
        if (g.players.size >= MAX_PLAYERS) return interaction.reply(ephemeral("The lobby is full."));
        try {
          await buyIn(g, interaction.user.id, interaction.user.username);
        } catch (err) {
          return interaction.reply(ephemeral(err.message));
        }
        return interaction.update(await renderLobby(g));
      }

      if (action === "cancel") {
        if (interaction.user.id !== g.hostId) return interaction.reply(ephemeral("Only the host can cancel."));
        await cancelGame(g);
        return interaction.update(cv2({ color: 0xff4d4f, title: "🧠 Trivia cancelled", description: "All buy-ins were refunded." }));
      }

      if (action === "start") {
        if (interaction.user.id !== g.hostId) return interaction.reply(ephemeral("Only the host can start."));
        if (!(await startGame(g))) {
          return interaction.reply(ephemeral("Need at least 2 players to start."));
        }
        return interaction.update(await renderQuestion(g));
      }

      if (action === "ans") {
        if (g.state !== "active") return interaction.reply(ephemeral("No question is live."));
        if (!g.players.has(interaction.user.id)) return interaction.reply(ephemeral("You're not in this match."));
        const q = g.data.questions[g.data.index];
        if (q.answeredBy) return interaction.reply(ephemeral("That one's already answered."));
        if (q.answers.has(interaction.user.id)) return interaction.reply(ephemeral("You already guessed this one."));
        q.answers.add(interaction.user.id);

        const pick = Number(arg);
        if (pick === q.correct) {
          q.answeredBy = interaction.user.id;
          g.data.scores.set(interaction.user.id, (g.data.scores.get(interaction.user.id) ?? 0) + 1);
          const done = await advance(g);
          return interaction.update(done ? await g.render(g) : await renderQuestion(g));
        }
        return interaction.reply(ephemeral(`❌ Not it.`));
      }
    };

    game.onTimeout = async (g) => {
      if (g.state === "open") {
        // Lobby timer lapsed — auto-start if possible, else refund.
        if (g.players.size < 2) {
          await cancelGame(g);
          g.render = async () => cv2({ color: 0xff4d4f, title: "🧠 Trivia ended", description: "Not enough players joined — buy-ins refunded." });
          return;
        }
        await startGame(g);
        g.render = async () => renderQuestion(g);
        return;
      }
      if (g.state === "active") {
        // Question timed out — advance or finish.
        const done = await advance(g);
        if (!done) g.render = async () => renderQuestion(g);
      }
    };

    game.render = async () => renderLobby(game);

    const msg = await ctx.reply(await renderLobby(game));
    bindMessage(game, msg?.id ?? (await ctx.fetchReplyMessage())?.id);
    return game;
  },
};
