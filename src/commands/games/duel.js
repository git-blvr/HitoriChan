import { SlashCommandBuilder } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr } from "../../helpers/embeds.js";
import { formatCurrency, getGuildEconomyConfig } from "../../utils/economyManager.js";
import { resolveTarget } from "../../utils/resolveTarget.js";
import { startChallenge } from "../../utils/gameChallenge.js";
import { finishGame, cancelGame } from "../../utils/gameManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("duel")
    .setDescription("Challenge someone to a coin-flip duel — winner takes the pot")
    .addUserOption((o) => o.setName("user").setDescription("Opponent").setRequired(true))
    .addIntegerOption((o) => o.setName("wager").setDescription("Amount each player stakes").setMinValue(1).setRequired(true)),
  prefixName: "duel",
  aliases: ["coinflipduel"],
  syntax: "{prefix}duel @user <wager>",
  example: "{prefix}duel @friend 500",

  async execute(ctx) {
    if (!ctx.guild) return ctx.reply(embErr("This command only works in a server."));
    const { target } = await resolveTarget(ctx, { optionName: "user", argIndex: 0, fallbackToAuthor: false });
    if (!target) return ctx.reply(embErr("Mention someone to duel."));
    const opponentId = target.user?.id ?? target.id;
    const opponentName = target.user?.username ?? target.username ?? "opponent";
    const wager = Math.floor(Number(ctx.getOption("wager", 1)) || 0);
    if (wager <= 0) return ctx.reply(embErr("A duel needs a wager greater than 0."));

    await startChallenge(ctx, {
      type: "duel",
      opponentId,
      opponentName,
      wager,
      title: "⚔️ Duel challenge",
      render: async (game) => {
        const config = await getGuildEconomyConfig(game.guildId);
        const winnerId = game.data.winnerId;
        return cv2({
          color: 0x57f287,
          title: "⚔️ Duel result",
          description: `The coin flips… 🪙\n🏆 <@${winnerId}> wins **${formatCurrency(game.pot, config.primary)}**!\n-# <@${game.hostId}> vs <@${game.data.opponentId}> — ${formatCurrency(game.wager, config.primary)} each`,
        });
      },
      onAccept: async (game) => {
        const winnerId = Math.random() < 0.5 ? game.hostId : opponentId;
        game.data.winnerId = winnerId;
        await finishGame(game, [winnerId]);
      },
      onMove: async () => {},
      onTimeout: async (game) => {
        await cancelGame(game);
        game.render = async () => cv2({
          color: 0xff4d4f,
          title: "Duel expired",
          description: `<@${game.data.opponentId}> didn't answer in time — <@${game.hostId}>'s wager was refunded.`,
        });
      },
    });
  },
};
