import {
  BetweenHorizonalStart,
  CircleArrowOutUpRight,
  SquareMousePointer,
} from "lucide-react";
import type { DatabaseTable } from "../../types";
import type { DatabaseObjectType, SheetContextMenu } from "./DatabaseWorkspace";

export function SheetContextMenuView({
  menu,
  onNewSheet,
  onRename,
  onDelete,
  onSelectTable,
  onInsertTableTemplate,
  onOpenTableInNewTab,
  onCreateTemplateSheet,
}: {
  menu: SheetContextMenu;
  onNewSheet: () => void;
  onRename: (sheetId: string) => void;
  onDelete: (sheetId: string) => void;
  onSelectTable: (table: DatabaseTable) => void;
  onInsertTableTemplate: (table: DatabaseTable) => void;
  onOpenTableInNewTab: (table: DatabaseTable) => void;
  onCreateTemplateSheet: (
    objectType: DatabaseObjectType,
    table?: DatabaseTable,
  ) => void;
}): JSX.Element | null {
  if (menu.kind === "object-group") {
    return null;
  }

  return (
    <div
      className="database-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.kind === "sheets" ? (
        <button type="button" role="menuitem" onClick={onNewSheet}>
          New sheet
        </button>
      ) : menu.kind === "table" ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onOpenTableInNewTab(menu.table)}
          >
            <CircleArrowOutUpRight size={13} />
            Open in new tab
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onSelectTable(menu.table)}
          >
            <SquareMousePointer size={13} /> SELECT{" "}
            {formatQualifiedObjectName(menu.table)}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onInsertTableTemplate(menu.table)}
          >
            <BetweenHorizonalStart size={13} />
            INSERT INTO {formatQualifiedObjectName(menu.table)}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onRename(menu.sheetId)}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onDelete(menu.sheetId)}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function formatQualifiedObjectName(table: DatabaseTable): string {
  return table.name;
}
