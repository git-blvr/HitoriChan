import { randomBytes } from "node:crypto";
import { MessageFlags } from "discord.js";
import { adjustBalance, recordGameResult, getGameConfig } from "./economyManager.js";
import * as EconomyAccount from "../models/EconomyAccount.js";

// Active game sessions. Bounded + TTL'd so a busy server can't grow RAM.
const games = new Map();
const MAX_GAMES = 250;
const SWEEP_MS = 5_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

let sweepTimer = null;
let clientRef = null;

function newId() {
  return randomBytes(5).toString("base64url");
}

function ensureSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpired, SWEEP_MS);
  sweepTimer.unref?.();
}

async function sweepExpired() {
  const now = Date.now();
  for (const game of games.values()) {
    if (game.state === "done" || now < game.deadline) continue;
    games.delete(game.id);
    try {
      await game.onTimeout?.(game);
      await editGameMessage(game).catch(() => {});
    } catch (err) {
      console.error(`[games] timeout handler failed for ${game.id}:`, err.message);
    }
  }
  if (!games.size && sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export function getSession(id) {
  return games.get(id) ?? null;
}

export function listSessions() {
  return [...games.values()];
}

export function countActive() {
  return games.size;
}

export function createSession({ type, guildId, channelId, hostId, wager = 0, data = {}, ttl = DEFAULT_SESSION_TTL_MS, client = null }) {
  if (games.size >= MAX_GAMES) {
    return { error: "Too many games running right now — try again in a moment." };
  }
  const game = {
    id: newId(),
    type,
    guildId,
    channelId,
    hostId,
    wager,
    pot: 0,
    players: new Map(), // userId -> { id, name, held: number }
    state: "open", // open | active | done
    data,
    deadline: Date.now() + ttl,
    client: client ?? clientRef,
    // Lock serializes button handling so double-clicks can't double-spend.
    _queue: Promise.resolve(),
  };
  games.set(game.id, game);
  ensureSweeper();
  return { game };
}

export function setClient(client) {
  clientRef = client;
}

export function bindMessage(game, messageId) {
  game.messageId = messageId ?? game.messageId;
}

export function extendDeadline(game, ms) {
  game.deadline = Date.now() + ms;
}

// Run fn under the session lock; user-facing errors propagate to the caller.
export function enqueue(game, fn) {
  const run = game._queue.then(fn);
  game._queue = run.catch(() => {});
  return run;
}

export function customId(game, action, arg = null) {
  return `game:${game.id}:${action}${arg == null ? "" : `:${arg}`}`;
}

// ── Wager escrow ─────────────────────────────────────────────────────────────
// Each player's buy-in is debited when they join/accept and tracked in
// player.held. Winners are paid from the pot; refunds restore held amounts.

export async function buyIn(game, userId, name) {
  if (game.players.has(userId)) return game.players.get(userId);
  if (game.wager > 0) {
    // Atomic guarded debit — concurrent clicks can't overdraw.
    const updated = await EconomyAccount.spend(game.guildId, userId, "primary", game.wager);
    if (!updated) {
      const account = await EconomyAccount.get(game.guildId, userId);
      throw new Error(`You need ${game.wager.toLocaleString()} to join — your balance is ${(account?.primary ?? 0).toLocaleString()}.`);
    }
    game.pot += game.wager;
  }
  const player = { id: userId, name: String(name || userId), held: game.wager };
  game.players.set(userId, player);
  return player;
}

export async function refundPlayers(game, userIds = null) {
  const ids = userIds ?? [...game.players.keys()];
  for (const uid of ids) {
    const p = game.players.get(uid);
    if (!p || !p.held) continue;
    try {
      await adjustBalance(game.guildId, uid, "primary", p.held);
      game.pot -= p.held;
      p.held = 0;
    } catch (err) {
      console.error(`[games] refund failed for ${uid}:`, err.message);
    }
  }
  if (game.pot < 0) game.pot = 0;
}

// winners: array of userIds (or single). Pot is split; stats recorded.
export async function finishGame(game, winners = []) {
  if (game.state === "done") return;
  game.state = "done";
  games.delete(game.id);

  const winnerIds = Array.isArray(winners) ? winners.filter(Boolean) : [winners].filter(Boolean);
  const results = [];
  const heldIds = [...game.players.keys()].filter((id) => (game.players.get(id)?.held ?? 0) > 0);

  if (winnerIds.length && game.pot > 0) {
    const share = Math.floor(game.pot / winnerIds.length);
    for (const uid of winnerIds) {
      try {
        await adjustBalance(game.guildId, uid, "primary", share);
      } catch (err) {
        console.error(`[games] payout failed for ${uid}:`, err.message);
      }
      results.push({ userId: uid, won: true, wagered: game.wager, wonAmount: share });
    }
    for (const uid of heldIds) {
      if (!winnerIds.includes(uid)) results.push({ userId: uid, won: false, wagered: game.wager, wonAmount: 0 });
    }
  } else {
    // No winners — refund everything still held.
    for (const uid of heldIds) {
      const p = game.players.get(uid);
      try {
        await adjustBalance(game.guildId, uid, "primary", p.held);
        p.held = 0;
      } catch (err) {
        console.error(`[games] refund failed for ${uid}:`, err.message);
      }
      results.push({ userId: uid, won: false, wagered: 0, wonAmount: 0 });
    }
    game.pot = 0;
  }

  await recordGameResult(game.guildId, results);
  return { pot: game.pot, winners: winnerIds };
}

export async function cancelGame(game) {
  if (game.state === "done") return;
  await refundPlayers(game);
  game.state = "done";
  games.delete(game.id);
}

// Games with custom payouts (blackjack) settle balances themselves, then call
// this to close the session and record stats.
export async function settleGame(game, results) {
  if (game.state === "done") return;
  game.state = "done";
  games.delete(game.id);
  await recordGameResult(game.guildId, results);
}

// ── Message editing ──────────────────────────────────────────────────────────

export async function editGameMessage(game) {
  if (!game.messageId || !game.channelId || !game.client) return;
  const channel = game.client.channels?.cache?.get(game.channelId)
    ?? (await game.client.channels?.fetch?.(game.channelId).catch(() => null));
  if (!channel?.messages) return;
  const message = await channel.messages.fetch(game.messageId).catch(() => null);
  if (!message) return;
  const payload = await game.render(game);
  await message.edit({ ...payload, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
}

export function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

// ── Button routing ───────────────────────────────────────────────────────────

// customId: game:<id>:<action>[:<arg>]
export async function handleGameInteraction(interaction, client) {
  clientRef = client ?? clientRef;
  const [, id, action, arg] = String(interaction.customId).split(":");
  const game = games.get(id);
  if (!game) {
    return interaction.reply(ephemeral("That game has ended."));
  }
  game.client = clientRef;

  return enqueue(game, async () => {
    try {
      await game.onButton?.(interaction, action, arg, game);
    } catch (err) {
      console.error(`[games] button ${action} on ${game.id} failed:`, err);
      const payload = ephemeral(err?.message || "Something went wrong with that move.");
      if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
      return interaction.reply(payload);
    }
  });
}

export async function checkGamblingEnabled(guildId) {
  const cfg = await getGameConfig(guildId);
  return cfg.gamblingEnabled;
}

export default {
  createSession, getSession, listSessions, countActive, bindMessage, extendDeadline, enqueue,
  customId, buyIn, refundPlayers, finishGame, cancelGame, settleGame, editGameMessage,
  ephemeral, handleGameInteraction, setClient, checkGamblingEnabled,
};
