// [pure] VP2 urban infill (docs/12_visual_polish2.md §6, ARCHITECTURE VP2-0 "Density"). Append-only pass: fills the empty lots
// the base builders leave beside sidewalks with purposeful content chosen by district theme -- infill frontage buildings
// (shared-wall rows), parking lots, pocket parks, courts, plazas, construction sites, outdoor markets, one gas station
// per fitting district and 1-2 landmarks from `DISTRICT_STYLES[...].landmarks`.
//
// Rules: runs after every base builder / pass (existing ids, colliders and RNG streams are untouched; every stream here is
// an FNV-hashed mulberry32 per district); everything snaps to integer metres; new colliders keep >= 3 m from buildings and
// walls (>= 1.5 m from props) so navigation can never be sealed; spawn zones, patrol waypoints, structures + approaches,
// stronghold rects, nests, hideouts/secrets, the start beach + start-nest path, the ring-road corridor, the intro camera path
// and the world edge are all reserved. Lots/props only ever sit on free (non-road, non-sidewalk) ground.
import { ARCHETYPE_MIN_FOOTPRINT, DISTRICT_STYLES, type DistrictStyle, type DistrictTheme } from '../../content/districtStyles';
import { buildIntroScript } from '../../content/intro';
import { COMPANIONS, HIDEOUTS, SECRETS } from '../../content/rewards';
import { createPose, sampleCameraPath } from '../../core/cinematicMath';
import type {
  AABB, BuildingArchetype, BuildingStyle, CityLandmarkKind, DistrictLayout, Facing4, PropDef, Rng, Vec2,
} from '../../core/types';
import { mulberry32 } from '../../utils/rng';
import { building, prop, rect, solid, vehicle, type WorldDraft } from './common';
import { seamCrossings } from './grid';
import { RING, ringRoadRects } from './ringRoad';

/** The pre-expansion world (suburbs, police, shopping, industrial). */
export const ORIGINAL_AREA: AABB = { minX: -200, minZ: -160, maxX: 200, maxZ: 160 };
const NEAR_AVENUE = 18;

/** Optional reserved areas the caller owns (START_BEACH lives in districtLayout, the checkpoint is built beside the world). */
export interface InfillExtras { startBeach?: AABB; checkpoint?: AABB }

/** Ground patches with at least this area are district base fill (not purposeful content) for coverage metrics. */
export const BASE_FILL_AREA = 2500;

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// --------------------------------------------------------------------------------------------------------------------
// Landmarks
// --------------------------------------------------------------------------------------------------------------------

/** along = length parallel to the street, depth = away from the street (both metres), h = collider height. */
export const LANDMARK_SIZES: Readonly<Record<CityLandmarkKind, { along: number; depth: number; h: number }>> = {
  lighthouse: { along: 6, depth: 6, h: 18 },
  waterTower: { along: 8, depth: 8, h: 16 },
  clockTower: { along: 7, depth: 7, h: 20 },
  controlTower: { along: 10, depth: 10, h: 24 },
  radioMast: { along: 5, depth: 5, h: 28 },
  fountainPlaza: { along: 12, depth: 12, h: 3 },
  bandshell: { along: 16, depth: 12, h: 8 },
  ferrisWheel: { along: 18, depth: 6, h: 22 },
  domeObservatory: { along: 14, depth: 14, h: 12 },
  glassTower: { along: 12, depth: 12, h: 40 },
  neonArch: { along: 14, depth: 4, h: 9 },
  hangar: { along: 30, depth: 24, h: 12 },
};
const OPEN_LANDMARKS: ReadonlySet<CityLandmarkKind> = new Set(['fountainPlaza', 'bandshell', 'ferrisWheel', 'neonArch']);

// --------------------------------------------------------------------------------------------------------------------
// Blocking prop sizes (shared with streetFurniture)
// --------------------------------------------------------------------------------------------------------------------

/** Footprint in the prop's local frame (w along local X, d along local Z) and collider height. */
export const PROP_SIZES: Readonly<Partial<Record<PropDef['kind'], { w: number; d: number; h: number; sight: boolean }>>> = {
  busStop: { w: 3.2, d: 1.3, h: 2.6, sight: false },
  mailbox: { w: 0.6, d: 0.6, h: 1.2, sight: false },
  newsStand: { w: 1.0, d: 0.9, h: 1.5, sight: false },
  bikeRack: { w: 1.8, d: 0.5, h: 0.9, sight: false },
  bollard: { w: 0.4, d: 0.4, h: 0.9, sight: false },
  planter: { w: 1.0, d: 1.0, h: 1.0, sight: false },
  patioTable: { w: 1.0, d: 1.0, h: 0.9, sight: false },
  utilityBox: { w: 0.9, d: 0.7, h: 1.2, sight: false },
  crates: { w: 1.2, d: 1.2, h: 1.0, sight: false },
  shoppingCart: { w: 0.6, d: 1.0, h: 1.0, sight: false },
  constructionBarrier: { w: 2.4, d: 0.5, h: 1.0, sight: false },
  basketballHoop: { w: 0.8, d: 0.8, h: 3.05, sight: false },
  gasPump: { w: 3.0, d: 1.2, h: 1.6, sight: false },
};

/** Blocking prop + matching small collider (the `vehicle()` pattern: tag `prop-${props.length}`). */
export function blockingProp(w: WorldDraft, kind: PropDef['kind'], x: number, z: number, rotation: number,
  variant = 0): AABB {
  const s = PROP_SIZES[kind]!;
  const c = Math.abs(Math.cos(rotation)), sn = Math.abs(Math.sin(rotation));
  const hx = (s.w * c + s.d * sn) / 2, hz = (s.w * sn + s.d * c) / 2;
  const r = rect(x - hx, z - hz, x + hx, z + hz);
  w.props.push({ kind, pos: { x, z }, rotation, variant, blocking: true });
  solid(w, r, `prop-${w.props.length}`, 'prop', s.h, s.sight);
  return r;
}

// --------------------------------------------------------------------------------------------------------------------
// Occupancy grid (1 m cells)
// --------------------------------------------------------------------------------------------------------------------

export const FLAG = { SOLID: 1, DIL: 2, SOFT: 4, PAVED: 8, USED: 16, KEEP: 32, JUNC: 64, NEAR: 128 } as const;
/** Anything a new building / lot must not overlap. */
const BLOCKED = FLAG.SOLID | FLAG.DIL | FLAG.SOFT | FLAG.PAVED | FLAG.JUNC | FLAG.NEAR;

export class Occupancy {
  readonly cols: number;
  readonly rows: number;
  readonly flags: Uint8Array;
  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number) {
    this.cols = Math.ceil(maxX - minX);
    this.rows = Math.ceil(maxZ - minZ);
    this.flags = new Uint8Array(this.cols * this.rows);
  }
  mark(mask: number, r: AABB, pad = 0): void {
    const x0 = Math.max(0, Math.floor(r.minX - pad - this.minX + 1e-6)), x1 = Math.min(this.cols - 1, Math.ceil(r.maxX + pad - this.minX - 1e-6) - 1);
    const z0 = Math.max(0, Math.floor(r.minZ - pad - this.minZ + 1e-6)), z1 = Math.min(this.rows - 1, Math.ceil(r.maxZ + pad - this.minZ - 1e-6) - 1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.flags[z * this.cols + x] |= mask;
  }
  /** True when any cell touched by r (grown by pad) carries a flag in mask. Outside the grid counts as a hit. */
  hit(r: AABB, mask: number, pad = 0): boolean {
    const x0 = Math.floor(r.minX - pad - this.minX + 1e-6), x1 = Math.ceil(r.maxX + pad - this.minX - 1e-6) - 1;
    const z0 = Math.floor(r.minZ - pad - this.minZ + 1e-6), z1 = Math.ceil(r.maxZ + pad - this.minZ - 1e-6) - 1;
    if (x0 < 0 || z0 < 0 || x1 >= this.cols || z1 >= this.rows) return true;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.flags[z * this.cols + x] & mask) return true;
    return false;
  }
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
export function grow(r: AABB, by: number): AABB {
  return { minX: r.minX - by, minZ: r.minZ - by, maxX: r.maxX + by, maxZ: r.maxZ + by };
}
function around(p: Vec2, by: number): AABB { return rect(p.x - by, p.z - by, p.x + by, p.z + by); }
function area(r: AABB): number { return (r.maxX - r.minX) * (r.maxZ - r.minZ); }

/** Rects the passes must keep clear (beyond colliders and paving): see the header for the list. */
export function protectedRects(w: WorldDraft, extra: InfillExtras): AABB[] {
  const out: AABB[] = [];
  for (const z of w.spawnZones) out.push(grow(z.rect, 3.5));
  // District seam crossings (tests/expansion.test.ts: three clear walks per shared edge).
  for (let i = 0; i < w.districts.length; i++) for (const o of w.districts.slice(i + 1)) {
    for (const c of seamCrossings(w.districts[i].rect, o.rect)) {
      out.push(rect(Math.min(c.a.x, c.b.x) - 5, Math.min(c.a.z, c.b.z) - 5, Math.max(c.a.x, c.b.x) + 5, Math.max(c.a.z, c.b.z) + 5));
    }
  }
  for (const g of w.guards) { out.push(around(g.pos, 2.5)); for (const p of g.waypoints) out.push(around(p, 2)); }
  for (const d of w.districts) for (const p of d.spawnPoints) out.push(around(p, 3));
  for (const s of w.structures) {
    out.push(grow(s.enclosure, 6), grow(s.rect, 3));
    for (const p of [...s.approachOutside, ...s.approachInside]) out.push(around(p, 3));
  }
  for (const s of w.strongholds) { out.push(grow(s.bounds, 8)); for (const p of s.reinforcementPoints) out.push(around(p, 4)); }
  for (const n of w.nests) out.push(around(n.pos, 12));
  out.push(grow(w.startFollowerArea, 6), around(w.playerStart, 14));
  const nest = w.nests.find(n => n.id === 'nest_start');
  if (nest) out.push(grow(rect(Math.min(w.playerStart.x, nest.pos.x), Math.min(w.playerStart.z, nest.pos.z),
    Math.max(w.playerStart.x, nest.pos.x), Math.max(w.playerStart.z, nest.pos.z)), 5));
  if (extra.startBeach) out.push(grow(extra.startBeach, 8));
  if (extra.checkpoint) out.push(grow(extra.checkpoint, 8));
  const ring = ringRoadRects(w.playArea), pad = RING.sidewalk + 3;
  out.push(grow(ring.north, pad), grow(ring.west, pad), grow(ring.east, pad));
  for (const h of HIDEOUTS) out.push(around(h.pos, 8));
  for (const s of SECRETS) { out.push(around(s.pos, 8)); if (s.shortcutTo) out.push(around(s.shortcutTo, 8)); }
  for (const c of COMPANIONS) out.push(around(c.unlockPos, 8));
  for (const m of w.markings) if (m.kind === 'crosswalk') out.push(grow(m.rect, 2));
  // Intro camera path (tests/intro.test.ts: the camera may never pass through a collider).
  const script = buildIntroScript({ playerStart: w.playerStart, playerStartFacing: w.playerStartFacing } as unknown as DistrictLayout);
  const pose = createPose(), last = script.keys[script.keys.length - 1].t;
  for (let t = 0; t <= last; t += 0.1) {
    sampleCameraPath(script.keys, t, pose);
    if (pose.pos.y < 48) out.push(around({ x: pose.pos.x, z: pose.pos.z }, 5));
  }
  return out;
}

/** Occupancy of the draft world: colliders (+ dilation), paving, base-fill-aware ground and every protected rect. */
export function buildOccupancy(w: WorldDraft, extra: InfillExtras = {}): Occupancy {
  const b = w.bounds, pa = w.playArea;
  const g = new Occupancy(b.minX, b.minZ, b.maxX, b.maxZ);
  g.mark(FLAG.SOLID, rect(b.minX, b.minZ, pa.minX + 14, b.maxZ));
  g.mark(FLAG.SOLID, rect(pa.maxX - 14, b.minZ, b.maxX, b.maxZ));
  g.mark(FLAG.SOLID, rect(b.minX, b.minZ, b.maxX, pa.minZ + 14));
  g.mark(FLAG.SOLID, rect(b.minX, pa.maxZ - 8, b.maxX, b.maxZ));
  for (const gp of w.ground) {
    if (gp.kind === 'road' || gp.kind === 'sidewalk' || gp.kind === 'sand') g.mark(FLAG.PAVED, gp.rect);
    else if (area(gp.rect) < BASE_FILL_AREA) {
      if (gp.kind === 'compound') { g.mark(FLAG.SOLID, gp.rect); g.mark(FLAG.DIL, gp.rect, 3); } else g.mark(FLAG.SOFT | FLAG.KEEP, gp.rect);
    }
  }
  for (const c of w.colliders) {
    g.mark(FLAG.SOLID, c);
    g.mark(FLAG.DIL, c, c.kind === 'prop' || c.kind === 'vehicle' ? 1.5 : 3);
  }
  for (const p of w.props) g.mark(FLAG.SOFT, around(p.pos, 1.2));
  // The original four districts (x/z within +-200/160) keep their hand-authored street scenes (tests and playtests place actors
  // beside the avenues): nothing blocking is added within NEAR_AVENUE metres of a carriageway there.
  for (const q of w.ground) if (q.kind === 'road' && overlaps(q.rect, ORIGINAL_AREA)) g.mark(FLAG.NEAR, q.rect, NEAR_AVENUE);
  // Junction boxes (roads that cross or abut at right angles) keep 6 m clear all round: lanes, signals and the crossing tests.
  const roads = w.ground.filter(q => q.kind === 'road').map(q => q.rect);
  const alongZ = (r: AABB): boolean => r.maxZ - r.minZ > r.maxX - r.minX;
  for (const a of roads) if (alongZ(a)) for (const b of roads) {
    if (alongZ(b)) continue;
    const ga = grow(a, 0.5), gb = grow(b, 0.5);
    if (!overlaps(ga, gb)) continue;
    const box = rect(Math.max(ga.minX, gb.minX), Math.max(ga.minZ, gb.minZ), Math.min(ga.maxX, gb.maxX), Math.min(ga.maxZ, gb.maxZ));
    g.mark(FLAG.JUNC, box, 6.5);
  }
  for (const r of protectedRects(w, extra)) g.mark(FLAG.SOFT, r);
  // Ground that is appended after the VP2 passes (start beach, ring road + its inner sidewalks) is paving for them.
  if (extra.startBeach) g.mark(FLAG.PAVED, extra.startBeach);
  const ring = ringRoadRects(w.playArea);
  for (const r of [ring.north, ring.west, ring.east]) g.mark(FLAG.PAVED, r);
  g.mark(FLAG.PAVED, grow(ring.north, RING.sidewalk));
  g.mark(FLAG.PAVED, grow(ring.west, RING.sidewalk));
  g.mark(FLAG.PAVED, grow(ring.east, RING.sidewalk));
  return g;
}

// --------------------------------------------------------------------------------------------------------------------
// Edges: the outer long sides of sidewalk strips
// --------------------------------------------------------------------------------------------------------------------

/** Buildings/lots start this many metres beyond the sidewalk edge (consistent setback). */
const SETBACK = 3;
const MAX_DEPTH = 26;
const MIN_RUN_DEPTH = 6;
const MIN_RUN_WIDTH = 6;

interface Edge {
  alongX: boolean;
  /** Integer coordinate of the sidewalk's outer edge on the cross axis. */
  e: number;
  /** +1 = parcels extend towards +cross axis, -1 = towards -cross axis. */
  n: 1 | -1;
  lo: number;
  hi: number;
}

function cellRect(e: Edge, t: number, k: number): AABB {
  if (e.alongX) return e.n > 0 ? rect(t, e.e + k, t + 1, e.e + k + 1) : rect(t, e.e - k - 1, t + 1, e.e - k);
  return e.n > 0 ? rect(e.e + k, t, e.e + k + 1, t + 1) : rect(e.e - k - 1, t, e.e - k, t + 1);
}
/** Along range [tLo, tHi) x depth range [dLo, dHi) measured from the edge. */
function span(e: Edge, tLo: number, tHi: number, dLo: number, dHi: number): AABB {
  if (e.alongX) return e.n > 0 ? rect(tLo, e.e + dLo, tHi, e.e + dHi) : rect(tLo, e.e - dHi, tHi, e.e - dLo);
  return e.n > 0 ? rect(e.e + dLo, tLo, e.e + dHi, tHi) : rect(e.e - dHi, tLo, e.e - dLo, tHi);
}
/** Direction a building on this edge faces (towards the sidewalk). */
function frontOf(e: Edge): Facing4 {
  if (e.alongX) return e.n > 0 ? 'north' : 'south';
  return e.n > 0 ? 'west' : 'east';
}
const FACING_ROT: Record<Facing4, number> = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };

function edgesFor(w: WorldDraft, dr: AABB): Edge[] {
  const out: Edge[] = [];
  for (const gp of w.ground) {
    if (gp.kind !== 'sidewalk' || !overlaps(gp.rect, dr)) continue;
    const r = gp.rect, alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
    const long = alongX ? r.maxX - r.minX : r.maxZ - r.minZ, short = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
    if (long < 8 || short > 6) continue;
    for (const n of [-1, 1] as const) {
      const raw = alongX ? (n < 0 ? r.minZ : r.maxZ) : (n < 0 ? r.minX : r.maxX);
      const lo = Math.ceil(Math.max(alongX ? r.minX : r.minZ, alongX ? dr.minX : dr.minZ) - 1e-6);
      const hi = Math.floor(Math.min(alongX ? r.maxX : r.maxZ, alongX ? dr.maxX : dr.maxZ) + 1e-6);
      if (hi - lo < MIN_RUN_WIDTH) continue;
      out.push({ alongX, e: n > 0 ? Math.ceil(raw - 1e-6) : Math.floor(raw + 1e-6), n, lo, hi });
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Item kinds & theme mix
// --------------------------------------------------------------------------------------------------------------------

type ItemKind = 'building' | 'parkingLot' | 'pocketPark' | 'court' | 'plaza' | 'construction' | 'market';
export const INFILL_KINDS: readonly ItemKind[] = ['building', 'parkingLot', 'pocketPark', 'court', 'plaza', 'construction', 'market'];

const THEME_MIX: Readonly<Record<DistrictTheme, Partial<Record<ItemKind, number>>>> = {
  downtown: { building: 70, plaza: 9, parkingLot: 10, construction: 6, market: 5 },
  residential: { building: 52, pocketPark: 20, parkingLot: 6, court: 10, construction: 4, market: 3 },
  beachfront: { building: 48, plaza: 14, market: 20, pocketPark: 10, parkingLot: 6 },
  industrial: { building: 40, parkingLot: 28, construction: 16, market: 8 },
  entertainment: { building: 52, plaza: 16, market: 16, parkingLot: 10, court: 4 },
  civic: { building: 52, pocketPark: 14, parkingLot: 16, plaza: 12, construction: 4 },
  campus: { building: 44, pocketPark: 20, court: 10, plaza: 16, parkingLot: 6, market: 4 },
  resort: { building: 48, pocketPark: 20, plaza: 16, parkingLot: 6, court: 4 },
  military: { building: 36, parkingLot: 22, construction: 24, market: 8 },
  airport: { building: 34, parkingLot: 42, construction: 14, market: 4 },
  park: { building: 26, pocketPark: 36, court: 16, plaza: 10, market: 10 },
};

const STYLE_FOR: Readonly<Record<BuildingArchetype, BuildingStyle>> = {
  bungalow: 'house', villa: 'house', artDecoHotel: 'apartment', apartment: 'apartment', convenienceStore: 'storefront',
  restaurant: 'storefront', beachShop: 'storefront', office: 'office', municipal: 'civic', warehouse: 'warehouse',
  parkingGarage: 'garage', gasStation: 'garage', landmark: 'civic',
};
/** Collider height range per archetype (scaled by the district's heightScale, never below the archetype minimum). */
const HEIGHT_RANGE: Readonly<Record<BuildingArchetype, [number, number]>> = {
  bungalow: [3.2, 5], villa: [4.5, 7.5], artDecoHotel: [10, 24], apartment: [9, 20], convenienceStore: [3.6, 5],
  restaurant: [3.6, 5.5], beachShop: [3.2, 5], office: [10, 30], municipal: [7, 14], warehouse: [6, 10],
  parkingGarage: [7, 15], gasStation: [4, 4.5], landmark: [10, 20],
};
const MAX_ALONG = 26, MAX_BLDG_DEPTH = 18;

// --------------------------------------------------------------------------------------------------------------------
// Pass
// --------------------------------------------------------------------------------------------------------------------

export interface InfillReport {
  /** Items placed, by kind (`gasStation` and `landmark` included). */
  counts: Record<string, number>;
  landmarks: { districtId: string; kind: CityLandmarkKind; pos: Vec2 }[];
}

interface Ctx {
  w: WorldDraft;
  g: Occupancy;
  rng: Rng;
  style: DistrictStyle;
  dr: AABB;
  edges: Edge[];
  /** District base-fill ground patches (area >= BASE_FILL_AREA) known before the pass. */
  base: { kind: string; rect: AABB }[];
  report: InfillReport;
  districtId: string;
}

function count(ctx: Ctx, key: string): void { ctx.report.counts[key] = (ctx.report.counts[key] ?? 0) + 1; }
function irand(rng: Rng, lo: number, hi: number): number { return lo + Math.floor(rng.next() * (hi - lo + 1)); }

/** Free depth per column of the edge from `from` to `to` (exclusive), measured beyond the setback. */
function profile(ctx: Ctx, e: Edge, from: number, to: number): Int16Array {
  const out = new Int16Array(Math.max(0, to - from));
  for (let t = from; t < to; t++) {
    let ok = true;
    for (let k = 0; k < SETBACK && ok; k++) if (ctx.g.hit(cellRect(e, t, k), FLAG.PAVED | FLAG.SOLID)) ok = false;
    if (!ok) continue;
    let depth = 0;
    while (depth < MAX_DEPTH) {
      const c = cellRect(e, t, SETBACK + depth);
      const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2;
      if (mx < ctx.dr.minX || mx >= ctx.dr.maxX || mz < ctx.dr.minZ || mz >= ctx.dr.maxZ) break;
      if (ctx.g.hit(c, BLOCKED)) break;
      depth++;
    }
    out[t - from] = depth;
  }
  return out;
}
function minDepth(prof: Int16Array, from: number, a: number, b: number): number {
  let m = MAX_DEPTH;
  for (let t = a; t < b; t++) m = Math.min(m, prof[t - from]);
  return m;
}

function claim(ctx: Ctx, r: AABB, solidThing: boolean): void {
  if (solidThing) { ctx.g.mark(FLAG.SOLID, r); ctx.g.mark(FLAG.DIL, r, 3); } else ctx.g.mark(FLAG.SOFT, r);
  ctx.g.mark(FLAG.USED, r);
}

function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T | null {
  const total = items.reduce((n, i) => n + i[1], 0);
  if (total <= 0) return null;
  let ticket = rng.next() * total;
  for (const [item, weight] of items) { ticket -= weight; if (ticket < 0) return item; }
  return items[items.length - 1][0];
}

/** Integer along/depth dims for an archetype inside (maxAlong, maxDepth), or null when it cannot fit. */
function fitDims(a: BuildingArchetype, maxAlong: number, maxDepth: number, rng: Rng): { along: number; depth: number } | null {
  const m = ARCHETYPE_MIN_FOOTPRINT[a];
  const ca = Math.min(maxAlong, MAX_ALONG), cd = Math.min(maxDepth, MAX_BLDG_DEPTH);
  const options: { aLo: number; dLo: number }[] = [];
  if (ca >= m.d && cd >= m.w) options.push({ aLo: m.d, dLo: m.w });
  if (ca >= m.w && cd >= m.d) options.push({ aLo: m.w, dLo: m.d });
  if (!options.length) return null;
  const o = options[Math.floor(rng.next() * options.length)];
  return { along: irand(rng, o.aLo, Math.min(ca, o.aLo + 7)), depth: irand(rng, o.dLo, Math.min(cd, o.dLo + 5)) };
}

function heightFor(a: BuildingArchetype, style: DistrictStyle, rng: Rng): number {
  const [lo, hi] = HEIGHT_RANGE[a];
  const h = (lo + (hi - lo) * rng.next()) * style.heightScale;
  return Math.round(Math.max(h, ARCHETYPE_MIN_FOOTPRINT[a].h) * 2) / 2;
}

function addBuilding(ctx: Ctx, e: Edge, r: AABB, a: BuildingArchetype, h: number, landmark?: CityLandmarkKind): void {
  const w = ctx.w;
  building(w, r, STYLE_FOR[a], h, ctx.rng);
  const b = w.buildings[w.buildings.length - 1];
  b.archetype = a;
  b.frontage = frontOf(e);
  if (landmark) b.landmark = landmark;
  claim(ctx, r, true);
}

// ---- items ---------------------------------------------------------------------------------------------------------

function placeBuilding(ctx: Ctx, e: Edge, t: number, runHi: number, prof: Int16Array, from: number): number {
  const rw = runHi - t;
  const mix = Object.entries(ctx.style.archetypeWeights)
    .filter(([a]) => a !== 'gasStation' && a !== 'landmark') as [BuildingArchetype, number][];
  for (let attempt = 0; attempt < 4; attempt++) {
    const probe = minDepth(prof, from, t, Math.min(runHi, t + 12));
    const feasible = mix.filter(([a]) => fitDims(a, rw, probe, { next: () => 0.5 }) !== null);
    const arch = pickWeighted(ctx.rng, feasible);
    if (!arch) return 0;
    const dims = fitDims(arch, rw, probe, ctx.rng);
    if (!dims) continue;
    let along = dims.along;
    const rest = rw - along;
    if (rest > 0 && rest < MIN_RUN_WIDTH && along + rest <= MAX_ALONG) along += rest;
    const depth = Math.min(dims.depth, minDepth(prof, from, t, t + along));
    const m = ARCHETYPE_MIN_FOOTPRINT[arch];
    if (depth < Math.min(m.w, m.d) || Math.max(depth, along) < m.d) continue;
    addBuilding(ctx, e, span(e, t, t + along, SETBACK, SETBACK + depth), arch, heightFor(arch, ctx.style, ctx.rng));
    count(ctx, 'building');
    return along;
  }
  return 0;
}

/** CityDistrict clips lower-priority ground under higher (lot = court < park = compound < sand < plaza): pick a visible kind. */
const GROUND_RANK: Readonly<Record<string, number>> = { lot: 1, court: 1, park: 2, compound: 2, sand: 3, plaza: 4 };
type FreeGround = 'lot' | 'park' | 'plaza' | 'court';
function visibleGround(ctx: Ctx, kind: FreeGround, r: AABB): FreeGround {
  const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
  let base: string | null = null;
  for (const b of ctx.base) if (cx > b.rect.minX && cx < b.rect.maxX && cz > b.rect.minZ && cz < b.rect.maxZ) base = b.kind;
  if (base === null || GROUND_RANK[kind] >= GROUND_RANK[base]) return kind;
  return 'plaza';
}
function groundPatch(ctx: Ctx, kind: FreeGround, r: AABB): void {
  ctx.w.ground.push({ kind: visibleGround(ctx, kind, r), rect: r });
  claim(ctx, r, false);
}

function randIn(rng: Rng, lo: number, hi: number): number { return lo + (hi - lo) * rng.next(); }

function scatterPlants(ctx: Ctx, r: AABB, perArea: number, inset: number): void {
  const n = Math.max(2, Math.round(area(r) * perArea));
  for (let i = 0; i < n; i++) {
    const x = Math.round(randIn(ctx.rng, r.minX + inset, r.maxX - inset) * 2) / 2;
    const z = Math.round(randIn(ctx.rng, r.minZ + inset, r.maxZ - inset) * 2) / 2;
    prop(ctx.w, ctx.rng.next() < 0.55 ? 'tree' : 'bush', x, z, ctx.rng.next() * Math.PI * 2, irand(ctx.rng, 0, 5));
  }
}

function placeItem(ctx: Ctx, kind: ItemKind, e: Edge, t: number, runHi: number, prof: Int16Array, from: number): number {
  if (kind === 'building') return placeBuilding(ctx, e, t, runHi, prof, from);
  const rw = runHi - t, rng = ctx.rng, front = frontOf(e), rot = FACING_ROT[front];
  const fit = (minW: number, maxW: number, minD: number, maxD: number): { along: number; depth: number } | null => {
    if (rw < minW) return null;
    let along = irand(rng, minW, Math.min(maxW, rw));
    if (rw - along > 0 && rw - along < MIN_RUN_WIDTH) along = rw;
    const avail = minDepth(prof, from, t, t + along);
    if (avail < minD) return null;
    return { along, depth: irand(rng, minD, Math.min(maxD, avail)) };
  };
  const mid = (r: AABB): Vec2 => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
  switch (kind) {
    case 'parkingLot': {
      const f = fit(16, 30, 13, 20);
      if (!f) return 0;
      const r = span(e, t, t + f.along, SETBACK, SETBACK + f.depth);
      groundPatch(ctx, 'lot', r);
      // Perpendicular stalls (3.2 m pitch) in a back row, plus a front row when the lot is deep enough; aisle >= 6 m.
      const rows = f.depth >= 19 ? [f.depth - 4, 3.5] : [f.depth - 4];
      for (const dRow of rows) for (let a = t + 3; a <= t + f.along - 3; a += 3.2) {
        if (rng.next() > 0.62) continue;
        const p = e.alongX
          ? { x: a, z: e.n > 0 ? e.e + SETBACK + dRow : e.e - SETBACK - dRow }
          : { x: e.n > 0 ? e.e + SETBACK + dRow : e.e - SETBACK - dRow, z: a };
        vehicle(ctx.w, 'car', Math.round(p.x * 2) / 2, Math.round(p.z * 2) / 2,
          (e.alongX ? 0 : Math.PI / 2) + (rng.next() < 0.5 ? Math.PI : 0), rng);
        const pr = ctx.w.colliders[ctx.w.colliders.length - 1];
        ctx.g.mark(FLAG.SOLID, pr); ctx.g.mark(FLAG.DIL, pr, 1.5);
      }
      return f.along;
    }
    case 'pocketPark': {
      const f = fit(12, 24, 9, 16);
      if (!f) return 0;
      const r = span(e, t, t + f.along, SETBACK, SETBACK + f.depth);
      groundPatch(ctx, 'park', r);
      scatterPlants(ctx, r, 1 / 38, 1.5);
      return f.along;
    }
    case 'court': {
      const f = fit(18, 22, 11, 13);
      if (!f) return 0;
      const r = span(e, t, t + f.along, SETBACK, SETBACK + f.depth);
      groundPatch(ctx, 'court', r);
      const c = mid(r);
      for (const s of [-1, 1]) {
        const off = (f.along / 2 - 1.5) * s;
        blockingProp(ctx.w, 'basketballHoop', e.alongX ? c.x + off : c.x, e.alongX ? c.z : c.z + off, rot + (s < 0 ? 0 : Math.PI), irand(rng, 0, 3));
      }
      return f.along;
    }
    case 'plaza': {
      const f = fit(12, 20, 10, 14);
      if (!f) return 0;
      const r = span(e, t, t + f.along, SETBACK, SETBACK + f.depth);
      groundPatch(ctx, 'plaza', r);
      for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const x = (r.minX + r.maxX) / 2 + fx * ((r.maxX - r.minX) / 2 - 2), z = (r.minZ + r.maxZ) / 2 + fz * ((r.maxZ - r.minZ) / 2 - 2);
        blockingProp(ctx.w, 'planter', Math.round(x * 2) / 2, Math.round(z * 2) / 2, rng.next() * Math.PI, irand(rng, 0, 3));
      }
      scatterPlants(ctx, grow(r, -3), 1 / 90, 0);
      return f.along;
    }
    case 'construction': {
      const f = fit(14, 24, 10, 14);
      if (!f) return 0;
      const r = span(e, t, t + f.along, SETBACK, SETBACK + f.depth);
      groundPatch(ctx, 'lot', r);
      // Fence along the street side with a wide gate gap (visual chain fence; only the barrier stubs block).
      const gate = t + Math.floor(f.along / 2);
      for (let a = t + 1; a < t + f.along - 1; a += 3) {
        if (Math.abs(a + 1.5 - gate) < 4) continue;
        const p = e.alongX ? { x: a + 1.5, z: e.e + e.n * (SETBACK + 0.5) } : { x: e.e + e.n * (SETBACK + 0.5), z: a + 1.5 };
        prop(ctx.w, 'chainFence', p.x, p.z, e.alongX ? 0 : Math.PI / 2, irand(rng, 0, 3));
      }
      for (const side of [-1, 1]) {
        const a = gate + side * 5;
        const p = e.alongX ? { x: a, z: e.e + e.n * (SETBACK + 0.5) } : { x: e.e + e.n * (SETBACK + 0.5), z: a };
        blockingProp(ctx.w, 'constructionBarrier', p.x, p.z, e.alongX ? 0 : Math.PI / 2, irand(rng, 0, 3));
      }
      const c = mid(r);
      blockingProp(ctx.w, 'crates', Math.round(c.x - 3), Math.round(c.z), 0, irand(rng, 0, 3));
      blockingProp(ctx.w, 'crates', Math.round(c.x + 3), Math.round(c.z + 2), 0.4, irand(rng, 0, 3));
      return f.along;
    }
    case 'market': {
      const f = fit(14, 22, 9, 12);
      if (!f) return 0;
      const r = span(e, t, t + f.along, SETBACK, SETBACK + f.depth);
      groundPatch(ctx, 'plaza', r);
      // Stalls on a 4 m grid (>= 3 m between neighbours): crates + patio tables.
      for (let x = r.minX + 3; x <= r.maxX - 3; x += 4) for (let z = r.minZ + 3; z <= r.maxZ - 3; z += 4) {
        if (rng.next() > 0.55) continue;
        blockingProp(ctx.w, rng.next() < 0.5 ? 'crates' : 'patioTable', Math.round(x), Math.round(z), 0, irand(rng, 0, 3));
      }
      return f.along;
    }
  }
}

function consumeRun(ctx: Ctx, e: Edge, runLo: number, runHi: number, prof: Int16Array, from: number): void {
  const rng = ctx.rng;
  const mix = THEME_MIX[ctx.style.theme];
  const skip = 0.3 * (1 - ctx.style.infillDensity);
  let t = runLo;
  for (let guard = 0; guard < 60 && runHi - t >= MIN_RUN_WIDTH; guard++) {
    if (rng.next() < skip) { t += irand(rng, 4, 8); continue; }
    const kinds = (Object.entries(mix) as [ItemKind, number][]);
    const order: ItemKind[] = [];
    const bag = kinds.slice();
    while (bag.length) {
      const k = pickWeighted(rng, bag)!;
      order.push(k);
      bag.splice(bag.findIndex(b => b[0] === k), 1);
    }
    let used = 0;
    for (const k of order) { used = placeItem(ctx, k, e, t, runHi, prof, from); if (used) break; }
    t += used || 4;
  }
}

function processEdge(ctx: Ctx, e: Edge): void {
  let cursor = e.lo;
  for (let guard = 0; guard < 40 && e.hi - cursor >= MIN_RUN_WIDTH; guard++) {
    const prof = profile(ctx, e, cursor, e.hi);
    let a = -1;
    let runLo = -1, runHi = -1;
    for (let i = 0; i <= prof.length; i++) {
      const ok = i < prof.length && prof[i] >= MIN_RUN_DEPTH;
      if (ok && a < 0) a = i;
      if (!ok && a >= 0) {
        if (i - a >= MIN_RUN_WIDTH) { runLo = cursor + a; runHi = cursor + i; break; }
        a = -1;
      }
    }
    if (runLo < 0) break;
    consumeRun(ctx, e, runLo, runHi, prof, cursor);
    cursor = runHi + 1;
  }
}

// ---- landmarks + gas station -------------------------------------------------------------------------------------------

function placeLandmark(ctx: Ctx, kind: CityLandmarkKind): boolean {
  const sz = LANDMARK_SIZES[kind], c = { x: (ctx.dr.minX + ctx.dr.maxX) / 2, z: (ctx.dr.minZ + ctx.dr.maxZ) / 2 };
  let best: { e: Edge; t: number; score: number } | null = null;
  for (const e of ctx.edges) {
    const prof = profile(ctx, e, e.lo, e.hi);
    for (let t = e.lo; t + sz.along <= e.hi; t += 2) {
      if (minDepth(prof, e.lo, t, t + sz.along) < sz.depth) continue;
      const r = span(e, t, t + sz.along, SETBACK, SETBACK + sz.depth);
      if (kind === 'glassTower') {
        let tall = 0;
        for (const b of ctx.w.buildings) {
          if (b.height >= 14 && Math.hypot((b.footprint.minX + b.footprint.maxX) / 2 - (r.minX + r.maxX) / 2,
            (b.footprint.minZ + b.footprint.maxZ) / 2 - (r.minZ + r.maxZ) / 2) < 70) tall++;
        }
        if (tall < 3) continue;
      }
      const score = Math.hypot((r.minX + r.maxX) / 2 - c.x, (r.minZ + r.maxZ) / 2 - c.z) + ctx.rng.next() * 6;
      if (!best || score < best.score) best = { e, t, score };
    }
  }
  if (!best) return false;
  const { e, t } = best, r = span(e, t, t + sz.along, SETBACK, SETBACK + sz.depth);
  addBuilding(ctx, e, r, 'landmark', sz.h, kind);
  const b = ctx.w.buildings[ctx.w.buildings.length - 1];
  const lot = grow(r, 2);
  b.lot = lot;
  ctx.w.ground.push({ kind: 'plaza', rect: lot });
  ctx.g.mark(FLAG.SOFT, lot);
  if (OPEN_LANDMARKS.has(kind)) ctx.g.mark(FLAG.DIL, r, 3);
  count(ctx, 'landmark');
  ctx.report.landmarks.push({ districtId: ctx.districtId, kind, pos: { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 } });
  return true;
}

/** Fallback landmark site: nearest-to-centre clear rect (2 m margin to anything solid) anywhere in the district. */
function placeLandmarkAnywhere(ctx: Ctx, kind: CityLandmarkKind): boolean {
  const sz = LANDMARK_SIZES[kind], dr = ctx.dr, c = { x: (dr.minX + dr.maxX) / 2, z: (dr.minZ + dr.maxZ) / 2 };
  const mask = FLAG.SOLID | FLAG.SOFT | FLAG.PAVED | FLAG.JUNC | FLAG.NEAR | FLAG.USED;
  let best: { r: AABB; score: number } | null = null;
  for (const [a, d] of [[sz.along, sz.depth], [sz.depth, sz.along]] as const) {
    for (let x = Math.ceil(dr.minX); x + a <= dr.maxX; x++) for (let z = Math.ceil(dr.minZ); z + d <= dr.maxZ; z++) {
      const r = rect(x, z, x + a, z + d);
      const score = Math.hypot(x + a / 2 - c.x, z + d / 2 - c.z);
      if ((best && score >= best.score) || ctx.g.hit(r, mask, 3)) continue;
      best = { r, score };
    }
  }
  if (!best) return false;
  const r = best.r;
  building(ctx.w, r, 'civic', sz.h, ctx.rng);
  const b = ctx.w.buildings[ctx.w.buildings.length - 1];
  b.archetype = 'landmark'; b.landmark = kind;
  claim(ctx, r, true);
  count(ctx, 'landmark');
  ctx.report.landmarks.push({ districtId: ctx.districtId, kind, pos: { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 } });
  return true;
}

/** Gas station at a corner lot: 10 x 7 kiosk at the back of a 20 x 19 parcel, two pump islands on the forecourt. */
function placeGasStation(ctx: Ctx): boolean {
  const ALONG = 20, DEPTH = 19, KIOSK_ALONG = 10, KIOSK_DEPTH = 7;
  const candidates: { e: Edge; t: number; score: number }[] = [];
  for (const e of ctx.edges) {
    const prof = profile(ctx, e, e.lo, e.hi);
    const cornerAt = (t: number): boolean => t < e.lo || t >= e.hi || ctx.g.hit(cellRect(e, t, SETBACK + 2), FLAG.PAVED | FLAG.JUNC);
    for (let t = e.lo; t + ALONG <= e.hi; t++) {
      if (!(cornerAt(t - 1) || cornerAt(t + ALONG))) continue;
      if (minDepth(prof, e.lo, t, t + ALONG) < DEPTH) continue;
      candidates.push({ e, t, score: ctx.rng.next() });
    }
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => a.score - b.score);
  const { e, t } = candidates[0];
  const parcel = span(e, t, t + ALONG, SETBACK, SETBACK + DEPTH);
  groundPatchLot(ctx, parcel);
  const kioskLo = t + (ALONG - KIOSK_ALONG) / 2;
  const kiosk = span(e, kioskLo, kioskLo + KIOSK_ALONG, SETBACK + DEPTH - KIOSK_DEPTH, SETBACK + DEPTH);
  addBuilding(ctx, e, kiosk, 'gasStation', 4, undefined);
  ctx.w.buildings[ctx.w.buildings.length - 1].lot = parcel;
  // Pump islands: 3 m in front of the kiosk face, long axis along the street, centred 3.2 m either side of the kiosk axis.
  const dMid = SETBACK + DEPTH - KIOSK_DEPTH - 3 - 0.6;
  for (const s of [-1, 1]) {
    const a = kioskLo + KIOSK_ALONG / 2 + s * 3.2;
    const x = e.alongX ? a : e.e + e.n * dMid, z = e.alongX ? e.e + e.n * dMid : a;
    const r = blockingProp(ctx.w, 'gasPump', x, z, e.alongX ? 0 : Math.PI / 2, irand(ctx.rng, 0, 3));
    ctx.g.mark(FLAG.DIL, r, 1.5);
  }
  count(ctx, 'gasStation');
  return true;
}
function groundPatchLot(ctx: Ctx, r: AABB): void { groundPatch(ctx, 'lot', r); }

// ---- leftovers: planted yards / paved strips so no lot stays bare ------------------------------------------------------

const LANDSCAPE_GROUND: Readonly<Record<DistrictTheme, FreeGround>> = {
  downtown: 'plaza', residential: 'park', beachfront: 'park', industrial: 'lot', entertainment: 'plaza', civic: 'park',
  campus: 'park', resort: 'park', military: 'lot', airport: 'lot', park: 'park',
};
const GREEN_THEMES: ReadonlySet<DistrictTheme> = new Set(['residential', 'beachfront', 'civic', 'campus', 'resort', 'park']);

/** Cover remaining free ground (not building / paving / protected / already used) with flat patches + sparse planting. */
function landscapeLeftovers(ctx: Ctx): void {
  const { g, dr, rng } = ctx;
  const x0 = Math.ceil(dr.minX), x1 = Math.floor(dr.maxX), z0 = Math.ceil(dr.minZ), z1 = Math.floor(dr.maxZ);
  const kind = LANDSCAPE_GROUND[ctx.style.theme];
  const open = (x: number, z: number): boolean => {
    const i = (z - g.minZ) * g.cols + (x - g.minX);
    return x >= g.minX && z >= g.minZ && x < g.minX + g.cols && z < g.minZ + g.rows
      && (g.flags[i] & (FLAG.SOLID | FLAG.PAVED | FLAG.KEEP | FLAG.USED | FLAG.JUNC)) === 0;
  };
  const rowOpen = (xa: number, xb: number, z: number): boolean => { for (let x = xa; x <= xb; x++) if (!open(x, z)) return false; return true; };
  const perArea = (GREEN_THEMES.has(ctx.style.theme) ? 1 / 60 : 1 / 160) * ctx.style.vegetation;
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      if (!open(x, z)) continue;
      let xe = x;
      while (xe + 1 < x1 && open(xe + 1, z)) xe++;
      let ze = z;
      while (ze + 1 < z1 && rowOpen(x, xe, ze + 1)) ze++;
      const wd = xe - x + 1, ht = ze - z + 1;
      if (!(Math.min(wd, ht) >= 3 || (Math.min(wd, ht) >= 2 && Math.max(wd, ht) >= 8))) { x = xe; continue; }
      const r = rect(x, z, xe + 1, ze + 1);
      groundPatch(ctx, kind, r);
      count(ctx, 'landscape');
      const n = Math.floor(area(r) * perArea + rng.next());
      for (let i = 0; i < n; i++) {
        const px = Math.round(randIn(rng, r.minX + 1, Math.max(r.minX + 1, r.maxX - 1)) * 2) / 2;
        const pz = Math.round(randIn(rng, r.minZ + 1, Math.max(r.minZ + 1, r.maxZ - 1)) * 2) / 2;
        if (g.hit(rect(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5), FLAG.SOLID | FLAG.DIL | FLAG.SOFT | FLAG.PAVED | FLAG.JUNC | FLAG.NEAR)) continue;
        const roll = rng.next();
        prop(ctx.w, GREEN_THEMES.has(ctx.style.theme) && roll < 0.25 && ctx.style.palms.length ? 'palm' : roll < 0.65 ? 'tree' : 'bush',
          px, pz, rng.next() * Math.PI * 2, irand(rng, 0, 5));
        g.mark(FLAG.SOFT, rect(px - 0.8, pz - 0.8, px + 0.8, pz + 0.8));
      }
      x = xe;
    }
  }
}

// ---- entry -------------------------------------------------------------------------------------------------------------

export function placeUrbanInfill(w: WorldDraft, seed: number, extra: InfillExtras = {}): InfillReport {
  const report: InfillReport = { counts: {}, landmarks: [] };
  const g = buildOccupancy(w, extra);
  for (const d of w.districts) {
    const style = DISTRICT_STYLES[d.id];
    const ctx: Ctx = { w, g, rng: mulberry32(hashString(`vp2-infill:${seed}:${d.id}`)), style, dr: d.rect,
      edges: edgesFor(w, d.rect), base: w.ground.filter(p => area(p.rect) >= BASE_FILL_AREA && overlaps(p.rect, d.rect)), report, districtId: d.id };
    let landmarks = 0;
    for (const kind of style.landmarks) if (landmarks < 2 && placeLandmark(ctx, kind)) landmarks++;
    // Dense blocks leave no frontage parcel for a big landmark: fall back to any clear spot in the district.
    if (landmarks === 0) for (const kind of style.landmarks) if (placeLandmarkAnywhere(ctx, kind)) { landmarks++; break; }
    if ((style.archetypeWeights.gasStation ?? 0) > 0) placeGasStation(ctx);
    for (const e of ctx.edges) processEdge(ctx, e);
    landscapeLeftovers(ctx);
  }
  return report;
}
