import { CheckCircle2 } from "lucide-react";
import type { ShutdownEntry } from "../../types";

export function ShutdownOverlay({
  entries,
  stoppedServices,
}: {
  entries: ShutdownEntry[];
  stoppedServices: Set<string>;
}): JSX.Element {
  return (
    <div className="shutdown-overlay">
      <div className="shutdown-dialog">
        <h2>Shutting down servers</h2>
        <div className="shutdown-service-list">
          {entries.map((entry) => {
            const key = `${entry.projectId}:${entry.service}`;
            const stopped = stoppedServices.has(key);
            return (
              <div
                key={key}
                className={`shutdown-service-item${stopped ? " stopped" : ""}`}
              >
                <div className="shutdown-service-label">
                  <strong>
                    {entry.service === "wildfly"
                      ? "WildFly"
                      : entry.service === "python"
                        ? "Python"
                        : "Frontend"}
                  </strong>
                  <span>{entry.projectName}</span>
                </div>
                <div className="shutdown-service-status">
                  {stopped ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <span className="shutdown-spinner" />
                  )}
                  <span>{stopped ? "Stopped" : "Stopping"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
