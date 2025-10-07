const { testServer } = require('../../config.json');
const getLocalCommands = require('../../utils/getLocalCommands');
const getApplicationCommands = require('../../utils/getApplicationCommands');
const areCommandsDifferent = require('../../utils/areCommandsDiff');

module.exports = async (client) => {
  const localCommands = getLocalCommands();

  try {
    const applicationCommands = await getApplicationCommands(client);

    // Helper to format options and their choices (handles nested subcommands)
    const formatOption = (option) => {
      const formatted = {
        name: option.name,
        description: option.description || '',
        type: option.type,
        required: !!option.required,
      };

      // Map choices to the expected shape and ensure values are strings or numbers
      if (option.choices && Array.isArray(option.choices)) {
        formatted.choices = option.choices.map((choice) => ({
          name: String(choice.name),
          value: typeof choice.value === 'number' ? choice.value : String(choice.value),
        }));
      }

      // Support nested options (subcommands / subcommand groups)
      if (option.options && Array.isArray(option.options)) {
        formatted.options = option.options.map(formatOption);
      }

      return formatted;
    };

    for (const localCommand of localCommands) {
      const { name, description, options } = localCommand;

      if (!name) {
        console.log(`Skipping command without name:`, localCommand);
        continue;
      }

      const existingCommand = await applicationCommands.cache.find(
        (cmd) => cmd.name === name
      );
      if (existingCommand) {
        if (areCommandsDifferent(existingCommand, localCommand)) {
          if (localCommand.deleted) {
            await applicationCommands.delete(existingCommand.id);
            console.log(`🗑 Deleted command "${localCommand.name}".`);
            continue;
          }


          // Ensure options array is properly formatted before editing
          const formattedOptions = (localCommand.options || []).map(formatOption);

          await applicationCommands.edit(existingCommand.id, {
            description: localCommand.description,
            options: formattedOptions,
          });

          console.log(`🔁 Edited command "${localCommand.name}".`);
        } else {
            console.log(`Command "${name}" is up to date.`);
        }
      } else {

        // Ensure options array is properly formatted before creating
        const formattedOptions = (localCommand.options || []).map(formatOption);

        await applicationCommands.create({
          name: localCommand.name,
          description: localCommand.description,
          options: formattedOptions,
        });

        console.log(`👑 Registered command "${localCommand.name}".`);
      }
    }
  } catch (error) {
    console.log(`There was an error: ${error}`);
  }
};