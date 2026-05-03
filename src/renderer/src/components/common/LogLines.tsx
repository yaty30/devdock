import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
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
const COLORIZED_MESSAGE_CACHE_LIMIT = 2000;
const colorizedMessageCache = new Map<string, ReactNode[]>();

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

function colorizeMessage(message: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(message)) !== null) {
    if (match.index > lastIndex) {
      parts.push(message.slice(lastIndex, match.index));
    }

    const value = match[0];
    parts.push(
      <span
        className={`log-token log-token-${tokenKind(value)}`}
        key={`${value}-${match.index}`}
      >
        {value}
      </span>,
    );
    lastIndex = match.index + value.length;
  }

  if (lastIndex < message.length) {
    parts.push(message.slice(lastIndex));
  }

  return parts;
}

function getColorizedMessage(message: string): ReactNode[] {
  const cached = colorizedMessageCache.get(message);
  if (cached) {
    return cached;
  }

  const colorized = colorizeMessage(message);
  colorizedMessageCache.set(message, colorized);

  if (colorizedMessageCache.size > COLORIZED_MESSAGE_CACHE_LIMIT) {
    const oldestKey = colorizedMessageCache.keys().next().value;
    if (oldestKey !== undefined) {
      colorizedMessageCache.delete(oldestKey);
    }
  }

  return colorized;
}

export function LogLines({
  lines,
  isLoadingOlder = false,
  hasMoreOlder = false,
  unseenCount = 0,
  isFollowing = true,
  suspendAutoFollow = false,
  activeMatchSeq = null,
  dense = false,
  highlight = "",
  onLoadOlder,
  onJumpToBottom,
  onFollowingChange,
}: {
  lines: LogLine[];
  isLoadingOlder?: boolean;
  hasMoreOlder?: boolean;
  unseenCount?: number;
  isFollowing?: boolean;
  suspendAutoFollow?: boolean;
  activeMatchSeq?: number | null;
  dense?: boolean;
  highlight?: string;
  onLoadOlder?: () => void;
  onJumpToBottom?: () => void;
  onFollowingChange?: (following: boolean) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollVersionRef = useRef(0);
  const shouldStickToBottomRef = useRef(isFollowing);
  const suspendAutoFollowRef = useRef(suspendAutoFollow);
  const pendingFollowSyncRef = useRef(false);
  const frozenScrollTopRef = useRef(0);
  const frozenRestorePendingRef = useRef(false);
  const resizeStateInitializedRef = useRef(false);
  const prependScrollRef = useRef<{
    scrollTop: number;
    prevFirstSeq: number | null;
  } | null>(null);
  const [contentFrozen, setContentFrozen] = useState(false);
  const [spinnerVisible, setSpinnerVisible] = useState(false);
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
    suspendAutoFollowRef.current = suspendAutoFollow;
    if (!resizeStateInitializedRef.current) {
      resizeStateInitializedRef.current = true;
      if (!suspendAutoFollow) {
        return;
      }
    }

    if (suspendAutoFollow) {
      frozenScrollTopRef.current = containerRef.current?.scrollTop ?? 0;
      frozenRestorePendingRef.current = true;
      if (shouldStickToBottomRef.current) {
        pendingFollowSyncRef.current = true;
      }
      setSpinnerVisible(true);
      setContentFrozen(true);
      return;
    }

    setContentFrozen(false);
    setSpinnerVisible(false);
  }, [suspendAutoFollow]);

  useLayoutEffect(() => {
    if (
      suspendAutoFollow ||
      contentFrozen ||
      !frozenRestorePendingRef.current
    ) {
      return;
    }

    frozenRestorePendingRef.current = false;
    if (pendingFollowSyncRef.current) {
      pendingFollowSyncRef.current = false;
      if (shouldStickToBottomRef.current) {
        scrollToBottom();
      }
      return;
    }

    const container = containerRef.current;
    if (container) {
      programmaticScrollRef.current = true;
      requestAnimationFrame(() => {
        container.scrollTop = frozenScrollTopRef.current;
        requestAnimationFrame(() => {
          programmaticScrollRef.current = false;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentFrozen, suspendAutoFollow]);

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
    if (activeMatchSeq === null || contentFrozen) return;
    const idx = lines.findIndex((l) => l.seq === activeMatchSeq);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchSeq, contentFrozen, lines.length]);

  useLayoutEffect(() => {
    const pending = prependScrollRef.current;
    if (!pending || pending.prevFirstSeq === null || contentFrozen) return;

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
  }, [contentFrozen, lines, dense]);

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

    if (suspendAutoFollowRef.current || contentFrozen) {
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
    if (programmaticScrollRef.current || contentFrozen) return;

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
      className={`log-lines${dense ? " dense" : ""}${
        contentFrozen ? " resizing" : ""
      }`}
      onScroll={handleScroll}
      ref={containerRef}
      style={{ position: "relative" }}
    >
      {!contentFrozen ? (
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
              const timeMatch = logLine.text.match(
                /^(\d{2}:\d{2}:\d{2})(?:\s+|$)/,
              );
              const time = timeMatch?.[1] ?? "";
              const message = timeMatch
                ? logLine.text.slice(timeMatch[0].length)
                : logLine.text;
              const lowerText = logLine.text.toLowerCase();
              const matched =
                term.length > 0 && lowerText.includes(term.toLowerCase());
              const severity =
                lowerText.includes("error") || lowerText.includes("fail")
                  ? " error"
                  : lowerText.includes("warn")
                    ? " warning"
                    : lowerText.includes("success") ||
                        lowerText.includes("running")
                      ? " success"
                      : "";

              return (
                <div
                  className={`log-line${matched ? " log-line-matched" : ""}${
                    activeMatchSeq === logLine.seq ? " log-line-active" : ""
                  }${severity}`}
                  data-log-seq={logLine.seq}
                  key={logLine.seq}
                  style={{
                    position: "absolute",
                    top: item.start,
                    left: 0,
                    width: "100%",
                    height: item.size,
                  }}
                >
                  <span className="log-number">{logLine.seq}</span>
                  <span className="log-time">{time}</span>
                  <span className="log-message">
                    {getColorizedMessage(message)}
                  </span>
                </div>
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
      ) : null}
      {spinnerVisible ? (
        <div className="log-resize-placeholder" aria-hidden="true" />
      ) : null}
    </div>
  );
}
