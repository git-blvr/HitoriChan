import { cv2 } from "../helpers/cv2.js";
import * as Reminder from "../models/Reminder.js";
import { closeDuePolls } from "./pollManager.js";

const TICK_MS = 10_000;
let timer = null;

async function deliverReminder(client, reminder) {
  Reminder.markDelivered(reminder.id);

  const payload = cv2({
    color: 0xffb224,
    title: "Reminder",
    description: `<@${reminder.userId}> ${reminder.message}`,
    footer: { text: `Set ${new Date(reminder.createdAt).toLocaleString()}` },
  });

  try {
    const channel = reminder.channelId
      ? client.channels.cache.get(reminder.channelId) ?? (await client.channels.fetch(reminder.channelId).catch(() => null))
      : null;
    if (channel?.isTextBased()) {
      await channel.send(payload);
      return;
    }
    const user = await client.users.fetch(reminder.userId).catch(() => null);
    if (user) await user.send(payload);
  } catch (err) {
    console.warn(`[reminders] delivery failed for #${reminder.id}:`, err.message);
  }
}

async function tick(client) {
  try {
    const due = Reminder.getDue();
    for (const reminder of due) {
      await deliverReminder(client, reminder);
    }
  } catch (err) {
    console.error("[reminders] tick failed:", err);
  }
  try {
    await closeDuePolls(client);
  } catch (err) {
    console.error("[polls] auto-close tick failed:", err);
  }
}

export function startReminderLoop(client) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(client), TICK_MS);
  timer.unref?.();
  tick(client);
}

export function stopReminderLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
