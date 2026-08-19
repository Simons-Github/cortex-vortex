import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { getGeminiStatus } from "@/lib/gemini-actions";

const TONE_OPTIONS = ["Concise", "Socratic", "Deeply technical"] as const;
const PREVIEW_TONE = "Concise";
const PREVIEW_DAILY_GOAL = 20;

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Cortex Vortex" },
      {
        name: "description",
        content:
          "Check Gemini server configuration status, review cadence and profile preferences for Cortex Vortex.",
      },
      { property: "og:title", content: "Settings — Cortex Vortex" },
      {
        property: "og:description",
        content: "Gemini configuration status and learning preferences.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const geminiStatus = useQuery({
    queryKey: ["gemini-status"],
    queryFn: () => getGeminiStatus(),
    staleTime: 60_000,
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-light tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Model access and learning preferences.</p>

        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="h-4 w-4" /> Gemini API Key
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {geminiStatus.isLoading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking server configuration…
                  </span>
                ) : geminiStatus.data?.configured ? (
                  "Key configured on the server. Explanations and quizzes are generated live."
                ) : (
                  "No key configured on the server. Explanations and quizzes fall back to mock responses."
                )}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                For security, the Gemini API key is never entered or stored in the browser. Set{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5">GEMINI_API_KEY</code> in a
                server-side <code className="rounded bg-zinc-800 px-1 py-0.5">.env</code> file (see{" "}
                <code className="rounded bg-zinc-800 px-1 py-0.5">.env.example</code>) and restart
                the server.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                geminiStatus.data?.configured
                  ? "border-zinc-500 bg-secondary text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {geminiStatus.isLoading
                ? "…"
                : geminiStatus.data?.configured
                  ? "Configured"
                  : "Not configured"}
            </span>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">Profile</h2>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              Coming soon
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">These preferences are not saved yet.</p>

          <label className="mt-5 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Display name
          </label>
          <input
            disabled
            placeholder="Your name"
            className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />

          <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Daily goal · {PREVIEW_DAILY_GOAL} min
          </label>
          <input
            type="range"
            disabled
            min={5}
            max={90}
            step={5}
            defaultValue={PREVIEW_DAILY_GOAL}
            className="mt-3 w-full accent-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <label className="mt-6 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Explanation tone
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                disabled
                className={`rounded-full border px-3.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
                  t === PREVIEW_TONE
                    ? "border-zinc-500 bg-secondary text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled
            className="mt-6 flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>Decay reminders</span>
            <span className="relative h-5 w-9 rounded-full bg-zinc-300">
              <span className="absolute top-0.5 left-[1.15rem] h-4 w-4 rounded-full bg-black" />
            </span>
          </button>
        </section>
      </main>
    </div>
  );
}
