export type DecayTier = "low" | "medium" | "high";

/** Map an already-computed decay % into a visual distortion tier. */
export function decayTier(decay: number): DecayTier {
  if (decay <= 30) return "low";
  if (decay <= 60) return "medium";
  return "high";
}
