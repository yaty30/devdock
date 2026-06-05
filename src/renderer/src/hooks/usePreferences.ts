import { useEffect, useState } from "react";
import {
  readStoredAccentColor,
  readStoredFontSizeMode,
  readStoredTheme,
  storeAccentColor,
  storeFontSizeMode,
  storeTheme,
} from "../stores/preferencesStore";
import type { FontSizeMode, Theme } from "../types";
import type { AccentColor, InterfacePreferences } from "../types/preferences";

export function usePreferences(): InterfacePreferences & {
  setTheme: (theme: Theme) => void;
  setAccentColor: (accentColor: AccentColor) => void;
  setFontSizeMode: (fontSizeMode: FontSizeMode) => void;
} {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [accentColor, setAccentColor] = useState<AccentColor>(() =>
    readStoredAccentColor(),
  );
  const [fontSizeMode, setFontSizeMode] = useState<FontSizeMode>(() =>
    readStoredFontSizeMode(),
  );

  useEffect(() => {
    storeTheme(theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    storeAccentColor(accentColor);
    document.documentElement.dataset.accent = accentColor;
  }, [accentColor]);

  useEffect(() => {
    storeFontSizeMode(fontSizeMode);
    document.documentElement.dataset.fontSize = fontSizeMode;
  }, [fontSizeMode]);

  return {
    theme,
    accentColor,
    fontSizeMode,
    setTheme,
    setAccentColor,
    setFontSizeMode,
  };
}
