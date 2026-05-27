import type { SVGProps } from "react";

export function MonitorCloud({
  size = 24,
  color = "currentColor",
  strokeWidth = 2,
  ...props
}: SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
}): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="18" height="12" x="3" y="4" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="M8.5 12.5h7.25a2.25 2.25 0 0 0 .35-4.47 3.5 3.5 0 0 0-6.63-.75A2.75 2.75 0 0 0 8.5 12.5Z" />
    </svg>
  );
}