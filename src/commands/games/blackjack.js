import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import {
  formatCurrency, getGuildEconomyConfig, getEconomyAccount, adjustBalance, validateBet,
} from "../../utils/economyManager.js";
import {
  createSession, bindMessage, customId, ephemeral, settleGame, cancelGame, extendDeadline,
} from "../../utils/gameManager.js";
import { newDeck, handValue, cardText, isBlackjack, blackjackResult } from "../../utils/gameLogic.js";

const TURN_TTL_MS = 3 * 60 * 1000;

function handLine(label, cards, hideFirst = false) {
  const value = hideFirst ? "??" : String(handValue(cards));
  return `**${label}** ${cardText(cards, hideFirst)} — ${value}`;
}

function buttons(game, { canDouble = false } = {}) {
  const done = game.state === "done";
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId(game, "hit")).setLabel("Hit").setStyle(ButtonStyle.Primary).setDisabled(done),
    new ButtonBuilder().setCustomId(customId(game, "stand")).setLabel("Stand").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(customId(game, "double")).setLabel("Double").setStyle(ButtonStyle.Secondary).setDisabled(done || !canDouble)
  );
  return [row];
}

async function render(game) {
  const { deck, player, dealer, reveal, result, doubled } = game.data;
  const config = await getGuildEconomyConfig(game.guildId);
  const stake = formatCurrency(game.wager * (doubled ? 2 : 1), config.primary);

  const table = [
    handLine("Dealer", dealer, !reveal),
    handLine("You", player),
  ].join("\n");

  if (!reveal) {
    return cv2({
      color: 0x5865f2,
      title: `🃏 Blackjack — stake ${stake}`,
      description: table,
      components: buttons(game, { canDouble: player.length === 2 }),
    });
  }

  const outcome = {
    blackjack: { color: 0x57f287, text: `Blackjack! You win **${formatCurrency(Math.floor(game.wager * 2.5 * (doubled ? 2 : 1)), config.primary)}**.` },
    player:    { color: 0x57f287, text: `You win **${formatCurrency(game.wager * 2 * (doubled ? 2 : 1), config.primary)}**.` },
    dealer:    { color: 0xff4d4f, text: `Dealer takes it. You lost **${stake}**.` },
    push:      { color: 0xffb224, text: "Push — your bet is back." },
  }[result] ?? { color: 0x5865f2, text: "" };

  return cv2({
    color: outcome.color,
    title: "🃏 Blackjack",
    description: `${table}\n${outcome.text}`,
    components: buttons(game),
  });
}

async function resolve(game, { stood = true } = {}) {
  const { player, dealer, deck } = game.data;
  game.data.reveal = true;

  if (stood && handValue(player) <= 21) {
    while (handValue(dealer) < 17) dealer.push(deck.pop());
  }

  const result = blackjackResult(player, dealer);
  game.data.result = result;

  const mult = result === "blackjack" ? 2.5 : result === "player" ? 2 : result === "push" ? 1 : 0;
  const stake = game.wager * (game.data.doubled ? 2 : 1);
  const payout = Math.floor(stake * mult);

  if (payout > 0) {
    await adjustBalance(game.guildId, game.hostId, "primary", payout);
  }
  await settleGame(game, [{
    userId: game.hostId,
    won: result === "player" || result === "blackjack",
    wagered: stake,
    wonAmount: payout,
  }]);
}

export default {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play blackjack against the dealer")
    .addIntegerOption((o) => o.setName("amount").setDescription("Your bet").setMinValue(1).setRequired(true)),
  prefixName: "blackjack",
  aliases: ["bj", "21"],
  syntax: "{prefix}blackjack <amount>",
  example: "{prefix}blackjack 200",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const amount = Math.floor(Number(ctx.getOption("amount", 0)) || 0);
    const check = await validateBet(ctx.guild.id, ctx.user.id, amount);
    if (check.error) return ctx.reply(embErr(check.error));

    const { game, error } = createSession({
      type: "blackjack",
      guildId: ctx.guild.id,
      channelId: ctx.channel.id,
      hostId: ctx.user.id,
      wager: amount,
      ttl: TURN_TTL_MS,
      client: ctx.client,
      data: {},
    });
    if (error) return ctx.reply(embErr(error));

    game.players.set(ctx.user.id, { id: ctx.user.id, name: ctx.user.username, held: 0 });
    await adjustBalance(ctx.guild.id, ctx.user.id, "primary", -amount);

    const deck = newDeck();
    const player = [deck.pop(), deck.pop()];
    const dealer = [deck.pop(), deck.pop()];
    Object.assign(game.data, { deck, player, dealer, reveal: false, result: null, doubled: false });
    game.render = render;

    if (isBlackjack(player)) {
      await resolve(game, { stood: false });
    } else {
      game.state = "active";
    }

    game.onButton = async (interaction, action, _arg, g) => {
      if (interaction.user.id !== g.hostId) {
        return interaction.reply(ephemeral("This isn't your table."));
      }
      if (g.state === "done") return interaction.reply(ephemeral("This hand is over."));
      extendDeadline(g, TURN_TTL_MS);

      if (action === "hit") {
        g.data.player.push(g.data.deck.pop());
        if (handValue(g.data.player) > 21 || handValue(g.data.player) === 21) {
          await resolve(g);
        }
        return interaction.update(await render(g));
      }
      if (action === "stand") {
        await resolve(g);
        return interaction.update(await render(g));
      }
      if (action === "double") {
        if (g.data.player.length !== 2) return interaction.reply(ephemeral("You can only double on your first move."));
        const account = await getEconomyAccount(g.guildId, g.hostId);
        if (account.primary < g.wager) return interaction.reply(ephemeral("Not enough funds to double."));
        await adjustBalance(g.guildId, g.hostId, "primary", -g.wager);
        g.data.doubled = true;
        g.data.player.push(g.data.deck.pop());
        await resolve(g);
        return interaction.update(await render(g));
      }
    };

    game.onTimeout = async (g) => {
      // Timeout = auto-stand and resolve fairly.
      await resolve(g);
      g.render = async () => {
        const config = await getGuildEconomyConfig(g.guildId);
        return cv2({
          color: 0xffb224,
          title: "🃏 Blackjack — timed out",
          description: `${handLine("Dealer", g.data.dealer)}\n${handLine("You", g.data.player)}\nTimed out — your hand stood automatically.`,
        });
      };
    };

    const msg = await ctx.reply(await render(game));
    bindMessage(game, msg?.id ?? (await ctx.fetchReplyMessage())?.id);
    return game;
  },
};
