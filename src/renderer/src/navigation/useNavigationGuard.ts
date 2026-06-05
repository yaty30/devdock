import { useCallback, useState } from "react";

type GuardedNavigationOptions = {
  closeSettings?: boolean;
  clearSettingsDirty?: boolean;
};

export function useNavigationGuard(): {
  settingsOpen: boolean;
  settingsDirty: boolean;
  pendingNavigation: (() => void) | null;
  setSettingsOpen: (open: boolean) => void;
  setSettingsDirty: (dirty: boolean) => void;
  requestSettingsNavigation: (
    action: () => void,
    options?: GuardedNavigationOptions,
  ) => void;
  closeSettings: () => void;
  confirmPendingNavigation: () => void;
  cancelPendingNavigation: () => void;
} {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);

  const requestSettingsNavigation = useCallback(
    (
      action: () => void,
      {
        closeSettings = true,
        clearSettingsDirty = true,
      }: GuardedNavigationOptions = {},
    ): void => {
      const run = (): void => {
        if (closeSettings) {
          setSettingsOpen(false);
        }
        if (clearSettingsDirty) {
          setSettingsDirty(false);
        }
        action();
      };

      if (settingsDirty && settingsOpen) {
        setPendingNavigation(() => run);
        return;
      }

      run();
    },
    [settingsDirty, settingsOpen],
  );

  const closeSettings = useCallback((): void => {
    requestSettingsNavigation(() => undefined);
  }, [requestSettingsNavigation]);

  const confirmPendingNavigation = useCallback((): void => {
    const pending = pendingNavigation;
    setPendingNavigation(null);
    pending?.();
  }, [pendingNavigation]);

  const cancelPendingNavigation = useCallback((): void => {
    setPendingNavigation(null);
  }, []);

  return {
    settingsOpen,
    settingsDirty,
    pendingNavigation,
    setSettingsOpen,
    setSettingsDirty,
    requestSettingsNavigation,
    closeSettings,
    confirmPendingNavigation,
    cancelPendingNavigation,
  };
}
