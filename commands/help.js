
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const getLocalCommands = require('../utils/getLocalCommands');
// Cache command metadata to avoid rebuilding on every interaction
let cachedCommandsMeta = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const buildCommandsMeta = () => {
  const now = Date.now();
  if (cachedCommandsMeta && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedCommandsMeta;
  }

  const rawCommands = getLocalCommands();
  const commandsMeta = { economy: [], fun: [], misc: [], moderation: [], voice: [], prefix: [] };

  const buildUsage = (cmd) => {
    if (!cmd.options?.length) return `/${cmd.name || 'unknown'}`;
    const parts = cmd.options.map(opt => 
      opt.type <= 2 ? `<${opt.name}>` : (opt.required ? `<${opt.name}>` : `[${opt.name}]`)
    );
    return `/${cmd.name} ${parts.join(' ')}`.trim();
  };

  const categoryMap = {
    economy: ['balance','bank','daily','level','pay','shop'],
    fun: ['interaction', 'coinflip'],
    misc: ['help','ping','lb'],
    voice: ['join', 'leave']
  };

  for (const cmd of rawCommands) {
    const meta = {
      name: cmd.name || 'unknown',
      desc: cmd.description || 'No description provided',
      usage: buildUsage(cmd),
      example: cmd.examples?.[0] || `/${cmd.name || 'unknown'}`,
      perms: cmd.permissionsRequired?.join(', ') || 'None'
    };

    const category = Object.keys(categoryMap).find(cat => 
      categoryMap[cat].includes(cmd.name)
    ) || 'moderation';
    
    commandsMeta[category].push(meta);
  }

  cachedCommandsMeta = commandsMeta;
  cacheTimestamp = now;
  return commandsMeta;
};

module.exports = {
  name: "help",
  description: "Shows all available commands",
  callback: async (client, interaction) => {
    const mainEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('BOCCHI THE HELP!')
      .setDescription('Choose a category from the dropdown to view command help for that category.')
      .setImage('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTACJoUGD4HMA8mvTKKXjtiil19-yOoNt-RrwqoJq30IK58_2rRxi9jogrglmH7qLuwqg&usqp=CAU')
      .setFooter({ text: 'Bocchi the Helper, Hitori chan dev' })
      .setTimestamp();
    const select = new StringSelectMenuBuilder()
      .setCustomId('help_select')
      .setPlaceholder('Select the category you want help with')
      .addOptions([
        { label: 'Economy', description: 'Balance, bank, pay, shop, etc.', value: 'economy', emoji: '💰' },
        { label: 'Fun', description: 'Interaction commands and gifs', value: 'fun', emoji: '🎉' },
        { label: 'Misc', description: 'Ping, emoji tools and utilities', value: 'misc', emoji: '🛠️' },
        { label: 'Moderation', description: 'Ban, kick, warn and moderation tools', value: 'moderation', emoji: '🔨' },
        { label: 'Voice', description: 'Add the bot in your voice chat! (BETA)', value: 'voice', emoji: '🎤' },
      ]);

    const row = new ActionRowBuilder().addComponents(select);
    await interaction.reply({ embeds: [mainEmbed], components: [row] });

    const commandsMeta = buildCommandsMeta();
    const collector = interaction.channel.createMessageComponentCollector({ 
      filter: i => i.user.id === interaction.user.id,
      componentType: ComponentType.StringSelect, 
      time: 60000 
    });

    const categoryColors = {
      prefix: '#FFFF00',
      economy: '#00AAFF',
      fun: '#FF69B4', 
      misc: '#7FFF00',
      moderation: '#FF4500',
      voice: '#a08ede'
    };

    collector.on('collect', async (i) => {
      try {
        if (i.customId === 'help_select') {
          const category = i.values[0];
          const commands = commandsMeta[category] || [];
          
          if (!commands.length) {
            await i.update({ content: 'No commands found in this category.', embeds: [], components: [] });
            return;
          }

          const cmdOptions = commands.map(cmd => ({ 
            label: cmd.name, 
            description: cmd.desc.slice(0, 100), 
            value: `${category}:${cmd.name}` 
          }));
          cmdOptions.push({ label: 'Back to categories', description: 'Return to the category list', value: 'back' });

          const categoryEmbed = new EmbedBuilder()
            .setTitle(`${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
            .setColor(categoryColors[category])
            .setDescription('Select a command to see detailed usage and examples.');

          const cmdSelect = new StringSelectMenuBuilder()
            .setCustomId('help_cmd_select')
            .setPlaceholder('Select a command to view usage and examples')
            .addOptions(cmdOptions);

          await i.update({ embeds: [categoryEmbed], components: [new ActionRowBuilder().addComponents(cmdSelect)] });
        }
        else if (i.customId === 'help_cmd_select') {
          const value = i.values[0];
          if (value === 'back') {
            await i.update({ embeds: [mainEmbed], components: [row] });
            return;
          }

          const [category, cmdName] = value.split(':');
          const cmd = commandsMeta[category]?.find(c => c.name === cmdName);
          
          if (!cmd) {
            await i.update({ content: 'Command not found.', embeds: [], components: [] });
            return;
          }

          const cmdDetail = new EmbedBuilder()
            .setTitle(`${cmd.name} — ${cmd.desc}`)
            .setColor('#00FFFF')
            .addFields(
              { name: 'Usage', value: `\`${cmd.usage}\``, inline: false },
              { name: 'Example', value: `\`${cmd.example}\``, inline: false },
              { name: 'Required Permissions', value: cmd.perms, inline: false }
            )
            .setFooter({ text: 'Tip: Copy the usage and paste into chat to run the command' });

          const commands = commandsMeta[category] || [];
          const cmdOptions = commands.map(c => ({ label: c.name, description: c.desc.slice(0, 100), value: `${category}:${c.name}` }));
          cmdOptions.push({ label: 'Back to categories', description: 'Return to the category list', value: 'back' });
          
          const cmdSelect = new StringSelectMenuBuilder()
            .setCustomId('help_cmd_select')
            .setPlaceholder('Select a command to view usage and examples')
            .addOptions(cmdOptions);

          await i.update({ embeds: [cmdDetail], components: [new ActionRowBuilder().addComponents(cmdSelect)] });
        }
      } catch (error) {
        console.error('Help command error:', error);
        await i.reply({ content: 'An error occurred. Please try again.', ephemeral: true }).catch(() => {});
      }
    });

    collector.on('end', async () => {
      try {
        select.setDisabled(true);
        await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select)] });
      } catch (e) {
        // Ignore edit errors for expired interactions
      }
    });
  },
};
