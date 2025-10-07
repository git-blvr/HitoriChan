const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "say",
  category: 'moderation',
  description: "Make the bot say something (custom text or clone a message by ID)",
  examples: [
    "/say Hello everyone!",
    "/say channel:#announcements 123456789012345678"
  ],
  options: [
    {
      name: "message",
      value: "message",
      description: "The message you want the bot to say",
      required: false,
      type: ApplicationCommandOptionType.String,
    },
    {
      name: "channel",
      value: "channel",
      description: "Channel to send the message to (optional)",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    },
    {
      name: "message_id",
      value: "id",
      description: "The ID of a message to copy",
      required: false,
      type: ApplicationCommandOptionType.String,
    }
  ],
  permissionsRequired: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.SendMessages],

  callback: async (client, interaction) => {
    const textOption = interaction.options.get("message")?.value;
    const channelOption = interaction.options.get("channel");
    const messageId = interaction.options.get("message_id")?.value;

    let targetChannel = interaction.channel;
    if (channelOption && channelOption.channel) {
      targetChannel = channelOption.channel;
    }

    let finalMessage = textOption;

    // If a message ID is given, try to fetch and clone that
    if (messageId) {
      try {
        const fetchedMessage = await targetChannel.messages.fetch(messageId);
        if (!fetchedMessage) {
          return interaction.reply({ content: "❌ Could not find that message ID in this channel.", flags: [4096] });
        }

        // Clone message content (text + attachments)
        let clonedContent = fetchedMessage.content || "";
        let clonedFiles = fetchedMessage.attachments.map(att => att.url);

        await targetChannel.send({ content: clonedContent, files: clonedFiles });
        return interaction.reply({ content: `✅ Successfully cloned message ID \`${messageId}\`.`, flags: [4096] });
      } catch (error) {
        console.log(`Error cloning message: ${error}`);
        return interaction.reply({ content: "❌ Failed to fetch or send that message ID.", flags: [4096] });
      }
    }

    // Normal message option
    if (!finalMessage) {
      return interaction.reply({ content: "❌ Please provide either a message or a message ID.", flags: [4096] });
    }

    // Check permissions
    if (interaction.guild && !targetChannel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ content: "❌ I don't have permission to send messages in that channel.", flags: [4096] });
    }

    try {
      await targetChannel.send(finalMessage);
      return
    } catch (error) {
      console.log(`Error sending message: ${error}`);
      return interaction.reply({ content: "❌ Failed to send the message. Please try again.", flags: [4096] });
    }
  },
};
