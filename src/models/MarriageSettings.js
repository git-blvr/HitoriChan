import { db } from "../database/db.js";

const getStmt = db.prepare("SELECT * FROM marriage_settings WHERE guild_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO marriage_settings (
    guild_id, enabled, ring_item_id, contract_item_id,
    proposal_message, accept_message, married_message, divorce_message,
    married_role_id, log_channel_id, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id) DO UPDATE SET
    enabled = excluded.enabled,
    ring_item_id = excluded.ring_item_id,
    contract_item_id = excluded.contract_item_id,
    proposal_message = excluded.proposal_message,
    accept_message = excluded.accept_message,
    married_message = excluded.married_message,
    divorce_message = excluded.divorce_message,
    married_role_id = excluded.married_role_id,
    log_channel_id = excluded.log_channel_id,
    updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare("DELETE FROM marriage_settings WHERE guild_id = ?");

function fromRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    enabled: row.enabled === 1,
    ringItemId: row.ring_item_id ?? null,
    contractItemId: row.contract_item_id ?? null,
    proposalMessage: row.proposal_message,
    acceptMessage: row.accept_message,
    marriedMessage: row.married_message,
    divorceMessage: row.divorce_message,
    marriedRoleId: row.married_role_id ?? null,
    logChannelId: row.log_channel_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function get(guildId) {
  return fromRow(getStmt.get(guildId));
}

export async function getOrCreate(guildId) {
  const existing = getStmt.get(guildId);
  if (existing) return fromRow(existing);

  const now = Date.now();
  upsertStmt.run(
    guildId,
    0, null, null,
    "{user} is proposing to {target}!",
    "{target} accepted {user}'s proposal!",
    "💍 {user} and {target} are now married!",
    "{user} and {target} are no longer married.",
    null, null,
    now, now
  );
  return fromRow(getStmt.get(guildId));
}

export async function save(guildId, values) {
  const current = await getOrCreate(guildId);
  const now = Date.now();

  const toBool = (v, d) => (v !== undefined ? (v ? 1 : 0) : (d ? 1 : 0));
  const toStr = (v, d) => (v !== undefined ? (v || d) : d);
  const toNullable = (v) => (v !== undefined ? (v || null) : null);

  upsertStmt.run(
    guildId,
    toBool(values.enabled, current.enabled),
    toNullable(values.ringItemId ?? current.ringItemId),
    toNullable(values.contractItemId ?? current.contractItemId),
    toStr(values.proposalMessage, current.proposalMessage),
    toStr(values.acceptMessage, current.acceptMessage),
    toStr(values.marriedMessage, current.marriedMessage),
    toStr(values.divorceMessage, current.divorceMessage),
    toNullable(values.marriedRoleId ?? current.marriedRoleId),
    toNullable(values.logChannelId ?? current.logChannelId),
    current.createdAt ?? now,
    now
  );

  return fromRow(getStmt.get(guildId));
}

export async function remove(guildId) {
  return deleteStmt.run(guildId);
}

export default { get, getOrCreate, save, remove };
