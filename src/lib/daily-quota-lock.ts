/**
 * Combined daily AI quota lock (explain + quiz + create topic). Shared so
 * Study Room and Create Topic stay in sync after any endpoint returns
 * `quotaExceeded` — the lock is the client cache of that server decision.
 */
import { useEffect, useState } from "react";

export const DAILY_QUOTA_RESET_KEY = "cortex-vortex:quota-reset-at:daily";
const QUOTA_LOCK_EVENT = "cortex-vortex:daily-quota-locked";

/** Reads a still-active combined-quota reset time, clearing any stale one. */
export function readStoredQuotaResetAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(DAILY_QUOTA_RESET_KEY);
  const resetAt = raw ? Number(raw) : NaN;
  if (!Number.isFinite(resetAt) || resetAt <= Date.now()) {
    window.localStorage.removeItem(DAILY_QUOTA_RESET_KEY);
    return null;
  }
  return resetAt;
}

/** Persists the lock so explain, quiz, and create-topic UIs stay in sync. */
export function lockDailyQuota(resetInHours: number): number {
  const resetAt = Date.now() + resetInHours * 60 * 60 * 1000;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DAILY_QUOTA_RESET_KEY, String(resetAt));
    window.dispatchEvent(new Event(QUOTA_LOCK_EVENT));
  }
  return resetAt;
}

export function useDailyQuotaLock() {
  const [quotaResetAt, setQuotaResetAt] = useState<number | null>(readStoredQuotaResetAt);
  useEffect(() => {
    const sync = () => setQuotaResetAt(readStoredQuotaResetAt());
    window.addEventListener(QUOTA_LOCK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(QUOTA_LOCK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return {
    quotaExceeded: quotaResetAt !== null,
    lockQuota: (resetInHours: number) => setQuotaResetAt(lockDailyQuota(resetInHours)),
  };
}
