/**
 * Shared starfield motion — WebGL StarField and VortexAtmosphere must use
 * these exact values so stars inside the card and in the page halo drift as
 * one continuous space.
 */

/** Distant-field spin (rad/s). Atmosphere motes and WebGL stars share this Ω. */
export const FIELD_SPIN = 0.12;

/** Mouse parallax amplitude (world units). Pixel offset derives from this. */
export const STAR_MOUSE_PARALLAX = 0.36;

/** Pointer follow — same lerp on both star layers. */
export const STAR_MOUSE_LERP = 0.035;

/** Vortex disk outer radius in world units; atmosphere u = 1 at this rim. */
export const VORTEX_MAX_R = 1.84;

export const CAMERA_FOV_DEG = 44;
export const CAMERA_DISTANCE = 5.1;

/** Visible world-height of the hero square (matches the R3F camera). */
export function viewWorldHeight(): number {
  return 2 * Math.tan(((CAMERA_FOV_DEG / 2) * Math.PI) / 180) * CAMERA_DISTANCE;
}

/** Angular speed at radius u (1 = vortex rim), matching atmosphere motes. */
export function fieldOmega(u: number, speedMul: number): number {
  return FIELD_SPIN * speedMul * (0.85 / (u + 0.35));
}

/** NDC pointer relative to the hero card — identical for WebGL and 2D halo. */
export function pointerNdcFromEvent(
  event: PointerEvent,
  rect: DOMRect,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}
