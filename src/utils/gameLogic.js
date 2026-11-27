// Pure game logic — no Discord objects. Everything here is unit-testable.

// ── Tic-tac-toe ──────────────────────────────────────────────────────────────

export const TTT_WINS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function tttResult(board) {
  for (const [a, b, c] of TTT_WINS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every(Boolean)) return { winner: "draw" };
  return { winner: null };
}

// ── Connect 4 ────────────────────────────────────────────────────────────────

export const C4_COLS = 7;
export const C4_ROWS = 6;

export function c4Drop(board, col, token) {
  // board[col][row], row 0 = bottom. Returns row index or -1 when column full.
  const column = board[col];
  for (let row = 0; row < C4_ROWS; row++) {
    if (!column[row]) {
      column[row] = token;
      return row;
    }
  }
  return -1;
}

export function c4Result(board) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let c = 0; c < C4_COLS; c++) {
    for (let r = 0; r < C4_ROWS; r++) {
      const t = board[c][r];
      if (!t) continue;
      for (const [dc, dr] of dirs) {
        const cEnd = c + dc * 3;
        const rEnd = r + dr * 3;
        if (cEnd < 0 || cEnd >= C4_COLS || rEnd < 0 || rEnd >= C4_ROWS) continue;
        if (board[c + dc][r + dr] === t && board[c + dc * 2][r + dr * 2] === t && board[cEnd][rEnd] === t) {
          return { winner: t, cells: [[c, r], [c + dc, r + dr], [c + dc * 2, r + dr * 2], [cEnd, rEnd]] };
        }
      }
    }
  }
  if (board.every((col) => col.every(Boolean))) return { winner: "draw" };
  return { winner: null };
}

// ── Rock paper scissors ──────────────────────────────────────────────────────

export const RPS_MOVES = ["rock", "paper", "scissors"];
const RPS_BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };

export function rpsResult(a, b) {
  if (a === b) return "draw";
  return RPS_BEATS[a] === b ? "a" : "b";
}

// ── Blackjack ────────────────────────────────────────────────────────────────

export const CARD_SUITS = ["♠", "♥", "♦", "♣"];
export const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function newDeck() {
  const deck = [];
  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === "A") { aces++; total += 11; }
    else if (["K", "Q", "J"].includes(c.rank)) total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

export function cardText(cards, hideFirst = false) {
  return cards.map((c, i) => (hideFirst && i === 0 ? "🂠" : `${c.rank}${c.suit}`)).join(" ");
}

// Resolves a finished round. Returns 'player' | 'dealer' | 'push' | 'blackjack'.
export function blackjackResult(player, dealer) {
  const pv = handValue(player);
  const dv = handValue(dealer);
  if (pv > 21) return "dealer";
  if (dv > 21) return "player";
  if (isBlackjack(player) && isBlackjack(dealer)) return "push";
  if (isBlackjack(player)) return "blackjack";
  if (isBlackjack(dealer)) return "dealer";
  if (pv > dv) return "player";
  if (dv > pv) return "dealer";
  return "push";
}

// ── Roulette ─────────────────────────────────────────────────────────────────

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_BETS = {
  red:    { label: "Red",    payout: 2, test: (n) => RED_NUMBERS.has(n) },
  black:  { label: "Black",  payout: 2, test: (n) => n !== 0 && !RED_NUMBERS.has(n) },
  odd:    { label: "Odd",    payout: 2, test: (n) => n !== 0 && n % 2 === 1 },
  even:   { label: "Even",   payout: 2, test: (n) => n !== 0 && n % 2 === 0 },
  high:   { label: "19–36",  payout: 2, test: (n) => n >= 19 },
  low:    { label: "1–18",   payout: 2, test: (n) => n >= 1 && n <= 18 },
};

export function spinRoulette() {
  return Math.floor(Math.random() * 37); // 0–36 European wheel
}

// bet: { type: 'red'|'black'|..., } or { type: 'number', number: 0-36 }
export function rouletteResult(bet, landed) {
  if (bet.type === "number") {
    return { won: landed === bet.number, payout: 36 };
  }
  const def = ROULETTE_BETS[bet.type];
  if (!def) return { won: false, payout: 0 };
  return { won: def.test(landed), payout: def.payout };
}

// ── Trivia ───────────────────────────────────────────────────────────────────

export const TRIVIA_QUESTIONS = [
  { q: "Which planet is known as the Red Planet?", a: "Mars", wrong: ["Venus", "Jupiter", "Mercury"] },
  { q: "What is the largest ocean on Earth?", a: "Pacific Ocean", wrong: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean"] },
  { q: "How many sides does a hexagon have?", a: "Six", wrong: ["Five", "Seven", "Eight"] },
  { q: "What year did the first iPhone release?", a: "2007", wrong: ["2005", "2008", "2010"] },
  { q: "Which element has the chemical symbol 'O'?", a: "Oxygen", wrong: ["Osmium", "Gold", "Oganesson"] },
  { q: "What is the capital of Japan?", a: "Tokyo", wrong: ["Kyoto", "Osaka", "Hiroshima"] },
  { q: "Which language runs natively in the browser?", a: "JavaScript", wrong: ["Python", "Java", "C++"] },
  { q: "How many minutes are in a full day?", a: "1440", wrong: ["1200", "1560", "1000"] },
  { q: "Which band performs 'Bohemian Rhapsody'?", a: "Queen", wrong: ["The Beatles", "Led Zeppelin", "Pink Floyd"] },
  { q: "What is the smallest prime number?", a: "2", wrong: ["1", "3", "0"] },
  { q: "Which animal is the fastest on land?", a: "Cheetah", wrong: ["Lion", "Greyhound", "Ostrich"] },
  { q: "In Bocchi the Rock!, what instrument does Hitori play?", a: "Guitar", wrong: ["Bass", "Drums", "Keyboard"] },
  { q: "What does 'HTTP' stand for?", a: "HyperText Transfer Protocol", wrong: ["High Throughput Transfer Process", "HyperText Translation Protocol", "Host Transfer Text Protocol"] },
  { q: "Which country invented pizza?", a: "Italy", wrong: ["France", "Greece", "Spain"] },
  { q: "How many players are on a soccer team on the field?", a: "11", wrong: ["9", "10", "12"] },
  { q: "What is the square root of 144?", a: "12", wrong: ["14", "11", "16"] },
  { q: "Which of these is NOT a programming language?", a: "Cobra Kai", wrong: ["Cobra", "Kotlin", "Dart"] },
  { q: "What color do you get mixing blue and yellow?", a: "Green", wrong: ["Purple", "Orange", "Brown"] },
  { q: "How many hearts does an octopus have?", a: "3", wrong: ["1", "2", "4"] },
  { q: "What is the currency of South Korea?", a: "Won", wrong: ["Yen", "Ringgit", "Baht"] },
];

export function pickTriviaQuestions(count, rng = Math.random) {
  const pool = [...TRIVIA_QUESTIONS];
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return picked.map(({ q, a, wrong }) => {
    const options = [...wrong.slice(0, 3), a];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { question: q, options, correct: options.indexOf(a) };
  });
}
