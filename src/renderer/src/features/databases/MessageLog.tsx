import { formatCompactTime } from "./databaseFormatters";
import type { MessageEntry } from "./DatabaseWorkspace";

export function MessageLog({
  messages,
}: {
  messages: MessageEntry[];
}): JSX.Element {
  return (
    <div className="database-message-log">
      {messages.length === 0 ? (
        <p className="database-empty-state">No messages for this sheet.</p>
      ) : null}
      {messages.map((message) => (
        <div className={`database-message ${message.tone}`} key={message.id}>
          <time>{formatCompactTime(message.time)}</time>
          <span>{message.text}</span>
        </div>
      ))}
    </div>
  );
}
