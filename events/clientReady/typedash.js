const User = require('../../models/user');

const words = [
    "Hitori", "Ikuyo", "Ryo", "Nijika", "Starry", "Kessoku", "Guitar", "Bass", "Vocalist", "BLVR"
];

let messageCounter = 0;
let messageThreshold = getRandomThreshold();
let isRoundActive = false;

function getRandomThreshold() {
    return Math.floor(Math.random() * (100 - 10 + 1)) + 10; 
}

console.log(`${messageThreshold} left to start the game!`)

async function startRound(channel) {
    isRoundActive = true;

    const randomWord = words[Math.floor(Math.random() * words.length)];
    await channel.send(`⚡ First person to type **${randomWord}** wins a reward!`);
    console.log(`Sent word: ${randomWord}`);

    const filter = msg => msg.content.toLowerCase() === randomWord.toLowerCase() && !msg.author.bot;
    const collector = channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async msg => {
        console.log(`${msg.author.tag} typed the word!`);

        let userDoc = await User.findOne({ userId: msg.author.id, guildId: msg.guild.id });
        if (!userDoc) {
            userDoc = new User({
                userId: msg.author.id,
                guildId: msg.guild.id,
                balance: 0,
                bank: 0,
                lastDaily: new Date(),
            });
        }
                                                                                    
        const reward = Math.floor(Math.random() * (1000 - 250 + 1)) + 250;
        userDoc.balance += reward;
        await userDoc.save();
        
        if (randomWord === "BLVR") {
            msg.reply(`🎉 Congrats ${msg.author}, you earned 1 coin...\n-# just kidding, you won **${reward}**`)
        } else {
            msg.reply(`🎉 Congrats ${msg.author}, you earned **${reward}** coins!`);
        }
    });

    collector.on('end', collected => {
        if (collected.size === 0) {
            channel.send(`⌛ Time's up! No one typed the word **${randomWord}**.`);
        }

        // reset for next round
        messageCounter = 0;
        messageThreshold = getRandomThreshold();
        isRoundActive = false;

        console.log(`🔄 Next game will trigger after ${messageThreshold} messages.`);
    });
}

module.exports = async (client) => {
    console.log("✅ TypeDash minigame started!");

    const channelId = '1376280104153514164';
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
        console.log("❌ Could not fetch channel.");
        return;
    }

    client.on('messageCreate', async (msg) => {
        if (msg.channel.id !== channelId || msg.author.bot) return;

        if (isRoundActive) return;

        messageCounter++;
        if (messageCounter >= messageThreshold) {
            console.log(`🚀 Triggering game after ${messageCounter} messages.`);
            startRound(channel);
        }
    });
};
