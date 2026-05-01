import { useState } from "react";
import { gitTerminalLines, quickGitCommands } from "../../data/mockData";

export function GitTerminalTab(): JSX.Element {
  const [command, setCommand] = useState("");

  return (
    <section className="git-terminal-screen">
      <div className="git-terminal-header">
        <div className="git-status-strip">
          <div>
            <span>Repository</span>
            <strong>Unavailable</strong>
          </div>
          <div>
            <span>Branch</span>
            <strong>unavailable</strong>
          </div>
          <div>
            <span>Path</span>
            <strong>C:\Users\yipsy1\iap</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>Git unavailable</strong>
          </div>
        </div>
        <div className="git-terminal-actions">
          <button type="button">Clear</button>
          <button type="button">Refresh Branch</button>
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
          {gitTerminalLines.map((line, index) => (
            <div className="terminal-line" key={`${line}-${index}`}>
              <span className="terminal-line-number">{index + 1}</span>
              <span
                className={
                  index === 3
                    ? "terminal-warning"
                    : index === 2
                      ? "terminal-muted"
                      : "terminal-command"
                }
              >
                {line}
              </span>
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
        />
        <button type="button">Run</button>
      </div>
    </section>
  );
}
