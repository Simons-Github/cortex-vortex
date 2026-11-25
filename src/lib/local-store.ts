/**
 * localStorage-backed fallback for mastery + streak tracking, used whenever
 * Supabase isn't configured or the user isn't signed in (see
 * `src/lib/mastery-store.ts`). Keeps the app fully functional out of the box
 * with no backend required.
 *
 * Reads are exposed through `useSyncExternalStore`-compatible
 * `subscribeLocalState`/`getLocalStateSnapshot` so any component reading this
 * state re-renders live when it changes anywhere in the app (same tab via a
 * custom event, other tabs via the native `storage` event) — no full page
 * reload needed.
 */

export type LocalMasteryMap = Record<string, number>;
export type LocalStreak = { count: number; lastActiveDate: string | null };
export type LocalState = { mastery: LocalMasteryMap; streak: LocalStreak };

const MASTERY_KEY = "cortex-vortex:local-mastery";
const STREAK_KEY = "cortex-vortex:local-streak";
const CHANGE_EVENT = "cortex-vortex:local-state-changed";

const EMPTY_SNAPSHOT: LocalState = { mastery: {}, streak: { count: 0, lastActiveDate: null } };

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMastery(): LocalMasteryMap {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(MASTERY_KEY);
    return raw ? (JSON.parse(raw) as LocalMasteryMap) : {};
  } catch {
    return {};
  }
}

function readStreak(): LocalStreak {
  if (!hasStorage()) return { count: 0, lastActiveDate: null };
  try {
    const raw = window.localStorage.getItem(STREAK_KEY);
    return raw ? (JSON.parse(raw) as LocalStreak) : { count: 0, lastActiveDate: null };
  } catch {
    return { count: 0, lastActiveDate: null };
  }
}

let cachedSnapshot: LocalState | null = null;

function invalidateSnapshot() {
  cachedSnapshot = null;
}

function notify() {
  invalidateSnapshot();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/** Stable snapshot for `useSyncExternalStore` — only recomputed when `notify()` invalidates the cache. */
export function getLocalStateSnapshot(): LocalState {
  if (!hasStorage()) return EMPTY_SNAPSHOT;
  if (!cachedSnapshot) {
    cachedSnapshot = { mastery: readMastery(), streak: readStreak() };
  }
  return cachedSnapshot;
}

export function getLocalStateServerSnapshot(): LocalState {
  return EMPTY_SNAPSHOT;
}

export function subscribeLocalState(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function getAllLocalMastery(): LocalMasteryMap {
  return getLocalStateSnapshot().mastery;
}

function clampMastery(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function setLocalTopicMastery(topicId: string, score: number): number {
  const current = readMastery();
  const clamped = clampMastery(score);
  current[topicId] = clamped;
  window.localStorage.setItem(MASTERY_KEY, JSON.stringify(current));
  notify();
  return clamped;
}

export function clearLocalMastery(): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(MASTERY_KEY);
  notify();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Client-side mirror of the `touch_streak` RPC's logic, used only in local
 * (anonymous/no-backend) mode where there is no server to compute it.
 * Idempotent per calendar day, same as the server version.
 */
export function touchLocalStreak(): LocalStreak {
  const streak = readStreak();
  const today = todayIso();

  if (streak.lastActiveDate === today) {
    return streak;
  }

  const next: LocalStreak =
    streak.lastActiveDate === yesterdayIso()
      ? { count: streak.count + 1, lastActiveDate: today }
      : { count: 1, lastActiveDate: today };

  window.localStorage.setItem(STREAK_KEY, JSON.stringify(next));
  notify();
  return next;
}

export function clearLocalStreak(): void {
  if (!hasStorage()) return;
  window.localStorage.removeItem(STREAK_KEY);
  notify();
}
