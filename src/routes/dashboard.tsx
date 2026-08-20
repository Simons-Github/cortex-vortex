import { useMemo, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DecayText } from "@/components/DecayText";
import { Vortex } from "@/components/Vortex";
import { VortexAtmosphere } from "@/components/VortexAtmosphere";
import { VortexParticles } from "@/components/VortexParticles";
import { TopNav } from "@/components/TopNav";
import { dashboardStats, topics } from "@/lib/mock-data";
import { liveDashboardStats, useMasteryStore } from "@/lib/mastery-store";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Cortex Vortex — Adaptive AI Learning Dashboard" },
      {
        name: "description",
        content:
          "Track knowledge decay, quiz yourself and keep mastery alive with Cortex Vortex, an adaptive AI learning companion.",
      },
      { property: "og:title", content: "Cortex Vortex — Adaptive AI Learning" },
      {
        property: "og:description",
        content: "Your live knowledge decay reading, adaptive quizzes and a full mastery matrix.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { getMastery, isLoading, isPureDemo } = useMasteryStore();
  const vortexRef = useRef<HTMLDivElement>(null);
  const decayTextRef = useRef<HTMLElement>(null);
  const stats = useMemo(() => {
    // Pure first-visit demo: polished mock aggregates (never persisted).
    // Synced / local-with-history: live aggregates via the same getMastery path.
    if (isPureDemo) {
      return {
        decay: dashboardStats.decay,
        activeTopics: dashboardStats.activeTopics,
        masteryRetained: dashboardStats.masteryRetained,
        nextReview: dashboardStats.nextReview,
        nextTopicId: topics[0]?.id,
      };
    }
    return liveDashboardStats(topics, getMastery);
  }, [getMastery, isPureDemo]);
  const nextTopicId = stats.nextTopicId;

  return (
    <div className="relative min-h-screen bg-background">
      <VortexAtmosphere vortexRef={vortexRef} />
      <TopNav />

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-5 pb-16 pt-10">
        {/* Soft edge fade is on Vortex (.vortex-card), not this wrapper, so the
            decay label and the quiz buttons below stay unmasked and sharp. */}
        <div className="relative isolate flex w-full flex-col items-center">
          <Vortex ref={vortexRef} />

          <div className="pointer-events-none absolute inset-x-0 bottom-[6%] z-[2] flex flex-col items-center">
            <DecayText
              ref={decayTextRef}
              decay={stats.decay}
              loading={isLoading}
              className="text-[3.25rem] font-light leading-none tracking-tighter text-foreground sm:text-[4.75rem]"
              style={{ textShadow: "0 2px 28px oklch(0 0 0 / 0.82)" }}
            />
            <p className="mt-1 text-xs uppercase tracking-[0.35em] text-muted-foreground">
              Knowledge Decay
            </p>
          </div>

          <VortexParticles
            decay={stats.decay}
            spawnOriginRef={decayTextRef}
            vortexRef={vortexRef}
          />
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {nextTopicId ? (
            <Link
              to="/study/$topicId"
              params={{ topicId: nextTopicId }}
              className="rounded-xl border border-zinc-700 bg-zinc-200 px-8 py-3 text-sm font-medium text-black transition-colors hover:bg-zinc-100"
            >
              Start Quiz
            </Link>
          ) : (
            <Link
              to="/matrix"
              className="rounded-xl border border-zinc-700 bg-zinc-200 px-8 py-3 text-sm font-medium text-black transition-colors hover:bg-zinc-100"
            >
              Start Quiz
            </Link>
          )}
          <Link
            to="/matrix"
            className="rounded-xl border border-border bg-card px-8 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Knowledge Matrix
          </Link>
        </div>

        <div className="mt-16 grid w-full max-w-3xl grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Stat label="Active Topics" value={isLoading ? "—" : String(stats.activeTopics)} />
          <Stat label="Mastery Retained" value={isLoading ? "—" : `${stats.masteryRetained}%`} />
          <Stat label="Next Review" value={isLoading ? "—" : stats.nextReview} />
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-6">
      <span className="text-2xl font-light text-foreground">{value}</span>
      <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
    </div>
  );
}
