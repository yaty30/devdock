import type { CryptographicToolTab } from "./ConversionTools";

export type ApiTesterView = "test" | "history" | "saved";
export type CompareView = "compare";

export function ApiTesterHeaderTabs({
  activeView,
  onViewChange,
}: {
  activeView: ApiTesterView;
  onViewChange: (view: ApiTesterView) => void;
}): JSX.Element {
  return (
    <div
      className="tabs api-tester-header-tabs"
      role="tablist"
      aria-label="API tester sections"
    >
      <button
        className={`tab${activeView === "test" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "test"}
        onClick={() => onViewChange("test")}
      >
        API Test
      </button>
      <button
        className={`tab${activeView === "history" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "history"}
        onClick={() => onViewChange("history")}
      >
        History
      </button>
      <button
        className={`tab${activeView === "saved" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "saved"}
        onClick={() => onViewChange("saved")}
      >
        Saved
      </button>
    </div>
  );
}

export function CompareHeaderTabs({
  activeView,
  onViewChange,
}: {
  activeView: CompareView;
  onViewChange: (view: CompareView) => void;
}): JSX.Element {
  return (
    <div
      className="tabs compare-header-tabs"
      role="tablist"
      aria-label="Compare sections"
    >
      <button
        className={`tab${activeView === "compare" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "compare"}
        onClick={() => onViewChange("compare")}
      >
        Compare
      </button>
    </div>
  );
}

export function CryptographicHeaderTabs({
  activeView,
  onViewChange,
}: {
  activeView: CryptographicToolTab;
  onViewChange: (view: CryptographicToolTab) => void;
}): JSX.Element {
  return (
    <div
      className="tabs cryptographic-header-tabs"
      role="tablist"
      aria-label="Cryptographic sections"
    >
      <button
        className={`tab${activeView === "base64" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "base64"}
        onClick={() => onViewChange("base64")}
      >
        Base64
      </button>

      <button
        className={`tab${activeView === "hashing" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "hashing"}
        onClick={() => onViewChange("hashing")}
      >
        Hash
      </button>

      <button
        className={`tab${activeView === "unicode" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "unicode"}
        onClick={() => onViewChange("unicode")}
      >
        Unicode
      </button>
    </div>
  );
}

export function SingleToolHeaderTabs({
  label,
}: {
  label: string;
}): JSX.Element {
  return (
    <div
      className="tabs single-tool-header-tabs"
      role="tablist"
      aria-label={label}
    >
      <button className="tab active" type="button" role="tab" aria-selected>
        {label}
      </button>
    </div>
  );
}
