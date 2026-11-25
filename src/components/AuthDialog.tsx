import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GoogleIcon } from "@/components/GoogleIcon";
import { useAuth } from "@/lib/auth";

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-600 disabled:opacity-60";

export function AuthDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { signInWithPassword, signInWithGoogle, signUp } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const busy = loading || oauthLoading;

  const reset = () => {
    setEmail("");
    setPassword("");
    setConfirmationSent(false);
    setOauthLoading(false);
  };

  const continueWithGoogle = async () => {
    if (busy) return;
    setOauthLoading(true);

    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast.error(error);
        setOauthLoading(false);
        return;
      }
      // Redirect to Google is in progress — leave the button disabled.
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
      setOauthLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setLoading(true);

    try {
      if (mode === "sign-in") {
        const { error } = await signInWithPassword(email, password);
        if (error) {
          toast.error(error);
          return;
        }
        toast.success("Signed in — mastery is now synced to your account.");
        setOpen(false);
        reset();
        void navigate({ to: "/dashboard" });
      } else {
        const { error, needsEmailConfirmation } = await signUp(email, password);
        if (error) {
          toast.error(error);
          return;
        }
        if (needsEmailConfirmation) {
          setConfirmationSent(true);
          return;
        }
        toast.success("Account created — mastery is now synced to your account.");
        setOpen(false);
        reset();
        void navigate({ to: "/dashboard" });
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
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
      <DialogTrigger asChild>
        {trigger ?? (
          <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground transition-colors hover:border-zinc-600">
            <LogIn className="h-3.5 w-3.5" /> Sign in
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="border-border bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {mode === "sign-in" ? "Sign in" : "Create an account"}
          </DialogTitle>
          <DialogDescription>
            {mode === "sign-in"
              ? "Sync your mastery scores and streak across devices."
              : "Your local progress will be merged in automatically once you're signed in."}
          </DialogDescription>
        </DialogHeader>

        {confirmationSent ? (
          <p className="text-sm text-muted-foreground">
            Check <span className="text-foreground">{email}</span> for a confirmation link, then
            sign in below.
          </p>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => void continueWithGoogle()}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-zinc-100 px-5 py-2.5 text-sm font-medium text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {oauthLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GoogleIcon className="h-4 w-4" />
              )}
              Continue with Google
            </button>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className={inputClass}
              />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className={inputClass}
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-200 px-5 py-2.5 text-sm font-medium text-black hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mode === "sign-in" ? "Sign in" : "Sign up"}
              </button>
            </form>
          </div>
        )}

        <button
          onClick={() => {
            setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
            setConfirmationSent(false);
          }}
          className="text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
