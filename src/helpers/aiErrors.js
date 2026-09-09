export class AIGroqError extends Error {
  constructor(message, { rateLimited = false, unavailable = false } = {}) {
    super(message);
    this.name = "AIGroqError";
    this.rateLimited = rateLimited;
    this.unavailable = unavailable;
  }
}

export function isRateLimited(err) {
  return err instanceof AIGroqError && err.rateLimited;
}

export function isUnavailable(err) {
  return err instanceof AIGroqError && err.unavailable;
}
