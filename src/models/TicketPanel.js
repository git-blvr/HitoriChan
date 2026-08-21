import { db } from "../database/db.js";

const listStmt = db.prepare("SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY name");
const getStmt = db.prepare("SELECT * FROM ticket_panels WHERE id = ?");
const getByNameStmt = db.prepare("SELECT * FROM ticket_panels WHERE guild_id = ? AND name = ?");
const insertStmt = db.prepare(`
  INSERT INTO ticket_panels (
    guild_id, name, type, title, description, color, image_url, thumbnail_url,
    use_dominant_color, button_label, button_color,
    category_id, staff_role_id, transcript_channel_id, welcome_message,
    fields, components, categories
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE ticket_panels SET
    name = ?, type = ?, title = ?, description = ?, color = ?, image_url = ?, thumbnail_url = ?,
    use_dominant_color = ?, button_label = ?, button_color = ?,
    category_id = ?, staff_role_id = ?, transcript_channel_id = ?, welcome_message = ?,
    fields = ?, components = ?, categories = ?
  WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM ticket_panels WHERE id = ?");

function parseJson(json) {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    type: row.type,
    title: row.title,
    description: row.description,
    color: row.color,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    useDominantColor: Boolean(row.use_dominant_color),
    buttonLabel: row.button_label,
    buttonColor: row.button_color,
    categoryId: row.category_id,
    staffRoleId: row.staff_role_id,
    transcriptChannelId: row.transcript_channel_id,
    welcomeMessage: row.welcome_message,
    fields: parseJson(row.fields),
    components: parseJson(row.components),
    categories: parseJson(row.categories),
    createdAt: new Date(row.created_at),
  };
}

export async function getForGuild(guildId) {
  return listStmt.all(guildId).map(fromRow);
}

export async function get(id) {
  return fromRow(getStmt.get(id));
}

export async function getByName(guildId, name) {
  return fromRow(getByNameStmt.get(guildId, name));
}

export async function create(data) {
  insertStmt.run(
    data.guildId,
    data.name,
    data.type ?? "embed",
    data.title ?? null,
    data.description ?? null,
    data.color ?? null,
    data.imageUrl ?? null,
    data.thumbnailUrl ?? null,
    data.useDominantColor ? 1 : 0,
    data.buttonLabel ?? "Create Ticket",
    data.buttonColor ?? "green",
    data.categoryId ?? null,
    data.staffRoleId ?? null,
    data.transcriptChannelId ?? null,
    data.welcomeMessage ?? null,
    JSON.stringify(data.fields ?? []),
    JSON.stringify(data.components ?? []),
    JSON.stringify(data.categories ?? [])
  );
  const row = db.prepare("SELECT * FROM ticket_panels WHERE rowid = last_insert_rowid()").get();
  return fromRow(row);
}

export async function update(id, data) {
  const panel = await get(id);
  if (!panel) return null;

  updateStmt.run(
    data.name ?? panel.name,
    data.type ?? panel.type,
    data.title ?? panel.title,
    data.description ?? panel.description,
    data.color ?? panel.color,
    data.imageUrl ?? panel.imageUrl,
    data.thumbnailUrl ?? panel.thumbnailUrl,
    (data.useDominantColor !== undefined ? data.useDominantColor : panel.useDominantColor) ? 1 : 0,
    data.buttonLabel ?? panel.buttonLabel,
    data.buttonColor ?? panel.buttonColor,
    data.categoryId ?? panel.categoryId,
    data.staffRoleId ?? panel.staffRoleId,
    data.transcriptChannelId ?? panel.transcriptChannelId,
    data.welcomeMessage ?? panel.welcomeMessage,
    JSON.stringify(data.fields ?? panel.fields),
    JSON.stringify(data.components ?? panel.components),
    JSON.stringify(data.categories ?? panel.categories),
    id
  );
  return get(id);
}

export async function remove(id) {
  return deleteStmt.run(id);
}

export default { getForGuild, get, getByName, create, update, remove };
