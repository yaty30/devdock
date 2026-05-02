import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { ConfirmDialogState } from "../../types";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  confirmDisabled = false,
  onClose,
  onConfirm,
  details,
}: ConfirmDialogState & {
  onClose: () => void;
  onConfirm?: () => void;
  details?: ReactNode;
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
            {variant === "warning" ? (
              <AlertTriangle size={21} />
            ) : (
              <Trash2 size={21} />
            )}
          </div>
          <div>
            <h2 id="confirm-dialog-title">{title}</h2>
            <p id="confirm-dialog-message">{message}</p>
            {details ? (
              <div className="confirm-dialog-details">{details}</div>
            ) : null}
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            className="button secondary compact"
            type="button"
            onClick={closeDialog}
          >
            {cancelLabel ?? "Cancel"}
          </button>
          <button
            className={
              variant === "warning"
                ? "confirm-warning-button"
                : "confirm-danger-button"
            }
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              onConfirm?.();
              closeDialog();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
