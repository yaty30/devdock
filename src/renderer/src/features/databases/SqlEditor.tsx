import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  autocompletion,
  acceptCompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentLess, indentMore } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  findNext,
  findPrevious,
  getSearchQuery,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
  type Panel as CodeMirrorPanel,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { FindControls } from "../../components/common/FindControls";
import type { DatabaseTable } from "../../types";
import type {
  DatabaseCompletionData,
  ExecutionTarget,
} from "./DatabaseWorkspace";

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--cm-sql-keyword)", fontWeight: "800" },
  { tag: tags.string, color: "var(--cm-sql-string)" },
  { tag: tags.number, color: "var(--cm-sql-number)" },
  { tag: tags.comment, color: "var(--cm-sql-comment)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--cm-sql-function)",
    fontWeight: "750",
  },
  { tag: tags.operator, color: "var(--cm-sql-operator)" },
  { tag: tags.atom, color: "var(--cm-sql-atom)" },
  { tag: tags.variableName, color: "var(--cm-sql-name)" },
]);

export const setExecutedSqlRange = StateEffect.define<ExecutionTarget | null>();

const executedSqlHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    let decorations = value.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setExecutedSqlRange)) {
        const target = effect.value;
        decorations = target
          ? Decoration.set([
              Decoration.mark({ class: "cm-executed-sql" }).range(
                target.from,
                target.to,
              ),
            ])
          : Decoration.none;
      }
    }

    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "INSERT",
  "UPDATE",
  "DELETE",
  "LIMIT",
  "OFFSET",
  "AND",
  "OR",
  "AS",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
];

export function SqlEditor({
  sheetId,
  value,
  onChange,
  onExecute,
  onSave,
  onNewSheet,
  onViewReady,
  completionData,
}: {
  sheetId: string;
  value: string;
  onChange: (value: string) => void;
  onExecute: (view: EditorView) => void;
  onSave: () => void;
  onNewSheet: () => void;
  onViewReady: (view: EditorView) => void;
  completionData: DatabaseCompletionData;
}): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const onSaveRef = useRef(onSave);
  const onNewSheetRef = useRef(onNewSheet);
  const completionDataRef = useRef(completionData);
  const activeSheetIdRef = useRef(sheetId);

  useEffect(() => {
    onChangeRef.current = onChange;
    onExecuteRef.current = onExecute;
    onSaveRef.current = onSave;
    onNewSheetRef.current = onNewSheet;
    completionDataRef.current = completionData;
  }, [completionData, onChange, onExecute, onNewSheet, onSave]);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) {
      return undefined;
    }

    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: createSqlEditorExtensions(
          () => completionDataRef.current,
          (nextValue) => {
            onChangeRef.current(nextValue);
          },
          (view) => onExecuteRef.current(view),
          () => onSaveRef.current(),
          () => onNewSheetRef.current(),
        ),
      }),
    });

    viewRef.current = editor;
    onViewReady(editor);

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
    const sheetChanged = activeSheetIdRef.current !== sheetId;

    if (sheetChanged || value !== currentValue) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        effects: sheetChanged ? setExecutedSqlRange.of(null) : undefined,
      });
    }

    activeSheetIdRef.current = sheetId;
  }, [sheetId, value]);

  return (
    <div
      className="database-sql-editor-shell"
      ref={editorHostRef}
      aria-label="SQL editor"
    />
  );
}

function createSqlEditorExtensions(
  getCompletionData: () => DatabaseCompletionData,
  onChange: (value: string) => void,
  onExecute: (view: EditorView) => void,
  onSave: () => void,
  onNewSheet: () => void,
): Extension[] {
  return [
    basicSetup,
    sql(),
    syntaxHighlighting(sqlHighlightStyle),
    executedSqlHighlightField,
    search({
      top: true,
      createPanel: createSqlFindPanel,
    }),
    EditorState.transactionExtender.of((transaction) =>
      transaction.docChanged ? { effects: setExecutedSqlRange.of(null) } : null,
    ),
    EditorView.domEventHandlers({
      focus(_event, view) {
        view.dispatch({ effects: setExecutedSqlRange.of(null) });
        return false;
      },
      mousedown(_event, view) {
        view.dispatch({ effects: setExecutedSqlRange.of(null) });
        return false;
      },
    }),
    autocompletion({
      activateOnTyping: true,
      override: [
        (context) => sqlCompletionSource(context, getCompletionData()),
      ],
    }),
    Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run() {
            onSave();
            return true;
          },
        },
        {
          key: "Ctrl-s",
          run() {
            onSave();
            return true;
          },
        },
        {
          key: "Mod-n",
          run() {
            onNewSheet();
            return true;
          },
        },
        {
          key: "Ctrl-n",
          run() {
            onNewSheet();
            return true;
          },
        },
        {
          key: "Ctrl-Enter",
          run(view) {
            onExecute(view);
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run(view) {
            onExecute(view);
            return true;
          },
        },
        {
          key: "Tab",
          run(view) {
            if (completionStatus(view.state) === "active") {
              return acceptCompletion(view);
            }
            return indentMore(view);
          },
        },
        {
          key: "Shift-Tab",
          run(view) {
            return indentLess(view);
          },
        },
        ...defaultKeymap,
      ]),
    ),
    EditorView.lineWrapping,
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
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "14px 15px",
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
      ".cm-tooltip": {
        color: "var(--text)",
        backgroundColor: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow)",
      },
    }),
  ];
}

function createSqlFindPanel(view: EditorView): CodeMirrorPanel {
  const dom = document.createElement("div");
  let root: Root | null = createRoot(dom);
  dom.className = "cm-search database-sql-find-panel";

  const render = (): void => {
    if (!root) {
      return;
    }

    const findState = getSqlFindState(view);
    flushSync(() => {
      root?.render(
        <FindControls
          value={findState.value}
          activeIndex={findState.activeIndex}
          matchCount={findState.matchCount}
          ariaLabel="Find SQL"
          className="log-find-row database-sql-find-row"
          inputRef={(input) => {
            input?.setAttribute("main-field", "true");
          }}
          onChange={(nextValue) => {
            const currentQuery = getSearchQuery(view.state);
            view.dispatch({
              effects: setSearchQuery.of(
                new SearchQuery({
                  search: nextValue,
                  caseSensitive: currentQuery.caseSensitive,
                  literal: currentQuery.literal,
                  regexp: currentQuery.regexp,
                  replace: currentQuery.replace,
                  wholeWord: currentQuery.wholeWord,
                  test: currentQuery.test,
                }),
              ),
            });
            render();
          }}
          onPrevious={() => {
            findPrevious(view);
            render();
          }}
          onNext={() => {
            findNext(view);
            render();
          }}
          onClear={() => {
            const currentQuery = getSearchQuery(view.state);
            view.dispatch({
              effects: setSearchQuery.of(
                new SearchQuery({
                  search: "",
                  caseSensitive: currentQuery.caseSensitive,
                  literal: currentQuery.literal,
                  regexp: currentQuery.regexp,
                  replace: currentQuery.replace,
                  wholeWord: currentQuery.wholeWord,
                  test: currentQuery.test,
                }),
              ),
            });
            render();
          }}
        />,
      );
    });
  };

  render();

  return {
    dom,
    top: true,
    update() {
      render();
    },
    destroy() {
      root?.unmount();
      root = null;
    },
  };
}

function getSqlFindState(view: EditorView): {
  value: string;
  activeIndex: number;
  matchCount: number;
} {
  const query = getSearchQuery(view.state);

  if (!query.search || !query.valid) {
    return { value: query.search, activeIndex: 0, matchCount: 0 };
  }

  const selection = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let matchCount = 0;
  let activeIndex = 0;
  let exactSelectionMatch = false;

  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const { from, to } = next.value;

    if (from === selection.from && to === selection.to) {
      activeIndex = matchCount;
      exactSelectionMatch = true;
    } else if (
      !exactSelectionMatch &&
      (from < selection.from || (from === selection.from && to < selection.to))
    ) {
      activeIndex = matchCount;
    }

    matchCount += 1;
  }

  return {
    value: query.search,
    activeIndex: matchCount === 0 ? 0 : Math.min(activeIndex, matchCount - 1),
    matchCount,
  };
}

export function getExecutionTarget(state: EditorState): ExecutionTarget | null {
  const sqlText = state.doc.toString();
  const selection = state.selection.main;

  if (!selection.empty) {
    const selectedSql = sqlText.slice(selection.from, selection.to);
    return selectedSql.trim()
      ? { sql: selectedSql, from: selection.from, to: selection.to }
      : null;
  }

  if (!sqlText.includes(";")) {
    return trimExecutionRange(sqlText, 0, sqlText.length);
  }

  const cursor = selection.head;
  let statementStart = 0;
  let previousTarget: ExecutionTarget | null = null;

  for (let index = 0; index <= sqlText.length; index += 1) {
    const atStatementEnd = index === sqlText.length || sqlText[index] === ";";
    if (!atStatementEnd) {
      continue;
    }

    const currentTarget = trimExecutionRange(sqlText, statementStart, index);
    if (!currentTarget) {
      statementStart = index + 1;
      continue;
    }

    if (cursor < currentTarget.from) {
      return previousTarget ?? currentTarget;
    }

    if (cursor <= index + 1) {
      return currentTarget;
    }

    previousTarget = currentTarget;
    statementStart = index + 1;
  }

  return previousTarget;
}

function trimExecutionRange(
  sqlText: string,
  rawFrom: number,
  rawTo: number,
): ExecutionTarget | null {
  let from = rawFrom;
  let to = rawTo;

  while (from < to && /\s/.test(sqlText[from])) {
    from += 1;
  }

  while (to > from && /\s/.test(sqlText[to - 1])) {
    to -= 1;
  }

  if (from >= to) {
    return null;
  }

  return { sql: sqlText.slice(from, to), from, to };
}

export function createDatabaseCompletionData(
  tables: DatabaseTable[],
): DatabaseCompletionData {
  const columns = Array.from(
    new Set(
      tables.flatMap((table) => table.columns.map((column) => column.name)),
    ),
  ).sort();

  return {
    keywords: SQL_KEYWORDS,
    tables: Array.from(
      new Set(tables.flatMap((table) => [table.name, formatObjectName(table)])),
    ).sort(),
    columns,
  };
}

function sqlCompletionSource(
  context: CompletionContext,
  data: DatabaseCompletionData,
): CompletionResult | null {
  const word = context.matchBefore(/[\w.]+/);
  const typedLength = word ? context.pos - word.from : 0;

  if (!word || typedLength < 2) {
    return null;
  }

  const beforeCursor = context.state.doc
    .sliceString(Math.max(0, context.pos - 160), context.pos)
    .toLowerCase();
  const contextKind = detectSqlCompletionContext(beforeCursor);
  const options = buildSqlCompletionOptions(data, contextKind);

  return {
    from: word.from,
    options,
    validFor: /^[\w.]*$/,
  };
}

function detectSqlCompletionContext(
  textBeforeCursor: string,
): "table" | "column" | "keyword" {
  if (/\b(from|join)\s+[\w.]*$/.test(textBeforeCursor)) {
    return "table";
  }

  if (
    /\b(select|where|order\s+by|group\s+by|having|on)\b[\s\S]*$/.test(
      textBeforeCursor,
    )
  ) {
    return "column";
  }

  return "keyword";
}

function buildSqlCompletionOptions(
  data: DatabaseCompletionData,
  contextKind: "table" | "column" | "keyword",
): Completion[] {
  const keywordOptions = data.keywords.map((label) => ({
    label,
    type: "keyword",
    boost: contextKind === "keyword" ? 80 : 10,
  }));
  const tableOptions = data.tables.map((label) => ({
    label,
    type: "class",
    boost: contextKind === "table" ? 100 : 25,
  }));
  const columnOptions = data.columns.map((label) => ({
    label,
    type: "property",
    boost: contextKind === "column" ? 100 : 20,
  }));

  if (contextKind === "table") {
    return [...tableOptions, ...keywordOptions, ...columnOptions];
  }

  if (contextKind === "column") {
    return [...columnOptions, ...keywordOptions, ...tableOptions];
  }

  return [...keywordOptions, ...tableOptions, ...columnOptions];
}

function formatObjectName(table: DatabaseTable): string {
  return table.name;
}
