import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_RADIUS = "220px";
/** Touch / no-hover: a wide static disc in the center — no fake cursor. */
const TOUCH_RADIUS = "min(48vmin, 420px)";

const REVEAL_MASK =
  "radial-gradient(circle var(--reveal-radius) at var(--reveal-x) var(--reveal-y), black 0%, transparent 70%)";

const INITIAL_REVEAL_STYLE = {
  "--reveal-x": "50%",
  "--reveal-y": "50%",
  "--reveal-radius": DEFAULT_RADIUS,
} as CSSProperties;

type HeroNeuronRevealProps = {
  className?: string;
};

const LAYER_FIT_CLASS =
  "pointer-events-none absolute inset-0 h-full w-full object-cover object-center";

/**
 * Decorative hero backdrop: idle neurons with a radial “activation” reveal
 * that follows the pointer. Position is written to CSS variables on the
 * wrapper ref — never React state — so pointer frames don’t re-render.
 *
 * The wrapper is pointer-events-none, so tracking listens on `window` and
 * maps client coords into the wrapper box.
 */
export function HeroNeuronReveal({ className }: HeroNeuronRevealProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const video = videoRef.current;
    if (!wrapper) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hoverQuery = window.matchMedia("(hover: hover)");

    const pos = { x: "50%", y: "50%" };
    let rafId = 0;

    const flush = () => {
      rafId = 0;
      wrapper.style.setProperty("--reveal-x", pos.x);
      wrapper.style.setProperty("--reveal-y", pos.y);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect();
      pos.x = `${event.clientX - rect.left}px`;
      pos.y = `${event.clientY - rect.top}px`;
      if (rafId === 0) {
        rafId = requestAnimationFrame(flush);
      }
    };

    const stopTracking = () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const pauseVideo = () => {
      video?.pause();
    };

    const playVideo = () => {
      if (!video) return;
      video.muted = true;
      void video.play().catch(() => {
        // Autoplay blocked — poster frame stays visible under the mask.
      });
    };

    const syncMode = () => {
      stopTracking();

      if (motionQuery.matches) {
        pauseVideo();
        wrapper.style.setProperty("--reveal-x", "50%");
        wrapper.style.setProperty("--reveal-y", "50%");
        wrapper.style.setProperty("--reveal-radius", DEFAULT_RADIUS);
        return;
      }

      playVideo();

      if (!hoverQuery.matches) {
        wrapper.style.setProperty("--reveal-x", "50%");
        wrapper.style.setProperty("--reveal-y", "50%");
        wrapper.style.setProperty("--reveal-radius", TOUCH_RADIUS);
        return;
      }

      wrapper.style.setProperty("--reveal-radius", DEFAULT_RADIUS);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    };

    syncMode();
    motionQuery.addEventListener("change", syncMode);
    hoverQuery.addEventListener("change", syncMode);

    return () => {
      stopTracking();
      pauseVideo();
      motionQuery.removeEventListener("change", syncMode);
      hoverQuery.removeEventListener("change", syncMode);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={INITIAL_REVEAL_STYLE}
      aria-hidden="true"
    >
      <img
        src="/neurons-idle.png"
        alt=""
        draggable={false}
        decoding="async"
        className={LAYER_FIT_CLASS}
        style={{ filter: "brightness(0.6)" }}
      />
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/neurons-active.png"
        className={cn(
          LAYER_FIT_CLASS,
          "animate-neuron-pulse motion-reduce:animate-none motion-reduce:opacity-0",
        )}
        style={{
          maskImage: REVEAL_MASK,
          WebkitMaskImage: REVEAL_MASK,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
        }}
      >
        <source src="/neurons-active.webm" type="video/webm" />
        <source src="/neurons-active.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
