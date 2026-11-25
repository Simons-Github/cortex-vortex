import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useDailyQuotaLock } from "@/lib/daily-quota-lock";
import { createCustomTopic, getGeminiStatus } from "@/lib/gemini-actions";
import { DAILY_QUOTA_TOAST } from "@/lib/gemini-types";
import { storeFirstQuestion } from "@/lib/quiz-preload";
import { attachTopicPdf } from "@/lib/topic-pdf-client";
import type { CustomTopicLevel } from "@/lib/supabase";

const TITLE_MIN_LENGTH = 3;
const TITLE_MAX_LENGTH = 80;

const LEVEL_OPTIONS: { value: CustomTopicLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-600 disabled:opacity-60";

type CreatePhase = "creating" | "uploading" | "reading";

/** Inline validation message for the title field, or `null` once it's valid (or still empty — no error shown yet). */
function titleValidationError(trimmedTitle: string): string | null {
  if (trimmedTitle.length === 0) return null;
  if (trimmedTitle.length < TITLE_MIN_LENGTH) {
    return `Title must be at least ${TITLE_MIN_LENGTH} characters.`;
  }
  if (trimmedTitle.length > TITLE_MAX_LENGTH) {
    return `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

function phaseLabel(phase: CreatePhase | null, loading: boolean): string {
  if (!loading) return "Create topic";
  switch (phase) {
    case "uploading":
      return "Uploading PDF…";
    case "reading":
      return "Reading document…";
    default:
      return "Creating topic…";
  }
}

/**
 * Self-contained dialog for creating a Gemini-generated custom topic —
 * mirrors `AuthDialog`'s pattern (controls its own open state, trigger is
 * passed in). On success it navigates straight to the new topic's study
 * room with the already-generated first question attached, so the study
 * room can render question 1 immediately while `generateQuiz` fills the rest.
 * The question is stored in sessionStorage (not the URL) so the answer is not
 * shareable via bookmarks or copied links.
 *
 * An optional PDF can be attached when the learner has stored a BYOK key.
 */
export function CreateTopicDialog({ trigger }: { trigger: React.ReactNode }) {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { quotaExceeded, lockQuota } = useDailyQuotaLock();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<CustomTopicLevel>("beginner");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<CreatePhase | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const geminiStatus = useQuery({
    queryKey: ["gemini-status", session?.access_token ?? null],
    queryFn: () => getGeminiStatus({ data: { accessToken: session?.access_token ?? null } }),
    enabled: open,
    staleTime: 60_000,
  });

  const canAttachPdf = geminiStatus.data?.userKey?.configured === true;
  const trimmedTitle = title.trim();
  const titleError = titleValidationError(trimmedTitle);
  const canSubmit =
    !quotaExceeded &&
    trimmedTitle.length >= TITLE_MIN_LENGTH &&
    trimmedTitle.length <= TITLE_MAX_LENGTH &&
    !loading;

  const reset = () => {
    setTitle("");
    setLevel("beginner");
    setPdfFile(null);
    setFormError(null);
    setPhase(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (quotaExceeded) {
      toast.error(DAILY_QUOTA_TOAST);
      return;
    }
    if (!canSubmit || loading) return;
    setFormError(null);
    setLoading(true);
    setPhase("creating");

    try {
      const result = await createCustomTopic({
        data: { title: trimmedTitle, level, accessToken: session?.access_token ?? null },
      });

      // `CreateTopicResponse`'s three variants don't share a common
      // discriminant field (e.g. the `rejected`/`success` arms have no
      // `quotaExceeded: false`), so narrow with `in` rather than truthiness
      // checks on a property that may not exist on the other arms.
      if ("quotaExceeded" in result) {
        lockQuota(result.resetInHours);
        setOpen(false);
        reset();
        toast.error(DAILY_QUOTA_TOAST);
        return;
      }

      if ("rejected" in result) {
        // Keep the dialog (and the learner's typed input) exactly as-is so
        // they can tweak the title without starting over.
        setFormError(result.reason);
        return;
      }

      let firstQuestion = result.firstQuestion;
      let firstFallback = result.fallback;

      if (pdfFile && user && canAttachPdf) {
        const ingested = await attachTopicPdf({
          userId: user.id,
          topicId: result.topicId,
          file: pdfFile,
          accessToken: session?.access_token ?? null,
          onProgress: setPhase,
        });
        if (!ingested.ok) {
          toast.error(ingested.message);
        } else if (ingested.firstQuestion) {
          firstQuestion = ingested.firstQuestion;
          firstFallback = false;
        }
      }

      void queryClient.invalidateQueries({ queryKey: ["merged-topics", user?.id] });
      setOpen(false);
      reset();
      storeFirstQuestion(result.topicId, {
        question: firstQuestion,
        fallback: firstFallback || undefined,
      });
      navigate({
        to: "/study/$topicId",
        params: { topicId: result.topicId },
        search: { tab: "quiz" },
      });
    } catch (error) {
      console.error("Failed to create custom topic:", error);
      toast.error("Couldn't create your topic. Please try again.");
    } finally {
      setLoading(false);
      setPhase(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border-border bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">Create a custom topic</DialogTitle>
          <DialogDescription>
            {quotaExceeded
              ? "Custom topics use the same daily AI pool as explanations and quizzes."
              : "Gemini generates a 5-question round for any topic you name. Uses your combined daily AI quota."}
          </DialogDescription>
        </DialogHeader>

        {quotaExceeded ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <p className="max-w-xs text-sm text-foreground">{DAILY_QUOTA_TOAST}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX_LENGTH}
                placeholder="e.g. Quantum computing basics"
                disabled={loading}
                autoFocus
                className={inputClass}
              />
              {titleError && <p className="mt-1.5 text-xs text-destructive">{titleError}</p>}
            </div>

            <div className="inline-flex w-full rounded-xl border border-border bg-background p-1">
              {LEVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLevel(opt.value)}
                  disabled={loading}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    level === opt.value
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {!geminiStatus.isLoading &&
              (canAttachPdf ? (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Optional PDF source (5 MB, 20 pages)
                  </label>
                  <input
                    data-testid="topic-pdf-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={loading}
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    className="mt-1.5 block w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:text-foreground"
                  />
                  {pdfFile && <p className="mt-1 text-xs text-muted-foreground">{pdfFile.name}</p>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  To attach a PDF,{" "}
                  <Link to="/settings" className="underline hover:text-foreground">
                    add your own Gemini API key
                  </Link>
                  .
                </p>
              ))}

            {formError && <p className="text-xs text-destructive">{formError}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-200 px-5 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {phaseLabel(phase, loading)}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> Create topic
                </>
              )}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
