import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const MODAL_EXIT_MS = 180;

export function Modal({
  open,
  title,
  subtitle,
  size = "md",
  children,
  className,
  contentClassName,
  closeLabel = "Close dialog",
  onClose,
}: {
  open: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  closeLabel?: string;
  onClose: () => void;
}): JSX.Element | null {
  const titleId = useId();
  const closeTimerRef = useRef<number | null>(null);
  const [shouldRender, setShouldRender] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [renderedTitle, setRenderedTitle] = useState(title);
  const [renderedSubtitle, setRenderedSubtitle] = useState(subtitle);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (title !== undefined) {
      setRenderedTitle(title);
    }
    setRenderedSubtitle(subtitle);
  }, [open, subtitle, title]);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setShouldRender(true);
      setIsClosing(false);
      return undefined;
    }

    if (!shouldRender) {
      return undefined;
    }

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, MODAL_EXIT_MS);

    return undefined;
  }, [open, shouldRender]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`modal-backdrop${isClosing ? " closing" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={`modal-surface modal-${size}${isClosing ? " closing" : ""}${
          className ? ` ${className}` : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header
          className={`modal-header${renderedSubtitle ? "" : " no-subtitle"}`}
        >
          <div>
            <h2 id={titleId}>{renderedTitle}</h2>
            {renderedSubtitle ? <p>{renderedSubtitle}</p> : null}
          </div>
          <button
            className="icon-button secondary"
            type="button"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div
          className={`modal-content${
            contentClassName ? ` ${contentClassName}` : ""
          }`}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
