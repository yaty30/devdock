import { Clipboard, Eraser, FileUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { defaultKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";

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
      <CompareTextEditor
        label={label}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

function CompareTextEditor({
  label,
  value,
  onChange,
}: {
  label: CompareSide;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: createCompareEditorExtensions((nextValue) => {
          onChangeRef.current(nextValue);
        }),
      }),
    });
    viewRef.current = editor;

    return () => {
      editor.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) {
      return;
    }

    const currentValue = editor.state.doc.toString();
    if (value !== currentValue) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      className="compare-text-editor"
      ref={hostRef}
      aria-label={`Compare text ${label}`}
    />
  );
}

function createCompareEditorExtensions(
  onChange: (value: string) => void,
): Extension[] {
  return [
    basicSetup,
    keymap.of(defaultKeymap),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        color: "var(--text)",
        backgroundColor: "var(--terminal-bg)",
        fontSize: "var(--database-code-font-size, 12px)",
      },
      ".cm-scroller": {
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        lineHeight: "1.55",
        overflow: "auto",
      },
      ".cm-content": {
        minWidth: "max-content",
        minHeight: "100%",
        padding: "11px 12px",
        whiteSpace: "pre",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-gutters": {
        color: "var(--muted)",
        backgroundColor:
          "color-mix(in srgb, var(--terminal-bg) 88%, var(--surface))",
        borderRightColor: "var(--terminal-border)",
      },
      ".cm-activeLineGutter, .cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--text)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
      },
    }),
  ];
}
