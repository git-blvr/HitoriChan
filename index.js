const { Client, IntentsBitField } = require("discord.js");
require("dotenv").config();
const mongoose = require("mongoose");
const eventHandler = require("./handlers/eventHandler");

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.MessageContent,
  ],
});

// Optimized MongoDB connection with connection pooling
const connectDB = async () => {
  if (!process.env.MONGODB_URI || !process.env.TOKEN) {
    console.error("Missing required environment variables!");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    });
    console.log("✅ Connected to MongoDB successfully!");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await mongoose.connection.close();
  client.destroy();
  process.exit(0);
});

(async () => {
  await connectDB();
  eventHandler(client);
  await client.login(process.env.TOKEN);
})();




