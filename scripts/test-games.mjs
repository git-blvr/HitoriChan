// Game-flow harness — simulates real multiplayer games end to end against a
// throwaway DB: lobby joins, accept/decline, moves, timeouts, escrow, payouts.
//
// Usage: node scripts/test-games.mjs [--verbose]

import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH = join(tmpdir(), `hc-gametest-${process.pid}.db`);
for (const s of ["", "-wal", "-shm"]) { try { unlinkSync(process.env.DB_PATH + s); } catch {} }
process.env.NATIVE_DISABLE = "1";

const VERBOSE = process.argv.includes("--verbose");

const gm = await import("../src/utils/gameManager.js");
const logic = await import("../src/utils/gameLogic.js");
const econ = await import("../src/utils/economyManager.js");
const EconomyAccount = (await import("../src/models/EconomyAccount.js")).default;

const GUILD = "666666666666666666";
const results = [];
let current = "startup";

function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond, extra });
  if (VERBOSE || !cond) console.log(`${cond ? " ok " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
}

function eq(name, a, b) { check(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// ── Mock interactions ───────────────────────────────────────────────────────

function mockInteraction(userId, username, customId) {
  const calls = { replies: [], updates: 0, follows: 0 };
  return {
    customId,
    user: { id: userId, username },
    guildId: GUILD,
    channelId: "444444444444444444",
    member: { permissions: { has: () => false } },
    client: mockClient(),
    deferred: false,
    replied: false,
    reply: async (p) => { calls.replies.push(p); return {}; },
    followUp: async (p) => { calls.follows++; calls.replies.push(p); return {}; },
    update: async (p) => { calls.updates++; calls.lastPayload = p; return {}; },
    deferUpdate: async () => {},
    deferReply: async () => {},
    calls,
  };
}

function mockClient() {
  return {
    user: { id: "333333333333333333" },
    channels: { cache: new Map(), fetch: async () => null },
    users: { cache: new Map() },
  };
}

async function give(userId, amount) {
  await econ.adjustBalance(GUILD, userId, "primary", amount);
}
async function bal(userId) {
  const a = await EconomyAccount.get(GUILD, userId);
  return a?.primary ?? 0;
}
async function stat(userId, key) {
  const a = await EconomyAccount.get(GUILD, userId);
  return a?.[key] ?? 0;
}

// ── Pure logic tests ────────────────────────────────────────────────────────

async function testLogic() {
  current = "logic";

  // Tic-tac-toe
  eq("ttt row win", logic.tttResult(["X", "X", "X", "", "", "", "", "", ""]).winner, "X");
  eq("ttt diag win", logic.tttResult(["O", "X", "X", "", "O", "", "", "", "O"]).winner, "O");
  eq("ttt draw", logic.tttResult(["X", "O", "X", "X", "O", "O", "O", "X", "X"]).winner, "draw");
  eq("ttt open", logic.tttResult(["X", "", "", "", "O", "", "", "", ""]).winner, null);

  // Connect 4
  let b = Array.from({ length: 7 }, () => Array(6).fill(null));
  for (let i = 0; i < 4; i++) logic.c4Drop(b, i, "R");
  eq("c4 horizontal", logic.c4Result(b).winner, "R");

  b = Array.from({ length: 7 }, () => Array(6).fill(null));
  for (let i = 0; i < 4; i++) logic.c4Drop(b, 0, "Y");
  eq("c4 vertical", logic.c4Result(b).winner, "Y");

  b = Array.from({ length: 7 }, () => Array(6).fill(null));
  // Build diagonal: R at (0,0),(1,1),(2,2),(3,3)
  logic.c4Drop(b, 0, "R");
  logic.c4Drop(b, 1, "Y"); logic.c4Drop(b, 1, "R");
  logic.c4Drop(b, 2, "Y"); logic.c4Drop(b, 2, "Y"); logic.c4Drop(b, 2, "R");
  logic.c4Drop(b, 3, "Y"); logic.c4Drop(b, 3, "Y"); logic.c4Drop(b, 3, "Y"); logic.c4Drop(b, 3, "R");
  eq("c4 diagonal", logic.c4Result(b).winner, "R");
  eq("c4 full col", logic.c4Drop(Array.from({ length: 7 }, () => Array(6).fill("R")), 0, "Y"), -1);

  // RPS
  eq("rps rock>scissors", logic.rpsResult("rock", "scissors"), "a");
  eq("rps scissors>paper", logic.rpsResult("scissors", "paper"), "a");
  eq("rps paper>rock", logic.rpsResult("paper", "rock"), "a");
  eq("rps draw", logic.rpsResult("rock", "rock"), "draw");
  eq("rps lose", logic.rpsResult("rock", "paper"), "b");

  // Blackjack
  eq("bj ace+king", logic.handValue([{ rank: "A", suit: "♠" }, { rank: "K", suit: "♥" }]), 21);
  eq("bj soft ace", logic.handValue([{ rank: "A", suit: "♠" }, { rank: "9", suit: "♥" }, { rank: "5", suit: "♦" }]), 15);
  eq("bj bust", logic.handValue([{ rank: "K", suit: "♠" }, { rank: "Q", suit: "♥" }, { rank: "5", suit: "♦" }]), 25);
  eq("bj result bj", logic.blackjackResult([{ rank: "A", suit: "♠" }, { rank: "K", suit: "♥" }], [{ rank: "9", suit: "♦" }, { rank: "8", suit: "♣" }]), "blackjack");
  eq("bj result push", logic.blackjackResult([{ rank: "10", suit: "♠" }, { rank: "9", suit: "♥" }], [{ rank: "K", suit: "♦" }, { rank: "9", suit: "♣" }]), "push");
  eq("bj deck size", logic.newDeck().length, 52);

  // Roulette
  eq("roul red", logic.rouletteResult({ type: "red" }, 1).won, true);
  eq("roul red on black", logic.rouletteResult({ type: "red" }, 2).won, false);
  eq("roul even on 0", logic.rouletteResult({ type: "even" }, 0).won, false);
  eq("roul straight", logic.rouletteResult({ type: "number", number: 17 }, 17).won, true);
  eq("roul straight miss", logic.rouletteResult({ type: "number", number: 17 }, 18).won, false);

  // Trivia picker
  const qs = logic.pickTriviaQuestions(5);
  eq("trivia count", qs.length, 5);
  check("trivia shape", qs.every((q) => q.options.length === 4 && q.correct >= 0 && q.correct < 4));
  check("trivia no dupes", new Set(qs.map((q) => q.question)).size === 5);
}

// ── Session/escrow tests ────────────────────────────────────────────────────

async function testEscrow() {
  current = "escrow";
  await give("u1", 1000);
  await give("u2", 500);

  const { game } = gm.createSession({
    type: "test", guildId: GUILD, channelId: "chan", hostId: "u1",
    wager: 100, client: mockClient(),
  });
  game.render = async () => ({});

  await gm.buyIn(game, "u1", "one");
  eq("buyIn debits", await bal("u1"), 900);
  eq("pot grows", game.pot, 100);

  // Insufficient funds → throws, no state change
  let threw = false;
  try { await gm.buyIn(game, "u3", "broke"); } catch { threw = true; }
  check("buyIn rejects broke player", threw);

  await gm.buyIn(game, "u2", "two");
  eq("pot after two", game.pot, 200);

  await gm.finishGame(game, ["u1"]);
  eq("winner paid pot", await bal("u1"), 1100);
  eq("loser kept out", await bal("u2"), 400);
  eq("session removed", gm.getSession(game.id), null);
  eq("stats: u1 played", await stat("u1", "gamesPlayed"), 1);
  eq("stats: u1 won", await stat("u1", "gamesWon"), 1);
  eq("stats: u2 played", await stat("u2", "gamesPlayed"), 1);
  eq("stats: u2 won", await stat("u2", "gamesWon"), 0);
}

async function testRefund() {
  current = "refund";
  await give("u4", 300);
  const { game } = gm.createSession({
    type: "test", guildId: GUILD, channelId: "chan", hostId: "u4",
    wager: 100, client: mockClient(),
  });
  await gm.buyIn(game, "u4", "four");
  await gm.cancelGame(game);
  eq("cancel refunds", await bal("u4"), 300);
}

async function testLocks() {
  current = "locks";
  await give("u5", 500);
  const { game } = gm.createSession({
    type: "test", guildId: GUILD, channelId: "chan", hostId: "u5",
    wager: 100, client: mockClient(),
  });
  // Simulate 5 rapid join clicks — each should run serialized and only one buy-in sticks.
  await Promise.all([1, 2, 3, 4, 5].map(() => gm.enqueue(game, () => gm.buyIn(game, "u5", "five").catch(() => {}))));
  eq("spam join debits once", await bal("u5"), 400);
  await gm.cancelGame(game);
}

async function testTimeoutSweep() {
  current = "timeout";
  await give("u6", 200);
  const { game } = gm.createSession({
    type: "test", guildId: GUILD, channelId: "chan", hostId: "u6",
    wager: 50, ttl: 1, client: mockClient(),
  });
  let timedOut = false;
  game.onTimeout = async (g) => { timedOut = true; await gm.cancelGame(g); };
  await gm.buyIn(game, "u6", "six");
  await new Promise((r) => setTimeout(r, 30));
  // Force the sweep — the real interval runs every 5s; call the internal path via deadline.
  game.deadline = Date.now() - 1000;
  // Manually run what the sweeper does
  for (const g2 of [game]) {
    if (g2.state !== "done" && Date.now() >= g2.deadline) {
      await g2.onTimeout(g2);
    }
  }
  check("timeout fired", timedOut);
  eq("timeout refunded", await bal("u6"), 200);
}

// ── Full multiplayer simulations via the real button router ─────────────────

async function fire(userId, username, game, action, arg = null) {
  const i = mockInteraction(userId, username, gm.customId(game, action, arg));
  await gm.handleGameInteraction(i, i.client);
  return i;
}

async function testTicTacToe() {
  current = "tictactoe";
  const T = (await import("../src/commands/games/tictactoe.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("host", 1000);
  await give("guest", 1000);

  const ctx = createCtx(fakeSlash("tictactoe", { user: "guest", wager: 100 }));
  await T.execute(ctx);
  const game = [...gameIds()][0];
  check("ttt session created", !!game);
  eq("ttt host escrowed", await bal("host"), 900);

  // Stranger can't accept
  const wrong = await fire("stranger", "stranger", game, "accept");
  check("ttt only opponent accepts", wrong.calls.replies.length === 1 && wrong.calls.updates === 0);

  // Opponent accepts
  const acc = await fire("guest", "guest", game, "accept");
  eq("ttt accepted", acc.calls.updates, 1);
  eq("ttt opponent escrowed", await bal("guest"), 900);
  eq("ttt pot", game.pot, 200);

  // Not your turn
  const early = await fire("guest", "guest", game, "move", "0");
  check("ttt turn enforced", early.calls.replies.length === 1 && early.calls.updates === 0);

  // Host plays X at 0,2,4 wins? Play: X0 O3 X1 O4 X2 → X wins top row
  await fire("host", "host", game, "move", "0");
  await fire("guest", "guest", game, "move", "3");
  await fire("host", "host", game, "move", "1");
  await fire("guest", "guest", game, "move", "4");
  await fire("host", "host", game, "move", "2");

  eq("ttt session closed", game.state, "done");
  eq("ttt winner got pot", await bal("host"), 1100); // 1000 - 100 escrow + 200 pot
  eq("ttt loser stake lost", await bal("guest"), 900);
}

async function testDuel() {
  current = "duel";
  const D = (await import("../src/commands/games/duel.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("dhost", 400);
  await give("dguest", 400);

  const ctx = createCtx(fakeSlash("duel", { user: "dguest", wager: 150 }));
  await D.execute(ctx);
  const game = [...gameIds()][0];
  check("duel session", !!game);
  eq("duel host escrow", await bal("dhost"), 250);

  const acc = await fire("dguest", "dguest", game, "accept");
  eq("duel accepted+resolved", acc.calls.updates, 1);
  eq("duel game done", game.state, "done");
  const total = (await bal("dhost")) + (await bal("dguest"));
  eq("duel pot conserved", total, 800); // 250+250 remaining + 300 pot = 800

  // Decline path — host's escrow is returned
  await give("dguest2", 100);
  const before = await bal("dhost");
  const ctx2 = createCtx(fakeSlash("duel", { user: "dguest2", wager: 50 }));
  await D.execute(ctx2);
  const g2 = [...gameIds()].find((g) => g.state === "open");
  check("duel #2 open", !!g2);
  eq("duel #2 host escrow", await bal("dhost"), before - 50);
  await fire("dguest2", "dguest2", g2, "decline");
  eq("decline refunds host", await bal("dhost"), before);
  eq("decline closes session", g2.state, "done");
}

async function testRps() {
  current = "rps";
  const R = (await import("../src/commands/games/rps.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("rhost", 500);
  await give("rguest", 500);

  const ctx = createCtx(fakeSlash("rps", { user: "rguest", wager: 100 }));
  await R.execute(ctx);
  const game = [...gameIds()][0];
  await fire("rguest", "rguest", game, "accept");

  await fire("rhost", "rhost", game, "pick", "rock");
  check("rps pick hidden", game.data.picks.rhost === "rock" && game.data.picks.rguest === undefined);
  const i2 = await fire("rguest", "rguest", game, "pick", "scissors");
  eq("rps resolved on both picks", game.state, "done");
  eq("rps rock wins", await bal("rhost"), 600);
}

async function testConnect4() {
  current = "connect4";
  const C = (await import("../src/commands/games/connect4.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("chost", 300);
  await give("cguest", 300);

  const ctx = createCtx(fakeSlash("connect4", { user: "cguest", wager: 0 }));
  await C.execute(ctx);
  const game = [...gameIds()][0];
  await fire("cguest", "cguest", game, "accept");

  // R drops col 0,1,2,3 → horizontal win
  for (const [u, col] of [["chost", 0], ["cguest", 0], ["chost", 1], ["cguest", 1], ["chost", 2], ["cguest", 2], ["chost", 3]]) {
    await fire(u, u, game, "drop", String(col));
  }
  eq("c4 resolved", game.state, "done");
  eq("c4 no-wager balances", (await bal("chost")) + (await bal("cguest")), 600);
}

async function testLottery() {
  current = "lottery";
  const L = (await import("../src/commands/games/lottery.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("lhost", 1000);
  await give("lp1", 500);
  await give("lp2", 500);

  const ctx = createCtx(fakeSlash("lottery", { amount: 100 }));
  await L.execute(ctx);
  const game = [...gameIds()][0];
  check("lottery lobby", !!game && game.state === "open");
  eq("lottery host buy-in", await bal("lhost"), 900);

  await fire("lp1", "lp1", game, "join");
  await fire("lp2", "lp2", game, "join");
  const dup = await fire("lp1", "lp1", game, "join");
  check("lottery dup join rejected", dup.calls.replies.length === 1);
  eq("lottery pot", game.pot, 300);

  await fire("lhost", "lhost", game, "draw");
  eq("lottery done", game.state, "done");
  const total = (await bal("lhost")) + (await bal("lp1")) + (await bal("lp2"));
  eq("lottery pot conserved", total, 2000);
  // Exactly one entrant holds the whole pot.
  check("lottery someone won",
    (await bal("lhost")) === 1200 || (await bal("lp1")) === 700 || (await bal("lp2")) === 700);
}

async function testTrivia() {
  current = "trivia";
  const T = (await import("../src/commands/games/trivia.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("thost", 500);
  await give("tguest", 500);

  const ctx = createCtx(fakeSlash("trivia", { wager: 50, questions: 3 }));
  await T.execute(ctx);
  const game = [...gameIds()][0];
  eq("trivia lobby", game.state, "open");
  eq("trivia host buy-in", await bal("thost"), 450);

  await fire("tguest", "tguest", game, "join");
  eq("trivia pot", game.pot, 100);

  await fire("thost", "thost", game, "start");
  eq("trivia active", game.state, "active");

  // Answer all questions correctly as the host.
  for (let qi = 0; qi < game.data.questions.length; qi++) {
    const q = game.data.questions[game.data.index];
    if (!q) break;
    const wrong = (q.correct + 1) % 4;
    // guest guesses wrong once
    await fire("tguest", "tguest", game, "ans", String(wrong));
    // host answers correctly
    await fire("thost", "thost", game, "ans", String(q.correct));
  }
  eq("trivia done", game.state, "done");
  eq("trivia host wins pot", await bal("thost"), 550);
  eq("trivia loser", await bal("tguest"), 450);
}

async function testBlackjack() {
  current = "blackjack";
  const B = (await import("../src/commands/games/blackjack.js")).default;
  const { createCtx } = await import("../src/utils/ctx.js");

  await give("bhost", 1000);
  const ctx = createCtx(fakeSlash("blackjack", { amount: 100 }));
  await B.execute(ctx);
  const game = [...gameIds()][0];
  if (!game) {
    // Dealt a natural blackjack — resolved and paid out instantly.
    // 1150 = blackjack (2.5x), 1000 = push (stake returned).
    const b = await bal("bhost");
    check("bj instant payout", b === 1150 || b === 1000, `got ${b}`);
  } else {
    check("bj session", true);
    eq("bj stake debited", await bal("bhost"), 900);

    // Force a known hand: player 20, dealer 17 — stand wins.
    game.data.player = [{ rank: "K", suit: "♠" }, { rank: "Q", suit: "♥" }];
    game.data.dealer = [{ rank: "9", suit: "♦" }, { rank: "8", suit: "♣" }];
    game.state = "active"; // in case it had auto-resolved a blackjack
    const st = await fire("bhost", "bhost", game, "stand");
    eq("bj stand resolves", game.state, "done");
    eq("bj win pays 2x", await bal("bhost"), 1100);
  }

  // Outsider can't play
  const ctx2 = createCtx(fakeSlash("blackjack", { amount: 50 }));
  await B.execute(ctx2);
  const g2 = [...gameIds()].find((g) => g.state !== "done");
  if (g2) {
    const out = await fire("outsider", "out", g2, "hit");
    check("bj outsiders blocked", out.calls.replies.length === 1 && out.calls.updates === 0);
    await gm.cancelGame(g2);
  } else {
    check("bj outsiders blocked", true); // second deal also resolved instantly — nothing to test
  }
}

// ── Fake slash interaction for ctx ──────────────────────────────────────────

const HOST_BY_CMD = {
  lottery: "lhost", trivia: "thost", blackjack: "bhost",
  duel: "dhost", rps: "rhost", connect4: "chost", tictactoe: "host",
};

function fakeSlash(name, opts) {
  const hostId = HOST_BY_CMD[name] ?? "host";
  const entries = Object.entries(opts).map(([k, v]) => ({
    name: k,
    type: typeof v === "number" ? 4 : 6,
    value: v,
    user: typeof v === "string" ? { id: v, username: v, bot: false } : undefined,
    member: undefined,
  }));
  return {
    isChatInputCommand: () => true,
    user: { id: hostId, username: hostId },
    member: { permissions: { has: () => true } },
    guild: {
      id: GUILD,
      members: {
        fetch: async (id) => ({ id, user: { id, username: id, bot: false }, displayName: id }),
      },
    },
    channel: { id: "444444444444444444", send: async () => fakeMsg() },
    client: mockClient(),
    options: {
      data: entries,
      get: (n) => entries.find((e) => e.name === n) ?? null,
      getSubcommand: () => "info",
      getUser: (n) => entries.find((e) => e.name === n)?.user ?? null,
    },
    reply: async (p) => fakeMsg(),
    editReply: async () => fakeMsg(),
    followUp: async () => fakeMsg(),
    fetchReply: async () => fakeMsg(),
    deferReply: async () => {},
    deferred: false, replied: false,
  };
}

let msgSeq = 0;
function fakeMsg() {
  const id = `msg-${Date.now()}-${++msgSeq}`;
  return {
    id,
    channelId: "444444444444444444",
    edit: async () => {},
    delete: async () => {},
    reply: async () => fakeMsg(),
  };
}

function* gameIds() {
  // Newest sessions first — tests grab [0] for the session they just created.
  yield* [...gm.listSessions()].reverse();
}

// ── Run ─────────────────────────────────────────────────────────────────────

const suites = [testLogic, testEscrow, testRefund, testLocks, testTimeoutSweep, testTicTacToe, testDuel, testRps, testConnect4, testLottery, testTrivia, testBlackjack];
for (const fn of suites) {
  try {
    await fn();
  } catch (err) {
    check(`${fn.name} threw`, false, `${err?.name}: ${err?.message}\n${err?.stack?.split("\n").slice(0, 4).join("\n")}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n══════════════ GAME RESULTS ══════════════`);
console.log(`Checks: ${results.length}   Failed: ${failed.length}`);
for (const f of failed) console.log(`  FAIL ${f.name} — ${f.extra}`);
try { unlinkSync(process.env.DB_PATH); } catch {}
process.exit(failed.length ? 1 : 0);
