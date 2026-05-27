import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
  type UIEvent,
} from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  Bold,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Palette,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { FindControls } from "../../components/common/FindControls";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Modal } from "../../components/dialogs/Modal";
import type { Sheet, SheetContentJson, SheetUpdate } from "../../types";

export type NotesView = "grid" | "list";
type SaveStatus = "saved" | "saving" | "unsaved" | "failed";
type FindRange = { from: number; to: number };
type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
};
type TiptapMark = { type?: string; attrs?: Record<string, unknown> };
type StaticRenderContext = {
  query: string;
  activeIndex: number;
  matchIndex: number;
  matchRefs?: MutableRefObject<(HTMLElement | null)[]>;
};

const AUTO_SAVE_DELAY_MS = 750;
const PIN_LIMIT = 3;
const PIN_LIMIT_MESSAGE =
  "You can pin up to 3 notes. Unpin one note before pinning another.";
const INITIAL_VISIBLE_NOTES = 18;
const VISIBLE_NOTE_INCREMENT = 12;
const DEFAULT_TEXT_COLOR = "#f9fafb";
const EMPTY_CONTENT: SheetContentJson = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
const noteFindPluginKey = new PluginKey("noteFindHighlight");

const NoteFindHighlight = Extension.create({
  name: "noteFindHighlight",

  addStorage() {
    return {
      query: "",
      activeIndex: 0,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: noteFindPluginKey,
        props: {
          decorations: (state) => {
            const storage = (
              this.editor.storage as unknown as Record<
                string,
                { query: string; activeIndex: number }
              >
            ).noteFindHighlight;
            const ranges = findTextRanges(state.doc, storage.query);
            if (ranges.length === 0) {
              return DecorationSet.empty;
            }

            return DecorationSet.create(
              state.doc,
              ranges.map((range, index) =>
                Decoration.inline(range.from, range.to, {
                  class:
                    index === storage.activeIndex
                      ? "note-find-match active"
                      : "note-find-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

export function NotesTab({
  projectId,
  view,
  addNoteRequestId,
  onFeedback,
}: {
  projectId: string;
  view: NotesView;
  addNoteRequestId: number;
  onFeedback?: (message: string) => void;
}): JSX.Element {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDialogKey, setAddDialogKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Sheet | null>(null);
  const [expandedSheetId, setExpandedSheetId] = useState<string | null>(null);
  const [expandedEditEnabled, setExpandedEditEnabled] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_NOTES);
  const [drafts, setDrafts] = useState<Record<string, SheetContentJson>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>(
    {},
  );
  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const draftRevisionRef = useRef<Map<string, number>>(new Map());
  const frozenPreviewRef = useRef<{
    sheetId: string;
    contentJson: SheetContentJson;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setVisibleCount(INITIAL_VISIBLE_NOTES);
    setDrafts({});
    dirtyIdsRef.current = new Set();
    setDirtyIds(new Set(dirtyIdsRef.current));
    setSaveStatuses({});
    setExpandedSheetId(null);
    setExpandedEditEnabled(false);
    frozenPreviewRef.current = null;
    draftRevisionRef.current.clear();
    clearAllSaveTimers(saveTimersRef.current);

    window.ivsDashboard
      .getSheets(projectId)
      .then((loadedSheets) => {
        if (cancelled) return;
        setSheets(loadedSheets);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Notes could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      clearAllSaveTimers(saveTimersRef.current);
    };
  }, [projectId]);

  useEffect(() => {
    if (addNoteRequestId > 0) {
      setAddDialogKey((k) => k + 1);
      setAddOpen(true);
    }
  }, [addNoteRequestId]);

  const expandedSheet = expandedSheetId
    ? (sheets.find((sheet) => sheet.id === expandedSheetId) ?? null)
    : null;
  const visibleSheets = sheets.slice(0, visibleCount);

  function sheetContent(sheet: Sheet): SheetContentJson {
    return drafts[sheet.id] ?? sheet.contentJson ?? EMPTY_CONTENT;
  }

  function previewContent(sheet: Sheet): SheetContentJson {
    const frozenPreview = frozenPreviewRef.current;
    if (frozenPreview?.sheetId === sheet.id) {
      return frozenPreview.contentJson;
    }
    return sheetContent(sheet);
  }

  function setSheetStatus(sheetId: string, status: SaveStatus): void {
    setSaveStatuses((current) => ({ ...current, [sheetId]: status }));
  }

  function openNote(sheetId: string): void {
    const sheet = sheets.find((item) => item.id === sheetId);
    frozenPreviewRef.current = sheet
      ? { sheetId, contentJson: sheetContent(sheet) }
      : null;
    setExpandedSheetId(sheetId);
    setExpandedEditEnabled(false);
  }

  function closeExpandedNote(): void {
    frozenPreviewRef.current = null;
    setExpandedSheetId(null);
    setExpandedEditEnabled(false);
  }

  function markSheetDirty(
    sheetId: string,
    contentJson: SheetContentJson,
  ): void {
    draftRevisionRef.current.set(
      sheetId,
      (draftRevisionRef.current.get(sheetId) ?? 0) + 1,
    );
    setDrafts((current) => ({ ...current, [sheetId]: contentJson }));
    dirtyIdsRef.current.add(sheetId);
    setDirtyIds(new Set(dirtyIdsRef.current));
    setSheetStatus(sheetId, "unsaved");
  }

  function queueAutoSave(sheet: Sheet, contentJson: SheetContentJson): void {
    const existingTimer = saveTimersRef.current.get(sheet.id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(sheet.id);
      void saveSheet(sheet.id, { contentJson });
    }, AUTO_SAVE_DELAY_MS);
    saveTimersRef.current.set(sheet.id, timer);
  }

  function handleContentChange(
    sheet: Sheet,
    contentJson: SheetContentJson,
  ): void {
    if (!expandedEditEnabled) return;
    markSheetDirty(sheet.id, contentJson);
    if (sheet.autoSaveEnabled) {
      queueAutoSave(sheet, contentJson);
    }
  }

  async function saveSheet(
    sheetId: string,
    updates: SheetUpdate = {},
  ): Promise<Sheet | null> {
    const savedContent = updates.contentJson !== undefined;
    const revisionAtSave = draftRevisionRef.current.get(sheetId) ?? 0;
    if (savedContent) {
      const timer = saveTimersRef.current.get(sheetId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        saveTimersRef.current.delete(sheetId);
      }
    }

    setSheetStatus(sheetId, "saving");
    try {
      const saved = await window.ivsDashboard.updateSheet(
        projectId,
        sheetId,
        updates,
      );
      setSheets((current) =>
        sortSheets(
          current.map((sheet) => (sheet.id === sheetId ? saved : sheet)),
        ),
      );

      const currentRevision = draftRevisionRef.current.get(sheetId) ?? 0;
      if (savedContent && currentRevision === revisionAtSave) {
        dirtyIdsRef.current.delete(sheetId);
        setDirtyIds(new Set(dirtyIdsRef.current));
        setDrafts((current) => {
          const next = { ...current };
          delete next[sheetId];
          return next;
        });
        setSheetStatus(sheetId, "saved");
      } else {
        setSheetStatus(
          sheetId,
          dirtyIdsRef.current.has(sheetId) ? "unsaved" : "saved",
        );
      }

      return saved;
    } catch (error) {
      console.error(error);
      setSheetStatus(sheetId, "failed");
      return null;
    }
  }

  async function handleToggleAutoSave(sheet: Sheet): Promise<void> {
    const nextAutoSaveEnabled = !sheet.autoSaveEnabled;
    if (!nextAutoSaveEnabled) {
      const timer = saveTimersRef.current.get(sheet.id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        saveTimersRef.current.delete(sheet.id);
      }
    }

    const saved = await saveSheet(sheet.id, {
      autoSaveEnabled: nextAutoSaveEnabled,
    });
    if (
      saved?.autoSaveEnabled &&
      expandedEditEnabled &&
      dirtyIdsRef.current.has(sheet.id)
    ) {
      queueAutoSave(saved, sheetContent(saved));
    }
  }

  async function handleTogglePin(sheet: Sheet): Promise<void> {
    const nextPinned = !sheet.pinned;
    if (
      nextPinned &&
      sheets.filter((item) => item.pinned && item.id !== sheet.id).length >=
        PIN_LIMIT
    ) {
      onFeedback?.(PIN_LIMIT_MESSAGE);
      return;
    }

    const saved = await saveSheet(sheet.id, {
      pinned: nextPinned,
      pinnedAt: nextPinned ? new Date().toISOString() : null,
    });
    if (!saved?.pinned && nextPinned) {
      onFeedback?.(PIN_LIMIT_MESSAGE);
    }
  }

  async function handleCreateNote(title: string): Promise<boolean> {
    try {
      const created = await window.ivsDashboard.createSheet(projectId, title);
      setSheets((current) => sortSheets([created, ...current]));
      setSaveStatuses((current) => ({ ...current, [created.id]: "saved" }));
      setAddOpen(false);
      openNote(created.id);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async function handleDeleteNote(sheet: Sheet): Promise<void> {
    try {
      await window.ivsDashboard.deleteSheet(projectId, sheet.id);
      const timer = saveTimersRef.current.get(sheet.id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        saveTimersRef.current.delete(sheet.id);
      }
      setSheets((current) => current.filter((item) => item.id !== sheet.id));
      dirtyIdsRef.current.delete(sheet.id);
      setDirtyIds(new Set(dirtyIdsRef.current));
      setDrafts((current) => {
        const next = { ...current };
        delete next[sheet.id];
        return next;
      });
      setSaveStatuses((current) => {
        const next = { ...current };
        delete next[sheet.id];
        return next;
      });
      if (expandedSheetId === sheet.id) {
        closeExpandedNote();
      }
    } catch (error) {
      console.error(error);
      setSheetStatus(sheet.id, "failed");
    }
  }

  function handleGridScroll(event: UIEvent<HTMLDivElement>): void {
    const target = event.currentTarget;
    const remaining =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining < 240 && visibleCount < sheets.length) {
      setVisibleCount((current) =>
        Math.min(sheets.length, current + VISIBLE_NOTE_INCREMENT),
      );
    }
  }

  return (
    <section className="notes-screen">
      {loading ? (
        <div className="notes-loading panel" aria-live="polite">
          <span className="notes-spinner" />
        </div>
      ) : loadError ? (
        <div className="notes-empty panel" role="alert">
          <h2>Notes unavailable</h2>
          <p>{loadError}</p>
        </div>
      ) : sheets.length === 0 ? (
        <div className="notes-empty panel">
          <h2>No Notes yet</h2>
          <p>Create the first Note for this project.</p>
          <button
            className="button primary compact"
            type="button"
            onClick={() => { setAddDialogKey((k) => k + 1); setAddOpen(true); }}
          >
            <Plus size={14} />
            Add Note
          </button>
        </div>
      ) : view === "grid" ? (
        <div className="notes-grid-scroll" onScroll={handleGridScroll}>
          <div className="notes-grid">
            {visibleSheets.map((sheet) => (
              <NotePreviewCard
                key={sheet.id}
                sheet={sheet}
                contentJson={previewContent(sheet)}
                onOpen={() => openNote(sheet.id)}
                onTogglePin={() => void handleTogglePin(sheet)}
                onDelete={() => setDeleteTarget(sheet)}
              />
            ))}
          </div>
        </div>
      ) : (
        <NoteListView
          sheets={sheets}
          dirtyIds={dirtyIds}
          saveStatuses={saveStatuses}
          getContent={previewContent}
          onOpen={(sheet) => openNote(sheet.id)}
          onTogglePin={(sheet) => void handleTogglePin(sheet)}
          onDelete={setDeleteTarget}
        />
      )}

      <AddNoteModal
        key={addDialogKey}
        open={addOpen}
        existingTitles={sheets.map((sheet) => sheet.title)}
        onCreate={handleCreateNote}
        onClose={() => setAddOpen(false)}
      />

      <Modal
        open={expandedSheet !== null}
        title={expandedSheet?.title ?? ""}
        subtitle={
          expandedSheet
            ? `Last updated: ${formatUpdatedAt(expandedSheet.updatedAt)}`
            : undefined
        }
        size="xl"
        className="notes-expanded-modal"
        contentClassName="notes-expanded-content"
        headerAction={
          expandedSheet ? (
            <ExpandedNoteHeaderActions
              sheet={expandedSheet}
              editEnabled={expandedEditEnabled}
              onToggleAutoSave={() => void handleToggleAutoSave(expandedSheet)}
              onToggleEdit={() => setExpandedEditEnabled((current) => !current)}
              onTogglePin={() => void handleTogglePin(expandedSheet)}
              onDelete={() => setDeleteTarget(expandedSheet)}
            />
          ) : null
        }
        closeLabel="Close note"
        onClose={closeExpandedNote}
      >
        {expandedSheet ? (
          <ExpandedNoteEditor
            sheet={expandedSheet}
            contentJson={sheetContent(expandedSheet)}
            saveStatus={
              saveStatuses[expandedSheet.id] ??
              (dirtyIds.has(expandedSheet.id) ? "unsaved" : "saved")
            }
            dirty={dirtyIds.has(expandedSheet.id)}
            editEnabled={expandedEditEnabled}
            onContentChange={(contentJson) =>
              handleContentChange(expandedSheet, contentJson)
            }
            onManualSave={() =>
              void saveSheet(expandedSheet.id, {
                contentJson: sheetContent(expandedSheet),
              })
            }
            onExitEditMode={() => setExpandedEditEnabled(false)}
          />
        ) : null}
      </Modal>

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete Note"
          message={
            <>
              Note <strong>{deleteTarget.title}</strong> and its content will be
              permanently deleted.
            </>
          }
          confirmLabel="Delete Note"
          cancelLabel="Cancel"
          variant="danger"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void handleDeleteNote(deleteTarget)}
        />
      ) : null}
    </section>
  );
}

function NotePreviewCard({
  sheet,
  contentJson,
  onOpen,
  onTogglePin,
  onDelete,
}: {
  sheet: Sheet;
  contentJson: SheetContentJson;
  onOpen: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}): JSX.Element {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <article
      className="note-preview-card"
      role="button"
      tabIndex={0}
      aria-label={`Open ${sheet.title}`}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <header className="note-preview-header">
        <h2>{sheet.title}</h2>
        <div className="note-preview-actions">
          <PinButton pinned={sheet.pinned} onClick={onTogglePin} />
          <button
            className="sheet-icon-button danger"
            type="button"
            aria-label={`Delete ${sheet.title}`}
            title="Delete Note"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      <StaticNoteContent
        className="note-preview-content"
        contentJson={contentJson}
        emptyLabel="Empty note"
      />
    </article>
  );
}

function ExpandedNoteHeaderActions({
  sheet,
  editEnabled,
  onToggleAutoSave,
  onToggleEdit,
  onTogglePin,
  onDelete,
}: {
  sheet: Sheet;
  editEnabled: boolean;
  onToggleAutoSave: () => void;
  onToggleEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div className="note-modal-header-actions">
      <button
        className={`sheet-icon-button autosave${sheet.autoSaveEnabled ? " active" : ""}`}
        type="button"
        aria-label={sheet.autoSaveEnabled ? "Auto-save on" : "Auto-save off"}
        title={sheet.autoSaveEnabled ? "Auto-save on" : "Auto-save off"}
        onClick={onToggleAutoSave}
      >
        {sheet.autoSaveEnabled ? (
          <AutoSaveOnIcon size={18} />
        ) : (
          <AutoSaveOffIcon size={18} />
        )}
      </button>
      <button
        className={`sheet-icon-button edit${editEnabled ? " active" : ""}`}
        type="button"
        aria-label={editEnabled ? "Edit mode on" : "Edit note"}
        title={editEnabled ? "Edit mode on" : "Edit note"}
        aria-pressed={editEnabled}
        onClick={onToggleEdit}
      >
        <EditIcon size={18} />
      </button>
      <PinButton pinned={sheet.pinned} onClick={onTogglePin} />
      <button
        className="sheet-icon-button danger"
        type="button"
        aria-label="Delete Note"
        title="Delete Note"
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

type LinkDialogState = { initialUrl: string; initialLabel: string };

function LinkDialog({
  initialUrl,
  initialLabel,
  onConfirm,
  onClose,
}: {
  initialUrl: string;
  initialLabel: string;
  onConfirm: (url: string, label: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [url, setUrl] = useState(initialUrl);
  const [label, setLabel] = useState(initialLabel);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null)
        window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  function closeDialog(): void {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 170);
  }

  function handleSubmit(): void {
    onConfirm(url, label);
    closeDialog();
  }

  return (
    <div
      className={`dialog-backdrop${isClosing ? " closing" : ""}`}
      role="presentation"
      onClick={closeDialog}
    >
      <section
        className={`add-project-dialog${isClosing ? " closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleSubmit();
          }
        }}
      >
        <h2 id="link-dialog-title">Insert Link</h2>
        <div className="add-project-fields">
          <label>
            <span>Label</span>
            <input
              autoFocus
              type="text"
              value={label}
              placeholder="Link text"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            <span>URL or file path</span>
            <input
              type="text"
              value={url}
              placeholder="https:// or C:\path\to\file"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button
            className="button primary compact"
            type="button"
            onClick={handleSubmit}
            disabled={!url.trim()}
          >
            Apply
          </button>
          <button
            className="button secondary compact"
            type="button"
            onClick={closeDialog}
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function ExpandedNoteEditor({
  sheet,
  contentJson,
  saveStatus,
  dirty,
  editEnabled,
  onContentChange,
  onManualSave,
  onExitEditMode,
}: {
  sheet: Sheet;
  contentJson: SheetContentJson;
  saveStatus: SaveStatus;
  dirty: boolean;
  editEnabled: boolean;
  onContentChange: (contentJson: SheetContentJson) => void;
  onManualSave: () => void;
  onExitEditMode: () => void;
}): JSX.Element {
  const [findTerm, setFindTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [linkDialog, setLinkDialog] = useState<LinkDialogState | null>(null);
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const contentSignature = useMemo(
    () => JSON.stringify(contentJson),
    [contentJson],
  );
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      Placeholder.configure({ placeholder: "Start typing..." }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ["file"],
        isAllowedUri: (url, { defaultValidate }) =>
          isLocalHref(url) || defaultValidate(url),
      }),
      CharacterCount,
      Highlight.configure({ multicolor: true }),
      NoteFindHighlight,
    ],
    content: contentJson as JSONContent,
    editable: editEnabled,
    editorProps: {
      attributes: {
        class: "note-editor-prosemirror",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      onContentChange(activeEditor.getJSON() as SheetContentJson);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editEnabled);
  }, [editEnabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const currentSignature = JSON.stringify(editor.getJSON());
    if (currentSignature !== contentSignature) {
      editor.commands.setContent(contentJson as JSONContent, {
        emitUpdate: false,
      });
    }
  }, [contentJson, contentSignature, editor]);

  const trimmedFindTerm = findTerm.trim();
  const staticTextContent = textFromContentJson(contentJson);
  const editorMatches = editor
    ? findTextRanges(editor.state.doc, trimmedFindTerm)
    : [];
  const matchCount = editEnabled
    ? editorMatches.length
    : countMatches(staticTextContent, trimmedFindTerm);
  const textContent = editor?.getText() ?? staticTextContent;
  const characterCount =
    editor?.storage.characterCount?.characters?.() ?? textContent.length;
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [trimmedFindTerm, editEnabled]);

  useEffect(() => {
    if (activeMatchIndex >= matchCount) {
      setActiveMatchIndex(matchCount > 0 ? matchCount - 1 : 0);
    }
  }, [activeMatchIndex, matchCount]);

  useEffect(() => {
    if (!editor) return;
    const storage = (
      editor.storage as unknown as Record<
        string,
        { query: string; activeIndex: number }
      >
    ).noteFindHighlight;
    storage.query = editEnabled ? trimmedFindTerm : "";
    storage.activeIndex = activeMatchIndex;
    editor.view.dispatch(
      editor.state.tr.setMeta(noteFindPluginKey, {
        query: storage.query,
        activeIndex: storage.activeIndex,
      }),
    );
  }, [activeMatchIndex, editEnabled, editor, trimmedFindTerm]);

  // Capture-phase Escape handler: intercept before Modal's document listener.
  // Priority: close link dialog → exit edit mode → let Modal close.
  useEffect(() => {
    if (!editEnabled && linkDialog === null) return undefined;

    function handleEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;

      if (linkDialog !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setLinkDialog(null);
        return;
      }

      if (editEnabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onExitEditMode();
      }
    }

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [editEnabled, linkDialog, onExitEditMode]);

  function preserveSelection(): void {
    if (!editor) return;
    savedSelectionRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
  }

  function runEditorCommand(
    event: ReactMouseEvent<HTMLButtonElement>,
    command: () => void,
  ): void {
    event.preventDefault();
    if (!editor || !editEnabled) return;
    command();
  }

  function restoreSelection(): void {
    if (!editor || !savedSelectionRef.current) return;
    const { from, to } = savedSelectionRef.current;
    const maxPosition = editor.state.doc.content.size;
    editor.commands.setTextSelection({
      from: Math.min(from, maxPosition),
      to: Math.min(to, maxPosition),
    });
  }

  function setLink(event: ReactMouseEvent<HTMLButtonElement>): void {
    runEditorCommand(event, () => {
      if (!editor) return;
      restoreSelection();
      const currentHref = editor.getAttributes("link").href as
        | string
        | undefined;
      if (currentHref) {
        editor.chain().focus().extendMarkRange("link").run();
      }
      const { from, to } = editor.state.selection;
      const selectedText =
        from !== to ? editor.state.doc.textBetween(from, to) : "";
      savedSelectionRef.current = { from, to };
      setLinkDialog({
        initialUrl: currentHref ?? "",
        initialLabel: selectedText,
      });
    });
  }

  function applyLink(url: string, label: string): void {
    if (!editor) return;
    restoreSelection();
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = normalizeHref(url);
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const initialLabel = linkDialog?.initialLabel ?? "";
    const nextLabel = label.trim() || (!hasSelection ? href : "");
    if (nextLabel && (!hasSelection || nextLabel !== initialLabel)) {
      const chain = editor.chain().focus();
      if (hasSelection) {
        chain.deleteSelection();
      }
      chain
        .insertContent({
          type: "text",
          text: nextLabel,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  }

  function handleEditorLinkClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    openLink(href);
  }

  function applyTextColor(nextColor: string): void {
    setTextColor(nextColor);
    if (!editor || !editEnabled) return;
    restoreSelection();
    editor.chain().focus().setColor(nextColor).run();
  }

  function focusEditorSurface(
    event: ReactMouseEvent<HTMLDivElement, MouseEvent>,
  ): void {
    if (!editor || !editEnabled) return;
    const target = event.target as HTMLElement;
    if (target === event.currentTarget || target.classList.contains("tiptap")) {
      editor.commands.focus("end");
    }
  }

  function focusEditorMatch(matchIndex: number): void {
    if (!editor) return;
    const ranges = findTextRanges(editor.state.doc, trimmedFindTerm);
    const range = ranges[matchIndex];
    if (!range) return;
    const transaction = editor.state.tr
      .setSelection(
        TextSelection.create(editor.state.doc, range.from, range.to),
      )
      .scrollIntoView();
    editor.view.dispatch(transaction);
    editor.view.focus();
  }

  function navigateFind(direction: -1 | 1): void {
    if (matchCount === 0) return;
    const nextIndex =
      direction === 1
        ? (activeMatchIndex + 1) % matchCount
        : (activeMatchIndex - 1 + matchCount) % matchCount;
    setActiveMatchIndex(nextIndex);
    if (editEnabled) {
      focusEditorMatch(nextIndex);
    }
  }

  function clearFind(): void {
    setFindTerm("");
    setActiveMatchIndex(0);
  }

  return (
    <article className="note-expanded-editor">
      <FindControls
        value={findTerm}
        activeIndex={activeMatchIndex}
        matchCount={matchCount}
        ariaLabel={`Find in ${sheet.title}`}
        className="sheet-find-row note-editor-find-row"
        onChange={setFindTerm}
        onPrevious={() => navigateFind(-1)}
        onNext={() => navigateFind(1)}
        onClear={clearFind}
      />

      {editEnabled ? (
        <>
          <div
            className="sheet-format-toolbar"
            aria-label={`${sheet.title} formatting`}
            onMouseDownCapture={preserveSelection}
          >
            <button
              className={editor?.isActive("bold") ? "active" : ""}
              type="button"
              aria-label="Bold"
              title="Bold"
              onMouseDown={(event) =>
                runEditorCommand(event, () =>
                  editor?.chain().focus().toggleBold().run(),
                )
              }
            >
              <Bold size={13} />
            </button>
            <button
              className={editor?.isActive("italic") ? "active" : ""}
              type="button"
              aria-label="Italic"
              title="Italic"
              onMouseDown={(event) =>
                runEditorCommand(event, () =>
                  editor?.chain().focus().toggleItalic().run(),
                )
              }
            >
              <Italic size={13} />
            </button>
            <button
              className={editor?.isActive("bulletList") ? "active" : ""}
              type="button"
              aria-label="Bullet list"
              title="Bullet list"
              onMouseDown={(event) =>
                runEditorCommand(event, () =>
                  editor?.chain().focus().toggleBulletList().run(),
                )
              }
            >
              <List size={13} />
            </button>
            <button
              className={editor?.isActive("orderedList") ? "active" : ""}
              type="button"
              aria-label="Ordered list"
              title="Ordered list"
              onMouseDown={(event) =>
                runEditorCommand(event, () =>
                  editor?.chain().focus().toggleOrderedList().run(),
                )
              }
            >
              <ListOrdered size={13} />
            </button>
            <button
              className={editor?.isActive("link") ? "active" : ""}
              type="button"
              aria-label="Link"
              title="Link"
              onMouseDown={setLink}
            >
              <LinkIcon size={13} />
            </button>
            <button
              className={editor?.isActive("highlight") ? "active" : ""}
              type="button"
              aria-label="Highlight"
              title="Highlight"
              onMouseDown={(event) =>
                runEditorCommand(event, () =>
                  editor
                    ?.chain()
                    .focus()
                    .toggleHighlight({ color: "#facc15" })
                    .run(),
                )
              }
            >
              <Highlighter size={13} />
            </button>
            <label
              className="note-color-control"
              title="Text color"
              aria-label="Text color"
              onMouseDown={preserveSelection}
            >
              <Palette size={13} />
              <input
                type="color"
                value={textColor}
                onChange={(event) => applyTextColor(event.target.value)}
              />
            </label>
          </div>

          <div
            className="sheet-editor-shell note-editor-shell editing"
            onMouseDown={focusEditorSurface}
            onClick={handleEditorLinkClick}
          >
            <EditorContent editor={editor} />
          </div>
        </>
      ) : (
        <StaticNoteContent
          activeMatchIndex={activeMatchIndex}
          className="note-static-viewer"
          contentJson={contentJson}
          emptyLabel="Empty note"
          findTerm={trimmedFindTerm}
        />
      )}

      <footer className="sheet-card-footer note-editor-footer">
        <span className={`sheet-save-status ${saveStatus}`}>
          {saveStatusLabel(saveStatus)}
        </span>
        <span>{editEnabled ? "Editing" : "Read-only"}</span>
        <span>{characterCount} chars</span>
        {editEnabled && !sheet.autoSaveEnabled ? (
          <button
            className="sheet-save-button"
            type="button"
            disabled={!dirty || saveStatus === "saving"}
            onClick={onManualSave}
          >
            <Save size={13} />
            Save
          </button>
        ) : null}
      </footer>
      {linkDialog !== null ? (
        <LinkDialog
          initialUrl={linkDialog.initialUrl}
          initialLabel={linkDialog.initialLabel}
          onConfirm={applyLink}
          onClose={() => setLinkDialog(null)}
        />
      ) : null}
    </article>
  );
}

function NoteListView({
  sheets,
  dirtyIds,
  saveStatuses,
  getContent,
  onOpen,
  onTogglePin,
  onDelete,
}: {
  sheets: Sheet[];
  dirtyIds: Set<string>;
  saveStatuses: Record<string, SaveStatus>;
  getContent: (sheet: Sheet) => SheetContentJson;
  onOpen: (sheet: Sheet) => void;
  onTogglePin: (sheet: Sheet) => void;
  onDelete: (sheet: Sheet) => void;
}): JSX.Element {
  return (
    <div className="notes-list panel">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Last updated</th>
            <th>Auto-save</th>
            <th>Character count</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sheets.map((sheet) => {
            const contentJson = getContent(sheet);
            const status =
              saveStatuses[sheet.id] ??
              (dirtyIds.has(sheet.id) ? "unsaved" : "saved");
            return (
              <tr
                key={sheet.id}
                tabIndex={0}
                onClick={() => onOpen(sheet)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(sheet);
                  }
                }}
              >
                <td>
                  <div className="notes-list-title-row">
                    {sheet.pinned ? (
                      <span className="notes-list-pin" title="Pinned note">
                        <PinIcon size={14} filled />
                      </span>
                    ) : null}
                    <strong>{sheet.title}</strong>
                  </div>
                  <span className={`sheet-save-status ${status}`}>
                    {saveStatusLabel(status)}
                  </span>
                </td>
                <td>{formatUpdatedAt(sheet.updatedAt)}</td>
                <td>{sheet.autoSaveEnabled ? "On" : "Off"}</td>
                <td>{textFromContentJson(contentJson).length}</td>
                <td>
                  <div className="notes-list-actions">
                    <PinButton
                      pinned={sheet.pinned}
                      onClick={() => onTogglePin(sheet)}
                    />
                    <button
                      type="button"
                      className="danger"
                      aria-label={`Delete ${sheet.title}`}
                      title="Delete Note"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(sheet);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddNoteModal({
  open,
  existingTitles,
  onCreate,
  onClose,
}: {
  open: boolean;
  existingTitles: string[];
  onCreate: (title: string) => Promise<boolean>;
  onClose: () => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setSubmitting(false);
      setSubmitFailed(false);
    }
  }, [open]);

  const validationMessage = noteTitleValidation(title, existingTitles);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (validationMessage) return;
    setSubmitting(true);
    setSubmitFailed(false);
    const created = await onCreate(title.trim());
    setSubmitting(false);
    if (!created) {
      setSubmitFailed(true);
    }
  }

  return (
    <Modal
      open={open}
      title="Add Note"
      subtitle="Create a project note"
      size="sm"
      closeLabel="Close add note"
      onClose={onClose}
    >
      <form className="add-sheet-form" onSubmit={handleSubmit}>
        <label htmlFor="note-title">Title</label>
        <input
          id="note-title"
          type="text"
          value={title}
          autoFocus
          onChange={(event) => {
            setTitle(event.target.value);
            setSubmitFailed(false);
          }}
        />
        {validationMessage ? (
          <p className="form-error">{validationMessage}</p>
        ) : null}
        {submitFailed ? (
          <p className="form-error">Note could not be created.</p>
        ) : null}
        <div className="add-sheet-actions">
          <button
            className="button secondary compact"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary compact"
            type="submit"
            disabled={!!validationMessage || submitting}
          >
            Add Note
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StaticNoteContent({
  contentJson,
  className,
  emptyLabel,
  findTerm = "",
  activeMatchIndex = 0,
}: {
  contentJson: SheetContentJson;
  className: string;
  emptyLabel: string;
  findTerm?: string;
  activeMatchIndex?: number;
}): JSX.Element {
  const matchRefs = useRef<(HTMLElement | null)[]>([]);
  const text = textFromContentJson(contentJson).trim();
  const query = findTerm.trim();
  const context: StaticRenderContext = {
    query,
    activeIndex: activeMatchIndex,
    matchIndex: 0,
    matchRefs,
  };
  matchRefs.current = [];
  const rendered = renderStaticNode(contentJson as TiptapNode, "note", context);

  useEffect(() => {
    if (!query) return;
    matchRefs.current[activeMatchIndex]?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }, [activeMatchIndex, query]);

  return (
    <div className={`${className}${text ? "" : " empty"}`}>
      {text ? rendered : <p className="note-static-empty">{emptyLabel}</p>}
    </div>
  );
}

const AutoSaveOffIcon = ({ size = 20 }: { size?: number }): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="currentColor"
      d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.48 2.54l2.6 1.53c.56-1.24.88-2.62.88-4.07 0-5.18-3.95-9.45-9-9.95M12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.06.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19"
    />
  </svg>
);

const AutoSaveOnIcon = ({ size = 20 }: { size?: number }): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="currentColor"
      d="M11 11H9c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2V9c0-.55-.45-1-1-1s-1 .45-1 1zm1 8c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.06.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19m1-16.95v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.48 2.54l2.6 1.53c.56-1.24.88-2.62.88-4.07 0-5.18-3.95-9.45-9-9.95"
    />
  </svg>
);

const EditIcon = ({ size = 20 }: { size?: number }): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="currentColor"
      d="M3 17.46v3.04c0 .28.22.5.5.5h3.04c.13 0 .26-.05.35-.15L17.81 9.94l-3.75-3.75L3.15 17.1q-.15.15-.15.36M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"
    />
  </svg>
);

function noteTitleValidation(
  title: string,
  existingTitles: string[],
): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "Note title is required.";
  const normalized = trimmed.toLowerCase();
  if (
    existingTitles.some(
      (existing) => existing.trim().toLowerCase() === normalized,
    )
  ) {
    return "A Note with this title already exists.";
  }
  return null;
}

function sortSheets(items: Sheet[]): Sheet[] {
  return [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    if (left.pinned && right.pinned) {
      const pinnedDiff =
        new Date(right.pinnedAt ?? right.updatedAt).getTime() -
        new Date(left.pinnedAt ?? left.updatedAt).getTime();
      if (pinnedDiff !== 0) return pinnedDiff;
    }
    const updatedDiff =
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;
    return left.title.localeCompare(right.title);
  });
}

function PinButton({
  pinned,
  onClick,
}: {
  pinned: boolean;
  onClick: () => void;
}): JSX.Element {
  const label = pinned ? "Unpin note" : "Pin note";
  return (
    <button
      className={`sheet-icon-button note-pin-button${pinned ? " active" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pinned}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <PinIcon size={18} filled={pinned} />
    </button>
  );
}

function PinIcon({
  size = 20,
  filled = false,
}: {
  size?: number;
  filled?: boolean;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      style={{ transform: "scaleX(-1)" }}
    >
      <path
        d="M14.579 14.579L11.6316 17.5264L10.7683 16.6631C10.3775 16.2723 10.1579 15.7422 10.1579 15.1894V13.1053L7.21052 10.158L5 9.42111L9.42111 5L10.158 7.21052L13.1053 10.1579L15.1894 10.1579C15.7422 10.1579 16.2722 10.3775 16.6631 10.7683L17.5264 11.6316L14.579 14.579ZM14.579 14.579L19 19"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function countMatches(text: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedText = text.toLowerCase();
  let count = 0;
  let index = normalizedText.indexOf(normalizedQuery);
  while (index !== -1) {
    count += 1;
    index = normalizedText.indexOf(
      normalizedQuery,
      index + normalizedQuery.length,
    );
  }
  return count;
}

function findTextRanges(doc: ProseMirrorNode, query: string): FindRange[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const ranges: FindRange[] = [];

  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return true;
    const text = node.text;
    const normalizedText = text.toLowerCase();
    let index = normalizedText.indexOf(normalizedQuery);
    while (index !== -1) {
      ranges.push({
        from: position + index,
        to: position + index + normalizedQuery.length,
      });
      index = normalizedText.indexOf(normalizedQuery, index + 1);
    }
    return true;
  });

  return ranges;
}

function textFromContentJson(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    return value.map(textFromContentJson).filter(Boolean).join("\n");
  }

  const node = value as { text?: unknown; type?: unknown; content?: unknown };
  const ownText = typeof node.text === "string" ? node.text : "";
  const childText = textFromContentJson(node.content);
  const combined = `${ownText}${childText}`;

  return node.type === "paragraph" || node.type === "heading"
    ? `${combined}\n`
    : combined;
}

function renderStaticNode(
  node: TiptapNode | undefined,
  key: string,
  context: StaticRenderContext,
): ReactNode {
  if (!node) return null;
  if (node.type === "text") {
    return renderStaticText(node.text ?? "", node.marks ?? [], key, context);
  }

  const children = (node.content ?? []).map((child, index) =>
    renderStaticNode(child, `${key}-${index}`, context),
  );

  switch (node.type) {
    case "doc":
      return <>{children}</>;
    case "paragraph":
      return <p key={key}>{children.length > 0 ? children : <br />}</p>;
    case "heading": {
      const level = Math.min(3, Math.max(1, numberAttr(node.attrs?.level, 2)));
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      return <Tag key={key}>{children}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList": {
      const start = numberAttr(node.attrs?.start, 1);
      return (
        <ol key={key} start={start === 1 ? undefined : start}>
          {children}
        </ol>
      );
    }
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    default:
      return <span key={key}>{children}</span>;
  }
}

function renderStaticText(
  text: string,
  marks: TiptapMark[],
  key: string,
  context: StaticRenderContext,
): ReactNode {
  if (!context.query) {
    return applyStaticMarks(text, marks, key);
  }

  const parts: ReactNode[] = [];
  const normalizedText = text.toLowerCase();
  const normalizedQuery = context.query.toLowerCase();
  let cursor = 0;
  let index = normalizedText.indexOf(normalizedQuery);

  while (index !== -1) {
    if (index > cursor) {
      parts.push(
        applyStaticMarks(text.slice(cursor, index), marks, `${key}-${cursor}`),
      );
    }

    const matchIndex = context.matchIndex;
    context.matchIndex += 1;
    const isActive = matchIndex === context.activeIndex;
    const matchText = text.slice(index, index + normalizedQuery.length);
    parts.push(
      <mark
        className={isActive ? "note-find-match active" : "note-find-match"}
        key={`${key}-match-${matchIndex}`}
        ref={(element) => {
          if (context.matchRefs) {
            context.matchRefs.current[matchIndex] = element;
          }
        }}
      >
        {applyStaticMarks(matchText, marks, `${key}-match-text-${matchIndex}`)}
      </mark>,
    );

    cursor = index + normalizedQuery.length;
    index = normalizedText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(applyStaticMarks(text.slice(cursor), marks, `${key}-${cursor}`));
  }

  return <>{parts}</>;
}

function applyStaticMarks(
  content: ReactNode,
  marks: TiptapMark[],
  key: string,
): ReactNode {
  return marks.reduce<ReactNode>((current, mark, index) => {
    const markKey = `${key}-mark-${index}`;
    switch (mark.type) {
      case "bold":
        return <strong key={markKey}>{current}</strong>;
      case "italic":
        return <em key={markKey}>{current}</em>;
      case "strike":
        return <s key={markKey}>{current}</s>;
      case "code":
        return <code key={markKey}>{current}</code>;
      case "highlight": {
        const color = stringAttr(mark.attrs?.color);
        return (
          <mark
            key={markKey}
            style={color ? { backgroundColor: color } : undefined}
          >
            {current}
          </mark>
        );
      }
      case "textStyle": {
        const color = stringAttr(mark.attrs?.color);
        return color ? (
          <span key={markKey} style={{ color }}>
            {current}
          </span>
        ) : (
          current
        );
      }
      case "link": {
        const href = stringAttr(mark.attrs?.href);
        return href ? (
          <a
            href={href}
            key={markKey}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openLink(href);
            }}
          >
            {current}
          </a>
        ) : (
          current
        );
      }
      default:
        return current;
    }
  }, content);
}

function numberAttr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving...";
    case "unsaved":
      return "Unsaved changes";
    case "failed":
      return "Save failed";
    case "saved":
      return "Saved";
  }
}

function clearAllSaveTimers(timers: Map<string, number>): void {
  for (const timer of timers.values()) {
    window.clearTimeout(timer);
  }
  timers.clear();
}

function normalizeHref(input: string): string {
  const raw = input.trim().replace(/^["']|["']$/g, "");
  if (isWindowsDrivePath(raw) || isWindowsUncPath(raw)) {
    return fileHrefFromPath(raw);
  }
  if (/^file:/i.test(raw)) {
    const localPath = filePathFromHref(raw);
    return localPath ? fileHrefFromPath(localPath) : raw;
  }
  return raw;
}

function openLink(href: string): void {
  const trimmed = href.trim();
  const localPath = filePathFromHref(trimmed);
  if (localPath) {
    void window.ivsDashboard.openPath(localPath);
    return;
  }
  if (isWindowsDrivePath(trimmed) || isWindowsUncPath(trimmed)) {
    void window.ivsDashboard.openPath(trimmed);
    return;
  }
  window.open(trimmed, "_blank", "noreferrer");
}

function isLocalHref(value: string | undefined): boolean {
  if (!value) return false;
  return (
    /^file:/i.test(value) ||
    isWindowsDrivePath(value) ||
    isWindowsUncPath(value)
  );
}

function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value.trim());
}

function isWindowsUncPath(value: string): boolean {
  return value.trim().startsWith("\\\\");
}

function fileHrefFromPath(path: string): string {
  const trimmed = path.trim();
  if (isWindowsUncPath(trimmed)) {
    return `file://${encodeURI(trimmed.slice(2).replace(/\\/g, "/"))}`;
  }
  return `file:///${encodeURI(trimmed.replace(/\\/g, "/"))}`;
}

function filePathFromHref(href: string): string | null {
  if (!/^file:/i.test(href.trim())) return null;
  try {
    const url = new URL(href.trim());
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) {
      return `\\\\${url.hostname}${pathname.replace(/\//g, "\\")}`;
    }
    return pathname.replace(/^\/([a-zA-Z]:)/, "$1").replace(/\//g, "\\");
  } catch {
    const path = href.trim().replace(/^file:\/+/i, "");
    return decodeURIComponent(path)
      .replace(/^\/([a-zA-Z]:)/, "$1")
      .replace(/\//g, "\\");
  }
}
