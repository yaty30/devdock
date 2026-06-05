import type { FontSizeMode, Theme } from "../types";

export type AccentColor =
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "purple"
  | "pink"
  | "black";

export type InterfacePreferences = {
  theme: Theme;
  accentColor: AccentColor;
  fontSizeMode: FontSizeMode;
};
