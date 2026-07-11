import { EmbedBuilder } from 'discord.js';

export function createBasicEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description);
}

export function createDescBasicEmbed(desc, color) {
    return new EmbedBuilder()
    .setDescription(desc)
    .setColor(color || 0x5865f2)
}