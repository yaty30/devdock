import type { DashboardTab } from "../../types";

export function SegmentedTabs({
  activeTab,
  projectTabLabel = "Dashboard",
  onTabChange,
}: {
  activeTab: DashboardTab;
  projectTabLabel?: string;
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
        {projectTabLabel}
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
      <button
        className={`tab${activeTab === "notes" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "notes"}
        onClick={() => onTabChange("notes")}
      >
        Notes
      </button>
    </div>
  );
}
