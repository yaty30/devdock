import { useEffect, useState } from "react";
import { Braces, File, FileText, Share } from "lucide-react";
import type { DatabaseConnection, DatabaseQueryValue } from "../../types";
import { formatCompactTime } from "./databaseFormatters";
import type { QuerySheet, ResultTab } from "./DatabaseWorkspace";

type ExportFormat = "json" | "csv" | "pdf";

type ExportSnackbarState = {
  tone: "valid" | "invalid";
  message: string;
  path?: string;
};

export function ResultExportMenu({
  resultTab,
  connection,
  sheet,
}: {
  resultTab: ResultTab | null;
  connection: DatabaseConnection;
  sheet: QuerySheet | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<ExportSnackbarState | null>(null);
  const disabled =
    !resultTab ||
    resultTab.rows.length === 0 ||
    resultTab.meta.status === "error";

  useEffect(() => {
    if (!snackbar) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSnackbar(null), 3600);
    return () => window.clearTimeout(timer);
  }, [snackbar]);

  async function exportResult(format: ExportFormat): Promise<void> {
    if (!resultTab || disabled) {
      return;
    }

    const exportedAt = new Date().toISOString();
    const baseName = safeFileName(
      `${connection.name}-${sheet?.name ?? "worksheet"}-${resultTab.name}`,
    );

    try {
      const exportPayload =
        format === "json"
          ? {
              fileName: `${baseName}.json`,
              content: JSON.stringify(resultTab.rows, null, 2),
            }
          : format === "csv"
            ? {
                fileName: `${baseName}.csv`,
                content: createCsv(resultTab),
              }
            : {
                fileName: `${baseName}.pdf`,
                content: createResultPdf(
                  resultTab,
                  connection,
                  sheet?.name ?? "Worksheet",
                  exportedAt,
                ),
              };
      const exportResult = await window.ivsDashboard.exportDatabaseResult(
        exportPayload.fileName,
        toBase64(exportPayload.content),
      );
      if (!exportResult.success) {
        setOpen(false);
        return;
      }
      setOpen(false);
      setSnackbar({
        message: "Exported",
        tone: "valid",
        path: exportResult.path,
      });
    } catch (error) {
      console.error(error);
      setOpen(false);
      setSnackbar({
        message: error instanceof Error ? error.message : "Export failed",
        tone: "invalid",
      });
    }
  }

  return (
    <>
      <div
        className="build-dropdown database-export-dropdown"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          className={`icon-button secondary database-output-share${open ? " open" : ""}`}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Export results"
          title="Export results"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <Share size={15} />
        </button>
        <div
          className={`build-dropdown-popover${open && !disabled ? " open" : ""}`}
          aria-hidden={!open || disabled}
        >
          <div className="build-dropdown-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => void exportResult("json")}
            >
              <Braces size={14} />
              <span>JSON</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => void exportResult("csv")}
            >
              <FileText size={14} />
              <span>CSV</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => void exportResult("pdf")}
            >
              <File size={14} />
              <span>PDF</span>
            </button>
          </div>
        </div>
      </div>
      {snackbar ? (
        <div
          className={`app-snackbar database-export-snackbar ${snackbar.tone}`}
        >
          <span>{snackbar.message}</span>
          {snackbar.path ? (
            <button
              type="button"
              onClick={() => void window.ivsDashboard.openPath(snackbar.path!)}
            >
              Open
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
function createCsv(tab: ResultTab): string {
  const headers = tab.columns.map((column) => column.label);
  const rows = tab.rows.map((row) =>
    tab.columns.map((column) => csvCell(row[column.key])).join(","),
  );
  return [headers.map(csvCell).join(","), ...rows].join("\r\n");
}

function toBase64(content: string | Uint8Array): string {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function csvCell(value: DatabaseQueryValue): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "query-results"
  );
}

function createResultPdf(
  tab: ResultTab,
  connection: DatabaseConnection,
  worksheetName: string,
  exportedAt: string,
): Uint8Array {
  const lines = [
    `Connection: ${connection.name}`,
    `Worksheet: ${worksheetName}`,
    `Exported: ${formatCompactTime(exportedAt)}`,
    "SQL:",
    ...wrapPdfLine(tab.statementSql, 112),
    "",
    tab.columns.map((column) => column.label).join(" | "),
    "-".repeat(112),
    ...tab.rows.map((row) =>
      tab.columns
        .map((column) => stringifyPdfValue(row[column.key]))
        .join(" | "),
    ),
  ];
  const pageLines: string[][] = [];
  const maxLinesPerPage = 42;
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pageLines.push(lines.slice(index, index + maxLinesPerPage));
  }

  return buildSimplePdf(
    pageLines.map((page) => page.flatMap((line) => wrapPdfLine(line, 132))),
  );
}

function stringifyPdfValue(value: DatabaseQueryValue): string {
  return value === null ? "NULL" : String(value).replace(/\s+/g, " ");
}

function wrapPdfLine(line: string, width: number): string[] {
  if (line.length <= width) {
    return [line];
  }
  const wrapped: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    wrapped.push(line.slice(index, index + width));
  }
  return wrapped;
}

function buildSimplePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const addObject = (content: string): number => {
    objects.push(content);
    return objects.length;
  };
  const fontObjectId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  );
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  pages.forEach((lines) => {
    const stream = ["BT", "/F1 8 Tf", "34 560 Td", "11 TL"]
      .concat(
        lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
        "ET",
      )
      .join("\n");
    const streamLength = new TextEncoder().encode(stream).length;
    const contentObjectId = addObject(
      `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`,
    );
    contentObjectIds.push(contentObjectId);
    pageObjectIds.push(0);
  });

  const pagesObjectId = objects.length + pages.length + 1;
  pages.forEach((_lines, index) => {
    const pageObjectId = addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
    );
    pageObjectIds[index] = pageObjectId;
  });
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  addObject(
    `<< /Type /Pages /Kids [${kids}] /Count ${pageObjectIds.length} >>`,
  );
  const catalogObjectId = addObject(
    `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`,
  );

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(chunks.join("").length);
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = chunks.join("").length;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return new TextEncoder().encode(chunks.join(""));
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
