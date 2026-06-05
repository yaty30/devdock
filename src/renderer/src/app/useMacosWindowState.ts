import { useEffect, useState } from "react";

export const IS_MACOS =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

export function useMacosWindowState(): {
  nativeWindowClass: string;
} {
  const [macosWindowFullscreen, setMacosWindowFullscreen] = useState(false);

  useEffect(() => {
    if (!IS_MACOS) {
      return undefined;
    }

    void window.ivsDashboard.isWindowMaximized().then(setMacosWindowFullscreen);
    return window.ivsDashboard.onWindowMaximizedChange(
      setMacosWindowFullscreen,
    );
  }, []);

  return {
    nativeWindowClass: IS_MACOS
      ? ` macos-native-window${macosWindowFullscreen ? " macos-window-fullscreen" : ""}`
      : "",
  };
}
