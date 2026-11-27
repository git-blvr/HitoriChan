import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig, validateBet } from "../../utils/economyManager.js";
import {
  createSession, bindMessage, customId, ephemeral, buyIn, finishGame, cancelGame, extendDeadline,
} from "../../utils/gameManager.js";

const LOBBY_MS = 60_000;
const DRAW_MS = 30 * 60 * 1000; // absolute cap once lobby closes

function lobbyRow(game) {
  const done = game.state === "done";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId(game, "join")).setLabel("Buy in").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(customId(game, "draw")).setLabel("Draw now").setStyle(ButtonStyle.Primary).setDisabled(done),
    new ButtonBuilder().setCustomId(customId(game, "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Secondary).setDisabled(done)
  );
}

function entrantList(game) {
  const names = [...game.players.values()].map((p) => `<@${p.id}>`);
  return names.length ? names.join(", ") : "—";
}

async function renderLobby(game) {
  const config = await getGuildEconomyConfig(game.guildId);
  return cv2({
    color: 0xffb224,
    title: "🎟️ Lottery",
    description: `Buy-in: **${formatCurrency(game.wager, config.primary)}** each.\n` +
      `Pot: **${formatCurrency(game.pot, config.primary)}** · ${game.players.size} entrant${game.players.size === 1 ? "" : "s"}\n` +
      `Entrants: ${entrantList(game)}\n` +
      `Draw happens <t:${Math.floor(game.data.drawAt / 1000)}:R> — or the host can draw early.`,
    components: [lobbyRow(game)],
  });
}

async function renderDone(game, winnerId) {
  const config = await getGuildEconomyConfig(game.guildId);
  return cv2({
    color: 0x57f287,
    title: "🎟️ Lottery — winner drawn",
    description: `🎉 <@${winnerId}> takes the whole pot: **${formatCurrency(game.pot, config.primary)}**!\n` +
      `${game.players.size} entrant${game.players.size === 1 ? "" : "s"} · <@${game.hostId}> hosted`,
  });
}

async function drawWinner(game) {
  const ids = [...game.players.keys()];
  if (!ids.length) {
    await cancelGame(game);
    return null;
  }
  const winnerId = ids[Math.floor(Math.random() * ids.length)];
  await finishGame(game, [winnerId]);
  return winnerId;
}

export default {
  data: new SlashCommandBuilder()
    .setName("lottery")
    .setDescription("Open a prize-pot lottery — everyone buys in, one winner takes all")
    .addIntegerOption((o) => o.setName("amount").setDescription("Ticket price per entrant").setMinValue(1).setRequired(true)),
  prefixName: "lottery",
  aliases: ["raffle", "jackpot"],
  syntax: "{prefix}lottery <amount>",
  example: "{prefix}lottery 100",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const amount = Math.floor(Number(ctx.getOption("amount", 0)) || 0);
    const check = await validateBet(ctx.guild.id, ctx.user.id, amount);
    if (check.error) return ctx.reply(embErr(check.error));

    const { game, error } = createSession({
      type: "lottery",
      guildId: ctx.guild.id,
      channelId: ctx.channel.id,
      hostId: ctx.user.id,
      wager: amount,
      ttl: LOBBY_MS,
      client: ctx.client,
      data: { drawAt: Date.now() + LOBBY_MS },
    });
    if (error) return ctx.reply(embErr(error));

    try {
      await buyIn(game, ctx.user.id, ctx.user.username);
    } catch (err) {
      await cancelGame(game);
      return ctx.reply(embErr(err.message));
    }

    game.onButton = async (interaction, action, _arg, g) => {
      if (action === "join") {
        if (g.players.has(interaction.user.id)) {
          return interaction.reply(ephemeral("You already have a ticket."));
        }
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
        return interaction.update(cv2({
          color: 0xff4d4f,
          title: "🎟️ Lottery cancelled",
          description: "All buy-ins were refunded.",
        }));
      }

      if (action === "draw") {
        if (interaction.user.id !== g.hostId) return interaction.reply(ephemeral("Only the host draws."));
        const winnerId = await drawWinner(g);
        return interaction.update(winnerId ? await renderDone(g, winnerId) : cv2({ color: 0xff4d4f, title: "🎟️ Lottery cancelled", description: "No entrants — refunded." }));
      }
    };

    game.onTimeout = async (g) => {
      const winnerId = await drawWinner(g);
      g.render = winnerId
        ? async () => renderDone(g, winnerId)
        : async () => cv2({ color: 0xff4d4f, title: "🎟️ Lottery ended", description: "Nobody bought in — refunds issued." });
    };

    const msg = await ctx.reply(await renderLobby(game));
    bindMessage(game, msg?.id ?? (await ctx.fetchReplyMessage())?.id);
    return game;
  },
};
