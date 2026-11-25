const FONT_STACKS = {
  geist: '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  serif: '"Instrument Serif", Georgia, "Times New Roman", serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

function hexLuminance(hex) {
  const c = String(hex || "").replace("#", "");
  if (c.length !== 6) return 0;
  const ch = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

function contrastRatio(a, b) {
  const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function readableOn(bgHex) {
  return contrastRatio(bgHex, "#000000") >= contrastRatio(bgHex, "#ffffff") ? "#000000" : "#ffffff";
}

function accentContrast(hex) {
  return readableOn(hex);
}

function accentReadable(accent, surface) {
  return contrastRatio(accent, surface) >= 3 ? accent : readableOn(surface);
}

// Mirror the dashboard theme (hc-theme-v1) so docs match the console.
(function applyTheme() {
  let theme;
  try {
    theme = JSON.parse(localStorage.getItem("hc-theme-v1")) || {};
  } catch {
    return;
  }
  const root = document.documentElement;
  if (theme.mode) root.dataset.theme = theme.mode;
  if (theme.accent) {
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--accent-contrast", accentContrast(theme.accent));
    root.style.setProperty("--accent-readable",
      accentReadable(theme.accent, theme.mode === "light" ? "#fafafa" : "#050505"));
  }
  if (theme.scale) root.style.setProperty("--ui-scale", String(theme.scale));
  if (theme.font && FONT_STACKS[theme.font]) root.style.setProperty("--font-ui", FONT_STACKS[theme.font]);
})();

const links = document.querySelectorAll(".docs-sidebar a");
const sections = document.querySelectorAll(".docs-content .panel");

function onScroll() {
  let current = "";
  const offset = 100;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= offset) {
      current = section.id;
    }
  }
  links.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${current}`);
  });
}

window.addEventListener("scroll", onScroll);
onScroll();
