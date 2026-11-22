// [pure] Shared heights for flat ground layers and ground decals, so overlapping surfaces never share a depth.
//
// Depth precision falls off with distance squared, so two coplanar (or a few-mm-apart) surfaces flicker
// ("z-fighting") at range. Rules:
//   * Flat ground layers that can overlap are >= 1.5 cm apart (CityDistrict ground ladder below); patches of
//     different kinds never overlap in the same plane (lower-priority patches are clipped).
//   * Transparent ground decals (blob shadows, rings, markers) sit at DECAL_Y or above — over every flat ground
//     layer except raised sidewalks — and use a polygon offset as a second guard.

/** Top height of each flat ground layer (metres). CityDistrict builds its slabs from these. */
export const GROUND_TOP = {
  base: -0.015, // district-tinted chunk slab
  road: 0.005,
  lot: 0.02,
  park: 0.035,
  parkInner: 0.055,
  compound: 0.035,
  sand: 0.05,
  sandDamp: 0.07,
  plazaRim: 0.04,
  plazaTop: 0.06,
  plazaInlay: 0.08,
  /** Basketball / tennis court surface (clipped under parks and plazas, above lots) and its painted lines. */
  court: 0.03,
  courtLine: 0.045,
  /** Road markings (separate mesh) — each kind on its own step so overlapping markings never tie. */
  crack: 0.015,
  laneDash: 0.025,
  drain: 0.025,
  parkingBay: 0.03,
  stopLine: 0.035,
  drainBar: 0.04,
  crosswalk: 0.045,
  /** Traffic-signal stop lines (world/TrafficSignals.ts, own mesh) sit just above the painted markings. */
  signalStopLine: 0.055,
} as const;

/**
 * Top of raised sidewalk paving (metres). CityDistrict's paving top slab, the curb furniture (StreetFurnitureFactory's
 * SIDEWALK_TOP is clamped to the same 0.15 flat-kind cap) and every sidewalk prop base use this one value.
 */
export const SIDEWALK_TOP = 0.15;

/** Lowest height for transparent ground decals (above every flat layer except raised sidewalks). */
export const DECAL_Y = 0.09;
/** Vertical step between stacked decals (they never write depth, so this only orders them vs. ground). */
export const DECAL_STEP = 0.004;

/** Structural subset of a three.js Material (keeps this module free of a `three` import). */
export interface PolygonOffsetTarget {
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

/** Pull a ground decal material toward the camera in depth so it always wins against the ground under it. */
export function asGroundDecal<M extends PolygonOffsetTarget>(mat: M, strength = 1): M {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2 * strength;
  mat.polygonOffsetUnits = -4 * strength;
  return mat;
}
