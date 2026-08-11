export async function resolveMember(ctx, argIndex = 0) {
  if (ctx.isInteraction) {
    const user = ctx.source?.options?.getUser?.("target") ?? ctx.source?.options?.getUser?.("user");
    if (!user) return null;
    return ctx.guild.members.fetch(user.id).catch(() => null);
  }

  const raw = ctx.args?.[argIndex];
  if (!raw || !ctx.guild) return null;

  const mentionMatch = String(raw).match(/<@!?(\d+)>$/);
  const id = mentionMatch?.[1] ?? raw;
  if (!/^\d{17,20}$/.test(id)) return null;

  return ctx.guild.members.fetch(id).catch(() => null);
}

export function resolveChannelId(raw) {
  if (!raw) return null;
  const match = String(raw).match(/<#(\d+)>$/);
  const id = match?.[1] ?? raw;
  return /^\d{17,20}$/.test(id) ? id : null;
}

export function resolveRoleId(raw) {
  if (!raw) return null;
  const match = String(raw).match(/<@&(\d+)>$/);
  const id = match?.[1] ?? raw;
  return /^\d{17,20}$/.test(id) ? id : null;
}

export function resolveReason(ctx, argIndex = 1) {
  if (ctx.isInteraction) {
    return ctx.source?.options?.getString?.("reason") ?? "No reason provided";
  }
  const reason = (ctx.args ?? []).slice(argIndex).join(" ").trim();
  return reason || "No reason provided";
}

export function resolveAttachment(ctx) {
  if (ctx.isInteraction) {
    return ctx.source?.options?.getAttachment?.("attachment")?.url ?? null;
  }
  return ctx.source?.attachments?.first?.()?.url ?? null;
}

export async function requireServer(ctx) {
  if (!ctx.guild) {
    await ctx.reply("This command only works in a server.");
    return false;
  }
  return true;
}

export async function checkHierarchy(ctx, target) {
  const botMember = ctx.guild.members.me;
  if (target.id === ctx.user.id) {
    await ctx.reply("You cannot moderate yourself.");
    return false;
  }
  if (target.id === ctx.guild.ownerId) {
    await ctx.reply("You cannot moderate the server owner.");
    return false;
  }
  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply("My role is too low to moderate that member.");
    return false;
  }
  if (ctx.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    await ctx.reply("Your role is too low to moderate that member.");
    return false;
  }
  return true;
}
