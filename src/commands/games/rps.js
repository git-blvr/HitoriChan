import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig } from "../../utils/economyManager.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import { startChallenge } from "../../utils/gameChallenge.js";
import { customId, ephemeral, finishGame, cancelGame, extendDeadline } from "../../utils/gameManager.js";
import { RPS_MOVES, rpsResult } from "../../utils/gameLogic.js";

const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };

function moveRow(game, done = false) {
  return new ActionRowBuilder().addComponents(
    ...RPS_MOVES.map((m) =>
      new ButtonBuilder()
        .setCustomId(customId(game, "pick", m))
        .setLabel(m[0].toUpperCase() + m.slice(1))
        .setEmoji(EMOJI[m])
        .setStyle(ButtonStyle.Primary)
        .setDisabled(done)
    )
  );
}

async function render(game) {
  const { picks } = game.data;
  const config = await getGuildEconomyConfig(game.guildId);
  const potText = game.pot > 0 ? ` — pot: **${formatCurrency(game.pot, config.primary)}**` : "";
  const a = picks[game.hostId];
  const b = picks[game.data.opponentId];
  const done = game.state === "done";

  if (a && b) {
    const res = rpsResult(a, b);
    const line = `<@${game.hostId}> chose ${EMOJI[a]} — <@${game.data.opponentId}> chose ${EMOJI[b]}`;
    if (res === "draw") {
      return cv2({
        color: 0xffb224,
        title: "Rock Paper Scissors — draw",
        description: `${line}\nSame pick${potText} — bets returned.`,
        components: [moveRow(game, true)],
      });
    }
    const winnerId = res === "a" ? game.hostId : game.data.opponentId;
    return cv2({
      color: 0x57f287,
      title: "Rock Paper Scissors",
      description: `${line}\n🏆 <@${winnerId}> wins${potText}!`,
      components: [moveRow(game, true)],
    });
  }

  const waiting = [];
  if (!a) waiting.push(`<@${game.hostId}>`);
  if (!b) waiting.push(`<@${game.data.opponentId}>`);
  return cv2({
    color: 0x5865f2,
    title: "Rock Paper Scissors",
    description: `<@${game.hostId}> vs <@${game.data.opponentId}>${potText}\n${a ? `<@${game.hostId}> has locked in.` : ""} ${b ? `<@${game.data.opponentId}> has locked in.` : ""}\nWaiting for: ${waiting.join(", ")}`,
    components: [moveRow(game, done)],
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Rock paper scissors vs another player — optionally for a wager")
    .addUserOption((o) => o.setName("user").setDescription("Opponent").setRequired(true))
    .addIntegerOption((o) => o.setName("wager").setDescription("Optional bet each player stakes").setMinValue(1)),
  prefixName: "rps",
  aliases: ["rockpaperscissors"],
  syntax: "{prefix}rps @user [wager]",
  example: "{prefix}rps @friend 100",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const { target } = await resolveTarget(ctx, { optionName: "user", argIndex: 0, fallbackToAuthor: false });
    if (!target) return ctx.reply(embErr("Mention someone to challenge."));
    const opponentId = target.user?.id ?? target.id;
    const opponentName = target.user?.username ?? target.username ?? "opponent";
    const wager = Math.floor(Number(ctx.getOption("wager", 1)) || 0);
    if (wager < 0) return ctx.reply(embErr("The wager can't be negative."));

    await startChallenge(ctx, {
      type: "rps",
      opponentId,
      opponentName,
      wager,
      title: "Rock Paper Scissors challenge",
      render,
      onAccept: (game) => {
        game.data.picks = {};
        extendDeadline(game, 90_000);
      },
      onMove: async (interaction, action, arg, game) => {
        if (action !== "pick") return;
        const isA = interaction.user.id === game.hostId;
        const isB = interaction.user.id === game.data.opponentId;
        if (!isA && !isB) return interaction.reply(ephemeral("You're not in this game."));
        if (!RPS_MOVES.includes(arg)) return interaction.reply(ephemeral("Pick rock, paper, or scissors."));
        if (game.data.picks[interaction.user.id]) {
          return interaction.reply(ephemeral("You've already locked in."));
        }
        game.data.picks[interaction.user.id] = arg;

        const a = game.data.picks[game.hostId];
        const b = game.data.picks[game.data.opponentId];
        if (a && b) {
          const res = rpsResult(a, b);
          if (res === "draw") await finishGame(game, []);
          else await finishGame(game, [res === "a" ? game.hostId : game.data.opponentId]);
        }
        return interaction.update(await render(game));
      },
      onTimeout: async (game) => {
        await cancelGame(game);
        game.render = async () => cv2({
          color: 0xff4d4f,
          title: "Rock Paper Scissors ended",
          description: "The game timed out — bets were refunded.",
        });
      },
    });
  },
};
