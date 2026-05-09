import { Maximize2 } from "lucide-react";
import type { DiffRow } from "./compareDiff";

export function CompareDiffTable({
  rows,
  leftTitle,
  rightTitle,
  summary,
  className = "",
  expanded,
  setExpanded,
}: {
  rows: DiffRow[];
  leftTitle: string;
  rightTitle: string;
  summary: string;
  className?: string;
  expanded: boolean;
  setExpanded?: (expanded: boolean) => void;
}): JSX.Element {
  return (
    <div
      className={`compare-diff${className ? ` ${className}` : ""}`}
      aria-label="Text comparison"
    >
      <div className="compare-result-titlebar">
        <div className="compare-result-title">
          <h2>Compare Results</h2>
          <span>{summary}</span>
        </div>
        {!expanded && (
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Expand comparison"
            title="Expand comparison"
            onClick={() => setExpanded?.(true)}
          >
            <Maximize2 size={15} />
          </button>
        )}
      </div>
      <div className="compare-diff-header">
        <span>{leftTitle}</span>
        <span>{rightTitle}</span>
      </div>
      <div className="compare-diff-table">
        {rows.length === 0 ? (
          <div className="compare-empty-row">
            Paste or import text to compare.
          </div>
        ) : (
          rows.map((row, rowIndex) => (
            <div
              className={`compare-diff-row ${row.kind}`}
              key={`${rowIndex}-${row.leftLineNumber ?? "x"}-${
                row.rightLineNumber ?? "x"
              }`}
            >
              <DiffCell
                side="left"
                lineNumber={row.leftLineNumber}
                text={row.leftText}
                empty={row.kind === "added"}
              />
              <DiffCell
                side="right"
                lineNumber={row.rightLineNumber}
                text={row.rightText}
                empty={row.kind === "removed"}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DiffCell({
  side,
  lineNumber,
  text,
  empty,
}: {
  side: "left" | "right";
  lineNumber?: number;
  text?: string;
  empty: boolean;
}): JSX.Element {
  return (
    <div className={`compare-diff-cell ${side}${empty ? " empty" : ""}`}>
      <span className="compare-line-number">{lineNumber ?? ""}</span>
      <pre>{text ?? ""}</pre>
    </div>
  );
}
