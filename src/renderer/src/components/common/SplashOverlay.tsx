import { AppLogoIcon } from "./AppLogoIcon";

export function SplashOverlay({
  phase,
  logoSize,
}: {
  phase: "visible" | "exiting";
  logoSize: string;
}): JSX.Element {
  return (
    <div className={`splash-screen ${phase}`} aria-hidden="true">
      <div className="splash-logo-shell" style={{ width: logoSize }}>
        <AppLogoIcon className="splash-logo" />
      </div>
    </div>
  );
}
