import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { AuthDialog } from "@/components/AuthDialog";
import { HeroNeuronReveal } from "@/components/HeroNeuronReveal";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: Landing,
});

// A tiled feTurbulence filter rendered to an SVG data URI — gives the hero
// gradient a faint grain instead of a flat, overly clean fill. Computed once
// at module scope since the markup never changes.
const NOISE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
const NOISE_BACKGROUND_IMAGE = `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;

const CTA_BASE =
  "inline-flex items-center justify-center rounded-xl px-8 py-3 text-sm font-medium transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

function Landing() {
  const { user, isLoading } = useAuth();

  // Wait for the initial session lookup so signed-in visitors never see a
  // flash of marketing copy before landing on their dashboard.
  if (isLoading) {
    return <div className="min-h-screen bg-background" aria-hidden="true" />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-zinc-900 via-neutral-950 to-black">
      <HeroNeuronReveal />

      {/* Soft radial glow behind the headline — cool tone from --muted-foreground
          (same token VortexParticles uses). Ellipse stretches downward so a faint
          echo softens the void below the CTAs without a second focal point. */}
      <div
        className="animate-hero-glow pointer-events-none absolute left-1/2 top-[44%] z-0 h-[min(110vw,48rem)] w-[min(88vw,40rem)] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(ellipse 55% 70% at 50% 38%, color-mix(in oklch, var(--muted-foreground) 22%, transparent) 0%, color-mix(in oklch, var(--muted-foreground) 8%, transparent) 42%, transparent 78%)",
        }}
        aria-hidden="true"
      />

      {/* Bottom vignette — barely-there deepen toward the foot of the viewport
          so the composition feels finished top-to-bottom. */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 48%, color-mix(in oklch, var(--muted-foreground) 4%, transparent) 72%, oklch(0 0 0 / 0.55) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Fixed grain overlay — texture only, no motion. Above glow, below content. */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.24] mix-blend-overlay"
        style={{ backgroundImage: NOISE_BACKGROUND_IMAGE }}
        aria-hidden="true"
      />

      {/* Readability scrim — darkens only the copy/CTA well and a thin header
          band. Edges stay open so the neuron reveal remains the hero. */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            "radial-gradient(ellipse 62% 48% at 50% 52%, oklch(0 0 0 / 0.62) 0%, oklch(0 0 0 / 0.32) 46%, transparent 74%), linear-gradient(to bottom, oklch(0 0 0 / 0.4) 0%, transparent 22%)",
        }}
        aria-hidden="true"
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/80" />
          <span className="text-sm font-medium uppercase tracking-[0.18em] text-foreground">
            Cortex Vortex
          </span>
        </div>
        <AuthDialog />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 text-center">
        <h1
          className="max-w-2xl text-4xl font-light leading-tight tracking-tight text-foreground sm:text-6xl"
          style={{ textShadow: "0 2px 28px oklch(0 0 0 / 0.55)" }}
        >
          Knowledge fades quietly.
          <br />
          Cortex Vortex makes it{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #fff 0%, color-mix(in oklch, var(--muted-foreground) 45%, white) 100%)",
            }}
          >
            visible.
          </span>
        </h1>
        <p
          className="mt-5 max-w-md text-sm text-zinc-300 sm:text-base"
          style={{ textShadow: "0 1px 16px oklch(0 0 0 / 0.7)" }}
        >
          Track decay across every topic you've learned, then let adaptive AI explanations and
          quizzes bring it back before you forget for good.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <AuthDialog
            trigger={
              <button
                className={`${CTA_BASE} border border-zinc-700 bg-zinc-200 text-black hover:bg-zinc-100 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_-6px_rgba(255,255,255,0.18),0_2px_8px_-2px_rgba(255,255,255,0.12)]`}
              >
                Sign in
              </button>
            }
          />
          <Link
            to="/dashboard"
            className={`${CTA_BASE} border border-white/20 bg-white/10 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-sm hover:border-white/30 hover:bg-white/[0.16]`}
          >
            Explore demo
          </Link>
        </div>
      </main>
    </div>
  );
}
