export type AppFeatureFlags = {
  database: boolean;
  ssh: boolean;
};

export const APP_FEATURE_FLAGS: AppFeatureFlags = {
  database: true,
  // SSH is experimental and intentionally disabled for now. It may return in a
  // future update or move into a separate app.
  ssh: false,
};

export type AppFeatureName = keyof AppFeatureFlags;

export function isAppFeatureEnabled(feature: AppFeatureName): boolean {
  return APP_FEATURE_FLAGS[feature];
}
