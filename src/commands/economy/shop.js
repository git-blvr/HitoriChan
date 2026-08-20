import { SlashCommandBuilder, PermissionsBitField } from "discord.js";
import { cv2 } from "../../helpers/cv2.js";
import { embErr, embWrn } from "../../helpers/embeds.js";
import { buildShopInterface, getShopSettings, setShopSettings } from "../../utils/shopManager.js";
import * as ShopCategory from "../../models/ShopCategory.js";

export default {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Send the server's economy shop interface")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  prefixName: "shop",
  syntax: "{prefix}shop",
  example: "{prefix}shop",
  async execute(ctx) {
    if (!ctx.guild) {
      await ctx.reply(embErr("This command only works in a server."));
      return;
    }

    if (!ctx.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      await ctx.reply(embErr("You need **Manage Server** permission to send the shop."));
      return;
    }

    const categories = await ShopCategory.getByGuild(ctx.guild.id);
    if (!categories.length) {
      await ctx.reply(embWrn("The shop has no categories yet. Set them up in the dashboard first."));
      return;
    }

    const settings = await getShopSettings(ctx.guild.id);
    const targetChannelId = settings.shopChannelId || ctx.channelId;
    const targetChannel = await ctx.guild.channels.fetch(targetChannelId).catch(() => null);
    if (!targetChannel) {
      await ctx.reply(embErr("The configured shop channel could not be found."));
      return;
    }

    const payload = await buildShopInterface(ctx.guild.id);

    try {
      if (settings.shopMessageId) {
        const existing = await targetChannel.messages.fetch(settings.shopMessageId).catch(() => null);
        if (existing) {
          await existing.edit(payload);
          await ctx.reply(cv2({
            color: 0x2ecc71,
            description: `Shop interface updated in <#${targetChannelId}>.`,
          }));
          return;
        }
      }

      const message = await targetChannel.send(payload);
      await setShopSettings(ctx.guild.id, { shopChannelId: targetChannelId, shopMessageId: message.id, shopInterfaceEnabled: true });

      await ctx.reply(cv2({
        color: 0x2ecc71,
        description: `Shop interface sent to <#${targetChannelId}>.`,
      }));
    } catch (err) {
      await ctx.reply(embErr(`Could not send the shop interface: ${err.message}`));
    }
  },
};
