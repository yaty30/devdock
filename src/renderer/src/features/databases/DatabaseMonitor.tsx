import { useState } from "react";
import { Play, Redo2 } from "lucide-react";
import { Panel } from "../../components/common/Panel";
import type { DatabaseConnection, DatabaseExecutionRecord } from "../../types";
import { formatCompactTime, formatSqlForDisplay } from "./databaseFormatters";

function HistoryQueryCell({
  query,
  expanded,
  onToggle,
}: {
  query: string;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const showToggle = query.length > 100 || /\s/.test(query.slice(100));
  const preview =
    query.length > 100 ? `${query.slice(0, 100).trimEnd()}...` : query;

  if (!showToggle) {
    return <span className="database-query-preview">{query}</span>;
  }

  return (
    <div className={`database-history-query${expanded ? " expanded" : ""}`}>
      {expanded ? (
        <pre>{formatSqlForDisplay(query)}</pre>
      ) : (
        <span className="database-query-preview">{preview}</span>
      )}
      <button
        className="database-query-toggle"
        type="button"
        onClick={onToggle}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
export function DatabaseMonitor({
  connection,
  executionHistory,
  queryCount,
  lastRefreshTime,
  onRerun,
}: {
  connection: DatabaseConnection;
  executionHistory: DatabaseExecutionRecord[];
  queryCount: number;
  lastRefreshTime: string;
  onRerun: (record: DatabaseExecutionRecord) => void;
}): JSX.Element {
  const [expandedQueryIds, setExpandedQueryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const summaryItems = [
    { label: "Connection", value: connection.name },
    { label: "Database Type", value: connection.type },
    { label: "Status", value: <StatusPill status={connection.status} /> },
    { label: "Host", value: connection.host },
    { label: "Port", value: connection.port },
    { label: "Current User", value: connection.user },
    { label: "Current Schema", value: connection.schema },
    { label: "Last Refresh", value: formatCompactTime(lastRefreshTime) },
    { label: "Latency", value: connection.latency },
    { label: "Uptime", value: connection.uptime },
    { label: "Active Sessions", value: String(connection.activeSessions) },
    { label: "Query Count", value: String(queryCount) },
  ];
  const visibleHistory = executionHistory.slice(0, 100);

  function toggleExpandedQuery(entryId: string): void {
    setExpandedQueryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  return (
    <div className="database-monitor-layout">
      <div className="database-summary-grid">
        {summaryItems.map((item) => (
          <div className="database-summary-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <Panel
        title="Execution History"
        className="database-history-panel"
        // titleMeta={
        //   <span className="database-history-count">
        //     {executionHistory.length} stored
        //   </span>
        // }
      >
        <div className="database-history-scroll">
          <table className="recent-builds-table database-history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Connection</th>
                <th>User</th>
                <th>Query</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Message</th>
                <th>Rows</th>
                <th>Re-run</th>
              </tr>
            </thead>
            <tbody>
              {visibleHistory.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatCompactTime(entry.time)}</td>
                  <td>{entry.connection}</td>
                  <td>{entry.user}</td>
                  <td className="database-query-cell">
                    <HistoryQueryCell
                      query={entry.query}
                      expanded={expandedQueryIds.has(entry.id)}
                      onToggle={() => toggleExpandedQuery(entry.id)}
                    />
                  </td>
                  <td>{entry.duration}</td>
                  <td>
                    <span
                      className={`status-pill ${
                        entry.status === "success" ? "success" : "failed"
                      }`}
                    >
                      {entry.status === "success" ? "Success" : "Error"}
                    </span>
                  </td>
                  <td
                    className="database-history-message-cell"
                    title={entry.message ?? entry.errorMessage ?? ""}
                  >
                    {entry.message ?? entry.errorMessage ?? ""}
                  </td>
                  <td>{entry.rows}</td>
                  <td>
                    <button
                      className="icon-button secondary database-history-rerun"
                      type="button"
                      aria-label={`Re-run query from ${formatCompactTime(entry.time)}`}
                      title="Re-run query"
                      onClick={() => onRerun(entry)}
                      disabled={entry.status !== "success"}
                    >
                      <Redo2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleHistory.length === 0 ? (
            <p className="database-empty-state">No query executions yet.</p>
          ) : null}
        </div>
        <div className="table-footer">
          <span>
            Showing {visibleHistory.length} of {executionHistory.length}{" "}
            executions
          </span>
          <span>Newest first, retained for 3 days</span>
        </div>
      </Panel>
    </div>
  );
}

export function StatusPill({
  status,
}: {
  status: DatabaseConnection["status"];
}): JSX.Element {
  const label =
    status === "connected"
      ? "Connected"
      : status === "error"
        ? "Error"
        : "Disconnected";
  const className =
    status === "connected"
      ? "success"
      : status === "error"
        ? "failed"
        : "warning";
  return <span className={`status-pill ${className}`}>{label}</span>;
}
