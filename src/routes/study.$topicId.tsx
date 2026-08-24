import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Lock,
  LogIn,
  Play,
  Repeat2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { z } from "zod";
import { TopNav } from "@/components/TopNav";
import { LiveMasteryBadge } from "@/components/LiveMasteryBadge";
import { AuthDialog } from "@/components/AuthDialog";
import { useAuth } from "@/lib/auth";
import { levelFor, topics, type ChatTurn, type Topic } from "@/lib/mock-data";
import { explainTopic, generateQuiz } from "@/lib/gemini-actions";
import { DAILY_QUOTA_TOAST, QUIZ_SESSION_SIZE, type FallbackReason } from "@/lib/gemini-types";
import type { GeneratedQuizQuestion } from "@/lib/gemini";
import { useMasteryStore } from "@/lib/mastery-store";
import { formatMasteryDelta, quizMasteryDelta } from "@/lib/quiz-mastery";
import { clearStoredFirstQuestion, readStoredFirstQuestion } from "@/lib/quiz-preload";
import { getMergedTopics, logQuizAttempt, type TopicSource } from "@/lib/supabase";

const studySearchSchema = z.object({
  tab: z.enum(["explanation", "quiz"]).optional(),
});

export const Route = createFileRoute("/study/$topicId")({
  head: () => ({
    meta: [
      { title: "Study Room — Cortex Vortex" },
      {
        name: "description",
        content: "Adaptive explanations and quizzes for the topic you are actively studying.",
      },
      { property: "og:title", content: "Study Room — Cortex Vortex" },
      {
        property: "og:description",
        content: "Explanations, quizzes and curated resources for this topic.",
      },
    ],
  }),
  validateSearch: (search) => studySearchSchema.parse(search),
  // Demo topics are static and resolved here synchronously. A `topicId` not
  // found in that list might still be a signed-in user's custom topic (only
  // discoverable client-side, after auth resolves) — the component below
  // handles that case instead of this loader throwing `notFound()` for it.
  loader: ({ params }) => topics.find((t) => t.id === params.topicId) ?? null,
  component: StudyRoom,
});

const PROMPT_TAGS = [
  { label: "Simplify explanation", variant: "simplify" as const },
  { label: "Deepen technical details", variant: "deepen" as const },
  { label: "Give a real-world example", variant: "example" as const },
  { label: "Quiz me on the weak spots", variant: "weakSpots" as const },
];

const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  "not-configured": "Gemini isn't configured on the server — showing a mock response instead.",
  "rate-limited": "Gemini rate limit reached — showing a mock response instead.",
  "api-error": "Gemini request failed — showing a mock response instead.",
};

function notifyFallback(reason?: FallbackReason) {
  toast.info(FALLBACK_MESSAGES[reason ?? "api-error"]);
}

const QUOTA_TOAST_MESSAGE = DAILY_QUOTA_TOAST;

/** Overlay shown on top of a grayed-out AI feature (chat input, quick prompts, quiz) when signed out. */
function SignInOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/85 p-6 text-center backdrop-blur-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <p className="max-w-xs text-sm text-foreground">
        Sign in to unlock AI-powered explanations and quizzes
      </p>
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

/** Overlay shown on top of a grayed-out AI feature once its daily quota has been used up. */
function QuotaExceededOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/85 p-6 text-center backdrop-blur-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <p className="max-w-xs text-sm text-foreground">{QUOTA_TOAST_MESSAGE}</p>
    </div>
  );
}

const QUOTA_RESET_KEY = "cortex-vortex:quota-reset-at:daily";
const QUOTA_LOCK_EVENT = "cortex-vortex:daily-quota-locked";

/** Reads a still-active combined-quota reset time, clearing any stale one. */
function readStoredQuotaResetAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(QUOTA_RESET_KEY);
  const resetAt = raw ? Number(raw) : NaN;
  if (!Number.isFinite(resetAt) || resetAt <= Date.now()) {
    window.localStorage.removeItem(QUOTA_RESET_KEY);
    return null;
  }
  return resetAt;
}

/** Persists the combined daily-quota lock so explain, quiz, and create-topic stay in sync. */
function storeQuotaResetAt(resetInHours: number): number {
  const resetAt = Date.now() + resetInHours * 60 * 60 * 1000;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(QUOTA_RESET_KEY, String(resetAt));
    window.dispatchEvent(new Event(QUOTA_LOCK_EVENT));
  }
  return resetAt;
}

function useDailyQuotaLock() {
  const [quotaResetAt, setQuotaResetAt] = useState<number | null>(readStoredQuotaResetAt);
  useEffect(() => {
    const sync = () => setQuotaResetAt(readStoredQuotaResetAt());
    window.addEventListener(QUOTA_LOCK_EVENT, sync);
    return () => window.removeEventListener(QUOTA_LOCK_EVENT, sync);
  }, []);
  return {
    quotaExceeded: quotaResetAt !== null,
    lockQuota: (resetInHours: number) => setQuotaResetAt(storeQuotaResetAt(resetInHours)),
  };
}

/** Shown in place of the study room while a custom topic is still being looked up, or once confirmed missing. */
function TopicStatusScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <Link
          to="/matrix"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Knowledge Matrix
        </Link>
        <div className="mt-10 flex min-h-[16rem] items-center justify-center rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {children}
        </div>
      </main>
    </div>
  );
}

function StudyRoom() {
  const params = Route.useParams();
  const demoTopic = Route.useLoaderData() as Topic | null;
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/study/$topicId" });
  const { user } = useAuth();
  const isAuthed = Boolean(user);

  // Drop leftover firstQuestion / firstQuestionFallback (and any other junk)
  // from old bookmarks so the correct answer never stays in the address bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const extra = [...new URL(window.location.href).searchParams.keys()].filter(
      (key) => key !== "tab",
    );
    if (extra.length === 0) return;
    void navigate({
      search: search.tab ? { tab: search.tab } : {},
      replace: true,
    });
  }, [navigate, search.tab]);

  // `demoTopic` is only ever set for the app's built-in topics — anything
  // else might be a signed-in user's custom topic, discoverable only via
  // `getMergedTopics` (custom_topics is RLS-scoped to the caller).
  const customTopicsQuery = useQuery({
    queryKey: ["merged-topics", user?.id],
    queryFn: () => getMergedTopics(user!.id),
    enabled: !demoTopic && isAuthed,
    staleTime: 15_000,
  });

  const customTopic = customTopicsQuery.data?.find((t) => t.id === params.topicId);
  const topic: Topic | undefined = demoTopic ?? customTopic;
  const source: TopicSource = demoTopic ? "demo" : "custom";

  if (!topic) {
    if (!demoTopic && isAuthed && customTopicsQuery.isLoading) {
      return (
        <TopicStatusScreen>
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading topic…
          </span>
        </TopicStatusScreen>
      );
    }
    return <TopicStatusScreen>Couldn't find that topic.</TopicStatusScreen>;
  }

  return <StudyRoomContent topic={topic} source={source} initialTab={search.tab} />;
}

function StudyRoomContent({
  topic,
  source,
  initialTab,
}: {
  topic: Topic;
  source: TopicSource;
  initialTab?: "explanation" | "quiz" | undefined;
}) {
  const [storedFirst] = useState(() => readStoredFirstQuestion(topic.id));
  const preloadedFirstQuestion = storedFirst?.question;
  const preloadedFirstQuestionFallback = storedFirst?.fallback;
  const [tab, setTab] = useState<"explanation" | "quiz">(
    () => initialTab ?? (preloadedFirstQuestion ? "quiz" : "explanation"),
  );

  useEffect(() => {
    clearStoredFirstQuestion(topic.id);
  }, [topic.id]);

  const { getMastery, isLoading } = useMasteryStore();
  const [mastery, setMastery] = useState(() => getMastery(topic));
  const syncedInitialRef = useRef(false);

  // Adopt the store's value once it has finished its initial load (synced
  // mode fetches over the network; local mode resolves immediately), but
  // never again afterwards so it doesn't clobber in-session quiz progress.
  useEffect(() => {
    if (syncedInitialRef.current || isLoading) return;
    syncedInitialRef.current = true;
    setMastery(getMastery(topic));
    // getMastery/topic are stable enough here; re-running only on the loading transition is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Link
          to="/matrix"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Knowledge Matrix
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-light tracking-tight text-foreground">{topic.title}</h1>
              {source === "custom" && (
                <span className="rounded-full border border-violet-900/60 bg-violet-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-300/90">
                  Custom
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {topic.category} · Last reviewed {topic.lastReviewed}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground">
              Level: {levelFor(mastery)} — {mastery}%
            </span>
            <LiveMasteryBadge score={mastery} />
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_18rem]">
          <div>
            <div className="inline-flex rounded-xl border border-border bg-card p-1">
              {(["explanation", "quiz"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-5 py-2 text-sm capitalize transition-colors ${
                    tab === t
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {tab === "explanation" ? (
                <ExplanationTab topic={topic} source={source} mastery={mastery} />
              ) : (
                <QuizTab
                  topic={topic}
                  mastery={mastery}
                  setMastery={setMastery}
                  preloadedFirstQuestion={preloadedFirstQuestion}
                  preloadedFirstQuestionFallback={preloadedFirstQuestionFallback}
                  onReviewExplanation={() => setTab("explanation")}
                />
              )}
            </div>
          </div>

          <aside className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Recommended Resources
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Selected for your current gap in {topic.title.toLowerCase()}.
            </p>
            <ul className="mt-4 space-y-3">
              {topic.resources.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-border bg-background p-3 transition-colors hover:border-zinc-700"
                >
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {r.kind === "video" ? (
                      <Play className="h-3 w-3" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {r.kind} · {r.minutes} min
                  </div>
                  <p className="mt-1.5 text-sm text-foreground">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{r.source}</p>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}

const MARKDOWN_CLASSNAMES =
  "[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal " +
  "[&_ol]:pl-5 [&_li]:mb-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic " +
  "[&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-medium [&_h1]:text-foreground [&_h2]:mb-2 [&_h2]:text-sm " +
  "[&_h2]:font-medium [&_h2]:text-foreground [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground " +
  "[&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs " +
  "[&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3 [&_pre]:text-xs " +
  "[&_a]:underline [&_a]:text-foreground";

function ExplanationTab({
  topic,
  source,
  mastery,
}: {
  topic: Topic;
  source: TopicSource;
  mastery: number;
}) {
  const { user, session } = useAuth();
  const isAuthed = Boolean(user);
  const [turns, setTurns] = useState<ChatTurn[]>(topic.conversation);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const { quotaExceeded, lockQuota } = useDailyQuotaLock();
  const isCustomTopic = source === "custom";

  const send = async (
    text: string,
    variant: "simplify" | "deepen" | "example" | "weakSpots" | "custom" = "custom",
  ) => {
    // Signed-out visitors never reach explainTopic — the UI is disabled for
    // them too, but this guard keeps it true even if that ever changes.
    // Custom topics are allowed through (`explainTopic` resolves them server-side).
    if (!isAuthed || quotaExceeded) return;
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const id = `${Date.now()}`;
    setTurns((prev) => [...prev, { id: `u${id}`, role: "user", text: trimmed }]);
    setDraft("");
    setLoading(true);

    try {
      const result = await explainTopic({
        data: {
          topicId: topic.id,
          mastery,
          message: trimmed,
          variant,
          accessToken: session?.access_token ?? null,
        },
      });
      if (result.quotaExceeded) {
        lockQuota(result.resetInHours);
        setTurns((prev) => [
          ...prev,
          { id: `a${id}`, role: "assistant", text: QUOTA_TOAST_MESSAGE },
        ]);
        toast.error(QUOTA_TOAST_MESSAGE);
        return;
      }
      setTurns((prev) => [...prev, { id: `a${id}`, role: "assistant", text: result.text }]);
      if (result.fallback) notifyFallback(result.reason);
    } catch (error) {
      console.error(error);
      setTurns((prev) => [
        ...prev,
        {
          id: `a${id}`,
          role: "assistant",
          text: isCustomTopic
            ? "Couldn't explain this custom topic. Please try again."
            : "Something went wrong reaching the tutor. Please try again.",
        },
      ]);
      toast.error("Couldn't reach the explanation service.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="space-y-4">
        {turns.map((t) => (
          <div key={t.id} className={t.role === "user" ? "flex justify-end" : "flex gap-3"}>
            {t.role === "assistant" && (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            )}
            {t.role === "assistant" ? (
              <div
                className={`max-w-[42rem] rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-zinc-300 ${MARKDOWN_CLASSNAMES}`}
              >
                <ReactMarkdown>{t.text}</ReactMarkdown>
              </div>
            ) : (
              <p className="max-w-[42rem] rounded-2xl bg-zinc-800 px-4 py-3 text-sm leading-relaxed text-foreground">
                {t.text}
              </p>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="relative mt-6">
        <div
          className={isAuthed && !quotaExceeded ? "" : "pointer-events-none select-none opacity-40"}
        >
          <div className="flex flex-wrap gap-2">
            {PROMPT_TAGS.map((p) => (
              <button
                key={p.label}
                onClick={() => send(p.label, p.variant)}
                disabled={loading || !isAuthed || quotaExceeded}
                tabIndex={isAuthed && !quotaExceeded ? undefined : -1}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-zinc-600 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {p.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft, "custom");
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={loading || !isAuthed || quotaExceeded}
              tabIndex={isAuthed && !quotaExceeded ? undefined : -1}
              placeholder="Ask about this topic"
              className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-600 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !isAuthed || quotaExceeded || !draft.trim()}
              tabIndex={isAuthed && !quotaExceeded ? undefined : -1}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-200 px-5 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send
            </button>
          </form>
        </div>

        {!isAuthed ? <SignInOverlay /> : quotaExceeded ? <QuotaExceededOverlay /> : null}
      </div>
    </div>
  );
}

function appendUniqueQuestions(
  existing: GeneratedQuizQuestion[],
  incoming: GeneratedQuizQuestion[],
): GeneratedQuizQuestion[] {
  const seen = new Set(existing.map((q) => q.question.trim().toLowerCase()));
  const extra: GeneratedQuizQuestion[] = [];
  for (const q of incoming) {
    const key = q.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(q);
  }
  return [...existing, ...extra];
}

function shuffleCopy<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) continue;
    next[i] = b;
    next[j] = a;
  }
  return next;
}

function QuizRecap({
  questions,
  answers,
  gain,
  loading,
  hasRetries,
  missed,
  onAgain,
  onRetryMissed,
  onStudy,
}: {
  questions: GeneratedQuizQuestion[];
  answers: Record<number, number>;
  gain: number;
  loading: boolean;
  hasRetries: boolean;
  missed: { q: GeneratedQuizQuestion; i: number; picked: number }[];
  onAgain: () => void;
  onRetryMissed: () => void;
  onStudy: () => void;
}) {
  const correctCount = questions.reduce(
    (n, q, i) => n + (answers[i] === q.correctOptionIndex ? 1 : 0),
    0,
  );

  return (
    <div className="rounded-2xl border border-border bg-[#121212] p-6">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {hasRetries ? "Visit so far" : "Round complete"}
      </p>
      <h2 className="mt-2 text-2xl font-light tracking-tight text-foreground">
        {correctCount} / {questions.length} correct
      </h2>
      <p
        className={`mt-1 text-sm ${
          gain > 0 ? "text-foreground" : gain < 0 ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {formatMasteryDelta(gain)} mastery {hasRetries ? "this visit" : "this round"}
      </p>
      {hasRetries ? (
        <p className="mt-1 text-xs text-muted-foreground">Including retries this visit</p>
      ) : null}

      {missed.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          {hasRetries
            ? "Latest retry cleared — nothing left to retry."
            : "Clean sweep — nothing to review."}
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {missed.map(({ q, i, picked }) => (
            <li key={i} className="rounded-xl border border-border bg-background p-4">
              <p className="text-sm text-foreground">{q.question}</p>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>You chose {q.options[picked]}</span>
              </p>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Correct: {q.options[q.correctOptionIndex]}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onStudy}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          Review in explanation
        </button>
        {missed.length > 0 ? (
          <button
            type="button"
            onClick={onRetryMissed}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Repeat2 className="h-4 w-4" />
            Retry missed
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAgain}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-4 py-2 text-sm text-foreground transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Another round
        </button>
      </div>
    </div>
  );
}

function QuizTab({
  topic,
  mastery,
  setMastery,
  preloadedFirstQuestion,
  preloadedFirstQuestionFallback,
  onReviewExplanation,
}: {
  topic: Topic;
  mastery: number;
  setMastery: (n: number) => void;
  preloadedFirstQuestion?: GeneratedQuizQuestion | undefined;
  preloadedFirstQuestionFallback?: boolean | undefined;
  onReviewExplanation: () => void;
}) {
  const { user, session } = useAuth();
  const isAuthed = Boolean(user);
  const { applyQuizResult, touchStreak, mode } = useMasteryStore();
  const [questions, setQuestions] = useState<GeneratedQuizQuestion[]>(() =>
    preloadedFirstQuestion ? [preloadedFirstQuestion] : [],
  );
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [gain, setGain] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"playing" | "recap">("playing");
  const [segmentStart, setSegmentStart] = useState(0);
  const { quotaExceeded, lockQuota } = useDailyQuotaLock();
  const gainsRef = useRef<Record<number, number>>({});
  const fetchedRef = useRef(false);
  const askedStemsRef = useRef<string[]>(
    preloadedFirstQuestion ? [preloadedFirstQuestion.question] : [],
  );
  // "Once per visit" — touch_streak is idempotent per calendar day server-side anyway,
  // this just avoids firing the RPC/local update on every single answer.
  const streakTouchedRef = useRef(false);
  const accessToken = session?.access_token ?? null;

  const rememberStems = (incoming: GeneratedQuizQuestion[]) => {
    const have = new Set(askedStemsRef.current.map((s) => s.trim().toLowerCase()));
    for (const q of incoming) {
      const key = q.question.trim().toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      askedStemsRef.current.push(q.question);
    }
  };

  const loadQuestions = (seeded: GeneratedQuizQuestion[], mode: "fill" | "replace") => {
    const needed = QUIZ_SESSION_SIZE - seeded.length;
    if (needed <= 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    generateQuiz({
      data: {
        topicId: topic.id,
        mastery,
        count: needed,
        avoid: askedStemsRef.current,
        accessToken,
      },
    })
      .then((result) => {
        if (result.quotaExceeded) {
          lockQuota(result.resetInHours);
          toast.error(QUOTA_TOAST_MESSAGE);
          return;
        }
        rememberStems(result.questions);
        const next = appendUniqueQuestions(seeded, result.questions).slice(0, QUIZ_SESSION_SIZE);
        if (mode === "replace") {
          setQuestions(next);
          setIndex(0);
          setAnswers({});
          setGain(0);
          setSegmentStart(0);
          gainsRef.current = {};
          setPhase("playing");
        } else {
          setQuestions(next);
        }
        if (result.fallback) notifyFallback(result.reason);
      })
      .catch((error) => {
        console.error(error);
        toast.error("Couldn't reach the quiz generator.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    // Signed-out visitors never reach generateQuiz — re-runs automatically
    // (via the `isAuthed` dep below) once they sign in, unlocking in place.
    // Once the daily quota is used up, stop fetching entirely — there's
    // nothing more to show until the lock lifts.
    if (!isAuthed || !accessToken || quotaExceeded || fetchedRef.current) return;
    fetchedRef.current = true;
    const seeded = preloadedFirstQuestion ? [preloadedFirstQuestion] : [];
    loadQuestions(seeded, "fill");
    // topic.id is stable per mount; mastery intentionally excluded so an
    // already-fetched round doesn't get replaced mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic.id, isAuthed, quotaExceeded, accessToken]);

  const latestMissed = questions
    .slice(segmentStart)
    .map((q, j) => ({ q, i: segmentStart + j, picked: answers[segmentStart + j] }))
    .filter(
      (row): row is { q: GeneratedQuizQuestion; i: number; picked: number } =>
        row.picked !== undefined && row.picked !== row.q.correctOptionIndex,
    );

  const retryMissed = () => {
    if (latestMissed.length === 0) return;
    const shuffled = shuffleCopy(latestMissed.map((row) => row.q));
    const start = questions.length;
    setQuestions((prev) => [...prev, ...shuffled]);
    setAnswers((a) => {
      const next = { ...a };
      for (let i = 0; i < shuffled.length; i++) delete next[start + i];
      return next;
    });
    setSegmentStart(start);
    setIndex(start);
    setPhase("playing");
  };

  const q = questions[index];
  const selected = answers[index];
  const answered = selected !== undefined;
  const correct = q ? selected === q.correctOptionIndex : false;
  const questionGain = gainsRef.current[index] ?? 0;
  const isLastLoaded = questions.length > 0 && index >= questions.length - 1;
  const expectingMore = loading && questions.length < QUIZ_SESSION_SIZE;
  const isRoundComplete = !loading && questions.length > 0 && isLastLoaded;

  const choose = (i: number) => {
    if (answered || !q) return;
    setAnswers((a) => ({ ...a, [index]: i }));
    const isCorrect = i === q.correctOptionIndex;
    const previous = mastery;
    const predicted = quizMasteryDelta(isCorrect, previous);
    gainsRef.current[index] = predicted;
    setGain((g) => g + predicted);
    setMastery(Math.max(0, Math.min(100, previous + predicted)));

    applyQuizResult(topic.id, isCorrect, mastery)
      .then(({ score, delta }) => {
        setMastery(score);
        if (delta !== predicted) {
          gainsRef.current[index] = delta;
          setGain((g) => g - predicted + delta);
        }
      })
      .catch((error) => {
        console.error("Failed to save mastery:", error);
        toast.error("Couldn't update your mastery.");
      });

    if (mode === "synced") {
      void logQuizAttempt(topic.id, q.question, isCorrect).catch((error) => {
        console.error("Failed to log quiz attempt:", error);
        toast.error("Couldn't save this quiz attempt.");
      });
    }

    if (!streakTouchedRef.current) {
      streakTouchedRef.current = true;
      touchStreak().catch((error) => console.error("Failed to update streak:", error));
    }
  };

  if (!isAuthed) {
    return (
      <div className="relative rounded-2xl border border-border bg-[#121212] p-6">
        <div className="pointer-events-none select-none opacity-40">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Question 1 of {QUIZ_SESSION_SIZE}</span>
            <span>{formatMasteryDelta(gain)} Mastery this round</span>
          </div>
          <h2 className="mt-4 text-lg font-light leading-snug text-foreground">
            A quiz question tailored to your mastery level will appear here.
          </h2>
          <div className="mt-5 space-y-2.5">
            {["Option A", "Option B", "Option C", "Option D"].map((label) => (
              <div
                key={label}
                tabIndex={-1}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left text-sm text-foreground"
              >
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <SignInOverlay />
      </div>
    );
  }

  if (quotaExceeded && questions.length === 0) {
    return (
      <div className="relative rounded-2xl border border-border bg-[#121212] p-6">
        <div className="pointer-events-none select-none opacity-40">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Question 1 of {QUIZ_SESSION_SIZE}</span>
            <span className={gain > 0 ? "text-foreground" : gain < 0 ? "text-destructive" : ""}>
              {formatMasteryDelta(gain)} Mastery this round
            </span>
          </div>
          <h2 className="mt-4 text-lg font-light leading-snug text-foreground">
            You've used up today's AI quota.
          </h2>
          <div className="mt-5 space-y-2.5">
            {["Option A", "Option B", "Option C", "Option D"].map((label) => (
              <div
                key={label}
                tabIndex={-1}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-4 py-3 text-left text-sm text-foreground"
              >
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <QuotaExceededOverlay />
      </div>
    );
  }

  if (phase === "recap" && questions.length > 0) {
    return (
      <QuizRecap
        questions={questions}
        answers={answers}
        gain={gain}
        loading={loading}
        hasRetries={segmentStart > 0}
        missed={latestMissed}
        onAgain={() => loadQuestions([], "replace")}
        onRetryMissed={retryMissed}
        onStudy={onReviewExplanation}
      />
    );
  }

  if (!q) {
    return (
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-[#121212] p-6 text-center">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating a {QUIZ_SESSION_SIZE}-question round…
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground">Couldn't load this round.</p>
            <button
              type="button"
              onClick={() => loadQuestions([], "fill")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-[#121212] p-6">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Question {index + 1} of {expectingMore ? QUIZ_SESSION_SIZE : questions.length}
        </span>
        <span className={gain > 0 ? "text-foreground" : gain < 0 ? "text-destructive" : ""}>
          {formatMasteryDelta(gain)} Mastery this round
        </span>
      </div>

      {expectingMore && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Preparing the rest of this round…
        </p>
      )}

      {index === 0 && preloadedFirstQuestionFallback && !expectingMore && (
        <p className="mt-2 text-xs text-muted-foreground">First question used a fallback prompt.</p>
      )}

      <h2 className="mt-4 text-lg font-light leading-snug text-foreground">{q.question}</h2>

      <div className="mt-5 space-y-2.5">
        {q.options.map((o, i) => {
          const isPicked = selected === i;
          const isRight = i === q.correctOptionIndex;
          const state = !answered
            ? "border-border hover:border-zinc-600"
            : isRight
              ? "border-zinc-400 bg-zinc-900"
              : isPicked
                ? "border-destructive/60"
                : "border-border opacity-50";
          return (
            <button
              key={`${index}-${i}`}
              type="button"
              onClick={() => choose(i)}
              disabled={answered}
              className={`flex w-full items-center justify-between rounded-xl border bg-background px-4 py-3 text-left text-sm text-foreground transition-colors ${state}`}
            >
              <span>{o}</span>
              {answered && isRight && (
                <span className="text-xs text-muted-foreground">correct</span>
              )}
              {answered && isPicked && !isRight && (
                <span className="text-xs text-destructive">your answer</span>
              )}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="mt-5 rounded-xl border border-border bg-background p-4">
          <p className="text-sm font-medium text-foreground">
            {correct
              ? `Correct · ${formatMasteryDelta(questionGain)} mastery`
              : `Not quite · ${formatMasteryDelta(questionGain)} mastery`}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{q.explanation}</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <button
          type="button"
          onClick={() => {
            if (isRoundComplete) {
              setPhase("recap");
              return;
            }
            setIndex((i) => i + 1);
          }}
          disabled={!answered || (isLastLoaded && expectingMore)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-4 py-2 text-sm text-foreground transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          {isLastLoaded && expectingMore ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isRoundComplete ? (
            "See results"
          ) : (
            <>
              Next <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
