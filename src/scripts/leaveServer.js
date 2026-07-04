import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`\nLogged in as ${client.user.tag}`);
  console.log(`Scanning ${client.guilds.cache.size} server(s) for invites...\n`);
  console.log("─".repeat(60));

  let totalDeleted = 0;
  let totalFailed = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      const botInvites = invites.filter((inv) => inv.inviterId === client.user.id);

      if (botInvites.size === 0) {
        console.log(`${guild.name} — no invites to clear`);
        continue;
      }

      let deleted = 0;
      let failed = 0;

      for (const invite of botInvites.values()) {
        try {
          await invite.delete("clearInvites script");
          deleted++;
        } catch {
          failed++;
        }
      }

      totalDeleted += deleted;
      totalFailed += failed;

      console.log(`${guild.name} — deleted ${deleted}${failed ? `, failed ${failed}` : ""}`);
    } catch (err) {
      console.log(`${guild.name} — could not fetch invites: ${err.message}`);
    }
  }

  console.log("─".repeat(60));
  console.log(`\nDone. ${totalDeleted} invite(s) deleted, ${totalFailed} failed.`);

  client.destroy();
});

client.login(process.env.TOKEN);