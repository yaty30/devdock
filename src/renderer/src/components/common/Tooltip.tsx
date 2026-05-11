import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

type TooltipPlacement = "top" | "bottom" | "left" | "right";
type TooltipStyle = CSSProperties & Record<`--${string}`, string>;

type TooltipProps = {
  content: ReactNode;
  placement?: TooltipPlacement;
  children: ReactNode;
  className?: string;
};

export function Tooltip({
  content,
  placement = "right",
  children,
  className = "",
}: TooltipProps): JSX.Element {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const showFrameRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<TooltipStyle>({});

  function updatePosition(): void {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const offset = 9;
    if (placement === "left") {
      setStyle({
        right: window.innerWidth - rect.left + offset,
        top: rect.top + rect.height / 2,
        "--tooltip-offset-x": "0px",
        "--tooltip-offset-y": "-50%",
      });
      return;
    }
    if (placement === "top") {
      setStyle({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + offset,
        "--tooltip-offset-x": "-50%",
        "--tooltip-offset-y": "0px",
      });
      return;
    }
    if (placement === "bottom") {
      setStyle({
        left: rect.left + rect.width / 2,
        top: rect.bottom + offset,
        "--tooltip-offset-x": "-50%",
        "--tooltip-offset-y": "0px",
      });
      return;
    }

    setStyle({
      left: rect.right + offset,
      top: rect.top + rect.height / 2,
      "--tooltip-offset-x": "0px",
      "--tooltip-offset-y": "-50%",
    });
  }

  function showTooltip(): void {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (showFrameRef.current !== null) {
      window.cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }

    updatePosition();
    setMounted(true);
    // Double rAF: first frame lets React flush the mount render,
    // second fires after the browser paints the hidden state so the
    // CSS enter transition has a real start point to animate from.
    showFrameRef.current = window.requestAnimationFrame(() => {
      showFrameRef.current = window.requestAnimationFrame(() => {
        setOpen(true);
        showFrameRef.current = null;
      });
    });
  }

  function hideTooltip(): void {
    if (showFrameRef.current !== null) {
      window.cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
    }

    setOpen(false);
    hideTimeoutRef.current = window.setTimeout(() => {
      setMounted(false);
      hideTimeoutRef.current = null;
    }, 160);
  }

  useEffect(() => {
    if (!mounted) {
      return undefined;
    }

    function handleViewportChange(): void {
      updatePosition();
    }

    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [mounted, placement]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
      if (showFrameRef.current !== null) {
        window.cancelAnimationFrame(showFrameRef.current);
      }
    };
  }, []);

  return (
    <span
      ref={anchorRef}
      className={`tooltip-anchor tooltip-anchor--${placement}${className ? ` ${className}` : ""}`}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {mounted
        ? createPortal(
            <span
              id={tooltipId}
              className={`tooltip-bubble tooltip-bubble--${placement}${open ? " open" : ""}`}
              role="tooltip"
              style={style}
            >
              <span className="tooltip-arrow" aria-hidden="true" />
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
