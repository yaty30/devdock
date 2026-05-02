import { useEffect, useState } from "react";
import { quickGitCommands } from "../../data/mockData";
import type { GitStatusRecord } from "../../types";

export function GitTerminalTab({
  projectId,
  gitStatus,
}: {
  projectId: string;
  gitStatus: GitStatusRecord;
}): JSX.Element {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>(gitStatus.lines);
  const [status, setStatus] = useState(gitStatus);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setStatus(gitStatus);
    setOutput(gitStatus.lines);
  }, [gitStatus]);

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
    const args = command.trim();
    if (!args) {
      return;
    }

    setCommand("");
    setRunning(true);
    window.ivsDashboard
      .runGitCommand(projectId, args)
      .then((nextStatus) => {
        setStatus(nextStatus);
        setOutput(nextStatus.lines);
      })
      .catch((error) => setOutput((lines) => [...lines, String(error)]))
      .finally(() => setRunning(false));
  }

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
          <div className="git-find-row">
            <label htmlFor="git-find">Find</label>
            <input id="git-find" type="text" />
            <button type="button">Prev</button>
            <button type="button">Next</button>
            <button type="button">Clear</button>
          </div>
        </div>
        <div className="terminal-output" aria-label="Git terminal output">
          {output.map((line, index) => (
            <div className="terminal-line" key={`${line}-${index}`}>
              <span className="terminal-line-number">{index + 1}</span>
              <span className={terminalLineClass(line)}>{line}</span>
            </div>
          ))}
        </div>
      </section>

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
