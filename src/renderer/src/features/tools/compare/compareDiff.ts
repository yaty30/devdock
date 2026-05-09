export type DiffRowKind = "equal" | "changed" | "removed" | "added";

export type DiffRow = {
  kind: DiffRowKind;
  leftLineNumber?: number;
  rightLineNumber?: number;
  leftText?: string;
  rightText?: string;
};

type DiffOperation = {
  kind: "equal" | "delete" | "insert";
  text: string;
  lineNumber: number;
  rightLineNumber?: number;
};

const LCS_CELL_LIMIT = 450_000;

export function buildSideBySideDiff(
  leftText: string,
  rightText: string,
): DiffRow[] {
  const leftLines = splitCompareLines(leftText);
  const rightLines = splitCompareLines(rightText);
  if (leftLines.length === 0 && rightLines.length === 0) {
    return [];
  }

  if (leftLines.length * rightLines.length > LCS_CELL_LIMIT) {
    return buildIndexDiff(leftLines, rightLines);
  }

  return pairDiffOperations(buildLineOperations(leftLines, rightLines));
}

export function formatDiffSummary(
  totalRows: number,
  changedRows: number,
): string {
  if (totalRows === 0) {
    return "No comparison loaded";
  }
  if (changedRows === 0) {
    return `${totalRows} lines, no differences`;
  }
  return `${changedRows} changed of ${totalRows} lines`;
}

function splitCompareLines(text: string): string[] {
  return text.length === 0
    ? []
    : text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function buildLineOperations(
  leftLines: string[],
  rightLines: string[],
): DiffOperation[] {
  const lcsMatrix = Array.from({ length: leftLines.length + 1 }, () =>
    new Array<number>(rightLines.length + 1).fill(0),
  );

  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (
      let rightIndex = rightLines.length - 1;
      rightIndex >= 0;
      rightIndex -= 1
    ) {
      lcsMatrix[leftIndex][rightIndex] =
        leftLines[leftIndex] === rightLines[rightIndex]
          ? lcsMatrix[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(
              lcsMatrix[leftIndex + 1][rightIndex],
              lcsMatrix[leftIndex][rightIndex + 1],
            );
    }
  }

  const operations: DiffOperation[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (
      leftIndex < leftLines.length &&
      rightIndex < rightLines.length &&
      leftLines[leftIndex] === rightLines[rightIndex]
    ) {
      operations.push({
        kind: "equal",
        text: leftLines[leftIndex],
        lineNumber: leftIndex + 1,
        rightLineNumber: rightIndex + 1,
      });
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      rightIndex < rightLines.length &&
      (leftIndex === leftLines.length ||
        lcsMatrix[leftIndex][rightIndex + 1] >=
          lcsMatrix[leftIndex + 1][rightIndex])
    ) {
      operations.push({
        kind: "insert",
        text: rightLines[rightIndex],
        lineNumber: rightIndex + 1,
      });
      rightIndex += 1;
    } else if (leftIndex < leftLines.length) {
      operations.push({
        kind: "delete",
        text: leftLines[leftIndex],
        lineNumber: leftIndex + 1,
      });
      leftIndex += 1;
    }
  }
  return operations;
}

function pairDiffOperations(operations: DiffOperation[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let deletedOperations: DiffOperation[] = [];
  let insertedOperations: DiffOperation[] = [];

  function flushPending(): void {
    const rowCount = Math.max(
      deletedOperations.length,
      insertedOperations.length,
    );
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const deletedOperation = deletedOperations[rowIndex];
      const insertedOperation = insertedOperations[rowIndex];
      rows.push({
        kind:
          deletedOperation && insertedOperation
            ? "changed"
            : deletedOperation
              ? "removed"
              : "added",
        leftLineNumber: deletedOperation?.lineNumber,
        rightLineNumber: insertedOperation?.lineNumber,
        leftText: deletedOperation?.text,
        rightText: insertedOperation?.text,
      });
    }
    deletedOperations = [];
    insertedOperations = [];
  }

  operations.forEach((operation) => {
    if (operation.kind === "equal") {
      flushPending();
      rows.push({
        kind: "equal",
        leftLineNumber: operation.lineNumber,
        rightLineNumber: operation.rightLineNumber ?? operation.lineNumber,
        leftText: operation.text,
        rightText: operation.text,
      });
      return;
    }

    if (operation.kind === "delete") {
      deletedOperations.push(operation);
      return;
    }

    insertedOperations.push(operation);
  });
  flushPending();
  return rows;
}

function buildIndexDiff(leftLines: string[], rightLines: string[]): DiffRow[] {
  const rowCount = Math.max(leftLines.length, rightLines.length);
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const leftValue = leftLines[rowIndex];
    const rightValue = rightLines[rowIndex];
    if (leftValue === rightValue) {
      return {
        kind: "equal",
        leftLineNumber: rowIndex + 1,
        rightLineNumber: rowIndex + 1,
        leftText: leftValue,
        rightText: rightValue,
      };
    }
    return {
      kind:
        leftValue === undefined
          ? "added"
          : rightValue === undefined
            ? "removed"
            : "changed",
      leftLineNumber: leftValue === undefined ? undefined : rowIndex + 1,
      rightLineNumber: rightValue === undefined ? undefined : rowIndex + 1,
      leftText: leftValue,
      rightText: rightValue,
    };
  });
}
