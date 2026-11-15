// [pure] Touch-control math (todos #7): virtual stick, tap detection, pinch zoom. No DOM, no three.

export interface StickOutput {
  /** -1..1, screen up = +1 (same meaning as W). */
  moveForward: number;
  /** -1..1, screen right = +1 (same meaning as D). */
  moveRight: number;
  sprint: boolean;
  /** 0..1 magnitude after dead zone rescale. */
  mag: number;
}

export function createStickOutput(): StickOutput {
  return { moveForward: 0, moveRight: 0, sprint: false, mag: 0 };
}

/**
 * Converts a finger offset from the stick centre (screen px, +y = down) into move axes.
 * Inside `deadZone` (fraction of radius) the output is zero; beyond it the magnitude is rescaled to 0..1 so the stick
 * starts gently, and the vector is clamped to the unit circle. Sprint is on when the raw offset reaches
 * `sprintThreshold` of the radius.
 */
export function stickFromOffset(
  dx: number, dy: number, radius: number, deadZone: number, sprintThreshold: number, out: StickOutput,
): StickOutput {
  out.moveForward = 0; out.moveRight = 0; out.sprint = false; out.mag = 0;
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return out;
  const len = Math.hypot(dx, dy);
  const raw = Math.min(1, len / radius);
  const dz = Math.min(Math.max(deadZone, 0), 0.99);
  if (raw <= dz || len === 0) return out;
  const mag = (raw - dz) / (1 - dz);
  out.moveRight = (dx / len) * mag;
  out.moveForward = (-dy / len) * mag;
  out.mag = mag;
  out.sprint = raw >= sprintThreshold;
  return out;
}

/** Knob position (px from centre) for drawing: the offset clamped to the stick radius. */
export function clampKnob(dx: number, dy: number, radius: number, out: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  const k = len > radius && len > 0 ? radius / len : 1;
  out.x = dx * k; out.y = dy * k;
  return out;
}

/** A touch is a tap when the finger barely moved and lifted quickly. */
export function isTap(dxPx: number, dyPx: number, ms: number, maxMovePx: number, maxMs: number): boolean {
  return Math.hypot(dxPx, dyPx) <= maxMovePx && ms >= 0 && ms <= maxMs;
}

/**
 * Pinch zoom delta in wheel units: fingers moving apart (distance grows) zooms in (negative, like wheel-up),
 * pinching together zooms out (positive). 0 for degenerate input.
 */
export function pinchZoomDelta(prevDistPx: number, distPx: number, scale: number): number {
  if (!(prevDistPx > 0) || !(distPx > 0) || !Number.isFinite(scale)) return 0;
  return (prevDistPx - distPx) * scale;
}

/** Distance between two touch points (px). */
export function touchDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}
