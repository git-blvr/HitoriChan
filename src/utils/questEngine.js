import * as Quest from "../models/Quest.js";
import * as QuestProgress from "../models/QuestProgress.js";
import * as EconomyAccount from "../models/EconomyAccount.js";
import { getGuildEconomyConfig } from "./economyManager.js";

// =========================================================
// DSL tokenizer / parser
// =========================================================

const OPERATORS = new Set([">=", "<=", "!=", "=", "<", ">", "==", "INCLUDE", "STARTS_WITH", "ENDS_WITH"]);
const BOOLEANS = new Set(["true", "false"]);
const KEYWORDS = new Set(["IF", "EXECUTE", "TASK"]);

function tokenize(input) {
  const tokens = [];
  const re = /\s*("(?:\\"|[^"])*"|'(?:\\'|[^'])*'|>=|<=|!=|==|=|<|>|&|\||!|\(|\)|,|\.|\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|\S)\s*/g;
  let m;
  while ((m = re.exec(input))) {
    const token = m[1];
    if (token === undefined) break;
    tokens.push(token);
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  consume(expected) {
    const t = this.next();
    if (t !== expected) throw new Error(`Expected ${expected}, got ${t}`);
    return t;
  }

  parseStatement() {
    const first = this.peek();
    if (first === "IF") {
      this.next();
      const condition = this.parseCondition();
      if (this.peek() === ",") this.next();
      this.consume("EXECUTE");
      this.consume("TASK");
      const taskName = this.next();
      return { type: "if", condition, taskName };
    }
    if (first === "EXECUTE") {
      this.next();
      this.consume("TASK");
      return { type: "execute", taskName: this.next() };
    }
    throw new Error(`Unexpected statement: ${first}`);
  }

  parseCondition() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek() === "|" || this.peek() === "OR") {
      this.next();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.peek() === "&" || this.peek() === "AND") {
      this.next();
      const right = this.parseNot();
      left = { type: "and", left, right };
    }
    return left;
  }

  parseNot() {
    if (this.peek() === "!" || this.peek() === "NOT") {
      this.next();
      return { type: "not", expr: this.parseNot() };
    }
    return this.parseAtom();
  }

  parseAtom() {
    const t = this.peek();
    if (t === "(") {
      this.next();
      const expr = this.parseCondition();
      this.consume(")");
      return expr;
    }

    // Variable
    if (t?.startsWith("$")) {
      return { type: "variable", name: this.next().slice(1) };
    }

    // Literal string
    if (t?.startsWith('"') || t?.startsWith("'")) {
      return { type: "literal", value: this.next().slice(1, -1) };
    }

    // Number
    if (t && /^\d/.test(t)) {
      return { type: "literal", value: Number(this.next()) };
    }

    // Boolean
    if (BOOLEANS.has(t)) {
      return { type: "literal", value: this.next() === "true" };
    }

    // Entity expression: entity (.field)? (operator value | method value)?
    if (t && /^[A-Za-z_]/.test(t)) {
      const entity = this.next();
      if (this.peek() === ".") {
        this.next();
        const field = this.next();

        // Operator + value
        if (OPERATORS.has(this.peek())) {
          const op = this.next();
          const value = this.parseAtom();
          return { type: "compare", entity, field, op, value };
        }

        // Method call with one argument (value)
        const next = this.peek();
        if (next && (next.startsWith('"') || next.startsWith("'") || /^\d/.test(next) || BOOLEANS.has(next) || next.startsWith("$") || /^[A-Za-z_]/.test(next))) {
          let arg = this.parseAtom();
          // For method names that look like identifiers but are actually operators reserved for string comparison, handle
          if (arg.type === "compare" && arg.entity === field && !arg.field) {
            // e.g. user.has_role "x" parsed weird? Not with current grammar.
          }
          return { type: "method", entity, field, arg };
        }

        return { type: "field", entity, field };
      }

      // Bare entity reference
      return { type: "entity", entity };
    }

    throw new Error(`Unexpected token: ${t}`);
  }
}

// =========================================================
// Evaluation helpers
// =========================================================

function resolveValue(node, context, quest) {
  if (node.type === "literal") return node.value;
  if (node.type === "variable") return quest.variables[node.name] ?? null;
  if (node.type === "entity") return null;
  if (node.type === "field") return getEntityField(node.entity, node.field, context);
  if (node.type === "compare") {
    const left = getEntityField(node.entity, node.field, context);
    const right = resolveValue(node.value, context, quest);
    return compareValues(left, node.op, right);
  }
  if (node.type === "method") {
    return callMethod(node.entity, node.field, resolveValue(node.arg, context, quest), context);
  }
  return null;
}

function evaluateCondition(node, context, quest) {
  if (node.type === "and") return evaluateCondition(node.left, context, quest) && evaluateCondition(node.right, context, quest);
  if (node.type === "or") return evaluateCondition(node.left, context, quest) || evaluateCondition(node.right, context, quest);
  if (node.type === "not") return !evaluateCondition(node.expr, context, quest);
  if (node.type === "compare" || node.type === "method" || node.type === "field") {
    return Boolean(resolveValue(node, context, quest));
  }
  if (node.type === "literal") return Boolean(node.value);
  return false;
}

function compareValues(left, op, right) {
  if (op === "=" || op === "==") return left == right;
  if (op === "!=") return left != right;
  if (op === "INCLUDE") return String(left).toLowerCase().includes(String(right).toLowerCase());
  if (op === "STARTS_WITH") return String(left).toLowerCase().startsWith(String(right).toLowerCase());
  if (op === "ENDS_WITH") return String(left).toLowerCase().endsWith(String(right).toLowerCase());
  const a = Number(left) || 0;
  const b = Number(right) || 0;
  if (op === ">") return a > b;
  if (op === "<") return a < b;
  if (op === ">=") return a >= b;
  if (op === "<=") return a <= b;
  return false;
}

function getMember(member) {
  if (!member) return null;
  if (member.user) return member;
  return { user: member };
}

function getEntityField(entity, field, context) {
  const progress = context.progress;
  const counters = progress?.counters || {};

  if (entity === "message") {
    const msg = context.message;
    if (!msg) return null;
    if (field === "content") return msg.content ?? "";
    if (field === "channel") return msg.channelId ?? msg.channel?.id ?? null;
    if (field === "author") return msg.author?.id ?? null;
    if (field === "guild") return msg.guildId ?? msg.guild?.id ?? null;
    if (field === "attachments") return msg.attachments?.size ?? 0;
    return null;
  }

  if (entity === "messages") {
    if (field === "sent") return counters.messagesSent || 0;
    if (field === "in_channel") return counters.messagesInChannel?.[context.channelId] || 0;
    if (field === "with_content") return counters.messagesWithContent?.[context.keyword] || 0;
    return null;
  }

  if (entity === "user") {
    const member = getMember(context.member || context.user || context.message?.member);
    if (!member) return null;
    if (field === "id") return member.id;
    if (field === "username") return member.user?.username ?? member.username;
    if (field === "display_name") return member.displayName ?? member.user?.username;
    if (field === "is_bot") return member.user?.bot ?? false;
    if (field === "boosted") return Boolean(member.premiumSince);
    return null;
  }

  if (entity === "voice") {
    if (field === "minutes") return Math.floor((counters.voiceSeconds || 0) / 60);
    if (field === "joined") return counters.voiceJoined || 0;
    return null;
  }

  if (entity === "invites") {
    if (field === "count") return counters.invites || 0;
    return null;
  }

  if (entity === "commands") {
    if (field === "count") return counters.commandsUsed || 0;
    if (field === "used") return counters.commandsUsedList?.[context.commandName] || 0;
    return null;
  }

  if (entity === "reactions") {
    if (field === "count") return counters.reactionsAdded || 0;
    return null;
  }

  if (entity === "economy") {
    if (field === "primary") return context.economy?.primary || 0;
    if (field === "secondary") return context.economy?.secondary || 0;
    return null;
  }

  if (entity === "channel") {
    if (field === "message") return context.message?.content ?? "";
    if (field === "id") return context.channelId || null;
    if (field === "name") {
      const channel = context.message?.channel || context.client?.channels?.cache?.get(context.channelId);
      return channel?.name ?? context.channelId;
    }
    return context.channelId || null;
  }

  if (entity === "guild") {
    return context.guildId || null;
  }

  if (entity === "progress") {
    return counters[field] || 0;
  }

  return null;
}

function callMethod(entity, method, arg, context) {
  const member = getMember(context.member || context.user || context.message?.member);
  const progress = context.progress;
  const counters = progress?.counters || {};

  if (entity === "user") {
    if (!member) return false;
    if (method === "has_role") return member.roles?.cache?.has?.(arg) ?? false;
    if (method === "has_any_role") {
      const ids = Array.isArray(arg) ? arg : String(arg).split(/[,\s]+/).filter(Boolean);
      return ids.some((id) => member.roles?.cache?.has?.(id));
    }
    if (method === "in_channel") return context.channelId === arg;
    if (method === "sent_messages") return (counters.messagesSent || 0) >= Number(arg);
    return false;
  }

  if (entity === "message") {
    const msg = context.message;
    if (!msg) return false;
    if (method === "content_include") return String(msg.content ?? "").toLowerCase().includes(String(arg).toLowerCase());
    if (method === "content_starts_with") return String(msg.content ?? "").toLowerCase().startsWith(String(arg).toLowerCase());
    if (method === "content_ends_with") return String(msg.content ?? "").toLowerCase().endsWith(String(arg).toLowerCase());
    if (method === "in_channel") return (msg.channelId || msg.channel?.id) === arg;
    return false;
  }

  if (entity === "messages") {
    if (method === "in_channel") return (counters.messagesInChannel?.[arg] || 0) >= 1;
    if (method === "with_content") return (counters.messagesWithContent?.[arg] || 0) >= 1;
    if (method === "sent") return (counters.messagesSent || 0) >= Number(arg);
    return false;
  }

  if (entity === "voice") {
    if (method === "minutes_at_least") return Math.floor((counters.voiceSeconds || 0) / 60) >= Number(arg);
    return false;
  }

  if (entity === "invites") {
    if (method === "at_least") return (counters.invites || 0) >= Number(arg);
    return false;
  }

  if (entity === "commands") {
    if (method === "used") return (counters.commandsUsedList?.[arg] || 0) >= 1;
    if (method === "used_at_least") {
      const parts = String(arg).split(/[,\s]+/);
      return (counters.commandsUsedList?.[parts[0]] || 0) >= Number(parts[1] || 1);
    }
    return false;
  }

  return false;
}

// =========================================================
// Counter / progress helpers
// =========================================================

async function getProgress(questId, userId) {
  return QuestProgress.getOrCreate(questId, userId);
}

async function saveProgress(progress) {
  await QuestProgress.save(progress);
}

export async function incrementCounter(guildId, userId, key, amount = 1, extra = {}) {
  const quests = await Quest.getEnabledForGuild(guildId);
  if (!quests.length) return;

  for (const quest of quests) {
    const progress = await getProgress(quest.id, userId);
    if (!progress) continue;
    if (progress.status !== "in_progress") continue;

    if (!progress.counters) progress.counters = {};
    progress.counters[key] = (progress.counters[key] || 0) + amount;

    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "object") {
        progress.counters[k] = progress.counters[k] || {};
        for (const [kk, vv] of Object.entries(v)) {
          progress.counters[k][kk] = (progress.counters[k][kk] || 0) + vv;
        }
      } else {
        progress.counters[k] = (progress.counters[k] || 0) + v;
      }
    }

    progress.updatedAt = Date.now();
    await saveProgress(progress);
  }
}

// =========================================================
// Quest runner
// =========================================================

async function resetProgressIfNeeded(quest, progress) {
  const now = Date.now();
  const last = progress.lastResetAt || 0;
  let shouldReset = false;

  if (quest.schedule === "daily") {
    const lastDate = new Date(last).toDateString();
    const nowDate = new Date(now).toDateString();
    shouldReset = lastDate !== nowDate;
  } else if (quest.schedule === "weekly") {
    const lastWeek = new Date(last).toISOString().slice(0, 6); // YYYY-W
    const nowWeek = new Date(now).toISOString().slice(0, 6);
    shouldReset = lastWeek !== nowWeek;
  }

  if (shouldReset) {
    progress.counters = {};
    progress.status = "in_progress";
    progress.completedAt = null;
    progress.claimedAt = null;
    progress.lastResetAt = now;
    progress.updatedAt = now;
    await saveProgress(progress);
  }
}

async function ensureEconomy(context, client) {
  if (context.economy) return;
  if (!context.guildId || !context.userId || !client) {
    context.economy = { primary: 0, secondary: 0 };
    return;
  }
  try {
    const account = await EconomyAccount.getOrCreate(context.guildId, context.userId);
    const config = await getGuildEconomyConfig(context.guildId);
    context.economy = { primary: account.primary, secondary: account.secondary, config };
  } catch {
    context.economy = { primary: 0, secondary: 0 };
  }
}

async function runQuest(quest, context, client) {
  if (!quest.enabled || !quest.dsl) return;

  const userId = context.userId;
  if (!userId) return;

  const progress = await getProgress(quest.id, userId);
  await resetProgressIfNeeded(quest, progress);
  if (progress.status !== "in_progress") return;

  context.client = client;
  context.progress = progress;
  await ensureEconomy(context, client);

  let ast;
  try {
    const tokens = tokenize(quest.dsl);
    const parser = new Parser(tokens);
    ast = parser.parseStatement();
  } catch (err) {
    console.error(`Quest ${quest.id} DSL parse error:`, err.message);
    return;
  }

  if (ast.type !== "if") return;

  const result = evaluateCondition(ast.condition, context, quest);
  if (!result) return;

  // Mark completed
  progress.status = "completed";
  progress.completedAt = Date.now();
  progress.updatedAt = Date.now();
  await saveProgress(progress);

  // Apply reward
  if (quest.rewardType && quest.rewardValue && quest.rewardAmount) {
    try {
      await applyReward(quest, context, client);
    } catch (err) {
      console.error(`Quest ${quest.id} reward error:`, err.message);
    }
  }

  // Execute named task
  if (ast.taskName) {
    await executeTaskByName(ast.taskName, quest, context, client);
  }
}

async function applyReward(quest, context, client) {
  const member = getMember(context.member);
  if (quest.rewardType === "currency") {
    await EconomyAccount.adjust(context.guildId, context.userId, quest.rewardValue, quest.rewardAmount);
  } else if (quest.rewardType === "role" && member) {
    const guild = client.guilds.cache.get(context.guildId);
    const role = guild?.roles.cache.get(quest.rewardValue);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role);
    }
  }
}

async function executeTaskByName(name, quest, context, client) {
  const task = quest.tasks.find((t) => t.name === name);
  if (!task) {
    console.warn(`Task ${name} not found in quest ${quest.id}`);
    return;
  }
  await executeTask(task, context, client);
}

async function executeTask(task, context, client) {
  const member = getMember(context.member);
  const guild = client?.guilds?.cache?.get(context.guildId);

  if (task.type === "send_message") {
    const channel = client?.channels?.cache?.get(task.payload?.channelId);
    if (channel?.isTextBased()) {
      const text = replaceVars(task.payload?.content, context);
      await channel.send(text);
    }
  } else if (task.type === "send_dm") {
    try {
      const user = await client?.users?.fetch?.(context.userId);
      if (user) await user.send(replaceVars(task.payload?.content, context));
    } catch {
      // ignore DM failures
    }
  } else if (task.type === "give_role" && member && guild) {
    const role = guild.roles.cache.get(task.payload?.roleId);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role);
    }
  } else if (task.type === "remove_role" && member && guild) {
    const role = guild.roles.cache.get(task.payload?.roleId);
    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
    }
  } else if (task.type === "give_currency") {
    await EconomyAccount.adjust(context.guildId, context.userId, task.payload?.currency || "primary", Number(task.payload?.amount) || 0);
  }
}

function replaceVars(text, context) {
  if (!text) return "";
  return text
    .replace(/\{user\}/g, `<@${context.userId}>`)
    .replace(/\{guild\}/g, context.guildId ? `<@${context.guildId}>` : "");
}

async function runAllForGuild(event, client, guildId, buildContext) {
  const quests = await Quest.getEnabledForGuild(guildId);
  if (!quests.length) return;
  for (const quest of quests) {
    const context = await buildContext(quest);
    await runQuest(quest, context, client);
  }
}

// =========================================================
// Public event handlers
// =========================================================

export async function onMessage(client, message) {
  if (message.author.bot || !message.guild) return;
  const guildId = message.guild.id;
  const userId = message.author.id;

  const ctx = {
    event: "message",
    message,
    member: message.member,
    userId,
    guildId,
    channelId: message.channelId,
    userId,
  };

  await incrementCounter(guildId, userId, "messagesSent", 1, {
    messagesInChannel: { [message.channelId]: 1 },
    messagesWithContent: { [String(message.content).toLowerCase().trim().slice(0, 50)]: 1 },
  });

  await runAllForGuild("message", client, guildId, () => ctx);
}

export async function onCommand(client, message, commandName, source = "prefix") {
  if (!message.guild) return;
  const guildId = message.guild.id;
  const userId = message.author.id;

  await incrementCounter(guildId, userId, "commandsUsed", 1, {
    commandsUsedList: { [commandName]: 1 },
  });

  const ctx = {
    event: "command",
    message,
    member: message.member,
    commandName,
    userId,
    guildId,
    channelId: message.channelId,
  };

  await runAllForGuild("command", client, guildId, () => ctx);
}

export async function onInteraction(client, interaction) {
  if (interaction.user?.bot || !interaction.guild) return;
  if (!interaction.isCommand()) return;
  const commandName = interaction.commandName;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  await incrementCounter(guildId, userId, "commandsUsed", 1, {
    commandsUsedList: { [commandName]: 1 },
  });

  const ctx = {
    event: "command",
    member: interaction.member,
    user: interaction.user,
    commandName,
    userId,
    guildId,
    channelId: interaction.channelId,
  };

  await runAllForGuild("command", client, guildId, () => ctx);
}

export async function onMemberUpdate(client, oldMember, newMember) {
  if (oldMember.guild) {
    const guildId = oldMember.guild.id;
    const userId = newMember.id;

    // Role added
    const added = [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
    const removed = [...oldMember.roles.cache.keys()].filter((id) => !newMember.roles.cache.has(id));

    for (const roleId of added) {
      await incrementCounter(guildId, userId, "rolesGained", 1, {
        rolesGainedList: { [roleId]: 1 },
      });
    }

    // Boost
    const wasBoosting = Boolean(oldMember.premiumSince);
    const isBoosting = Boolean(newMember.premiumSince);
    if (!wasBoosting && isBoosting) {
      await incrementCounter(guildId, userId, "boostsGiven", 1);
    }

    const ctx = {
      event: "member_update",
      member: newMember,
      oldMember,
      userId,
      guildId,
      addedRoles: added,
      removedRoles: removed,
    };

    await runAllForGuild("member_update", client, guildId, () => ctx);
  }
}

const voiceSessions = new Map();

export async function onVoiceStateUpdate(client, oldState, newState) {
  const userId = newState.id;
  const guildId = newState.guild.id;

  const joined = !oldState.channelId && newState.channelId;
  const left = oldState.channelId && !newState.channelId;

  if (joined) {
    voiceSessions.set(`${guildId}:${userId}`, { joinedAt: Date.now() });
    await incrementCounter(guildId, userId, "voiceJoined", 1);
  } else if (left) {
    const key = `${guildId}:${userId}`;
    const session = voiceSessions.get(key);
    if (session) {
      const minutes = Math.floor((Date.now() - session.joinedAt) / 1000 / 60);
      await incrementCounter(guildId, userId, "voiceSeconds", Math.floor((Date.now() - session.joinedAt) / 1000));
      voiceSessions.delete(key);
    }

    const ctx = {
      event: "voice",
      member: newState.member,
      userId,
      guildId,
      channelId: newState.channelId || oldState.channelId,
    };
    await runAllForGuild("voice", client, guildId, () => ctx);
  }
}

export function testParse(dsl) {
  const tokens = tokenize(dsl);
  const parser = new Parser(tokens);
  return { tokens, ast: parser.parseStatement() };
}

export function evaluateConditionForTest(dsl, quest, context) {
  const tokens = tokenize(dsl);
  const parser = new Parser(tokens);
  const ast = parser.parseStatement();
  if (ast.type !== "if") return false;
  return evaluateCondition(ast.condition, context, quest);
}

export async function onReaction(client, reaction, user) {
  if (user.bot || !reaction.message.guild) return;
  const guildId = reaction.message.guild.id;
  const userId = user.id;
  await incrementCounter(guildId, userId, "reactionsAdded", 1);
}
