
const { Client, Interaction, EmbedBuilder } = require('discord.js');
const User = require('../../models/user')

const getDailyAmount = () => Math.floor(Math.random() * (2500 - 1 + 1)) + 1;

module.exports = {
  name: 'daily',
  category: 'economy',
  description: 'Collect your dailies!',
  examples: [
    "/daily"
  ],
  /**
   *
   * @param {Client} client
   * @param {Interaction} interaction
   */
  callback: async (client, interaction) => {
    if (!interaction.inGuild()) {
      interaction.reply({
        content: 'You can only run this command inside a server.',
        ephemeral: true,
      });
      return;
    }

    try {
      await interaction.deferReply();

      const query = {
        userId: interaction.member.id,
      };

      let user = await User.findOne(query);

      if (user) {
        const lastDailyDate = user.lastDaily.toDateString();
        const currentDate = new Date().toDateString();

        if (lastDailyDate === currentDate) {
          const reply = await interaction.editReply(
            'You have already collected your dailies today. Come back tomorrow!'
          );
          
          // Delete the message after 10 seconds
          setTimeout(() => {
            reply.delete().catch(() => {});
          }, 10000);
          return;
        }

        user.lastDaily = new Date();
      } else {
        user = new User({
          ...query,
          lastDaily: new Date(),
        });
      }

      const dailyAmount = getDailyAmount();
      const hasBoosterRole = !!interaction.member.premiumSince;
      
      let bonusAmount = 0;
      let totalAmount = dailyAmount;
      
      if (hasBoosterRole) {
        bonusAmount = Math.floor(dailyAmount * 3); // 300% bonus
        totalAmount = dailyAmount + bonusAmount;
      }

      user.balance += totalAmount;
      await user.save();

      const embed = new EmbedBuilder()
        .setTitle('Daily claimed successfully!')
        .setDescription(hasBoosterRole ? '🎉 Server Supporter Prize 🎉' : '💎 Daily Reward Claimed')
        .setColor('#00FF00')
        .addFields(
          {
            name: '💰 Daily Amount',
            value: `${dailyAmount} coins`,
            inline: true
          },
          {
            name: '🚀 Server Booster Bonus',
            value: hasBoosterRole 
              ? `+${bonusAmount} coins (300% bonus!)` 
              : 'Boost the server to get 300% more daily!',
            inline: true
          },
          {
            name: '💎 Total Earned',
            value: `${hasBoosterRole ? totalAmount : dailyAmount} coins`,
            inline: false
          },
          {
            name: '💳 New Balance',
            value: `${user.balance} coins`,
            inline: false
          }
        )
        .setFooter({ text: hasBoosterRole ? 'Thanks for boosting the server!' : 'Boost the server for 300% more rewards!' })
        .setTimestamp();

      const reply = await interaction.editReply({ embeds: [embed] });
      
      // Delete the message after 30 seconds
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 30000);2
    } catch (error) {
      console.log(`Error with /daily: ${error}`);
    }
  },
};
