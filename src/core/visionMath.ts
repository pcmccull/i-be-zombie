/**
 * [pure] World-space vision haze math, tier-blend easing, and human visual gating.
 *
 * Human visibility rule (docs/5_expand_world.md §4):
 * - awareness === 'identified' => 'full' (regardless of distance; normal mesh, bars, markers, targetable).
 * - awareness === 'seen'       => 'silhouette' (dark flat silhouette; no bars, markers, hit-flash, or targeting).
 * - otherwise ('none' | 'heard' | 'sensed') => 'hidden' at any distance (never drawn: a silhouette at the exact live
 *   position would leak what the tier's identified/seen rules hide; sense cues carry fuzzed positions instead).
 *
 * Monotonicity: the mode depends only on awareness, and AwarenessSystem's identified/seen sets only grow with tier.
 */
import type { Awareness, VisionProfile } from './types';

export type HumanVisualMode = 'full' | 'silhouette' | 'hidden';

export type VisionHazeProfile = Pick<VisionProfile, 'clearRadius' | 'hazeRadius' | 'hazeStrength'>;

/**
 * Smooth, monotonic non-decreasing haze factor in [0, hazeStrength].
 * Returns 0 inside clearRadius, smoothsteps to hazeStrength at hazeRadius,
 * and returns hazeStrength beyond hazeRadius.
 * Degenerate hazeRadius <= clearRadius falls back to a NaN-free step at clearRadius.
 */
export function hazeFactor(
  dist: number,
  clearRadius: number,
  hazeRadius: number,
  hazeStrength: number,
): number {
  if (dist <= clearRadius) return 0;
  if (hazeRadius <= clearRadius) return hazeStrength;
  if (dist >= hazeRadius) return hazeStrength;
  const t = (dist - clearRadius) / (hazeRadius - clearRadius);
  return t * t * (3 - 2 * t) * hazeStrength;
}

/**
 * Linearly interpolates clearRadius, hazeRadius, and hazeStrength into `out`.
 * Clamps `t` to [0, 1] and guarantees exact endpoints at t <= 0 and t >= 1.
 */
export function lerpProfile<T extends VisionHazeProfile>(
  a: VisionHazeProfile,
  b: VisionHazeProfile,
  t: number,
  out: T,
): T {
  if (t <= 0) {
    out.clearRadius = a.clearRadius;
    out.hazeRadius = a.hazeRadius;
    out.hazeStrength = a.hazeStrength;
    return out;
  }
  if (t >= 1) {
    out.clearRadius = b.clearRadius;
    out.hazeRadius = b.hazeRadius;
    out.hazeStrength = b.hazeStrength;
    return out;
  }
  out.clearRadius = a.clearRadius + (b.clearRadius - a.clearRadius) * t;
  out.hazeRadius = a.hazeRadius + (b.hazeRadius - a.hazeRadius) * t;
  out.hazeStrength = a.hazeStrength + (b.hazeStrength - a.hazeStrength) * t;
  return out;
}

/**
 * Eased 0..1 blend factor for vision tier transitions (cubic ease-out).
 * Returns 0 for elapsed <= 0, 1 for elapsed >= tierBlendTime or tierBlendTime <= 0.
 */
export function tierBlend(elapsedSinceChange: number, tierBlendTime: number): number {
  if (tierBlendTime <= 0) return 1;
  if (elapsedSinceChange <= 0) return 0;
  if (elapsedSinceChange >= tierBlendTime) return 1;
  const inv = 1 - elapsedSinceChange / tierBlendTime;
  return 1 - inv * inv * inv;
}

/**
 * Determines how a human should be rendered given their awareness state,
 * XZ distance from the Alpha, and the active vision profile.
 */
export function humanVisual(
  awareness: Awareness,
  dist: number,
  profile: VisionHazeProfile,
): HumanVisualMode {
  if (awareness === 'identified') return 'full';
  if (awareness === 'seen') return 'silhouette';
  // Unaware humans are never drawn: a mesh at the exact live position would leak what the vision tier hides.
  void dist; void profile;
  return 'hidden';
}

/**
 * Vision limit (playtest request: "everything past the vision limit is hidden"). Past `hazeRadius` the haze ramps to
 * fully opaque over `VISION_EDGE_BAND × hazeRadius`, and the background matches the haze colour, so nothing beyond
 * `hazeRadius × (1 + VISION_EDGE_BAND)` is visible. Must match the GLSL in visuals/VisionFog.ts.
 */
export const VISION_EDGE_BAND = 0.12;

/** 1 = fully visible (inside hazeRadius) .. 0 = hidden (past the edge band); smoothstep in between. */
export function visionVisibility(dist: number, hazeRadius: number): number {
  const band = Math.max(1e-4, hazeRadius * VISION_EDGE_BAND);
  const t = Math.max(0, Math.min(1, (dist - hazeRadius) / band));
  return 1 - t * t * (3 - 2 * t);
}

/** True once a point is completely hidden by the vision limit (used to cull effects that skip the haze shader). */
export function isBeyondVision(dist: number, hazeRadius: number): boolean {
  return dist >= hazeRadius * (1 + VISION_EDGE_BAND);
}
