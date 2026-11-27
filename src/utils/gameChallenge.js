import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../helpers/cv2.js";
import { embErr } from "../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig, validateBet } from "./economyManager.js";
import {
  createSession, bindMessage, customId, buyIn, finishGame, cancelGame,
  extendDeadline, ephemeral, editGameMessage,
} from "./gameManager.js";

export const CHALLENGE_TTL_MS = 60_000;

export function challengeButtons(game) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId(game, "accept")).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(customId(game, "decline")).setLabel("Decline").setStyle(ButtonStyle.Danger)
  );
}

// Opens a 1v1 challenge: posts Accept/Decline, escrows the challenger's buy-in.
// opts:
//   type, opponentId, opponentName, wager,
//   title(game),             → text for the challenge message
//   onAccept(game),          → init game state once opponent accepts
//   onMove(interaction, action, arg, game) → gameplay button handling
//   onTimeout(game)          → default cancels + refunds
//   render(game)             → payload rendered after accept and after each move
//   gameTtl                  → active-game deadline (default 5 min)
export async function startChallenge(ctx, opts) {
  const {
    type, opponentId, opponentName, wager = 0, gameTtl = 5 * 60 * 1000,
    title, onAccept, onMove, onTimeout, render,
  } = opts;

  if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
  if (!opponentId) return ctx.reply(embErr("Pick someone to challenge."));
  if (opponentId === ctx.user.id) return ctx.reply(embErr("You can't challenge yourself."));
  if (opponentId === ctx.client.user?.id) return ctx.reply(embErr("I can't play right now — pick a human."));

  const config = await getGuildEconomyConfig(ctx.guild.id);

  if (wager > 0) {
    const check = await validateBet(ctx.guild.id, ctx.user.id, wager);
    if (check.error) return ctx.reply(embErr(check.error));
  }

  const { game, error } = createSession({
    type,
    guildId: ctx.guild.id,
    channelId: ctx.channel.id,
    hostId: ctx.user.id,
    wager,
    ttl: CHALLENGE_TTL_MS,
    client: ctx.client,
    data: { opponentId, opponentName },
  });
  if (error) return ctx.reply(embErr(error));

  game.render = render;
  game.onMove = onMove;
  game.onTimeout = onTimeout ?? defaultTimeout;
  game.onButton = async (interaction, action, arg, g) => {
    if (action === "decline") {
      if (![g.hostId, g.data.opponentId].includes(interaction.user.id)) {
        return interaction.reply(ephemeral("Only the players can decline."));
      }
      await cancelGame(g);
      return interaction.update(cv2({
        color: 0xff4d4f,
        title: "Challenge declined",
        description: `<@${g.hostId}>'s ${type} challenge was declined.`,
      }));
    }

    if (action === "accept") {
      if (interaction.user.id !== g.data.opponentId) {
        return interaction.reply(ephemeral("This challenge isn't for you."));
      }
      try {
        await buyIn(g, interaction.user.id, interaction.user.username);
      } catch (err) {
        return interaction.reply(ephemeral(err.message));
      }
      g.state = "active";
      extendDeadline(g, gameTtl);
      await onAccept?.(g);
      return interaction.update(await g.render(g));
    }

    if (g.state !== "active") {
      return interaction.reply(ephemeral("This game hasn't started yet."));
    }
    return g.onMove(interaction, action, arg, g);
  };

  // Escrow the challenger's buy-in up front.
  try {
    await buyIn(game, ctx.user.id, ctx.user.username);
  } catch (err) {
    await cancelGame(game);
    return ctx.reply(embErr(err.message));
  }

  const wagerLine = wager > 0 ? ` for **${formatCurrency(wager, config.primary)}**` : "";
  const payload = cv2({
    color: 0xffb224,
    title: typeof title === "function" ? title(game) : title,
    description: `<@${ctx.user.id}> challenges <@${opponentId}>${wagerLine}.\n<@${opponentId}> has 60 seconds to accept.`,
    components: [challengeButtons(game)],
  });

  await ctx.reply(payload);
  const msg = await ctx.fetchReplyMessage();
  if (msg) bindMessage(game, msg.id);
  return game;
}

async function defaultTimeout(game) {
  await cancelGame(game);
  game.render = async () => cv2({
    color: 0xff4d4f,
    title: "Challenge expired",
    description: `<@${game.hostId}>'s challenge went unanswered. Any held bets were refunded.`,
  });
}

// Convenience: finish a 1v1 with a winner (or null → draw/refund).
export async function endVersus(game, winnerId) {
  if (winnerId) return finishGame(game, [winnerId]);
  return finishGame(game, []);
}
