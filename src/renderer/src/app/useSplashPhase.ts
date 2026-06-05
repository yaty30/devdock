import { useEffect, useRef, useState } from "react";

export type SplashPhase = "visible" | "exiting" | "hidden";

const SPLASH_READY_FRAME_MS = 800;
const SPLASH_EXIT_HOLD_MS = 800;
const SPLASH_FADE_OUT_MS = 420;

export function useSplashPhase(appReady: boolean): SplashPhase {
  const [splashPhase, setSplashPhase] = useState<SplashPhase>("visible");
  const splashSequenceStartedRef = useRef(false);

  useEffect(() => {
    if (splashSequenceStartedRef.current || !appReady) {
      return undefined;
    }

    splashSequenceStartedRef.current = true;

    const timers = [
      window.setTimeout(
        () => setSplashPhase("exiting"),
        SPLASH_READY_FRAME_MS + SPLASH_EXIT_HOLD_MS,
      ),
      window.setTimeout(
        () => setSplashPhase("hidden"),
        SPLASH_READY_FRAME_MS + SPLASH_EXIT_HOLD_MS + SPLASH_FADE_OUT_MS,
      ),
    ];

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [appReady]);

  return splashPhase;
}
