import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ConfirmDialogState } from "../../types";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onClose,
}: ConfirmDialogState & {
  onClose: () => void;
}): JSX.Element {
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
        className={`confirm-dialog${isClosing ? " closing" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-body">
          <div className="confirm-dialog-icon">
            <Trash2 size={21} />
          </div>
          <div>
            <h2 id="confirm-dialog-title">{title}</h2>
            <p id="confirm-dialog-message">{message}</p>
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            className="button secondary compact"
            type="button"
            onClick={closeDialog}
          >
            Cancel
          </button>
          <button
            className="confirm-danger-button"
            type="button"
            onClick={closeDialog}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
