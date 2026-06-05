import { useEffect, useRef, useState } from "react";
import type { SnackbarState, SnackbarTone } from "../types/snackbar";

export function useSnackbar(): {
  snackbar: SnackbarState | null;
  snackbarClosing: boolean;
  showSnackbar: (message: string, tone: SnackbarTone) => void;
  dismissSnackbar: () => void;
} {
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const [snackbarClosing, setSnackbarClosing] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  function clearTimers(): void {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function showSnackbar(message: string, tone: SnackbarTone): void {
    clearTimers();
    setSnackbarClosing(false);
    setSnackbar({ message, tone });
    dismissTimerRef.current = window.setTimeout(() => {
      setSnackbarClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setSnackbar(null);
        setSnackbarClosing(false);
      }, 190);
    }, 3600);
  }

  function dismissSnackbar(): void {
    clearTimers();
    setSnackbar(null);
    setSnackbarClosing(false);
  }

  return {
    snackbar,
    snackbarClosing,
    showSnackbar,
    dismissSnackbar,
  };
}
