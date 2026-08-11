export function formatNumber(value, locale = "en-US") {
  return Number(value).toLocaleString(locale);
}

export function formatMoney(value, locale = "en-US") {
  return formatNumber(value, locale);
}

export function formatCurrency(amount, symbol) {
  return `${symbol}${formatNumber(amount)}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function truncate(str, maxLength, suffix = "...") {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
}

export function escapeMarkdown(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/`/g, "\\`");
}
