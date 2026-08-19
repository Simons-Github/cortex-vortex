import { Link, useNavigate } from "@tanstack/react-router";
import { Settings, Flame, Cloud, HardDrive, LogOut, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { AuthDialog } from "@/components/AuthDialog";
import { useAuth } from "@/lib/auth";
import { useMasteryStore } from "@/lib/mastery-store";

export function TopNav() {
  const navigate = useNavigate();
  const { user, signOut, isSupabaseConfigured } = useAuth();
  const { mode, streakCount } = useMasteryStore();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/80" />
          <span className="text-sm font-medium tracking-[0.18em] uppercase text-foreground">
            Cortex Vortex
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground">
            <Flame className="h-3.5 w-3.5" />
            <span className="text-foreground">{streakCount} Day Streak</span>
          </div>

          <span
            title={
              mode === "synced"
                ? "Mastery and streak are synced to your account."
                : "Mastery and streak are stored on this device only — sign in to sync."
            }
            className={`hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs sm:flex ${
              mode === "synced"
                ? "border-emerald-900/70 bg-emerald-950/50 text-emerald-400"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {mode === "synced" ? (
              <Cloud className="h-3.5 w-3.5" />
            ) : (
              <HardDrive className="h-3.5 w-3.5" />
            )}
            {mode === "synced" ? "Synced to your account" : "Using local storage"}
          </span>

          {!user && (
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Exit demo
            </Link>
          )}

          {user ? (
            <button
              onClick={async () => {
                await signOut();
                toast.info("Signed out — mastery will be tracked locally on this device.");
                void navigate({ to: "/" });
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-zinc-600 hover:text-foreground"
              title={user.email ?? undefined}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          ) : (
            isSupabaseConfigured && <AuthDialog />
          )}

          <Link
            to="/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
