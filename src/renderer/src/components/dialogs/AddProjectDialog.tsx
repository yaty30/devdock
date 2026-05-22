import { useEffect, useRef, useState } from "react";
import { AppSelect, type AppSelectOption } from "../common/AppSelect";
import type { BackendType } from "../../types";

const BACKEND_TYPE_OPTIONS: Array<AppSelectOption<BackendType>> = [
  { value: "wildfly", label: "WildFly", dotColor: "#8b5cf6" },
  { value: "python", label: "Python", dotColor: "#10b981" },
];

export function AddProjectDialog({
  onCreate,
  onClose,
}: {
  onCreate: (
    name: string,
    code: string,
    backendType: BackendType,
  ) => Promise<boolean>;
  onClose: () => void;
}): JSX.Element {
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [backendType, setBackendType] = useState<BackendType>("wildfly");
  const [isClosing, setIsClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  function closeDialog(): void {
    if (isClosing) {
      return;
    }

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 170);
  }

  async function submitProject(): Promise<void> {
    if (saving) {
      return;
    }

    setSaving(true);
    const created = await onCreate(projectName, projectCode, backendType);
    setSaving(false);
    if (created) {
      closeDialog();
    }
  }

  return (
    <div
      className={`dialog-backdrop${isClosing ? " closing" : ""}`}
      role="presentation"
      onClick={closeDialog}
    >
      <section
        className={`add-project-dialog${isClosing ? " closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submitProject();
          }
        }}
      >
        <h2 id="add-project-title">Add Project</h2>
        <div className="add-project-fields">
          <label>
            <span>Project name</span>
            <input
              autoFocus
              type="text"
              value={projectName}
              maxLength={16}
              placeholder="Maximum 16 characters, e.g. Project IAP"
              onChange={(event) => setProjectName(event.target.value)}
            />
          </label>
          <label>
            <span>Project tag</span>
            <input
              type="text"
              value={projectCode}
              maxLength={3}
              placeholder="Maximum 3 characters, e.g. IAP"
              onChange={(event) =>
                setProjectCode(event.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            <span>Backend type</span>
            <AppSelect
              value={backendType}
              options={BACKEND_TYPE_OPTIONS}
              onChange={setBackendType}
              ariaLabel="Backend type"
              minDropdownWidth={160}
            />
          </label>
        </div>
        <p>
          Project folder and app.config will be created automatically after you
          enter a name.
        </p>
        <div className="dialog-actions">
          <button
            className="button primary compact"
            type="button"
            onClick={() => void submitProject()}
            disabled={saving}
          >
            {saving ? "Adding" : "Add Project"}
          </button>
          <button
            className="button secondary compact"
            type="button"
            onClick={closeDialog}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
