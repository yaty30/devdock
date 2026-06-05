import { Check, Moon, Sun } from "lucide-react";
import type { Theme } from "../../types";
import type { AccentColor } from "../../types/preferences";
import { Modal } from "./Modal";

const ACCENT_OPTIONS: ReadonlyArray<{ value: AccentColor; label: string }> = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "yellow", label: "Yellow" },
  { value: "orange", label: "Orange" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
  { value: "black", label: "Black" },
];

export function InterfaceSettingsModal({
  open,
  theme,
  accentColor,
  onThemeChange,
  onAccentColorChange,
  onClose,
}: {
  open: boolean;
  theme: Theme;
  accentColor: AccentColor;
  onThemeChange: (theme: Theme) => void;
  onAccentColorChange: (color: AccentColor) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      open={open}
      title="Interface settings"
      size="sm"
      className="interface-settings-modal"
      contentClassName="interface-settings-modal-content"
      closeLabel="Close interface settings"
      onClose={onClose}
    >
      <div className="interface-settings-panel">
        <section className="interface-settings-section">
          <h3>Interface theme</h3>
          <div className="interface-theme-options" role="group">
            <button
              className={`interface-theme-option${theme === "light" ? " active" : ""}`}
              type="button"
              aria-pressed={theme === "light"}
              onClick={() => onThemeChange("light")}
            >
              <Sun size={16} />
              <span>Light</span>
            </button>
            <button
              className={`interface-theme-option${theme === "dark" ? " active" : ""}`}
              type="button"
              aria-pressed={theme === "dark"}
              onClick={() => onThemeChange("dark")}
            >
              <Moon size={16} />
              <span>Dark</span>
            </button>
          </div>
        </section>

        <section className="interface-settings-section">
          <h3>Accent color</h3>
          <div className="accent-color-grid" role="group">
            {ACCENT_OPTIONS.map((option) => {
              const selected = accentColor === option.value;
              return (
                <button
                  key={option.value}
                  className={`accent-color-option ${option.value}${selected ? " active" : ""}`}
                  type="button"
                  aria-label={`${option.label} accent`}
                  aria-pressed={selected}
                  title={option.label}
                  onClick={() => onAccentColorChange(option.value)}
                >
                  <span className="accent-color-swatch" />
                  <span>{option.label}</span>
                  {selected ? <Check size={15} /> : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}
