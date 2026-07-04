import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "src", "logs", "servers");
const WITH_INVITES = process.argv.includes("--invites");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`\nLogged in as ${client.user.tag}`);
  console.log(`Found ${client.guilds.cache.size} server(s) — invites: ${WITH_INVITES ? "yes" : "no"}\n`);

  const lines = [];
  const timestamp = new Date().toISOString();

  lines.push(`Server List — ${timestamp}`);
  lines.push("─".repeat(60));

  for (const guild of client.guilds.cache.values()) {
    lines.push(`${guild.name}`);
    lines.push(`  ID:      ${guild.id}`);
    lines.push(`  Members: ${guild.memberCount}`);

    if (WITH_INVITES) {
      try {
        const channels = await guild.channels.fetch();
        const inviteChannel = channels.find(
          (c) => c?.isTextBased() && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite")
        );

        if (!inviteChannel) {
          lines.push(`  Invite:  no channel available`);
        } else {
          const invite = await inviteChannel.createInvite({ maxAge: 0, maxUses: 0, reason: "Server list script" });
          lines.push(`  Invite:  https://discord.gg/${invite.code}`);
        }
      } catch (err) {
        lines.push(`  Invite:  failed — ${err.message}`);
      }
    }

    lines.push("");
  }

  lines.push("─".repeat(60));

  const output = lines.join("\n");
  const fileName = `${timestamp.replace(/[:.]/g, "-")}.log`;
  const filePath = join(LOG_DIR, fileName);

  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(filePath, output, "utf-8");

  console.log(output);
  console.log(`\nLog saved to src/logs/servers/${fileName}`);

  client.destroy();
});

client.login(process.env.TOKEN);