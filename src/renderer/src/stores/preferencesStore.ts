import type { FontSizeMode, Theme } from "../types";
import type { AccentColor } from "../types/preferences";

const THEME_STORAGE_KEY = "ivs-dashboard-theme";
const ACCENT_STORAGE_KEY = "ivs-dashboard-accent";
const FONT_SIZE_STORAGE_KEY = "ivs-dashboard-font-size";

export function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function storeTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function readStoredAccentColor(): AccentColor {
  const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  if (
    stored === "green" ||
    stored === "yellow" ||
    stored === "orange" ||
    stored === "purple" ||
    stored === "pink" ||
    stored === "black"
  ) {
    return stored;
  }

  return "blue";
}

export function storeAccentColor(accentColor: AccentColor): void {
  window.localStorage.setItem(ACCENT_STORAGE_KEY, accentColor);
}

export function readStoredFontSizeMode(): FontSizeMode {
  const stored = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (
    stored === "50" ||
    stored === "70" ||
    stored === "90" ||
    stored === "100" ||
    stored === "120" ||
    stored === "140" ||
    stored === "160"
  ) {
    return stored;
  }

  if (stored === "180" || stored === "200") {
    return "160";
  }

  if (stored === "small") {
    return "90";
  }

  if (stored === "large") {
    return "120";
  }

  return "100";
}

export function storeFontSizeMode(fontSizeMode: FontSizeMode): void {
  window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSizeMode);
}
