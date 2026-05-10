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
  const [leftReady, setLeftReady] = useState(false);
  const [rightReady, setRightReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const leftInputRef = useRef<HTMLInputElement>(null);
  const rightInputRef = useRef<HTMLInputElement>(null);
  const compareReady = leftReady && rightReady;
  const diffRows = useMemo(
    () => (compareReady ? buildSideBySideDiff(leftText, rightText) : []),
    [compareReady, leftText, rightText],
  );
  const changedRowCount = diffRows.filter((row) => row.kind !== "equal").length;
  const leftTitle = leftFileName ?? "A";
  const rightTitle = rightFileName ?? "B";
  const diffSummary = compareReady
    ? formatDiffSummary(diffRows.length, changedRowCount)
    : "";

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
        setLeftReady(true);
        return;
      }
      setRightText(value);
      setRightFileName(file.name);
      setRightReady(true);
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
            setLeftReady(value.length > 0);
          }}
          onImport={() => leftInputRef.current?.click()}
          onClear={() => {
            setLeftText("");
            setLeftFileName(null);
            setLeftReady(false);
          }}
          onPasteFromClipboard={(value) => {
            setLeftText(value);
            setLeftFileName(null);
            setLeftReady(value.length > 0);
          }}
        />
        <CompareInputPane
          label="B"
          value={rightText}
          fileName={rightFileName}
          onChange={(value) => {
            setRightText(value);
            setRightFileName(null);
            setRightReady(value.length > 0);
          }}
          onImport={() => rightInputRef.current?.click()}
          onClear={() => {
            setRightText("");
            setRightFileName(null);
            setRightReady(false);
          }}
          onPasteFromClipboard={(value) => {
            setRightText(value);
            setRightFileName(null);
            setRightReady(value.length > 0);
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
        ready={compareReady}
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
          ready={compareReady}
          className="compare-diff-expanded"
          expanded={expanded}
        />
      </Modal>
    </section>
  );
}
