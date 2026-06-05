import { Grid3X3, List, Plus } from "lucide-react";
import type { NotesView } from "../../features/notes/NotesTab";

export function NotesHeaderActions({
  view,
  disabled = false,
  onAdd,
  onToggleView,
}: {
  view: NotesView;
  disabled?: boolean;
  onAdd: () => void;
  onToggleView: () => void;
}): JSX.Element {
  return (
    <>
      <button
        className="icon-button secondary header-settings-button"
        type="button"
        aria-label="Add note"
        title="Add note"
        disabled={disabled}
        onClick={onAdd}
      >
        <Plus size={18} />
      </button>
      <button
        className="icon-button secondary header-settings-button"
        type="button"
        aria-label={
          view === "grid" ? "Switch to list view" : "Switch to grid view"
        }
        title={view === "grid" ? "List view" : "Grid view"}
        disabled={disabled}
        onClick={onToggleView}
      >
        {view === "grid" ? <List size={18} /> : <Grid3X3 size={18} />}
      </button>
    </>
  );
}
