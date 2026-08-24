import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthDialog } from "@/components/AuthDialog";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/lib/auth";
import { deleteUserGeminiKey, getGeminiStatus, saveUserGeminiKey } from "@/lib/gemini-actions";

const TONE_OPTIONS = ["Concise", "Socratic", "Deeply technical"] as const;
const PREVIEW_TONE = "Concise";
const PREVIEW_DAILY_GOAL = 20;

const SAVE_ERROR_MESSAGE: Record<
  "invalid-key" | "rate-limited" | "byok-unavailable" | "save-failed",
  string
> = {
  "invalid-key": "That doesn't look like a valid Gemini API key.",
  "rate-limited": "Too many save attempts. Please wait a few minutes and try again.",
  "byok-unavailable": "Saving your own key isn't enabled on this server.",
  "save-failed": "Couldn't save your key right now. Please try again.",
};

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Cortex Vortex" },
      {
        name: "description",
        content:
          "Check Gemini server configuration, add your own API key, and review profile preferences for Cortex Vortex.",
      },
      { property: "og:title", content: "Settings — Cortex Vortex" },
      {
        property: "og:description",
        content: "Gemini configuration status, your API key, and learning preferences.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, session, isSupabaseConfigured } = useAuth();
  const queryClient = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState("");

  const geminiStatus = useQuery({
    queryKey: ["gemini-status", session?.access_token ?? null],
    queryFn: () => getGeminiStatus({ data: { accessToken: session?.access_token ?? null } }),
    staleTime: 60_000,
  });

  const saveKey = useMutation({
    mutationFn: (apiKey: string) =>
      saveUserGeminiKey({
        data: { accessToken: session?.access_token ?? null, apiKey },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(SAVE_ERROR_MESSAGE[result.reason]);
        return;
      }
      setApiKeyInput("");
      toast.success("Your Gemini API key is saved and encrypted.");
      void queryClient.invalidateQueries({ queryKey: ["gemini-status"] });
    },
    onError: () => {
      toast.error("Couldn't save your key right now. Please try again.");
    },
  });

  const removeKey = useMutation({
    mutationFn: () =>
      deleteUserGeminiKey({
        data: { accessToken: session?.access_token ?? null },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(
          result.reason === "byok-unavailable"
            ? "Saving your own key isn't enabled on this server."
            : "Couldn't remove your key right now. Please try again.",
        );
        return;
      }
      toast.success("Your Gemini API key was removed.");
      void queryClient.invalidateQueries({ queryKey: ["gemini-status"] });
    },
    onError: () => {
      toast.error("Couldn't remove your key right now. Please try again.");
    },
  });

  const platformConfigured = geminiStatus.data?.platformConfigured === true;
  const byokAvailable = geminiStatus.data?.byokAvailable === true;
  const userKey = geminiStatus.data?.userKey;
  const busy = saveKey.isPending || removeKey.isPending;

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
                ) : platformConfigured ? (
                  "Key configured on the server. Explanations and quizzes are generated live."
                ) : (
                  "No key configured on the server. Explanations and quizzes fall back to mock responses."
                )}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                The demo/platform key lives only in server env (
                <code className="rounded bg-zinc-800 px-1 py-0.5">GEMINI_API_KEY</code>) and is
                never shipped to the browser. It uses a shared daily quota of 5.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                platformConfigured
                  ? "border-zinc-500 bg-secondary text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {geminiStatus.isLoading ? "…" : platformConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-sm font-medium text-foreground">Your Gemini API key</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed-in accounts can store their own key, encrypted at rest. It is sent to the server
            to save, then forgotten here — we only show a hint afterwards. Your key skips the shared
            daily quota; short burst limits still apply.
          </p>

          {!user ? (
            <div className="mt-5">
              <p className="text-sm text-muted-foreground">
                Sign in to add your own Gemini API key.
              </p>
              {isSupabaseConfigured && (
                <div className="mt-3">
                  <AuthDialog
                    trigger={
                      <button
                        type="button"
                        className="rounded-xl border border-zinc-500 bg-secondary px-4 py-2 text-sm text-foreground"
                      >
                        Sign in
                      </button>
                    }
                  />
                </div>
              )}
            </div>
          ) : geminiStatus.isLoading ? (
            <p className="mt-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking whether your own key can be
              stored…
            </p>
          ) : !byokAvailable ? (
            <p className="mt-5 text-sm text-muted-foreground">
              Bring-your-own-key isn&apos;t enabled on this server. The operator needs{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5">USER_KEY_ENCRYPTION_SECRET</code>{" "}
              and <code className="rounded bg-zinc-800 px-1 py-0.5">SUPABASE_SERVICE_ROLE_KEY</code>
              .
            </p>
          ) : (
            <form
              className="mt-5"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = apiKeyInput.trim();
                if (!trimmed || busy) return;
                saveKey.mutate(trimmed);
              }}
            >
              {userKey?.configured && (
                <p className="mb-4 text-sm text-foreground">Saved key · ••••{userKey.hint}</p>
              )}

              <label
                htmlFor="user-gemini-key"
                className="block text-xs uppercase tracking-[0.2em] text-muted-foreground"
              >
                Your Gemini API key
              </label>
              <input
                id="user-gemini-key"
                type="password"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIza…"
                disabled={busy || geminiStatus.isLoading}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={busy || apiKeyInput.trim().length < 20}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-200 px-4 py-2 text-sm font-medium text-black hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveKey.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save key
                </button>
                {userKey?.configured && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeKey.mutate()}
                    className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Get a key at{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  Google AI Studio
                </a>
                . Usage is billed to your Google account. Restrict the key to the Generative
                Language API in Google Cloud. We encrypt it with AES-256-GCM before storage; the
                plaintext is never written to the database or returned to the browser.
              </p>
            </form>
          )}
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
