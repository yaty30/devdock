import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

export function ActionLink({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className="link-button"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <ExternalLink size={14} />
    </button>
  );
}
