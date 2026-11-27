import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig } from "../../utils/economyManager.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import { startChallenge } from "../../utils/gameChallenge.js";
import { customId, ephemeral, finishGame, cancelGame } from "../../utils/gameManager.js";
import { C4_COLS, C4_ROWS, c4Drop, c4Result } from "../../utils/gameLogic.js";

const TOKEN = { R: "🔴", Y: "🟡" };

function boardText(game, winCells = []) {
  const win = new Set(winCells.map(([c, r]) => `${c}:${r}`));
  let out = "";
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < C4_COLS; c++) {
      const t = game.data.board[c][r];
      out += t ? (win.has(`${c}:${r}`) ? "🟢" : TOKEN[t]) : "⚫";
    }
    out += "\n";
  }
  return out;
}

function columnRows(game) {
  const done = game.state === "done";
  const full = (c) => game.data.board[c][C4_ROWS - 1] !== null && game.data.board[c][C4_ROWS - 1] !== undefined;
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();
  for (let c = 0; c < C4_COLS; c++) {
    const btn = new ButtonBuilder()
      .setCustomId(customId(game, "drop", String(c)))
      .setLabel(String(c + 1))
      .setStyle(game.data.turn === "R" ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setDisabled(done || full(c));
    (c < 4 ? row1 : row2).addComponents(btn);
  }
  return [row1, row2];
}

async function render(game) {
  const result = c4Result(game.data.board);
  const config = await getGuildEconomyConfig(game.guildId);
  const potText = game.pot > 0 ? ` — pot: **${formatCurrency(game.pot, config.primary)}**` : "";

  if (result.winner === "draw") {
    return cv2({
      color: 0xffb224,
      title: "Connect 4 — draw",
      description: `${boardText(game)}\nBoard's full — bets returned.`,
    });
  }
  if (result.winner) {
    const winnerId = result.winner === "R" ? game.hostId : game.data.opponentId;
    return cv2({
      color: 0x57f287,
      title: "Connect 4",
      description: `${boardText(game, result.cells)}\n🏆 <@${winnerId}> (${TOKEN[result.winner]}) wins${potText}!`,
      components: columnRows(game),
    });
  }
  const turnId = game.data.turn === "R" ? game.hostId : game.data.opponentId;
  return cv2({
    color: 0x5865f2,
    title: "Connect 4",
    description: `${boardText(game)}\n<@${game.hostId}> ${TOKEN.R} vs <@${game.data.opponentId}> ${TOKEN.Y}${potText}\nTurn: <@${turnId}>`,
    components: columnRows(game),
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName("connect4")
    .setDescription("Challenge someone to Connect 4 — optionally for a wager")
    .addUserOption((o) => o.setName("user").setDescription("Opponent").setRequired(true))
    .addIntegerOption((o) => o.setName("wager").setDescription("Optional bet each player stakes").setMinValue(1)),
  prefixName: "connect4",
  aliases: ["c4", "connectfour"],
  syntax: "{prefix}connect4 @user [wager]",
  example: "{prefix}connect4 @friend 250",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const { target } = await resolveTarget(ctx, { optionName: "user", argIndex: 0, fallbackToAuthor: false });
    if (!target) return ctx.reply(embErr("Mention someone to challenge."));
    const opponentId = target.user?.id ?? target.id;
    const opponentName = target.user?.username ?? target.username ?? "opponent";
    const wager = Math.floor(Number(ctx.getOption("wager", 1)) || 0);
    if (wager < 0) return ctx.reply(embErr("The wager can't be negative."));

    await startChallenge(ctx, {
      type: "connect4",
      opponentId,
      opponentName,
      wager,
      title: "Connect 4 challenge",
      render,
      onAccept: (game) => {
        game.data.board = Array.from({ length: C4_COLS }, () => Array(C4_ROWS).fill(null));
        game.data.turn = "R";
      },
      onMove: async (interaction, action, arg, game) => {
        if (action !== "drop") return;
        const isR = interaction.user.id === game.hostId;
        const isY = interaction.user.id === game.data.opponentId;
        if (!isR && !isY) return interaction.reply(ephemeral("You're not in this game."));
        const myToken = isR ? "R" : "Y";
        if (game.data.turn !== myToken) return interaction.reply(ephemeral("It's not your turn."));
        const col = Number(arg);
        if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) {
          return interaction.reply(ephemeral("Pick a column."));
        }
        if (c4Drop(game.data.board, col, myToken) === -1) {
          return interaction.reply(ephemeral("That column is full."));
        }
        game.data.turn = myToken === "R" ? "Y" : "R";

        const result = c4Result(game.data.board);
        if (result.winner === "draw") {
          await finishGame(game, []);
        } else if (result.winner) {
          await finishGame(game, [isR ? game.hostId : game.data.opponentId]);
        }
        return interaction.update(await render(game));
      },
      onTimeout: async (game) => {
        await cancelGame(game);
        game.render = async () => cv2({
          color: 0xff4d4f,
          title: "Connect 4 ended",
          description: `${boardText(game)}\nThe game timed out — bets were refunded.`,
        });
      },
    });
  },
};
