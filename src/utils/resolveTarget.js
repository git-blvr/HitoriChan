function extractId(raw) {
  const mention = String(raw).match(/^<@!?(\d+)>$/);
  return mention ? mention[1] : String(raw);
}

function isSnowflake(id) {
  return /^\d{17,20}$/.test(String(id));
}

async function resolveById(ctx, id, allowUserFallback) {
  if (ctx.guild) {
    const member = await ctx.guild.members.fetch(id).catch(() => null);
    if (member) return member;
  }

  if (allowUserFallback) {
    try {
      return await ctx.client.users.fetch(id);
    } catch {
      return null;
    }
  }

  return null;
}

export async function resolveTarget(ctx, options = {}) {
  const {
    optionName = "user",
    argIndex = 0,
    fallbackToAuthor = true,
    allowReference = true,
    allowUserFallback = false,
  } = options;

  let target = null;
  let refMessage = null;
  let consumed = 0;

  if (ctx.isInteraction) {
    const userObj =
      ctx.source?.options?.getUser?.(optionName) ??
      ctx.source?.options?.getUser?.("user") ??
      ctx.source?.options?.getUser?.("target");

    if (userObj) {
      target = await resolveById(ctx, userObj.id, allowUserFallback);
      if (target) {
        consumed = 1;
      }
    }
  } else {
    const raw = ctx.args?.[argIndex] ?? null;

    if (raw) {
      const id = extractId(raw);
      if (isSnowflake(id)) {
        target = await resolveById(ctx, id, allowUserFallback);
        if (target) {
          consumed = 1;
        }
      }
    }

    if (!target && allowReference && ctx.reference?.messageId) {
      try {
        refMessage = await ctx.channel.messages.fetch(ctx.reference.messageId);
      } catch {
        refMessage = null;
      }

      if (refMessage) {
        target = await resolveById(ctx, refMessage.author.id, allowUserFallback);
        if (target) {
          consumed = 0;
        } else {
          refMessage = null;
        }
      }
    }
  }

  if (!target && fallbackToAuthor) {
    target = ctx.member ?? ctx.user;
    consumed = 0;
  }

  return { target, refMessage, consumed };
}
