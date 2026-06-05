import { HeaderUtilityActions } from "../../components/layout/HeaderActions";
import type { DatabaseConnection, FontSizeMode } from "../../types";

export type DatabaseRuntimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "sleeping"
  | "disconnected"
  | "reconnecting"
  | "error";

export function DatabaseHeaderActions({
  connection,
  databaseStatus,
  fontSizeMode,
  onFontSizeChange,
  onSettingsClick,
  disabled = false,
}: {
  connection: DatabaseConnection;
  databaseStatus: DatabaseRuntimeStatus;
  fontSizeMode: FontSizeMode;
  onFontSizeChange: (mode: FontSizeMode) => void;
  onSettingsClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="header-actions database-header-actions">
      <div className="database-header-context" aria-label="Database context">
        <span className={`database-status-dot ${databaseStatus}`} />
        <span>{databaseStatus}</span>
        <span>-</span>
        <span>{connection.user}</span>
        <span>-</span>
        <strong>{connection.name}</strong>
      </div>
      <HeaderUtilityActions
        fontSizeMode={fontSizeMode}
        onFontSizeChange={onFontSizeChange}
        onSettingsClick={onSettingsClick}
        disabled={disabled}
        settingsIcon="cog"
      />
    </div>
  );
}
