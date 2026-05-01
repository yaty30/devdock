import type { DashboardTab } from "../../types";

export function SegmentedTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}): JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label="Dashboard sections">
      <button
        className={`tab${activeTab === "dashboard" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "dashboard"}
        onClick={() => onTabChange("dashboard")}
      >
        Dashboard
      </button>
      <button
        className={`tab${activeTab === "monitor" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "monitor"}
        onClick={() => onTabChange("monitor")}
      >
        Monitor
      </button>
      <button
        className={`tab${activeTab === "git-terminal" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "git-terminal"}
        onClick={() => onTabChange("git-terminal")}
      >
        Git terminal
      </button>
    </div>
  );
}
