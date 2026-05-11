import { useEffect, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { FindControls } from "../../components/common/FindControls";
import type { GitStatusRecord } from "../../types";
import {
  copyTextToClipboard,
  type CopyFeedback,
} from "../../utils/copyToClipboard";

type GitCommandHistoryItem = {
  id: number;
  command: string;
  input: string;
  executedAt: Date;
  status: "Running" | "Success" | "Failed";
};

type GitCommandHistoryRow =
  | { type: "divider"; key: string; label: string }
  | { type: "item"; item: GitCommandHistoryItem };

const GIT_HISTORY_PAGE_SIZE = 30;
const GIT_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const quickGitCommands = [
  "status",
  "branch",
  "log --oneline",
  "fetch",
  "pull",
  "diff",
];

export function GitTerminalTab({
  projectId,
  gitStatus,
  onFeedback,
}: {
  projectId: string;
  gitStatus: GitStatusRecord;
  onFeedback?: CopyFeedback;
}): JSX.Element {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>(gitStatus.lines);
  const [status, setStatus] = useState(gitStatus);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<GitCommandHistoryItem[]>([]);
  const [findTerm, setFindTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(
    GIT_HISTORY_PAGE_SIZE,
  );
  const historyIdRef = useRef(0);
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStatus(gitStatus);
    setOutput(gitStatus.lines);
  }, [gitStatus]);

  useEffect(() => {
    setCommand("");
    setFindTerm("");
    setActiveMatchIndex(0);
    const storedHistory = loadGitHistory(projectId);
    historyIdRef.current = Math.max(0, ...storedHistory.map((item) => item.id));
    setHistory(storedHistory);
    setVisibleHistoryCount(GIT_HISTORY_PAGE_SIZE);
  }, [projectId]);

  useEffect(() => {
    saveGitHistory(projectId, history);
  }, [history, projectId]);

  const trimmedFindTerm = findTerm.trim().toLowerCase();
  const matchIndexes = useMemo(
    () =>
      trimmedFindTerm
        ? output.reduce<number[]>((matches, line, index) => {
            if (line.toLowerCase().includes(trimmedFindTerm)) {
              matches.push(index);
            }
            return matches;
          }, [])
        : [],
    [output, trimmedFindTerm],
  );
  const matchCount = matchIndexes.length;
  const activeLineIndex =
    matchCount > 0
      ? matchIndexes[Math.min(activeMatchIndex, matchCount - 1)]
      : null;

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [trimmedFindTerm]);

  useEffect(() => {
    if (activeMatchIndex >= matchCount) {
      setActiveMatchIndex(matchCount > 0 ? matchCount - 1 : 0);
    }
  }, [activeMatchIndex, matchCount]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }, [activeLineIndex]);

  useEffect(() => {
    const sentinel = historySentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleHistoryCount((current) =>
            Math.min(current + GIT_HISTORY_PAGE_SIZE, history.length),
          );
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [history.length]);

  function refreshBranch(): void {
    setRunning(true);
    window.ivsDashboard
      .getGitStatus(projectId)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setOutput(nextStatus.lines);
      })
      .catch((error) => setOutput((lines) => [...lines, String(error)]))
      .finally(() => setRunning(false));
  }

  function runCommand(): void {
    const args = normalizeGitInput(command);
    if (!args) {
      return;
    }

    const historyId = historyIdRef.current + 1;
    historyIdRef.current = historyId;
    const historyCommand = `git ${args}`;
    setVisibleHistoryCount((current) =>
      Math.max(current, GIT_HISTORY_PAGE_SIZE),
    );
    setHistory((current) =>
      pruneGitHistory([
        {
          id: historyId,
          command: historyCommand,
          input: args,
          executedAt: new Date(),
          status: "Running",
        },
        ...current,
      ]),
    );
    setCommand("");
    setRunning(true);
    window.ivsDashboard
      .runGitCommand(projectId, args)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setOutput(nextStatus.lines);
        updateHistory(historyId, {
          status: gitCommandSucceeded(nextStatus.lines) ? "Success" : "Failed",
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setOutput((lines) => [...lines, message]);
        updateHistory(historyId, {
          status: "Failed",
        });
      })
      .finally(() => setRunning(false));
  }

  function updateHistory(
    historyId: number,
    patch: Pick<GitCommandHistoryItem, "status">,
  ): void {
    setHistory((current) =>
      pruneGitHistory(
        current.map((item) =>
          item.id === historyId ? { ...item, ...patch } : item,
        ),
      ),
    );
  }

  function copyCommand(commandText: string): void {
    void copyTextToClipboard(commandText, onFeedback);
  }

  function navigateFind(direction: -1 | 1): void {
    if (matchCount === 0) {
      return;
    }

    setActiveMatchIndex(
      (current) => (current + direction + matchCount) % matchCount,
    );
  }

  function clearFind(): void {
    setFindTerm("");
    setActiveMatchIndex(0);
  }

  const visibleHistory = history.slice(0, visibleHistoryCount);
  const historyRows = groupGitHistoryByDate(visibleHistory);
  const hasMoreHistory = visibleHistoryCount < history.length;

  return (
    <section className="git-terminal-screen">
      <div className="git-terminal-header">
        <div className="git-status-strip">
          <div className="git-status-item">
            <span>Repository</span>
            <strong>{status.repository || "Unavailable"}</strong>
          </div>
          <div className="git-status-item">
            <span>Branch</span>
            <strong>{status.branch}</strong>
          </div>
          <div className="git-status-item">
            <span>Commit</span>
            <strong>@{status.commit}</strong>
          </div>
          <div className="git-status-item git-status-item-status">
            <span>Status</span>
            <strong>{status.status}</strong>
          </div>
        </div>
        <div className="git-terminal-actions">
          <button type="button" onClick={() => setOutput([])}>
            Clear
          </button>
          <button type="button" onClick={refreshBranch} disabled={running}>
            Refresh Branch
          </button>
        </div>
      </div>

      <div className="git-terminal-layout">
        <section className="panel git-terminal-panel">
          <div className="git-tools-row">
            <div className="quick-command-row" aria-label="Quick git commands">
              {quickGitCommands.map((quickCommand) => (
                <button
                  type="button"
                  key={quickCommand}
                  onClick={() => setCommand(quickCommand)}
                >
                  {quickCommand}
                </button>
              ))}
            </div>
            <FindControls
              id="git-find"
              value={findTerm}
              activeIndex={activeMatchIndex}
              matchCount={matchCount}
              className="git-find-row"
              onChange={setFindTerm}
              onPrevious={() => navigateFind(-1)}
              onNext={() => navigateFind(1)}
              onClear={clearFind}
            />
          </div>
          <div className="terminal-output" aria-label="Git terminal output">
            {output.map((line, index) => {
              const matched = matchIndexes.includes(index);
              const active = index === activeLineIndex;
              return (
                <div
                  className={`terminal-line${matched ? " terminal-line-matched" : ""}${
                    active ? " terminal-line-active" : ""
                  }`}
                  key={`${line}-${index}`}
                  ref={active ? activeLineRef : undefined}
                >
                  <span className="terminal-line-number">{index + 1}</span>
                  <span className={terminalLineClass(line)}>{line}</span>
                </div>
              );
            })}
          </div>
        </section>

        <aside
          className="panel git-history-panel"
          aria-label="Git command history"
        >
          <div className="git-history-header">
            <h2>Git Command History</h2>
          </div>
          <div className="git-history-list">
            {history.length === 0 ? (
              <p className="git-history-empty">No commands run yet.</p>
            ) : (
              historyRows.map((row) =>
                row.type === "divider" ? (
                  <div
                    className="activity-date-divider git-history-date-divider"
                    key={row.key}
                  >
                    <span>{row.label}</span>
                  </div>
                ) : (
                  <article
                    className="git-history-item"
                    key={row.item.id}
                    onClick={() => setCommand(row.item.input)}
                  >
                    <div
                      className={`git-history-dot ${historyStatusClass(row.item.status)}`}
                    />
                    <div className="git-history-copy">
                      <strong>{row.item.command}</strong>
                      <span>{formatHistoryTime(row.item.executedAt)}</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Copy ${row.item.command}`}
                      title="Copy command"
                      onClick={(event) => {
                        event.stopPropagation();
                        copyCommand(row.item.command);
                      }}
                    >
                      <Copy size={13} />
                    </button>
                  </article>
                ),
              )
            )}
            {hasMoreHistory ? (
              <div
                ref={historySentinelRef}
                className="activity-scroll-sentinel"
                aria-hidden="true"
              />
            ) : null}
          </div>
        </aside>
      </div>

      <div className="git-command-row">
        <span className="git-command-prefix">git</span>
        <input
          type="text"
          aria-label="Git command arguments"
          placeholder="status"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              runCommand();
            }
          }}
        />
        <button type="button" onClick={runCommand} disabled={running}>
          {running ? "Running" : "Run"}
        </button>
      </div>
    </section>
  );
}

function normalizeGitInput(value: string): string {
  return value.trim().replace(/^git\s+/i, "");
}

function gitCommandSucceeded(lines: string[]): boolean {
  return !lines.some((line) => /git exited with code (?!0\b)\d+/i.test(line));
}

function formatHistoryTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function groupGitHistoryByDate(
  items: GitCommandHistoryItem[],
): GitCommandHistoryRow[] {
  const rows: GitCommandHistoryRow[] = [];
  let previousKey: string | null = null;

  for (const item of items) {
    const key = historyDateKey(item.executedAt);
    if (key !== previousKey) {
      rows.push({
        type: "divider",
        key: `divider-${key}`,
        label: formatHistoryDate(item.executedAt),
      });
      previousKey = key;
    }
    rows.push({ type: "item", item });
  }

  return rows;
}

function historyDateKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function formatHistoryDate(value: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (historyDateKey(value) === historyDateKey(today)) {
    return "Today";
  }

  if (historyDateKey(value) === historyDateKey(yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: value.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(value);
}

function loadGitHistory(projectId: string): GitCommandHistoryItem[] {
  try {
    const raw = localStorage.getItem(gitHistoryStorageKey(projectId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Array<
      Omit<GitCommandHistoryItem, "executedAt"> & { executedAt: string }
    >;
    return pruneGitHistory(
      parsed.map((item) => ({
        ...item,
        executedAt: new Date(item.executedAt),
      })),
    );
  } catch {
    return [];
  }
}

function saveGitHistory(
  projectId: string,
  history: GitCommandHistoryItem[],
): void {
  try {
    const pruned = pruneGitHistory(history);
    localStorage.setItem(
      gitHistoryStorageKey(projectId),
      JSON.stringify(
        pruned.map((item) => ({
          ...item,
          executedAt: item.executedAt.toISOString(),
        })),
      ),
    );
  } catch {
    // Ignore storage failures; command history is a convenience feature.
  }
}

function pruneGitHistory(
  history: GitCommandHistoryItem[],
): GitCommandHistoryItem[] {
  const minTime = Date.now() - GIT_HISTORY_RETENTION_MS;
  return history
    .filter((item) => {
      const time = item.executedAt.getTime();
      return !Number.isNaN(time) && time >= minTime;
    })
    .sort(
      (left, right) => right.executedAt.getTime() - left.executedAt.getTime(),
    );
}

function gitHistoryStorageKey(projectId: string): string {
  return `ivs-dashboard:git-history:${projectId}`;
}

function historyStatusClass(status: GitCommandHistoryItem["status"]): string {
  return status.toLowerCase();
}

function terminalLineClass(line: string): string {
  const lower = line.toLowerCase();

  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("fatal") ||
    lower.includes("does not exist")
  ) {
    return "terminal-error";
  }

  if (lower.includes("warning") || lower.includes("unavailable")) {
    return "terminal-warning";
  }

  if (
    line.includes("$ git") ||
    line.includes("$ status") ||
    line.includes("$ ")
  ) {
    return "terminal-command";
  }

  if (
    lower.includes("repository:") ||
    lower.includes("branch:") ||
    lower.includes("commit:")
  ) {
    return "terminal-info";
  }

  if (lower.includes("clean") || lower.includes("exited with code 0")) {
    return "terminal-success";
  }

  if (/^\d{2}:\d{2}:\d{2}\s+[MADRCU?!]{1,2}\s/.test(line)) {
    return "terminal-change";
  }

  return "terminal-muted";
}
