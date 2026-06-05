import { useEffect, useState } from "react";

export function useFeatureFlags(): {
  chatEnabled: boolean;
  debugEnabled: boolean;
} {
  const [chatEnabled, setChatEnabled] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.ivsDashboard
      .getFeatureFlags()
      .then((flags) => {
        if (!cancelled) {
          setChatEnabled(flags.chatEnabled);
          setDebugEnabled(flags.debugEnabled);
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { chatEnabled, debugEnabled };
}
