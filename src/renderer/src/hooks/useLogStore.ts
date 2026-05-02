/**
 * Renderer-side log viewport store.
 *
 * Architecture:
 *  - Each project+channel has a LogViewportState: the currently loaded window
 *    of log lines, tracking oldest/newest seq numbers and UI state.
 *  - Live `log-batch` events go into a per-channel pending queue, which is
 *    drained progressively at DRAIN_PER_FRAME lines per animation frame so
 *    batches look like a smooth stream rather than one big dump.
 *  - Historical loads (user scrolled near top) call `prependHistorical`,
 *    which bypasses the progressive queue and inserts lines immediately.
 *  - All state lives at module level — never in React state — so live log
 *    updates only re-render the specific log panel that subscribes to that
 *    channel, not the entire component tree.
 */

import { useEffect, useState } from "react";
import type {
  LogChannel,
  LogLine,
  LogQueryResult,
} from "../../../shared/dashboardTypes";

// ── Constants ────────────────────────────────────────────────────────────────

export const INITIAL_LIVE_LINES = 400;
export const LOAD_OLDER_CHUNK = 400;
const MAX_RENDERER_LINES = 4000;
// Lines moved from the pending queue into the visible store per animation frame.
const DRAIN_PER_FRAME = 16;

// ── Types ────────────────────────────────────────────────────────────────────

type StoreKey = string; // `${projectId}:${channel}`

export type LogViewportState = {
  lines: LogLine[];
  oldestLoadedSeq: number | null;
  newestLoadedSeq: number | null;
  /** Whether the viewport is pinned to the newest line and follows new output. */
  isFollowing: boolean;
  /** True while a historical fetch is in-flight. */
  isLoadingOlder: boolean;
  /** Whether the backend has lines older than oldestLoadedSeq. */
  hasMoreOlder: boolean;
  /** Count of live lines that arrived while the user was reading history. */
  unseenNewLineCount: number;
};

// ── Module-level state ───────────────────────────────────────────────────────

const viewports = new Map<StoreKey, LogViewportState>();
const pendingQueue = new Map<StoreKey, LogLine[]>();
const subscribers = new Map<StoreKey, Set<() => void>>();
let drainScheduled = false;

// ── Internal helpers ─────────────────────────────────────────────────────────

function makeKey(projectId: string, channel: LogChannel): StoreKey {
  return `${projectId}:${channel}`;
}

function emptyViewport(): LogViewportState {
  return {
    lines: [],
    oldestLoadedSeq: null,
    newestLoadedSeq: null,
    isFollowing: true,
    isLoadingOlder: false,
    hasMoreOlder: false,
    unseenNewLineCount: 0,
  };
}

function getOrCreate(k: StoreKey): LogViewportState {
  let v = viewports.get(k);
  if (!v) {
    v = emptyViewport();
    viewports.set(k, v);
  }
  return v;
}

function notify(k: StoreKey): void {
  subscribers.get(k)?.forEach((fn) => fn());
}

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  requestAnimationFrame(drainAll);
}

function drainAll(): void {
  drainScheduled = false;

  for (const [k, queue] of pendingQueue) {
    if (queue.length === 0) continue;

    const batch = queue.splice(0, DRAIN_PER_FRAME);
    const vp = getOrCreate(k);

    // Deduplicate by seq
    const existingSeqs = new Set(vp.lines.map((l) => l.seq));
    const newLines = batch.filter((l) => !existingSeqs.has(l.seq));
    if (newLines.length === 0) continue;

    const merged = [...vp.lines, ...newLines];

    // Trim from the top when following (keep newest lines)
    const trimmed =
      merged.length > MAX_RENDERER_LINES
        ? merged.slice(merged.length - MAX_RENDERER_LINES)
        : merged;

    viewports.set(k, {
      ...vp,
      lines: trimmed,
      oldestLoadedSeq: trimmed[0]?.seq ?? vp.oldestLoadedSeq,
      newestLoadedSeq: trimmed[trimmed.length - 1]?.seq ?? vp.newestLoadedSeq,
      unseenNewLineCount: vp.isFollowing
        ? 0
        : vp.unseenNewLineCount + newLines.length,
    });

    notify(k);
  }

  const hasMore = [...pendingQueue.values()].some((q) => q.length > 0);
  if (hasMore) scheduleDrain();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called when a log panel opens. Sets the initial loaded window immediately
 * without progressive animation — these are already-available historical lines.
 */
export function initViewport(
  projectId: string,
  channel: LogChannel,
  result: LogQueryResult,
): void {
  const k = makeKey(projectId, channel);
  // Discard any pending live lines that arrived before init completed
  const queue = pendingQueue.get(k);
  if (queue) queue.length = 0;

  viewports.set(k, {
    lines: [...result.lines],
    oldestLoadedSeq: result.oldestSeq,
    newestLoadedSeq: result.newestSeq,
    isFollowing: true,
    isLoadingOlder: false,
    hasMoreOlder: result.hasMoreOlder,
    unseenNewLineCount: 0,
  });
  notify(k);
}

/**
 * Called by App when a live `log-batch` IPC event arrives.
 * Lines enter the progressive display queue.
 */
export function appendLiveBatch(
  projectId: string,
  channel: LogChannel,
  lines: LogLine[],
): void {
  const k = makeKey(projectId, channel);
  let queue = pendingQueue.get(k);
  if (!queue) {
    queue = [];
    pendingQueue.set(k, queue);
  }
  for (const line of lines) queue.push(line);
  scheduleDrain();
}

/**
 * Called when the user scrolls near the top and older lines have been fetched.
 * Bypasses the progressive queue — inserts immediately so the user sees them
 * without delay after explicitly requesting history.
 */
export function prependHistorical(
  projectId: string,
  channel: LogChannel,
  result: LogQueryResult,
): void {
  const k = makeKey(projectId, channel);
  const vp = getOrCreate(k);

  const existingSeqs = new Set(vp.lines.map((l) => l.seq));
  const newLines = result.lines.filter((l) => !existingSeqs.has(l.seq));

  const merged = [...newLines, ...vp.lines];

  // Trim from the bottom (far end from where user is reading) to stay within budget
  const trimmed =
    merged.length > MAX_RENDERER_LINES
      ? merged.slice(0, MAX_RENDERER_LINES)
      : merged;

  viewports.set(k, {
    ...vp,
    lines: trimmed,
    oldestLoadedSeq: trimmed[0]?.seq ?? vp.oldestLoadedSeq,
    isLoadingOlder: false,
    hasMoreOlder: result.hasMoreOlder,
  });
  notify(k);
}

/** Mark a historical fetch as in-flight to prevent duplicate requests. */
export function setLoadingOlder(
  projectId: string,
  channel: LogChannel,
  loading: boolean,
): void {
  const k = makeKey(projectId, channel);
  const vp = getOrCreate(k);
  viewports.set(k, { ...vp, isLoadingOlder: loading });
  notify(k);
}

/** Update whether the viewport is pinned to the bottom. */
export function setFollowing(
  projectId: string,
  channel: LogChannel,
  following: boolean,
): void {
  const k = makeKey(projectId, channel);
  const vp = getOrCreate(k);
  if (vp.isFollowing === following) return;
  viewports.set(k, {
    ...vp,
    isFollowing: following,
    unseenNewLineCount: following ? 0 : vp.unseenNewLineCount,
  });
  notify(k);
}

/** Clear the unseen count and resume following (called on jump-to-bottom). */
export function clearUnseen(projectId: string, channel: LogChannel): void {
  const k = makeKey(projectId, channel);
  const vp = getOrCreate(k);
  viewports.set(k, { ...vp, unseenNewLineCount: 0, isFollowing: true });
  notify(k);
}

/** Reset state when a log-clear IPC event arrives. */
export function clearViewport(projectId: string, channel: LogChannel): void {
  const k = makeKey(projectId, channel);
  const queue = pendingQueue.get(k);
  if (queue) queue.length = 0;
  viewports.set(k, emptyViewport());
  notify(k);
}

/** Read current viewport state without subscribing. */
export function getViewport(
  projectId: string,
  channel: LogChannel,
): LogViewportState {
  return getOrCreate(makeKey(projectId, channel));
}

/**
 * React hook. Returns current viewport state and re-renders only this
 * component when the channel updates.
 */
export function useLogViewport(
  projectId: string,
  channel: LogChannel,
): LogViewportState {
  const k = makeKey(projectId, channel);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    let set = subscribers.get(k);
    if (!set) {
      set = new Set();
      subscribers.set(k, set);
    }
    const trigger = (): void => forceUpdate((n) => n + 1);
    set.add(trigger);
    return () => {
      set!.delete(trigger);
      if (set!.size === 0) subscribers.delete(k);
    };
  }, [k]);

  return getOrCreate(k);
}
