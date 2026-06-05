import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  FolderGit as GitFolder,
  History,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { FindControls } from "../../components/common/FindControls";
import type {
  GitStatusRecord,
  ProjectGitContext,
  ProjectSettingsRecord,
} from "../../types";
import {
  copyTextToClipboard,
  type CopyFeedback,
} from "../../utils/copyToClipboard";
import {
  getProjectGitContextLabel,
  isProjectUsingSeparateGitRepositories,
} from "../../../../shared/projectFrontend";

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

type GitRepositorySelectorContext = Extract<
  ProjectGitContext,
  "frontend" | "backend"
>;

export function GitRepositorySelector({
  projectId,
  settings,
  value,
  disabled = false,
  onChange,
}: {
  projectId: string;
  settings: ProjectSettingsRecord;
  value: ProjectGitContext;
  disabled?: boolean;
  onChange: (context: ProjectGitContext) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<
    Partial<Record<GitRepositorySelectorContext, GitStatusRecord>>
  >({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const separateGitRepositories =
    isProjectUsingSeparateGitRepositories(settings);
  const selectedContext =
    value === "frontend" || value === "backend" ? value : "backend";
  const selectedLabel = getProjectGitContextLabel(selectedContext);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closeOnOutsideClick(event: MouseEvent): void {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!separateGitRepositories) {
      setOpen(false);
      setStatuses({});
      return undefined;
    }

    let cancelled = false;
    (["frontend", "backend"] as GitRepositorySelectorContext[]).forEach(
      (context) => {
        window.ivsDashboard
          .getGitStatus(projectId, context)
          .then((status) => {
            if (cancelled) {
              return;
            }
            setStatuses((current) => ({ ...current, [context]: status }));
          })
          .catch(() => {
            if (cancelled) {
              return;
            }
            setStatuses((current) => ({
              ...current,
              [context]: {
                repository: settings.git[context].directory,
                context,
                contextLabel: getProjectGitContextLabel(context),
                valid: false,
                branch: "unavailable",
                commit: "unavailable",
                status: `${getProjectGitContextLabel(context)} Git directory is not configured or is not a valid Git repository.`,
                lines: [],
              },
            }));
          });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [projectId, separateGitRepositories, settings.git]);

  if (!separateGitRepositories) {
    return null;
  }

  function contextMessage(context: GitRepositorySelectorContext): string {
    const configuredDirectory = settings.git[context].directory.trim();
    if (!configuredDirectory) {
      return `${getProjectGitContextLabel(context)} Git directory is not configured or is not a valid Git repository.`;
    }

    const status = statuses[context];
    if (status && !status.valid) {
      return status.status;
    }

    return getProjectGitContextLabel(context);
  }

  function contextDisabled(context: GitRepositorySelectorContext): boolean {
    if (disabled || !settings.git[context].directory.trim()) {
      return true;
    }

    const status = statuses[context];
    return status ? !status.valid : false;
  }

  function selectContext(context: GitRepositorySelectorContext): void {
    if (contextDisabled(context)) {
      return;
    }

    onChange(context);
    setOpen(false);
  }

  return (
    <div className="build-dropdown git-context-dropdown" ref={dropdownRef}>
      <button
        className={`icon-button secondary header-settings-button git-context-trigger${
          open ? " open" : ""
        }`}
        type="button"
        aria-label={`Git repository context: ${selectedLabel}`}
        title={`Git repository context: ${selectedLabel}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <GitFolder size={18} />
      </button>
      <div className={`build-dropdown-popover${open ? " open" : ""}`}>
        <div className="build-dropdown-menu git-context-menu" role="menu">
          {(["frontend", "backend"] as GitRepositorySelectorContext[]).map(
            (context) => {
              const disabledOption = contextDisabled(context);
              const label = getProjectGitContextLabel(context);
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={context}
                  className={selectedContext === context ? "active" : undefined}
                  disabled={disabledOption}
                  title={disabledOption ? contextMessage(context) : label}
                  onClick={() => selectContext(context)}
                >
                  <GitFolder size={15} />
                  <span>{label}</span>
                </button>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
}

export function GitTerminalTab({
  projectId,
  gitStatus,
  settings,
  gitContext,
  onFeedback,
}: {
  projectId: string;
  gitStatus: GitStatusRecord;
  settings: ProjectSettingsRecord;
  gitContext: ProjectGitContext;
  onFeedback?: CopyFeedback;
}): JSX.Element {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>(gitStatus.lines);
  const [status, setStatus] = useState(gitStatus);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<GitCommandHistoryItem[]>([]);
  const [findTerm, setFindTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(
    GIT_HISTORY_PAGE_SIZE,
  );
  const historyIdRef = useRef(0);
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const separateGitRepositories =
    isProjectUsingSeparateGitRepositories(settings);
  const selectedContext = separateGitRepositories ? gitContext : "single";
  const selectedContextLabel = getProjectGitContextLabel(selectedContext);
  const selectedGitValid = status.valid !== false;

  useEffect(() => {
    if (selectedContext === (gitStatus.context ?? "single")) {
      setStatus(gitStatus);
      setOutput(gitStatus.lines);
    }
  }, [gitStatus, selectedContext]);

  useEffect(() => {
    setRunning(true);
    window.ivsDashboard
      .getGitStatus(projectId, selectedContext)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setOutput(nextStatus.lines);
      })
      .catch((error) => setOutput((lines) => [...lines, String(error)]))
      .finally(() => setRunning(false));
  }, [projectId, selectedContext]);

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
      .getGitStatus(projectId, selectedContext)
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
      .runGitCommand(projectId, args, selectedContext)
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
    <section
      className={`git-terminal-screen${historyOpen ? "" : " history-collapsed"}`}
    >
      <div className="git-terminal-header">
        <div className="git-status-strip">
          <div className="git-status-item">
            <span>Repository</span>
            <strong>{status.repository || "Unavailable"}</strong>
          </div>
          {separateGitRepositories ? (
            <div className="git-status-item">
              <span>Context</span>
              <strong>{selectedContextLabel}</strong>
            </div>
          ) : null}
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
            <strong
              className={`git-working-tree-status ${gitWorkingTreeStatusClass(
                status.status,
              )}`}
            >
              {status.status}
            </strong>
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
        <section
          className={`panel git-terminal-panel${running ? " loading" : ""}`}
        >
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
            {!selectedGitValid ? (
              <div className="git-context-warning" role="status">
                {status.status}
              </div>
            ) : null}
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
          {running ? (
            <div className="git-terminal-loading" role="status">
              <LoaderCircle className="button-spinner" size={22} />
              <span>Running git command...</span>
            </div>
          ) : null}
        </section>

        <aside
          className={`panel git-history-panel${historyOpen ? "" : " collapsed"}`}
          id="git-command-history-panel"
          aria-label="Git command history"
        >
          <div className="git-history-header">
            {historyOpen ? (
              <h2>Git Command History</h2>
            ) : (
              <History size={16} aria-hidden="true" />
            )}
            <button
              className="git-history-toggle"
              type="button"
              aria-controls="git-command-history-panel"
              aria-expanded={historyOpen}
              title={
                historyOpen ? "Hide command history" : "Show command history"
              }
              onClick={() => setHistoryOpen((current) => !current)}
            >
              {historyOpen ? (
                <PanelRightClose size={15} />
              ) : (
                <PanelRightOpen size={15} />
              )}
            </button>
          </div>
          {historyOpen ? (
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
          ) : null}
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
        <button
          type="button"
          onClick={runCommand}
          disabled={running || !selectedGitValid}
        >
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

function gitWorkingTreeStatusClass(
  status: string,
): "success" | "warning" | "failed" {
  if (status === "Clean") {
    return "success";
  }

  if (
    /error|failed|fatal|unavailable|not configured|does not exist|not a valid|not a directory/i.test(
      status,
    )
  ) {
    return "failed";
  }

  return "warning";
}

function terminalLineClass(line: string): string {
  const lower = line.toLowerCase();

  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("fatal") ||
    lower.includes("does not exist") ||
    lower.includes("not a valid") ||
    lower.includes("not a directory")
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
    lower.includes("git root:") ||
    lower.includes("context:") ||
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
