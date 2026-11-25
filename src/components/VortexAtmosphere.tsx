import { useEffect, useRef, type RefObject } from "react";
import {
  STAR_MOUSE_LERP,
  STAR_MOUSE_PARALLAX,
  fieldOmega,
  pointerNdcFromEvent,
  viewWorldHeight,
} from "./vortex-motion";

type Mote = {
  /** Radius in hero-disk units (1 = outer rim of the WebGL vortex). */
  u: number;
  /** Rest angle on the log-spiral, before time. */
  theta0: number;
  size: number;
  alpha: number;
  speedMul: number;
  /** 0 = arm highlight, 1 = inter-arm dust. */
  kind: 0 | 1;
};

type VortexAtmosphereProps = {
  /** Hero vortex — the field shares its center and inclination. */
  vortexRef: RefObject<HTMLElement | null>;
};

/**
 * Must stay in lockstep with VortexShader / VortexParticles: disk fraction of
 * the hero square, 48° inclination, two-arm log spiral.
 */
const DISK_RX = 0.44;
const INCLINATION_COS = Math.cos((48 * Math.PI) / 180);
const ARM_COUNT = 2;
const SPIRAL_PITCH = 9.8;
const TAU = Math.PI * 2;

const MIN_U = 1.14;
const MAX_U = 4.35;

function detectLowPower(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(max-width: 768px)").matches
  );
}

function fieldCount(): number {
  return detectLowPower() ? 70 : 160;
}

/**
 * Full-viewport halo behind the hero spiral. Same two-arm log spiral as
 * VortexShader, occupying the space the square canvas does not. Star drift
 * (Ω(u) + mouse parallax) is shared with WebGL StarField via vortex-motion.
 * Mote data lives in a ref — frames never re-render React.
 */
export function VortexAtmosphere({ vortexRef }: VortexAtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const motesRef = useRef<Mote[]>([]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const haze = hazeRef.current;
    const ctx2d = canvasEl?.getContext("2d");
    if (!canvasEl || !ctx2d) return;

    // Fresh non-union bindings so nested rAF closures keep definite types.
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx2d;

    const motes = motesRef.current;
    let rafId = 0;
    let width = 0;
    let height = 0;
    let centerX = 0;
    let centerY = 0;
    let diskRx = 1;
    let diskRy = 1;
    let fillColor = "color-mix(in oklch, var(--muted-foreground) 50%, white)";
    let dustColor = "color-mix(in oklch, var(--muted-foreground) 72%, white)";
    let reducedMotion = false;
    let lastTs = 0;
    let simTime = 0;
    let paused = false;
    let mouseX = 0;
    let mouseY = 0;
    let mouseTargetX = 0;
    let mouseTargetY = 0;
    let pxPerWorld = 1;

    function readColors() {
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue("--muted-foreground")
        .trim();
      const base = token || "var(--muted-foreground)";
      fillColor = `color-mix(in oklch, ${base} 48%, white)`;
      dustColor = `color-mix(in oklch, ${base} 70%, white)`;
    }

    function updateCenter() {
      const vortexEl = vortexRef.current;
      let cardSize = Math.min(width, height);
      if (vortexEl) {
        const vr = vortexEl.getBoundingClientRect();
        centerX = vr.left + vr.width / 2;
        centerY = vr.top + vr.height / 2;
        cardSize = Math.min(vr.width, vr.height);
        diskRx = cardSize * DISK_RX;
      } else {
        centerX = width / 2;
        centerY = height * 0.38;
        diskRx = cardSize * 0.22;
      }
      diskRy = Math.max(diskRx * INCLINATION_COS, 1);
      // Same world→pixel scale as the WebGL star parallax (fov 44° / z=5.1).
      pxPerWorld = cardSize / viewWorldHeight();

      if (haze) {
        haze.style.transform = `translate(${centerX}px, ${centerY}px)`;
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateCenter();
    }

    function seedMotes() {
      const count = fieldCount();
      motes.length = 0;
      for (let i = 0; i < count; i++) {
        const kind: 0 | 1 = Math.random() > 0.32 ? 0 : 1;
        const u = MIN_U + Math.pow(Math.random(), 0.52) * (MAX_U - MIN_U);
        const arm = i % ARM_COUNT;
        const jitter = kind === 0 ? 0.22 : 0.7;
        const theta0 =
          (arm / ARM_COUNT) * TAU + SPIRAL_PITCH * Math.log(u) + (Math.random() - 0.5) * jitter;
        motes.push({
          u,
          theta0,
          size: kind === 0 ? 0.55 + Math.random() * 1.15 : 1.4 + Math.random() * 2.4,
          alpha: kind === 0 ? 0.1 + Math.random() * 0.12 : 0.04 + Math.random() * 0.06,
          speedMul: 0.55 + Math.random() * 0.55,
          kind,
        });
      }
    }

    function rimFade(u: number): number {
      const inner = Math.min(1, Math.max(0, (u - 1.12) / 0.38));
      const outer = Math.min(1, Math.max(0, (MAX_U - u) / 1.05));
      return inner * inner * (0.15 + 0.85 * outer);
    }

    function drawMote(m: Mote, x: number, y: number, theta: number) {
      const fade = rimFade(m.u);
      if (fade < 0.02) return;

      ctx.save();
      ctx.translate(x, y);
      if (m.kind === 0) {
        ctx.rotate(theta + Math.PI / 2);
        ctx.scale(1 + Math.min(m.u * 0.18, 1.6), 1);
      }
      ctx.beginPath();
      ctx.arc(0, 0, m.size, 0, TAU);
      ctx.fillStyle = m.kind === 0 ? fillColor : dustColor;
      ctx.globalAlpha = m.alpha * fade;
      ctx.fill();
      ctx.restore();
    }

    function drawFrame(t: number) {
      ctx.clearRect(0, 0, width, height);

      for (const m of motes) {
        // Same Ω(u) as WebGL StarField — one continuous rotating field.
        const omega = fieldOmega(m.u, m.speedMul);
        const theta = m.theta0 + t * omega;
        const parallaxMul = 0.55 + ((m.speedMul - 0.55) / 0.55) * 0.8;
        const ox = mouseX * STAR_MOUSE_PARALLAX * parallaxMul * pxPerWorld;
        const oy = -mouseY * STAR_MOUSE_PARALLAX * parallaxMul * pxPerWorld;
        const x = centerX + Math.cos(theta) * m.u * diskRx + ox;
        const y = centerY + Math.sin(theta) * m.u * diskRy + oy;
        drawMote(m, x, y, theta);
      }

      ctx.globalAlpha = 1;
    }

    function tick(now: number) {
      if (paused) return;
      const dt = lastTs === 0 ? 0 : Math.min((now - lastTs) / 1000, 0.1);
      lastTs = now;
      mouseX += (mouseTargetX - mouseX) * STAR_MOUSE_LERP;
      mouseY += (mouseTargetY - mouseY) * STAR_MOUSE_LERP;
      if (!reducedMotion) simTime += dt;
      drawFrame(simTime);
      if (!reducedMotion && !paused) rafId = requestAnimationFrame(tick);
    }

    function startLoop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      lastTs = 0;
      if (reducedMotion) {
        drawFrame(0);
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    readColors();
    seedMotes();
    resize();

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = motionQuery.matches;

    const onMotionChange = () => {
      reducedMotion = motionQuery.matches;
      startLoop();
    };
    motionQuery.addEventListener("change", onMotionChange);

    const onLayout = () => {
      resize();
      if (reducedMotion) drawFrame(0);
    };

    const ro = new ResizeObserver(onLayout);
    const vortexEl = vortexRef.current;
    if (vortexEl) ro.observe(vortexEl);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, { passive: true });

    const onPointer = (event: PointerEvent) => {
      const el = vortexRef.current;
      if (!el) return;
      const ndc = pointerNdcFromEvent(event, el.getBoundingClientRect());
      mouseTargetX = ndc.x;
      mouseTargetY = ndc.y;
      if (reducedMotion) {
        mouseX += (mouseTargetX - mouseX) * STAR_MOUSE_LERP;
        mouseY += (mouseTargetY - mouseY) * STAR_MOUSE_LERP;
        drawFrame(simTime);
      }
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const onVisibility = () => {
      paused = document.hidden;
      if (paused) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        lastTs = 0;
      } else {
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const settleId = requestAnimationFrame(() => {
      const el = vortexRef.current;
      if (el) ro.observe(el);
      updateCenter();
      if (reducedMotion) drawFrame(0);
    });

    startLoop();

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(settleId);
      motionQuery.removeEventListener("change", onMotionChange);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      motes.length = 0;
    };
  }, [vortexRef]);

  return (
    <div
      className="vortex-atmosphere pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Milk well — ellipse overshoots the viewport so the last stop never
          lands on-screen as a ring. Modest prefixed blur; falloff is in the
          gradient so Safari doesn't clip a 72px kernel into a hard edge. */}
      <div
        className="vortex-haze-well absolute -inset-[30%]"
        style={{
          background:
            "radial-gradient(ellipse 78% 64% at 50% 42%, oklch(0.7 0.01 286 / 0.14) 0%, oklch(0.55 0.01 286 / 0.08) 22%, oklch(0.38 0.008 286 / 0.04) 44%, oklch(0.2 0.005 286 / 0.015) 62%, transparent 82%)",
        }}
      />
      <div ref={hazeRef} className="absolute left-0 top-0">
        <div className="relative -translate-x-1/2 -translate-y-1/2">
          <div
            className="vortex-haze-field animate-vortex-field h-[min(145vw,86rem)] w-[min(145vw,86rem)] opacity-[0.22]"
            style={{
              background:
                "radial-gradient(ellipse 62% 46% at 50% 50%, color-mix(in oklch, var(--muted-foreground) 28%, transparent) 0%, color-mix(in oklch, var(--muted-foreground) 10%, transparent) 32%, color-mix(in oklch, var(--muted-foreground) 3%, transparent) 52%, transparent 72%)",
            }}
          />
          <div
            className="vortex-haze-field-slow animate-vortex-field-slow absolute inset-[-22%] opacity-[0.14]"
            style={{
              background:
                "radial-gradient(ellipse 74% 56% at 50% 48%, color-mix(in oklch, var(--muted-foreground) 18%, transparent) 0%, color-mix(in oklch, var(--muted-foreground) 6%, transparent) 38%, transparent 68%)",
            }}
          />
        </div>
      </div>
      <canvas ref={canvasRef} className="vortex-blend-screen absolute inset-0 h-full w-full" />
    </div>
  );
}
