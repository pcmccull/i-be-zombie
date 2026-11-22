// [pure] Brain pickups: collected brains (biomass) pop out of their source and fly into the Alpha.
// Shared by visuals/BrainPickups.ts (flight) and AudioSystem (the collect sound lands with the first brain).

/** Seconds from spawn until a brain reaches the Alpha. */
export const BRAIN_FLY_S = 0.75;
/** Extra start delay per brain in one burst, so a big reward streams in as a little chain. */
export const BRAIN_STAGGER_S = 0.07;
/** Most brains drawn for one gain (a stronghold capture). */
export const BRAIN_MAX_PER_GAIN = 8;
/** Brains a gain sends to the Alpha: 1 for small rewards, up to BRAIN_MAX_PER_GAIN for big ones. */
export function brainCount(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.max(1, Math.min(BRAIN_MAX_PER_GAIN, Math.round(amount / 4)));
}

export interface BrainFlightPoint { x: number; y: number; z: number; scale: number }

const START_Y = 1.1;
const TARGET_Y = 1.7;
const POP_HEIGHT = 1.6;

/**
 * Position along the flight at normalized time u ∈ [0, 1]. The brain first hops up and out to the side (`side`
 * ∈ [-1, 1] spreads a burst), then accelerates into the target, which is re-read every frame so it homes onto
 * a moving Alpha. Scale pops in, holds, and shrinks into the Alpha at the end.
 */
export function brainFlightAt(u: number, sx: number, sz: number, tx: number, tz: number, side: number,
  out: BrainFlightPoint): BrainFlightPoint {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  const ease = t * t * (3 - 2 * t) * 0.35 + t * t * t * 0.65; // slow start, fast finish
  const dx = tx - sx, dz = tz - sz;
  const len = Math.hypot(dx, dz) || 1;
  // Sideways bulge perpendicular to the flight, strongest mid-flight.
  const bulge = Math.sin(Math.PI * t) * side * Math.min(2.2, 0.6 + len * 0.15);
  out.x = sx + dx * ease + (-dz / len) * bulge;
  out.z = sz + dz * ease + (dx / len) * bulge;
  out.y = START_Y + (TARGET_Y - START_Y) * ease + Math.sin(Math.PI * Math.min(1, t * 1.25)) * POP_HEIGHT;
  out.scale = t < 0.15 ? 0.4 + 0.6 * (t / 0.15) : t > 0.85 ? Math.max(0.15, (1 - t) / 0.15) : 1;
  return out;
}
