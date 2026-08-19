import { forwardRef, type CSSProperties } from "react";
import { decayTier } from "@/lib/decay-tier";
import { cn } from "@/lib/utils";

type DecayTextProps = {
  /** Existing decay percentage (0–100); not recalculated here. */
  decay: number;
  loading?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "h1" | "span";
};

/**
 * Percentage text that erodes visually as knowledge decay rises.
 * Distortion uses SVG feTurbulence + feDisplacementMap (CSS filter: url(...));
 * no JS animation loop, no chromatic/clip-path glitch.
 */
export const DecayText = forwardRef<HTMLElement, DecayTextProps>(function DecayText(
  { decay, loading = false, className, style, as: Tag = "h1" },
  ref,
) {
  const text = loading ? "—" : `${decay}%`;
  const tier = loading ? "low" : decayTier(decay);

  return (
    <>
      <DecayDistortFilters />
      <Tag
        ref={ref as never}
        className={cn("decay-text", `decay-tier-${tier}`, className)}
        data-decay-tier={tier}
        style={style}
      >
        {text}
      </Tag>
    </>
  );
});

/** Shared SVG filter defs for organic letterform erosion. Hidden from layout/AT. */
function DecayDistortFilters() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      focusable="false"
    >
      <defs>
        {/* Medium: fine fractal noise, light displacement, slow breathe */}
        <filter
          id="decay-distort-medium"
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03"
            numOctaves="2"
            seed="3"
            result="noise"
          >
            <animate
              attributeName="baseFrequency"
              values="0.025;0.038;0.025"
              dur="10s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Medium static (prefers-reduced-motion) */}
        <filter
          id="decay-distort-medium-static"
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03"
            numOctaves="2"
            seed="3"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* High: coarser warps + light edge blur for eroded look */}
        <filter
          id="decay-distort-high"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015"
            numOctaves="3"
            seed="7"
            result="noise"
          >
            <animate
              attributeName="baseFrequency"
              values="0.012;0.02;0.012"
              dur="11s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="11"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="0.7" />
        </filter>

        {/* High static (prefers-reduced-motion) */}
        <filter
          id="decay-distort-high-static"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015"
            numOctaves="3"
            seed="7"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="11"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="0.7" />
        </filter>
      </defs>
    </svg>
  );
}
