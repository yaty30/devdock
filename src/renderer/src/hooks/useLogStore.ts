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
// Hard cap for in-memory log retention per channel. Lines beyond this are
// dropped from the oldest end (when following) or newest end (when prepending
// historical lines) to prevent unbounded memory growth during long sessions.
const MAX_RENDERER_LINES = 50_000;
// Lines moved from the pending queue into the visible store per animation
// frame. Tuned high enough that bursts of 20K+ records flush within a few
// frames, while still letting React paint between batches.
const DRAIN_PER_FRAME = 500;

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
// Per-channel set of seq numbers currently in `viewports[k].lines`. Maintained
// incrementally so dedup during drains is O(batch) instead of O(buffer).
const loadedSeqs = new Map<StoreKey, Set<number>>();
let drainScheduled = false;

function getOrCreateSeqSet(k: StoreKey): Set<number> {
  let s = loadedSeqs.get(k);
  if (!s) {
    s = new Set();
    loadedSeqs.set(k, s);
  }
  return s;
}

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
    const seqSet = getOrCreateSeqSet(k);

    // Deduplicate by seq using the incrementally-maintained set (O(batch)).
    const newLines: LogLine[] = [];
    for (const line of batch) {
      if (!seqSet.has(line.seq)) {
        seqSet.add(line.seq);
        newLines.push(line);
      }
    }
    if (newLines.length === 0) continue;

    let merged: LogLine[];
    if (vp.lines.length + newLines.length > MAX_RENDERER_LINES) {
      // Trim from the top when following (keep newest lines).
      const overflow = vp.lines.length + newLines.length - MAX_RENDERER_LINES;
      for (let i = 0; i < overflow && i < vp.lines.length; i++) {
        seqSet.delete(vp.lines[i]!.seq);
      }
      merged =
        overflow >= vp.lines.length
          ? newLines.slice(-MAX_RENDERER_LINES)
          : vp.lines.slice(overflow).concat(newLines);
    } else {
      merged = vp.lines.concat(newLines);
    }

    viewports.set(k, {
      ...vp,
      lines: merged,
      oldestLoadedSeq: merged[0]?.seq ?? vp.oldestLoadedSeq,
      newestLoadedSeq: merged[merged.length - 1]?.seq ?? vp.newestLoadedSeq,
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

  const seqSet = new Set<number>();
  for (const line of result.lines) seqSet.add(line.seq);
  loadedSeqs.set(k, seqSet);

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
  const seqSet = getOrCreateSeqSet(k);

  const newLines = result.lines.filter((l) => !seqSet.has(l.seq));
  for (const line of newLines) seqSet.add(line.seq);

  let merged = newLines.concat(vp.lines);

  // Trim from the bottom (far end from where user is reading) to stay within budget.
  if (merged.length > MAX_RENDERER_LINES) {
    for (let i = MAX_RENDERER_LINES; i < merged.length; i++) {
      seqSet.delete(merged[i]!.seq);
    }
    merged = merged.slice(0, MAX_RENDERER_LINES);
  }

  viewports.set(k, {
    ...vp,
    lines: merged,
    oldestLoadedSeq: merged[0]?.seq ?? vp.oldestLoadedSeq,
    isLoadingOlder: false,
    hasMoreOlder: result.hasMoreOlder,
  });
  notify(k);
}

export function replaceWithHistoricalWindow(
  projectId: string,
  channel: LogChannel,
  result: LogQueryResult,
): void {
  const k = makeKey(projectId, channel);
  const seqSet = new Set<number>();
  for (const line of result.lines) seqSet.add(line.seq);
  loadedSeqs.set(k, seqSet);

  viewports.set(k, {
    lines: [...result.lines],
    oldestLoadedSeq: result.oldestSeq,
    newestLoadedSeq: result.newestSeq,
    isFollowing: false,
    isLoadingOlder: false,
    hasMoreOlder: result.hasMoreOlder,
    unseenNewLineCount: 0,
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
  loadedSeqs.delete(k);
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
