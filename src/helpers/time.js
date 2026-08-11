export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR   = 60 * MS_PER_MINUTE;
export const MS_PER_DAY    = 24 * MS_PER_HOUR;
export const MS_PER_WEEK   = 7 * MS_PER_DAY;

export function toDateString(date = new Date()) {
  return date.toISOString().split("T")[0];
}

export function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateString(d);
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function formatDuration(ms) {
  if (ms <= 0) return "0s";
  const units = [
    [MS_PER_WEEK, "w"],
    [MS_PER_DAY, "d"],
    [MS_PER_HOUR, "h"],
    [MS_PER_MINUTE, "m"],
    [MS_PER_SECOND, "s"],
  ];
  const parts = [];
  for (const [value, label] of units) {
    if (ms >= value) {
      parts.push(`${Math.floor(ms / value)}${label}`);
      ms %= value;
    }
  }
  return parts.join(" ") || "0s";
}

export function formatDetailedDuration(ms) {
  if (ms <= 0) return "0 seconds";
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

export function parseDuration(str) {
  const units = { s: MS_PER_SECOND, m: MS_PER_MINUTE, h: MS_PER_HOUR, d: MS_PER_DAY, w: MS_PER_WEEK };
  const regex = /(\d+)(s|m|h|d|w)/gi;
  let total = 0;
  let match;
  while ((match = regex.exec(str)) !== null) {
    total += parseInt(match[1]) * (units[match[2].toLowerCase()] ?? 0);
  }
  return total || null;
}

export function isSameDay(a, b) {
  return toDateString(a) === toDateString(b);
}

export function timestampSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}
