import type { ReactNode } from "react";

function colorizeMessage(message: string): ReactNode[] {
  const segments = message.split(
    /(\[INFO\]|\[vite\]|\[warn\]|BUILD SUCCESS|http:\/\/localhost:5173\/|C:\\projects\\iap\\frontend)/g,
  );

  return segments.map((segment, index) => {
    if (
      segment === "[INFO]" ||
      segment === "http://localhost:5173/" ||
      segment === "C:\\projects\\iap\\frontend"
    ) {
      return (
        <span className="log-accent" key={`${segment}-${index}`}>
          {segment}
        </span>
      );
    }

    if (segment === "[vite]" || segment === "BUILD SUCCESS") {
      return (
        <span className="log-success" key={`${segment}-${index}`}>
          {segment}
        </span>
      );
    }

    if (segment === "[warn]") {
      return (
        <span className="log-warning" key={`${segment}-${index}`}>
          {segment}
        </span>
      );
    }

    return <span key={`${segment}-${index}`}>{segment}</span>;
  });
}

export function LogLines({
  lines,
  dense = false,
  highlight = "",
}: {
  lines: string[];
  dense?: boolean;
  highlight?: string;
}): JSX.Element {
  const term = highlight.trim();

  return (
    <div className={`log-lines${dense ? " dense" : ""}`}>
      {lines.map((line, index) => {
        const time = line.slice(0, 8);
        const message = line.slice(9);
        const matched =
          term.length > 0 && line.toLowerCase().includes(term.toLowerCase());

        return (
          <div
            className={`log-line${matched ? " log-line-matched" : ""}`}
            key={`${line}-${index}`}
          >
            <span className="log-number">{index + 1}</span>
            <span className="log-time">{time}</span>
            <span className="log-message">{colorizeMessage(message)}</span>
          </div>
        );
      })}
    </div>
  );
}
