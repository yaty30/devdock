import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

export function ActionLink({ children }: { children: ReactNode }): JSX.Element {
  return (
    <button className="link-button" type="button">
      {children}
      <ExternalLink size={14} />
    </button>
  );
}
