import { useEffect, useRef, type RefObject } from "react";

export function useSidebarResizeSync(
  sidebarCollapsed: boolean,
  appShellRef: RefObject<HTMLDivElement>,
): void {
  const sidebarTransitionReadyRef = useRef(false);

  useEffect(() => {
    if (!sidebarTransitionReadyRef.current) {
      sidebarTransitionReadyRef.current = true;
      return undefined;
    }

    const shell = appShellRef.current;
    if (!shell) {
      return undefined;
    }

    let dispatched = false;
    const dispatchSettledResize = (): void => {
      if (dispatched) {
        return;
      }

      dispatched = true;
      window.dispatchEvent(new Event("resize"));
    };

    const fallbackTimer = window.setTimeout(dispatchSettledResize, 220);
    const handleTransitionEnd = (event: TransitionEvent): void => {
      if (
        event.target === shell &&
        event.propertyName === "grid-template-columns"
      ) {
        window.clearTimeout(fallbackTimer);
        dispatchSettledResize();
      }
    };

    shell.addEventListener("transitionend", handleTransitionEnd);
    return () => {
      window.clearTimeout(fallbackTimer);
      shell.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, [appShellRef, sidebarCollapsed]);
}
