import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type UIEvent,
} from "react";
import {
  useVirtualizer,
  type Rect,
  type Virtualizer,
} from "@tanstack/react-virtual";
import type { LogLine } from "../../../../shared/dashboardTypes";

const AUTO_SCROLL_THRESHOLD = 80;
const ROW_HEIGHT_DENSE = 18;
const ROW_HEIGHT_NORMAL = 22;
// Sized for a 50K-line buffer so most visible rows stay cached across
// scrolling and re-renders. We cache pre-built HTML strings (not React
// node trees) so each row mounts a single innerHTML span instead of a
// fiber tree of ~10-20 token spans. This keeps resize/sidebar-toggle
// reconciliation cheap even with token-dense WildFly output.
const COLORIZED_MESSAGE_CACHE_LIMIT = 8000;
const colorizedMessageCache = new Map<string, string>();

function escapeHtml(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    switch (ch) {
      case 38: // &
        out += "&amp;";
        break;
      case 60: // <
        out += "&lt;";
        break;
      case 62: // >
        out += "&gt;";
        break;
      case 34: // "
        out += "&quot;";
        break;
      case 39: // '
        out += "&#39;";
        break;
      default:
        out += value[i];
    }
  }
  return out;
}

type TokenKind =
  | "level-info"
  | "level-warn"
  | "level-error"
  | "success"
  | "command"
  | "url"
  | "path"
  | "number"
  | "quote"
  | "keyword";

const TOKEN_PATTERN =
  /(\[(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE)\]|\[vite\]|\b(?:INFO|WARN|WARNING|ERROR|FAILED|FAILURE|SUCCESS|BUILD SUCCESS|BUILD FAILURE|running|started|stopped|completed|deployed|timeout)\b|\$ [^\r\n]+|https?:\/\/[^\s"'<>]+|[A-Za-z]:\\[^\s"'<>]+|\b\d+(?:\.\d+)?(?:ms|s|m|kB|MB|%)?\b|"[^"]*"|'[^']*')/gi;

function getElementRect(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function getResizeObserverRect(
  element: Element,
  entry: ResizeObserverEntry | undefined,
): Rect {
  const box = entry?.borderBoxSize?.[0];
  if (box) {
    return {
      width: Math.round(box.inlineSize),
      height: Math.round(box.blockSize),
    };
  }

  return getElementRect(element);
}

function observeLogElementHeight(
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  cb: (rect: Rect) => void,
): (() => void) | undefined {
  const element = instance.scrollElement;
  if (!element) {
    return undefined;
  }

  const targetWindow = instance.targetWindow;
  let lastRect = getElementRect(element);
  let frame: number | null = null;
  cb(lastRect);

  if (!targetWindow?.ResizeObserver) {
    return () => {};
  }

  const observer = new targetWindow.ResizeObserver((entries) => {
    if (frame !== null) {
      targetWindow.cancelAnimationFrame(frame);
    }

    frame = targetWindow.requestAnimationFrame(() => {
      frame = null;
      const nextRect = getResizeObserverRect(element, entries[0]);
      if (nextRect.height === lastRect.height) {
        lastRect = nextRect;
        return;
      }

      lastRect = nextRect;
      cb(nextRect);
    });
  });

  observer.observe(element, { box: "border-box" });

  return () => {
    if (frame !== null) {
      targetWindow.cancelAnimationFrame(frame);
    }
    observer.unobserve(element);
  };
}

function tokenKind(value: string): TokenKind {
  const lower = value.toLowerCase();

  if (lower.includes("error") || lower.includes("fail")) {
    return "level-error";
  }

  if (lower.includes("warn")) {
    return "level-warn";
  }

  if (lower === "[info]" || lower === "[vite]") {
    return "level-info";
  }

  if (
    lower.includes("success") ||
    lower.includes("running") ||
    lower.includes("started") ||
    lower.includes("completed") ||
    lower.includes("deployed")
  ) {
    return "success";
  }

  if (value.startsWith("$ ")) {
    return "command";
  }

  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return "url";
  }

  if (/^[A-Za-z]:\\/.test(value)) {
    return "path";
  }

  if (/^["']/.test(value)) {
    return "quote";
  }

  if (/^\d/.test(value)) {
    return "number";
  }

  return "keyword";
}

function colorizeMessageHtml(message: string): string {
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(message)) !== null) {
    if (match.index > lastIndex) {
      out += escapeHtml(message.slice(lastIndex, match.index));
    }

    const value = match[0];
    out += `<span class="log-token log-token-${tokenKind(value)}">${escapeHtml(value)}</span>`;
    lastIndex = match.index + value.length;
  }

  if (lastIndex < message.length) {
    out += escapeHtml(message.slice(lastIndex));
  }

  return out;
}

function getColorizedMessageHtml(message: string): string {
  const cached = colorizedMessageCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  const html = colorizeMessageHtml(message);
  colorizedMessageCache.set(message, html);

  if (colorizedMessageCache.size > COLORIZED_MESSAGE_CACHE_LIMIT) {
    const oldestKey = colorizedMessageCache.keys().next().value;
    if (oldestKey !== undefined) {
      colorizedMessageCache.delete(oldestKey);
    }
  }

  return html;
}

export type VirtualizedLogViewerProps = {
  lines: LogLine[];
  isLoadingOlder?: boolean;
  hasMoreOlder?: boolean;
  unseenCount?: number;
  isFollowing?: boolean;
  suspendAutoFollow?: boolean;
  activeMatchSeq?: number | null;
  dense?: boolean;
  colorize?: boolean;
  highlight?: string;
  onLoadOlder?: () => void;
  onJumpToBottom?: () => void;
  onFollowingChange?: (following: boolean) => void;
};

type LogRowProps = {
  line: LogLine;
  top: number;
  height: number;
  matched: boolean;
  active: boolean;
  colorize: boolean;
};

// Memoized so unrelated panel state changes (find term updates that don't
// affect this row, scroll position, resize, sibling updates) don't force this
// row to re-render. Rows only re-render when their own match/active flags or
// position change.
const LogRow = memo(function LogRow({
  line,
  top,
  height,
  matched,
  active,
  colorize,
}: LogRowProps) {
  const timeMatch = line.text.match(/^(\d{2}:\d{2}:\d{2})(?:\s+|$)/);
  const time = timeMatch?.[1] ?? "";
  const message = timeMatch ? line.text.slice(timeMatch[0].length) : line.text;
  const lowerText = line.text.toLowerCase();
  const severity = colorize
    ? lowerText.includes("error") || lowerText.includes("fail")
      ? " error"
      : lowerText.includes("warn")
        ? " warning"
        : lowerText.includes("success") || lowerText.includes("running")
          ? " success"
          : ""
    : "";

  return (
    <div
      className={`log-line${matched ? " log-line-matched" : ""}${
        active ? " log-line-active" : ""
      }${severity}`}
      data-log-seq={line.seq}
      style={{
        position: "absolute",
        top,
        left: 0,
        width: "100%",
        height,
      }}
    >
      <span className="log-number">{line.seq}</span>
      <span className="log-time">{time}</span>
      <span
        className="log-message"
        // Colorized output is a pre-built, fully escaped HTML string (see
        // colorizeMessageHtml). Setting it via innerHTML keeps each row at
        // a single React fiber instead of one fiber per token, so resize
        // and sidebar-toggle reconciliation stays cheap.
        dangerouslySetInnerHTML={{
          __html: colorize
            ? getColorizedMessageHtml(message)
            : escapeHtml(message),
        }}
      />
    </div>
  );
});

export function LogLines({
  lines,
  isLoadingOlder = false,
  hasMoreOlder = false,
  unseenCount = 0,
  isFollowing = true,
  suspendAutoFollow = false,
  activeMatchSeq = null,
  dense = false,
  colorize = true,
  highlight = "",
  onLoadOlder,
  onJumpToBottom,
  onFollowingChange,
}: VirtualizedLogViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollVersionRef = useRef(0);
  const shouldStickToBottomRef = useRef(isFollowing);
  const suspendAutoFollowRef = useRef(suspendAutoFollow);
  const pendingFollowSyncRef = useRef(false);
  const prependScrollRef = useRef<{
    scrollTop: number;
    prevFirstSeq: number | null;
  } | null>(null);
  const term = highlight.trim();

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: lines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => (dense ? ROW_HEIGHT_DENSE : ROW_HEIGHT_NORMAL),
    observeElementRect: observeLogElementHeight,
    overscan: 10,
    useFlushSync: false,
  });

  useEffect(() => {
    shouldStickToBottomRef.current = isFollowing;
  }, [isFollowing]);

  useLayoutEffect(() => {
    const wasSuspended = suspendAutoFollowRef.current;
    suspendAutoFollowRef.current = suspendAutoFollow;

    // When resize ends, fire any deferred bottom-sync that arrived while we
    // were suspending auto-follow.
    if (
      wasSuspended &&
      !suspendAutoFollow &&
      pendingFollowSyncRef.current &&
      shouldStickToBottomRef.current
    ) {
      pendingFollowSyncRef.current = false;
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspendAutoFollow]);

  const lastSeq = lines[lines.length - 1]?.seq ?? 0;
  useEffect(() => {
    requestBottomSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, lastSeq]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(() => {
      requestBottomSync();
    });
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeMatchSeq === null) return;
    const idx = lines.findIndex((l) => l.seq === activeMatchSeq);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchSeq, lines.length]);

  useLayoutEffect(() => {
    const pending = prependScrollRef.current;
    if (!pending || pending.prevFirstSeq === null) return;

    const currentFirstSeq = lines[0]?.seq ?? null;
    if (currentFirstSeq === null || currentFirstSeq >= pending.prevFirstSeq)
      return;

    const insertedCount = lines.findIndex(
      (l) => l.seq >= pending.prevFirstSeq!,
    );
    if (insertedCount <= 0) return;

    const container = containerRef.current;
    if (container) {
      const rowHeight = dense ? ROW_HEIGHT_DENSE : ROW_HEIGHT_NORMAL;
      programmaticScrollRef.current = true;
      container.scrollTop = pending.scrollTop + insertedCount * rowHeight;
      prependScrollRef.current = null;
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    }
  }, [lines, dense]);

  function scrollToBottom(): void {
    const container = containerRef.current;
    if (!container) return;
    const version = ++programmaticScrollVersionRef.current;
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        if (programmaticScrollVersionRef.current === version) {
          programmaticScrollRef.current = false;
        }
      });
    });
  }

  function requestBottomSync(): void {
    if (!shouldStickToBottomRef.current) {
      return;
    }

    if (suspendAutoFollowRef.current) {
      pendingFollowSyncRef.current = true;
      return;
    }

    scrollToBottom();
  }

  const handleLoadOlder = useCallback(() => {
    if (!onLoadOlder || isLoadingOlder || !hasMoreOlder) return;
    const container = containerRef.current;
    prependScrollRef.current = {
      scrollTop: container?.scrollTop ?? 0,
      prevFirstSeq: lines[0]?.seq ?? null,
    };
    onLoadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoadOlder, isLoadingOlder, hasMoreOlder, lines]);

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    if (programmaticScrollRef.current) return;

    const container = event.currentTarget;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nowFollowing = distanceFromBottom <= AUTO_SCROLL_THRESHOLD;

    if (nowFollowing !== shouldStickToBottomRef.current) {
      shouldStickToBottomRef.current = nowFollowing;
      onFollowingChange?.(nowFollowing);
    }

    if (container.scrollTop <= 32) {
      handleLoadOlder();
    }
  }

  return (
    <div
      className={`log-lines${dense ? " dense" : ""}`}
      onScroll={handleScroll}
      ref={containerRef}
      style={{ position: "relative" }}
    >
      <div className="log-content">
        {(hasMoreOlder || isLoadingOlder) && (
          <div className="log-loading-row">
            {isLoadingOlder
              ? "Loading older log lines..."
              : "Scroll up to load older lines"}
          </div>
        )}

        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const logLine = lines[item.index];
            const matched =
              term.length > 0 &&
              logLine.text.toLowerCase().includes(term.toLowerCase());

            return (
              <LogRow
                key={logLine.seq}
                line={logLine}
                top={item.start}
                height={item.size}
                matched={matched}
                active={activeMatchSeq === logLine.seq}
                colorize={colorize}
              />
            );
          })}
        </div>

        {unseenCount > 0 && !isFollowing && (
          <button
            type="button"
            className="log-jump-bar"
            onClick={() => {
              scrollToBottom();
              onJumpToBottom?.();
            }}
          >
            {unseenCount} new {unseenCount === 1 ? "line" : "lines"} - Jump to
            bottom
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Reusable virtualized log viewer used by every dashboard log panel and any
 * full-log view. Renders only visible rows via @tanstack/react-virtual with a
 * small overscan, supports auto-follow, search highlighting, jump-to-bottom,
 * and progressive historical loading.
 *
 * `LogLines` is kept as a named export for backwards compatibility.
 */
export const VirtualizedLogViewer = LogLines;
