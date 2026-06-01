import { useId } from "react";

type AppLogoIconProps = {
  className?: string;
  size?: number | string;
};

export function AppLogoIcon({
  className,
  size = 30,
}: AppLogoIconProps): JSX.Element {
  const gradientId = `app-logo-gradient-${useId().replace(/:/g, "")}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className ? `app-logo-icon ${className}` : "app-logo-icon"}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--app-logo-color-1)" />
          <stop offset="18%" stopColor="var(--app-logo-color-2)" />
          <stop offset="38%" stopColor="var(--app-logo-color-3)" />
          <stop offset="55%" stopColor="var(--app-logo-color-4)" />
          <stop offset="72%" stopColor="var(--app-logo-color-5)" />
          <stop offset="88%" stopColor="var(--app-logo-color-6)" />
          <stop offset="100%" stopColor="var(--app-logo-color-7)" />
        </linearGradient>
      </defs>

      <path
        d="M22 12a7.85 7.85 0 0 1-3.7 6.6l-4 2.7a3.9 3.9 0 0 1-4.5 0l-4-2.7A7.57 7.57 0 0 1 2 12a10 10 0 0 1 20 0
       M10.7 11.3c-1.4-1.3-3.3-1.7-4.2-.8s-.5 2.8.8 4.2c1.4 1.4 3.2 1.8 4.2.8.9-.9.5-2.8-.8-4.2
       M17.5 10.5c-.9-.9-2.8-.5-4.2.8-1.4 1.4-1.8 3.2-.8 4.2.9.9 2.8.5 4.2-.8 1.3-1.4 1.7-3.3.8-4.2"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
