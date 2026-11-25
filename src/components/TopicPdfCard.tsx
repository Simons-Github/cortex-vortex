import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getGeminiStatus, removeTopicPdf } from "@/lib/gemini-actions";
import { attachTopicPdf } from "@/lib/topic-pdf-client";
import type { TopicPdfMeta } from "@/lib/supabase";

export function PdfTopicBadge() {
  return (
    <span className="rounded-full border border-sky-900/60 bg-sky-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300/90">
      PDF
    </span>
  );
}

export function TopicPdfCard({
  topicId,
  pdf,
}: {
  topicId: string;
  pdf: TopicPdfMeta | null | undefined;
}) {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"attach" | "remove" | null>(null);

  const geminiStatus = useQuery({
    queryKey: ["gemini-status", session?.access_token ?? null],
    queryFn: () => getGeminiStatus({ data: { accessToken: session?.access_token ?? null } }),
    staleTime: 60_000,
  });

  const canAttach = geminiStatus.data?.userKey?.configured === true;
  const ready = pdf?.status === "ready";
  const failed = pdf?.status === "failed";

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["merged-topics", user?.id] });
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !user) return;
    if (!canAttach) {
      toast.error("PDF sources require your own Gemini API key. Add one in Settings.");
      return;
    }
    setBusy("attach");
    try {
      const result = await attachTopicPdf({
        userId: user.id,
        topicId,
        file,
        accessToken: session?.access_token ?? null,
      });
      if (!result.ok) {
        toast.error(result.message);
      } else {
        toast.success("PDF attached. Quizzes and explanations will use this document.");
        refresh();
      }
    } catch (error) {
      console.error("Failed to attach PDF:", error);
      toast.error("Couldn't attach this PDF. Please try again.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setBusy("remove");
    try {
      const result = await removeTopicPdf({
        data: { accessToken: session?.access_token ?? null, topicId },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("PDF removed.");
      refresh();
    } catch (error) {
      console.error("Failed to remove PDF:", error);
      toast.error("Couldn't remove this PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Source PDF
          </p>
          {ready ? (
            <p className="mt-1 truncate text-sm text-foreground">
              {pdf.fileName}
              {pdf.pageCount ? ` · ${pdf.pageCount} pages` : ""}
            </p>
          ) : failed ? (
            <p className="mt-1 text-sm text-destructive">
              {pdf.failureReason ?? "Couldn't read this PDF."}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Attach one PDF (5 MB, 20 pages). Quizzes use a stored study brief, not the raw file.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            data-testid="topic-pdf-input"
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {canAttach ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {busy === "attach" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {ready || failed ? "Replace PDF" : "Attach PDF"}
            </button>
          ) : (
            <Link
              to="/settings"
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Add API key to attach
            </Link>
          )}
          {(ready || failed) && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void onRemove()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {busy === "remove" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
