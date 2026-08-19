import {
  Component,
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

type ShaderProps = {
  onContextLost: () => void;
  onReady: () => void;
};

type VortexProps = {
  /** Optional fixed size; omit for responsive clamp(340px, 50vh, 560px). */
  size?: number;
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function VortexFallback() {
  return (
    <>
      <img
        src="/vortex.png"
        alt=""
        className="vortex-blend-screen animate-vortex-spin h-full w-full object-contain"
      />
      <div className="animate-vortex-breathe pointer-events-none absolute inset-[28%] rounded-full bg-black" />
    </>
  );
}

class VortexShaderBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export const Vortex = forwardRef<HTMLDivElement, VortexProps>(function Vortex({ size }, ref) {
  const responsive = size == null;
  const [Shader, setShader] = useState<ComponentType<ShaderProps> | null>(null);
  const [useFallback, setUseFallback] = useState(true);
  const [shaderReady, setShaderReady] = useState(false);

  const dropToFallback = useCallback(() => {
    setUseFallback(true);
    setShader(null);
    setShaderReady(false);
  }, []);

  useEffect(() => {
    if (!hasWebGL()) return;

    let cancelled = false;
    void import("./VortexShader")
      .then((mod) => {
        if (cancelled) return;
        setShader(() => mod.VortexShader);
        setUseFallback(false);
      })
      .catch(() => {
        if (!cancelled) dropToFallback();
      });

    return () => {
      cancelled = true;
    };
  }, [dropToFallback]);

  return (
    <div
      ref={ref}
      className="vortex-card relative mx-auto flex select-none items-center justify-center overflow-visible"
      style={
        responsive
          ? {
              width: "clamp(340px, 50vh, 560px)",
              height: "clamp(340px, 50vh, 560px)",
              maxWidth: "92vw",
              ["--vortex-size" as string]: "min(92vw, clamp(340px, 50vh, 560px))",
            }
          : {
              width: size,
              height: size,
              maxWidth: "92vw",
              maxHeight: "92vw",
              ["--vortex-size" as string]: `${size}px`,
            }
      }
      aria-hidden="true"
    >
      <div className="vortex-card__glow" />
      {/* Mask + vignette live on this layer only — see .vortex-card in styles.css */}
      <div className="vortex-card__media">
        {(!shaderReady || useFallback) && (
          <div className="absolute inset-0">
            <VortexFallback />
          </div>
        )}
        {Shader && !useFallback ? (
          <div className="absolute inset-0">
            <VortexShaderBoundary onError={dropToFallback}>
              <Shader onContextLost={dropToFallback} onReady={() => setShaderReady(true)} />
            </VortexShaderBoundary>
          </div>
        ) : null}
      </div>
    </div>
  );
});
