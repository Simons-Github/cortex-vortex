/**
 * Central mastery + streak data layer. Reconciles two write sources, plus a
 * display-only demo baseline:
 *
 *  - Supabase (`user_topic_mastery` / `profiles`) when configured and the
 *    user is signed in — the "synced" mode. Missing row = real 0%.
 *  - localStorage (`src/lib/local-store.ts`) when logged out — the "local"
 *    mode. An explicit key (even 0) wins; topics never written stay on the
 *    decorative `Topic.mastery` demo baseline for UI only.
 *  - Pure first-visit demo (local mode, empty mastery map): every topic
 *    renders from mock-data. Those values must never be written to
 *    localStorage or merged into Supabase on first login.
 *
 * Quiz answers go through `applyQuizResult` (server picks the delta via
 * `apply_quiz_result`; local mode uses the same `quizMasteryDelta` table).
 * Login-merge and other arbitrary bumps still use `incrementMastery`.
 * Both apply an optimistic local update immediately and then reconcile with
 * the authoritative row returned by Supabase. Writes always start from a
 * stored score or 0 — never from the decorative demo baseline.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  applyTopicQuizResult,
  getProfile,
  getTopicMastery,
  incrementTopicMastery,
  isSupabaseConfigured,
  touchStreak as touchStreakRpc,
  type Profile,
  type TopicMastery,
} from "@/lib/supabase";
import { quizMasteryDelta } from "@/lib/quiz-mastery";
import {
  clearLocalMastery,
  clearLocalStreak,
  getAllLocalMastery,
  getLocalStateServerSnapshot,
  getLocalStateSnapshot,
  setLocalTopicMastery,
  subscribeLocalState,
  touchLocalStreak,
} from "@/lib/local-store";
import type { Topic } from "@/lib/mock-data";

export type MasteryMode = "synced" | "local";
export type LiveMasteryLevel = "Novice" | "Developing" | "Mastered";

export type LiveDashboardStats = {
  decay: number;
  activeTopics: number;
  masteryRetained: number;
  nextReview: string;
  nextTopicId: string | undefined;
};

/** Novice 0–33, Developing 34–66, Mastered 67–100 — the live-tracking thresholds for a `mastery_score`. */
export function masteryLevel(score: number): LiveMasteryLevel {
  if (score <= 33) return "Novice";
  if (score <= 66) return "Developing";
  return "Mastered";
}

/**
 * Live dashboard aggregates from `getMastery`. Callers that need the pure
 * first-visit demo surface should branch to `dashboardStats` instead — this
 * helper is for synced / local-with-history (and mixed local) only.
 */
export function liveDashboardStats(
  topics: Topic[],
  getMastery: (topic: Topic) => number,
): LiveDashboardStats {
  const active = topics.filter((t) => getMastery(t) > 0);
  const fallbackId = topics[0]?.id;

  if (active.length === 0) {
    return {
      decay: 0,
      activeTopics: 0,
      masteryRetained: 0,
      nextReview: "No reviews yet",
      nextTopicId: fallbackId,
    };
  }

  const masteryRetained = Math.round(
    active.reduce((sum, t) => sum + getMastery(t), 0) / active.length,
  );
  const next = [...active].sort((a, b) => getMastery(a) - getMastery(b))[0];

  return {
    decay: Math.max(0, 100 - masteryRetained),
    activeTopics: active.length,
    masteryRetained,
    nextReview: "Due now",
    nextTopicId: next?.id ?? fallbackId,
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

const MASTERY_QUERY_KEY = "topic-mastery";
const PROFILE_QUERY_KEY = "profile";
const RPC_DELTA_LIMIT = 10;

/** Reaches an arbitrary total delta via repeated `increment_mastery` calls, since the RPC caps each call at ±10. */
async function incrementByAnyAmount(
  topicId: string,
  totalDelta: number,
): Promise<TopicMastery | null> {
  let remaining = totalDelta;
  let last: TopicMastery | null = null;
  while (remaining !== 0) {
    const step = Math.sign(remaining) * Math.min(RPC_DELTA_LIMIT, Math.abs(remaining));
    last = await incrementTopicMastery(topicId, step);
    remaining -= step;
  }
  return last;
}

/**
 * Called once after a successful sign-in/sign-up. Merges any localStorage
 * mastery data into Supabase — but only ever raises a topic's score, never
 * lowers it: a higher Supabase score always wins over a lower local one.
 */
export async function mergeLocalMasteryIntoSupabase(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  const localMastery = getAllLocalMastery();
  const topicIds = Object.keys(localMastery);
  if (topicIds.length === 0) {
    clearLocalStreak();
    return;
  }

  const remoteRows = await getTopicMastery(userId);
  const remoteByTopic = new Map(remoteRows.map((row) => [row.topic_id, row.mastery_score]));

  for (const topicId of topicIds) {
    const localScore = localMastery[topicId] ?? 0;
    const remoteScore = remoteByTopic.get(topicId) ?? 0;
    if (localScore > remoteScore) {
      await incrementByAnyAmount(topicId, localScore - remoteScore);
    }
  }

  clearLocalMastery();
  clearLocalStreak();
}

export function useMasteryStore() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mode: MasteryMode = isSupabaseConfigured && user ? "synced" : "local";

  const masteryQuery = useQuery({
    queryKey: [MASTERY_QUERY_KEY, user?.id],
    queryFn: () => getTopicMastery(user!.id),
    enabled: mode === "synced",
    staleTime: 15_000,
  });

  const profileQuery = useQuery({
    queryKey: [PROFILE_QUERY_KEY, user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: mode === "synced",
    staleTime: 15_000,
  });

  const localState = useSyncExternalStore(
    subscribeLocalState,
    getLocalStateSnapshot,
    getLocalStateServerSnapshot,
  );

  const remoteMasteryByTopic = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of masteryQuery.data ?? []) map[row.topic_id] = row.mastery_score;
    return map;
  }, [masteryQuery.data]);

  const masteryByTopic = mode === "synced" ? remoteMasteryByTopic : localState.mastery;
  const streakCount =
    mode === "synced" ? (profileQuery.data?.streak_count ?? 0) : localState.streak.count;

  /** Logged out + no local mastery keys → UI may show decorative demo baseline. */
  const isPureDemo = mode === "local" && Object.keys(localState.mastery).length === 0;

  /**
   * Display mastery for a topic:
   *  - synced: missing Supabase row → 0% (never demo baseline)
   *  - local with an explicit key (incl. 0) → that stored value
   *  - local without a key → decorative `topic.mastery` (UI only; never written)
   */
  const getMastery = useCallback(
    (topic: Topic): number => {
      if (mode === "synced") {
        return masteryByTopic[topic.id] ?? 0;
      }
      if (Object.hasOwn(masteryByTopic, topic.id)) {
        return masteryByTopic[topic.id]!;
      }
      return topic.mastery;
    },
    [mode, masteryByTopic],
  );

  const incrementMastery = useCallback(
    async (topicId: string, delta: number, fallbackBaseline = 0): Promise<number> => {
      if (mode === "synced" && user) {
        const previous = remoteMasteryByTopic[topicId] ?? fallbackBaseline;
        const optimistic = clamp(previous + delta);

        queryClient.setQueryData<TopicMastery[]>([MASTERY_QUERY_KEY, user.id], (rows) => {
          const list = rows ? [...rows] : [];
          const idx = list.findIndex((r) => r.topic_id === topicId);
          const existing = idx >= 0 ? list[idx] : undefined;
          if (existing) {
            list[idx] = { ...existing, mastery_score: optimistic };
          } else {
            list.push({
              id: `optimistic-${topicId}`,
              user_id: user.id,
              topic_id: topicId,
              mastery_score: optimistic,
              last_reviewed_at: new Date().toISOString(),
            });
          }
          return list;
        });

        try {
          const row = await incrementTopicMastery(topicId, delta);
          queryClient.setQueryData<TopicMastery[]>([MASTERY_QUERY_KEY, user.id], (rows) => {
            const list = rows ? [...rows] : [];
            const idx = list.findIndex((r) => r.topic_id === topicId);
            if (idx >= 0) list[idx] = row;
            else list.push(row);
            return list;
          });
          return row.mastery_score;
        } catch (error) {
          // Reconcile with the server's authoritative state rather than trust the optimistic guess.
          queryClient.invalidateQueries({ queryKey: [MASTERY_QUERY_KEY, user.id] });
          throw error;
        }
      }

      const current = localState.mastery[topicId] ?? fallbackBaseline;
      return setLocalTopicMastery(topicId, current + delta);
    },
    [mode, user, remoteMasteryByTopic, queryClient, localState.mastery],
  );

  /**
   * One quiz answer. Synced mode sends only `correct` and lets
   * `apply_quiz_result` choose the delta; local mode uses `quizMasteryDelta`
   * so demo / signed-out progress matches after a login merge.
   */
  const applyQuizResult = useCallback(
    async (
      topicId: string,
      correct: boolean,
      fallbackBaseline = 0,
    ): Promise<{ score: number; delta: number }> => {
      const previous =
        mode === "synced"
          ? (remoteMasteryByTopic[topicId] ?? fallbackBaseline)
          : (localState.mastery[topicId] ?? fallbackBaseline);
      const predicted = quizMasteryDelta(correct, previous);

      if (mode === "synced" && user) {
        const optimistic = clamp(previous + predicted);

        queryClient.setQueryData<TopicMastery[]>([MASTERY_QUERY_KEY, user.id], (rows) => {
          const list = rows ? [...rows] : [];
          const idx = list.findIndex((r) => r.topic_id === topicId);
          const existing = idx >= 0 ? list[idx] : undefined;
          if (existing) {
            list[idx] = { ...existing, mastery_score: optimistic };
          } else {
            list.push({
              id: `optimistic-${topicId}`,
              user_id: user.id,
              topic_id: topicId,
              mastery_score: optimistic,
              last_reviewed_at: new Date().toISOString(),
            });
          }
          return list;
        });

        try {
          const row = await applyTopicQuizResult(topicId, correct);
          queryClient.setQueryData<TopicMastery[]>([MASTERY_QUERY_KEY, user.id], (rows) => {
            const list = rows ? [...rows] : [];
            const idx = list.findIndex((r) => r.topic_id === topicId);
            if (idx >= 0) list[idx] = row;
            else list.push(row);
            return list;
          });
          return { score: row.mastery_score, delta: row.mastery_score - previous };
        } catch (error) {
          queryClient.invalidateQueries({ queryKey: [MASTERY_QUERY_KEY, user.id] });
          throw error;
        }
      }

      const score = setLocalTopicMastery(topicId, previous + predicted);
      return { score, delta: score - previous };
    },
    [mode, user, remoteMasteryByTopic, queryClient, localState.mastery],
  );

  const touchStreak = useCallback(async (): Promise<number> => {
    if (mode === "synced" && user) {
      try {
        const profile = await touchStreakRpc();
        queryClient.setQueryData<Profile>([PROFILE_QUERY_KEY, user.id], profile);
        return profile.streak_count ?? 0;
      } catch (error) {
        queryClient.invalidateQueries({ queryKey: [PROFILE_QUERY_KEY, user.id] });
        throw error;
      }
    }

    const streak = touchLocalStreak();
    return streak.count;
  }, [mode, user, queryClient]);

  return {
    mode,
    isPureDemo,
    isLoading: mode === "synced" && (masteryQuery.isLoading || profileQuery.isLoading),
    masteryByTopic,
    streakCount,
    getMastery,
    incrementMastery,
    applyQuizResult,
    touchStreak,
  };
}
