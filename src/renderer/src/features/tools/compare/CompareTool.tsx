import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Modal } from "../../../components/dialogs/Modal";
import { CompareDiffTable } from "./CompareDiffTable";
import { CompareInputPane } from "./CompareInputPane";
import { buildSideBySideDiff, formatDiffSummary } from "./compareDiff";

export function CompareTool(): JSX.Element {
  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  const [leftFileName, setLeftFileName] = useState<string | null>(null);
  const [rightFileName, setRightFileName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const leftInputRef = useRef<HTMLInputElement>(null);
  const rightInputRef = useRef<HTMLInputElement>(null);
  const diffRows = useMemo(
    () => buildSideBySideDiff(leftText, rightText),
    [leftText, rightText],
  );
  const changedRowCount = diffRows.filter((row) => row.kind !== "equal").length;
  const leftTitle = leftFileName ?? "A";
  const rightTitle = rightFileName ?? "B";
  const diffSummary = formatDiffSummary(diffRows.length, changedRowCount);

  function importFile(
    event: ChangeEvent<HTMLInputElement>,
    side: "left" | "right",
  ): void {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (side === "left") {
        setLeftText(value);
        setLeftFileName(file.name);
        return;
      }
      setRightText(value);
      setRightFileName(file.name);
    };
    reader.readAsText(file);
  }

  return (
    <section className="tools-screen compare-tool-screen">
      <div className="compare-input-grid">
        <CompareInputPane
          label="A"
          value={leftText}
          fileName={leftFileName}
          onChange={(value) => {
            setLeftText(value);
            setLeftFileName(null);
          }}
          onImport={() => leftInputRef.current?.click()}
          onClear={() => {
            setLeftText("");
            setLeftFileName(null);
          }}
          onPasteFromClipboard={(value) => {
            setLeftText(value);
            setLeftFileName(null);
          }}
        />
        <CompareInputPane
          label="B"
          value={rightText}
          fileName={rightFileName}
          onChange={(value) => {
            setRightText(value);
            setRightFileName(null);
          }}
          onImport={() => rightInputRef.current?.click()}
          onClear={() => {
            setRightText("");
            setRightFileName(null);
          }}
          onPasteFromClipboard={(value) => {
            setRightText(value);
            setRightFileName(null);
          }}
        />
        <input
          ref={leftInputRef}
          className="compare-file-input"
          type="file"
          onChange={(event) => importFile(event, "left")}
        />
        <input
          ref={rightInputRef}
          className="compare-file-input"
          type="file"
          onChange={(event) => importFile(event, "right")}
        />
      </div>

      <CompareDiffTable
        rows={diffRows}
        leftTitle={leftTitle}
        rightTitle={rightTitle}
        summary={diffSummary}
        className="panel"
        expanded={expanded}
        setExpanded={setExpanded}
      />

      <Modal
        open={expanded}
        title="Comparing"
        subtitle={`${leftTitle} vs ${rightTitle}`}
        size="xl"
        className="compare-expanded-modal"
        contentClassName="compare-expanded-content"
        closeLabel="Close expanded comparison"
        onClose={() => setExpanded(false)}
      >
        <CompareDiffTable
          rows={diffRows}
          leftTitle={leftTitle}
          rightTitle={rightTitle}
          summary={diffSummary}
          className="compare-diff-expanded"
          expanded={expanded}
        />
      </Modal>
    </section>
  );
}
