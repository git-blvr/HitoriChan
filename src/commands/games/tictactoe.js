import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig } from "../../utils/economyManager.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import { startChallenge } from "../../utils/gameChallenge.js";
import { customId, ephemeral, finishGame, cancelGame } from "../../utils/gameManager.js";
import { tttResult } from "../../utils/gameLogic.js";

const EMPTY = "";
const MARK = { X: "✕", O: "○" };

function boardRows(game, winLine = []) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let i = r * 3; i < r * 3 + 3; i++) {
      const cell = game.data.board[i];
      const won = winLine.includes(i);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(customId(game, "move", String(i)))
          .setLabel(cell ? MARK[cell] : "·")
          .setStyle(won ? ButtonStyle.Success : cell === "X" ? ButtonStyle.Primary : cell === "O" ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(game.state === "done" || Boolean(cell))
      );
    }
    rows.push(row);
  }
  return rows;
}

async function render(game) {
  const { board, turn, names } = game.data;
  const result = tttResult(board);
  const config = await getGuildEconomyConfig(game.guildId);
  const potText = game.pot > 0 ? ` — pot: **${formatCurrency(game.pot, config.primary)}**` : "";

  if (result.winner === "draw") {
    return cv2({
      color: 0xffb224,
      title: "Tic-tac-toe — draw",
      description: `Nobody wins this one.${potText} Bets returned.`,
      components: boardRows(game, result.line),
    });
  }
  if (result.winner) {
    const winnerId = result.winner === "X" ? game.hostId : game.data.opponentId;
    return cv2({
      color: 0x57f287,
      title: "Tic-tac-toe",
      description: `🏆 <@${winnerId}> (**${MARK[result.winner]}**) wins${potText}!`,
      components: boardRows(game, result.line),
    });
  }
  const turnId = turn === "X" ? game.hostId : game.data.opponentId;
  return cv2({
    color: 0x5865f2,
    title: "Tic-tac-toe",
    description: `${names.x} (**✕**) vs ${names.o} (**○**)${potText}\nTurn: <@${turnId}> (**${MARK[turn]}**)`,
    components: boardRows(game),
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName("tictactoe")
    .setDescription("Challenge someone to tic-tac-toe — optionally for a wager")
    .addUserOption((o) => o.setName("user").setDescription("Opponent").setRequired(true))
    .addIntegerOption((o) => o.setName("wager").setDescription("Optional bet each player stakes").setMinValue(1)),
  prefixName: "tictactoe",
  aliases: ["ttt", "xo"],
  syntax: "{prefix}tictactoe @user [wager]",
  example: "{prefix}tictactoe @friend 100",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const { target } = await resolveTarget(ctx, { optionName: "user", argIndex: 0, fallbackToAuthor: false });
    if (!target) return ctx.reply(embErr("Mention someone to challenge."));
    const opponentId = target.user?.id ?? target.id;
    const opponentName = target.user?.username ?? target.username ?? "opponent";
    const wager = Math.floor(Number(ctx.getOption("wager", 1)) || 0);
    if (wager < 0) return ctx.reply(embErr("The wager can't be negative."));

    await startChallenge(ctx, {
      type: "tictactoe",
      opponentId,
      opponentName,
      wager,
      title: "Tic-tac-toe challenge",
      render,
      onAccept: (game) => {
        game.data.board = Array(9).fill(EMPTY);
        game.data.turn = "X";
        game.data.names = { x: `<@${game.hostId}>`, o: `<@${opponentId}>` };
      },
      onMove: async (interaction, action, arg, game) => {
        if (action !== "move") return;
        const { board, turn } = game.data;
        const isX = interaction.user.id === game.hostId;
        const isO = interaction.user.id === game.data.opponentId;
        if (!isX && !isO) return interaction.reply(ephemeral("You're not in this game."));
        const myMark = isX ? "X" : "O";
        if (turn !== myMark) return interaction.reply(ephemeral("It's not your turn."));
        const i = Number(arg);
        if (!Number.isInteger(i) || i < 0 || i > 8 || board[i]) {
          return interaction.reply(ephemeral("That cell is taken."));
        }
        board[i] = myMark;
        game.data.turn = myMark === "X" ? "O" : "X";

        const result = tttResult(board);
        if (result.winner === "draw") {
          await finishGame(game, []);
        } else if (result.winner) {
          await finishGame(game, [isX ? game.hostId : game.data.opponentId]);
        }
        return interaction.update(await render(game));
      },
      onTimeout: async (game) => {
        await cancelGame(game);
        game.render = async () => cv2({
          color: 0xff4d4f,
          title: "Tic-tac-toe ended",
          description: "The game timed out — bets were refunded.",
          components: boardRows(game),
        });
      },
    });
  },
};
