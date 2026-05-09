import { Clipboard, Eraser, FileUp } from "lucide-react";

type CompareSide = "A" | "B";

export function CompareInputPane({
  label,
  value,
  fileName,
  onChange,
  onImport,
  onClear,
  onPasteFromClipboard,
}: {
  label: CompareSide;
  value: string;
  fileName: string | null;
  onChange: (value: string) => void;
  onImport: () => void;
  onClear: () => void;
  onPasteFromClipboard: (value: string) => void;
}): JSX.Element {
  async function pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard?.readText();
      if (text !== undefined) {
        onPasteFromClipboard(text);
      }
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="compare-input-pane panel">
      <div className="compare-pane-actions">
        <div className="compare-pane-title">
          <span>{label}</span>
          <strong>{fileName ?? `Text ${label}`}</strong>
        </div>
        <div>
          <button
            className="icon-button secondary"
            type="button"
            aria-label={`Import ${label}`}
            title={`Import ${label}`}
            onClick={onImport}
          >
            <FileUp size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label={`Paste ${label}`}
            title={`Paste ${label}`}
            onClick={() => void pasteFromClipboard()}
          >
            <Clipboard size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label={`Clear ${label}`}
            title={`Clear ${label}`}
            onClick={onClear}
          >
            <Eraser size={15} />
          </button>
        </div>
      </div>
      <textarea
        value={value}
        aria-label={`Compare text ${label}`}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
