import { masteryLevel } from "@/lib/mastery-store";

/** Badge for a live (Supabase/localStorage-tracked) mastery score — Novice 0–33, Developing 34–66, Mastered 67–100. */
export function LiveMasteryBadge({ score }: { score: number }) {
  const level = masteryLevel(score);
  const tone =
    level === "Mastered"
      ? "border-emerald-900/70 bg-emerald-950/50 text-emerald-400"
      : level === "Developing"
        ? "border-cyan-900/60 bg-cyan-950/40 text-cyan-300/90"
        : "border-zinc-800 bg-zinc-900/60 text-zinc-400";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] tracking-wide ${tone}`}>
      {level}
    </span>
  );
}
