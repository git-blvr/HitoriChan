export class AIError extends Error {
  constructor(message, { rateLimited = false, unavailable = false } = {}) {
    super(message);
    this.name = "AIError";
    this.rateLimited = rateLimited;
    this.unavailable = unavailable;
  }
}

// Backwards-compatible alias — instanceof works for both names.
export const AIGroqError = AIError;

export function isRateLimited(err) {
  return err instanceof AIError && err.rateLimited;
}

export function isUnavailable(err) {
  return err instanceof AIError && err.unavailable;
}
