import { useEffect, useRef, type RefObject } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  /** Per-particle speed multiplier so paths don't look uniform. */
  speedMul: number;
};

type Intensity = {
  count: number;
  accel: number;
  speedScale: number;
};

type SpawnRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const MIN_PARTICLES = 12;
/** Hard cap — never allocate beyond this regardless of decay. */
const MAX_PARTICLES = 70;

const MIN_ACCEL = 0.01;
const MAX_ACCEL = 0.055;
const MIN_SPEED = 0.4;
const MAX_SPEED = 1.15;

/** Frames between each +1/−1 particle adjustment toward target count. */
const COUNT_ADJUST_INTERVAL = 4;

/**
 * Must stay in lockstep with VortexShader: MAX_R / framed half-width (~0.89 of
 * the square) and hole at ~0.50 world units. Projected ellipse uses the same
 * 48° inclination as CAMERA_INCLINATION.
 */
const DISK_RX = 0.44;
const INCLINATION_COS = Math.cos((48 * Math.PI) / 180);
const HOLE_FRAC = 0.5 / 1.84;
const ABSORB_FRAC = HOLE_FRAC * 0.92;
const EDGE_INSET = 0.08;
const EDGE_JITTER = 0.06;
/** Outward/inward scatter from the DecayText perimeter — keep tight so motes hug the digits. */
const SPAWN_JITTER = 4;

function clampDecay(decay: number): number {
  return Math.max(0, Math.min(100, decay));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map raw decay (0–100) → eased intensity. Quadratic-ish curve keeps low
 * decay calm longer; hunger ramps more as decay approaches 100.
 */
function intensityFromDecay(decay: number): Intensity {
  const t = Math.pow(clampDecay(decay) / 100, 1.3);
  return {
    count: Math.round(lerp(MIN_PARTICLES, MAX_PARTICLES, t)),
    accel: lerp(MIN_ACCEL, MAX_ACCEL, t),
    speedScale: lerp(MIN_SPEED, MAX_SPEED, t),
  };
}

type VortexParticlesProps = {
  /** Existing decay percentage (0–100); intensity interpolates continuously. */
  decay: number;
  /** DecayText (or container) — particles spawn from its layout box. */
  spawnOriginRef: RefObject<HTMLElement | null>;
  /** Vortex graphic — attraction target is its center. */
  vortexRef: RefObject<HTMLElement | null>;
};

/**
 * Canvas particle field: motes drawn out of the decay percentage and captured
 * into the same elliptical orbit + inflow as the WebGL disk. Particle data
 * lives in a mutable ref array — never React state — so frames don't re-render.
 */
export function VortexParticles({ decay, spawnOriginRef, vortexRef }: VortexParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const decayRef = useRef(decay);
  decayRef.current = decay;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = particlesRef.current;
    let rafId = 0;
    let width = 0;
    let height = 0;
    let centerX = 0;
    let centerY = 0;
    let diskRx = 1;
    let diskRy = 1;
    let spawnRect: SpawnRect | null = null;
    let fillColor = "color-mix(in oklch, var(--muted-foreground) 45%, white)";
    let hotColor = "color-mix(in oklch, var(--muted-foreground) 18%, white)";
    let reducedMotion = false;
    let framesUntilCountAdjust = 0;

    function readFillColor() {
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue("--muted-foreground")
        .trim();
      const base = token || "var(--muted-foreground)";
      fillColor = `color-mix(in oklch, ${base} 45%, white)`;
      hotColor = `color-mix(in oklch, ${base} 18%, white)`;
    }

    function updateVortexCenter() {
      const vortexEl = vortexRef.current;
      const parentRect = parent!.getBoundingClientRect();
      if (vortexEl) {
        const vr = vortexEl.getBoundingClientRect();
        centerX = vr.left - parentRect.left + vr.width / 2;
        centerY = vr.top - parentRect.top + vr.height / 2;
        diskRx = Math.min(vr.width, vr.height) * DISK_RX;
      } else {
        centerX = width / 2;
        centerY = height / 2;
        diskRx = Math.min(width, height) * DISK_RX;
      }
      diskRy = Math.max(diskRx * INCLINATION_COS, 1);
    }

    function ellipseSr(x: number, y: number): number {
      const sx = (x - centerX) / diskRx;
      const sy = (y - centerY) / diskRy;
      return Math.hypot(sx, sy) || 0.0001;
    }

    function updateSpawnOrigin() {
      const originEl = spawnOriginRef.current;
      if (!originEl) {
        spawnRect = null;
        return;
      }
      const parentRect = parent!.getBoundingClientRect();
      const tr = originEl.getBoundingClientRect();
      if (tr.width < 1 || tr.height < 1) {
        spawnRect = null;
        return;
      }
      spawnRect = {
        x: tr.left - parentRect.left,
        y: tr.top - parentRect.top,
        w: tr.width,
        h: tr.height,
      };
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;

      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      updateVortexCenter();
      updateSpawnOrigin();
    }

    function createParticle(): Particle {
      const p: Particle = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 1,
        opacity: 1,
        speedMul: 1,
      };
      spawnParticle(p);
      return p;
    }

    function spawnParticle(p: Particle) {
      const { speedScale } = intensityFromDecay(decayRef.current);

      if (spawnRect) {
        const { x, y, w, h } = spawnRect;
        const peri = Math.max(2 * (w + h), 1);
        let t = Math.random() * peri;
        let sx: number;
        let sy: number;
        if (t < w) {
          sx = x + t;
          sy = y;
        } else if ((t -= w) < h) {
          sx = x + w;
          sy = y + t;
        } else if ((t -= h) < w) {
          sx = x + w - t;
          sy = y + h;
        } else {
          t -= w;
          sx = x;
          sy = y + h - t;
        }
        const j = SPAWN_JITTER;
        p.x = sx + (Math.random() - 0.5) * j * 2;
        p.y = sy + (Math.random() - 0.5) * j * 2;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const rim = 1 - EDGE_INSET - Math.random() * EDGE_JITTER;
        p.x = centerX + Math.cos(angle) * diskRx * rim;
        p.y = centerY + Math.sin(angle) * diskRy * rim;
      }

      const sr = ellipseSr(p.x, p.y);
      const th = Math.atan2((p.y - centerY) / diskRy, (p.x - centerX) / diskRx);
      const spin = 0.04 * speedScale;
      p.vx = -Math.sin(th) * sr * spin * diskRx;
      p.vy = Math.cos(th) * sr * spin * diskRy;
      p.radius = 0.55 + Math.random() * 1.15;
      p.opacity = 0.4 + Math.random() * 0.3;
      p.speedMul = 0.7 + Math.random() * 0.7;
    }

    function setParticleCount(count: number) {
      const target = Math.min(Math.max(count, 0), MAX_PARTICLES);
      while (particles.length < target) {
        particles.push(createParticle());
      }
      if (particles.length > target) {
        particles.length = target;
      }
    }

    function nudgeParticleCount(targetCount: number) {
      const target = Math.min(Math.max(targetCount, 0), MAX_PARTICLES);
      if (particles.length === target) {
        framesUntilCountAdjust = 0;
        return;
      }
      if (framesUntilCountAdjust > 0) {
        framesUntilCountAdjust -= 1;
        return;
      }
      framesUntilCountAdjust = COUNT_ADJUST_INTERVAL;
      if (particles.length < target) {
        particles.push(createParticle());
      } else {
        particles.pop();
      }
    }

    function drawMote(p: Particle, sr: number) {
      const speed = Math.hypot(p.vx, p.vy);
      const stretch = 1 + Math.min(speed * 1.65, 6.5);
      const heat = Math.min(1, Math.max(0, (1.05 - sr) / 0.7));
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(Math.atan2(p.vy, p.vx));
      ctx!.scale(stretch, 1);
      ctx!.beginPath();
      ctx!.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx!.fillStyle = heat > 0.45 ? hotColor : fillColor;
      ctx!.globalAlpha = p.opacity;
      ctx!.fill();
      ctx!.restore();
    }

    function drawStaticFrame() {
      updateSpawnOrigin();
      updateVortexCenter();
      const { count } = intensityFromDecay(decayRef.current);
      setParticleCount(count);
      if (spawnRect) {
        for (const p of particles) spawnParticle(p);
      }
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        drawMote(p, ellipseSr(p.x, p.y));
      }
      ctx!.globalAlpha = 1;
    }

    function tick() {
      const config = intensityFromDecay(decayRef.current);
      nudgeParticleCount(config.count);

      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        const sx = (p.x - centerX) / diskRx;
        const sy = (p.y - centerY) / diskRy;
        let sr = Math.hypot(sx, sy) || 0.0001;
        let th = Math.atan2(sy, sx);

        const inflow =
          (0.0016 + config.accel * 0.055) * p.speedMul * config.speedScale * (0.45 + 0.7 / (sr + 0.28));
        const spin =
          (0.011 + config.accel * 0.12) * p.speedMul * config.speedScale * (0.5 + 0.85 / (sr + 0.18));

        sr -= inflow;
        th += spin;

        const nx = centerX + Math.cos(th) * sr * diskRx;
        const ny = centerY + Math.sin(th) * sr * diskRy;
        p.vx = nx - p.x;
        p.vy = ny - p.y;
        p.x = nx;
        p.y = ny;

        const fadeOuter = Math.min(1, Math.max(0, (1.18 - sr) / 0.28));
        const fadeHole = Math.min(1, Math.max(0, (sr - ABSORB_FRAC) / 0.14));
        const baseOpacity = 0.38 + p.speedMul * 0.28;
        p.opacity = baseOpacity * fadeOuter * (0.12 + 0.88 * fadeHole);

        if (sr < ABSORB_FRAC || p.opacity < 0.04) {
          spawnParticle(p);
          continue;
        }

        drawMote(p, sr);
      }

      ctx!.globalAlpha = 1;
      if (!reducedMotion) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function startLoop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      if (reducedMotion) {
        drawStaticFrame();
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    readFillColor();
    resize();

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = motionQuery.matches;

    const onMotionChange = () => {
      reducedMotion = motionQuery.matches;
      particles.length = 0;
      framesUntilCountAdjust = 0;
      startLoop();
    };
    motionQuery.addEventListener("change", onMotionChange);

    const onLayoutChange = () => {
      resize();
      if (reducedMotion) drawStaticFrame();
    };

    const ro = new ResizeObserver(onLayoutChange);
    ro.observe(parent);

    function observeTargets() {
      const vortexEl = vortexRef.current;
      const originEl = spawnOriginRef.current;
      if (vortexEl) ro.observe(vortexEl);
      if (originEl) ro.observe(originEl);
    }
    observeTargets();

    const onWindowResize = () => onLayoutChange();
    window.addEventListener("resize", onWindowResize);

    const settleId = requestAnimationFrame(() => {
      observeTargets();
      updateSpawnOrigin();
      updateVortexCenter();
      if (spawnRect) {
        for (const p of particles) spawnParticle(p);
      }
      if (reducedMotion) drawStaticFrame();
    });

    startLoop();

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(settleId);
      motionQuery.removeEventListener("change", onMotionChange);
      window.removeEventListener("resize", onWindowResize);
      ro.disconnect();
      particles.length = 0;
    };
  }, [spawnOriginRef, vortexRef]);

  return (
    <canvas
      ref={canvasRef}
      className="vortex-blend-screen pointer-events-none absolute inset-0 z-10 h-full w-full"
      aria-hidden="true"
    />
  );
}
