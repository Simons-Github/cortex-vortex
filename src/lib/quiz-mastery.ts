/**
 * Deterministic mastery delta for one quiz answer.
 *
 * Mirrors `public.apply_quiz_result` in `supabase/sql/quiz_attempts.sql` and
 * `levelFor()` in `src/lib/mock-data.ts` (Beginner ≤30, Intermediate ≤70,
 * Advanced otherwise). The client must never roll this with `Math.random()` —
 * synced mode lets Postgres pick the delta; local/demo uses this same table
 * so a later login-merge stays consistent.
 *
 * Gains are intentionally small so a 5-question round cannot jump to 100.
 */
export function quizMasteryDelta(correct: boolean, currentScore: number): number {
  if (!correct) return -1;
  if (currentScore <= 30) return 3;
  if (currentScore <= 70) return 2;
  return 1;
}

/** Display helper: "+3%", "+0%", "-1%". */
export function formatMasteryDelta(delta: number): string {
  if (delta > 0) return `+${delta}%`;
  if (delta === 0) return `+0%`;
  return `${delta}%`;
}
