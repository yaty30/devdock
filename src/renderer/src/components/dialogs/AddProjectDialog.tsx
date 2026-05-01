import { useEffect, useRef, useState } from "react";

export function AddProjectDialog({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const [projectName, setProjectName] = useState("");
  const [isClosing, setIsClosing] = useState(false);
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
      >
        <h2 id="add-project-title">Add Project</h2>
        <label>
          <span>Project name</span>
          <input
            autoFocus
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
        </label>
        <p>
          Project folder and app.config will be created automatically after you
          enter a name.
        </p>
        <div className="dialog-actions">
          <button
            className="button primary compact"
            type="button"
            onClick={closeDialog}
          >
            Add Project
          </button>
          <button
            className="button secondary compact"
            type="button"
            onClick={closeDialog}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
