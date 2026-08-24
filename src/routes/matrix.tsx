import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, LogIn, Plus, Search } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { LiveMasteryBadge } from "@/components/LiveMasteryBadge";
import { AuthDialog } from "@/components/AuthDialog";
import { CreateTopicDialog } from "@/components/CreateTopicDialog";
import { difficulties, topics } from "@/lib/mock-data";
import { useMasteryStore } from "@/lib/mastery-store";
import { useAuth } from "@/lib/auth";
import { getMergedTopics, isSupabaseConfigured, type MergedTopic } from "@/lib/supabase";

export const Route = createFileRoute("/matrix")({
  head: () => ({
    meta: [
      { title: "Knowledge Matrix — Cortex Vortex" },
      {
        name: "description",
        content:
          "Every topic you are tracking, with mastery levels, decay and review status in one grid.",
      },
      { property: "og:title", content: "Knowledge Matrix — Cortex Vortex" },
      {
        property: "og:description",
        content: "Mastery levels and decay across all of your tracked topics.",
      },
    ],
  }),
  component: Matrix,
});

const DEMO_TOPICS: MergedTopic[] = topics.map((t) => ({ ...t, source: "demo" }));

function Matrix() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [difficulty, setDifficulty] = useState<string>("All");
  const { user } = useAuth();
  const isAuthed = Boolean(user);
  // Live-tracked scores (Supabase when signed in, localStorage otherwise) —
  // react-query's cache means this refreshes automatically after a quiz
  // completes elsewhere in the app, no full page reload required.
  const { getMastery } = useMasteryStore();

  // Custom topics only exist for signed-in users (RLS-scoped) — signed-out
  // visitors just see the built-in demo set, same as before this feature.
  const mergedTopicsQuery = useQuery({
    queryKey: ["merged-topics", user?.id],
    queryFn: () => getMergedTopics(user!.id),
    enabled: isAuthed && isSupabaseConfigured,
    staleTime: 15_000,
  });

  const allTopics: MergedTopic[] = mergedTopicsQuery.data ?? DEMO_TOPICS;

  // Derived from the live topic list (rather than the static mock-data
  // export) so a "Custom" category shows up in the filter automatically
  // once the learner has created at least one topic — existing demo
  // categories keep their original order ahead of it.
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(allTopics.map((t) => t.category)))],
    [allTopics],
  );

  const filtered = useMemo(
    () =>
      allTopics.filter(
        (t) =>
          (category === "All" || t.category === category) &&
          (difficulty === "All" || t.difficulty === difficulty) &&
          t.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [allTopics, query, category, difficulty],
  );

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-3xl font-light tracking-tight text-foreground">Knowledge Matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered.length} of {allTopics.length} topics
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topics"
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-600"
            />
          </div>
          <Select value={category} onChange={setCategory} options={categories} />
          <Select value={difficulty} onChange={setDifficulty} options={[...difficulties]} />
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <CreateTopicCard isAuthed={isAuthed} />

          {filtered.map((t) => {
            const mastery = getMastery(t);
            return (
              <Link
                key={t.id}
                to="/study/$topicId"
                params={{ topicId: t.id }}
                className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-medium text-foreground">{t.title}</h2>
                      {t.source === "custom" && <CustomTopicBadge />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.category} · {t.difficulty}
                    </p>
                  </div>
                  <LiveMasteryBadge score={mastery} />
                </div>

                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{t.summary}</p>

                <div className="mt-5">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-zinc-300" style={{ width: `${mastery}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                    <span>{mastery}% mastery</span>
                    <span>Next review {t.nextReview}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">No topics match those filters.</p>
          )}
        </div>
      </main>
    </div>
  );
}

/** Small pill distinguishing a user-created topic from the app's built-in demo topics. */
function CustomTopicBadge() {
  return (
    <span className="rounded-full border border-violet-900/60 bg-violet-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-300/90">
      Custom
    </span>
  );
}

/**
 * Entry point for the create-custom-topic flow. Always visible on the grid;
 * signed-out visitors see a sign-in prompt matching `SignInOverlay`'s visual
 * language elsewhere in the app instead of the dialog trigger.
 */
function CreateTopicCard({ isAuthed }: { isAuthed: boolean }) {
  if (!isAuthed) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card p-5 text-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <p className="text-sm text-foreground">Sign in to create your own custom topics</p>
        <AuthDialog
          trigger={
            <button className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200 px-4 py-2 text-xs font-medium text-black transition-colors hover:bg-zinc-100">
              <LogIn className="h-3.5 w-3.5" /> Sign in
            </button>
          }
        />
      </div>
    );
  }

  return (
    <CreateTopicDialog
      trigger={
        <button className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-5 text-center transition-colors hover:border-zinc-600">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background">
            <Plus className="h-4 w-4 text-muted-foreground" />
          </span>
          <span className="text-sm font-medium text-foreground">Create new topic</span>
          <span className="text-xs text-muted-foreground">
            Start a 5-question round on anything you want to learn
          </span>
        </button>
      }
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-zinc-600"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-card">
          {o}
        </option>
      ))}
    </select>
  );
}
