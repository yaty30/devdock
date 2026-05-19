import { useEffect, useState, type ReactNode } from "react";
import { Minus, Minimize2, Square, X } from "lucide-react";
import type { DashboardTab } from "../../types";
import { SegmentedTabs } from "../navigation/SegmentedTabs";

export function AppHeader({
  activeTab,
  onTabChange,
  children,
  actions,
}: {
  activeTab?: DashboardTab;
  onTabChange?: (tab: DashboardTab) => void;
  children?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  const tabs =
    children ??
    (activeTab && onTabChange ? (
      <SegmentedTabs activeTab={activeTab} onTabChange={onTabChange} />
    ) : null);

  return (
    <header className="app-header" aria-label="Application header">
      <div className="app-header-tabs">{tabs}</div>

      <div className="app-header-right">
        <div className="app-header-actions">{actions}</div>
        <div className="app-header-window-controls">
          <WindowControls />
        </div>
      </div>
    </header>
  );
}

function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.ivsDashboard.isWindowMaximized().then(setMaximized);
    return window.ivsDashboard.onWindowMaximizedChange(setMaximized);
  }, []);

  return (
    <div className="app-window-controls" aria-label="Window controls">
      <button
        className="app-window-control"
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void window.ivsDashboard.minimizeWindow()}
      >
        <Minus size={16} />
      </button>
      <button
        className="app-window-control"
        type="button"
        aria-label="Toggle maximize window"
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void window.ivsDashboard.toggleMaximizeWindow()}
      >
        {maximized ? <Minimize2 size={14} /> : <Square size={14} />}
      </button>
      <button
        className="app-window-control danger"
        type="button"
        aria-label="Close window"
        title="Close"
        onClick={() => void window.ivsDashboard.closeWindow()}
      >
        <X size={16} />
      </button>
    </div>
  );
}