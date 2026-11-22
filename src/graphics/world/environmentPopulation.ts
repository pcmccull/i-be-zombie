// [pure] VP2-T007 render-only environment dressing placement (docs/12_visual_polish2.md §6-8, ARCHITECTURE §VP2-1/VP2-3).
// populateChunk(layout, chunkId) returns the curbs, road details, sidewalk furniture, palms, building-edge plants / clutter
// and park vegetation for one 80 m chunk. Pure and deterministic: the result depends only on (layout, chunkId) — every
// random stream is a mulberry32 seeded by an FNV-1a hash of (SEED, chunkId, category), never Math.random, and the only
// module state is a WeakMap cache of the per-layout spatial index (built lazily, never mutated afterwards).
//
// Hard rules (VP2-3): dressing never intersects a collider footprint (only the wall-mounted `vine` may touch the 0.8 m
// band outside a building face), items taller than 0.5 m only stand in the sidewalk furniture strip (<= 1.2 m from the
// road edge), the building wall band (<= 0.8 m from a footprint), or park / plaza / court / lot / yard interiors >= 1.5 m
// from spawn zones and >= claimRadius + 1.5 m from nests; road surfaces only take FLAT_KINDS; nothing on START_BEACH, on
// the playerStart -> start-nest line (+/- 2 m), on a traffic lane (non-flat) or within 1.2 m of a guard waypoint.
import { BALANCE } from '../../config/balance';
import { DISTRICT_STYLES, type DistrictStyle } from '../../content/districtStyles';
import type { AABB, BuildingDef, DistrictId, DistrictLayout } from '../../core/types';
import { buildTrafficNetwork, type NetworkLane } from '../../systems/trafficControl';
import { mulberry32 } from '../../utils/rng';
import { START_BEACH } from '../../world/districtLayout';
import { chunkIdAt, chunkRect } from '../../world/worldQueries';
import { GROUND_TOP } from '../../world/groundLevels';
import { FLAT_KINDS, type DressingKind, type FurnitureKind } from '../environment/environmentKinds';

export interface DressingInstance {
  kind: DressingKind; x: number; y: number; z: number; rotY: number; scale: number;
  /** Flat stretch (curbs, hatching, aprons...): local X length / local Z depth in metres. */
  sx?: number; sz?: number;
  variant: number; tier: 0 | 1 | 2;
}

export interface PopulationStats { total: number; byKind: Record<string, number>; byTier: [number, number, number] }

// ---------------------------------------------------------------------------------------------------------------------
// Tunables / tables
// ---------------------------------------------------------------------------------------------------------------------

export const MAX_ITEMS_PER_CHUNK = 900;
/** Sidewalk furniture strip: items taller than 0.5 m may stand within this distance of the road edge. */
export const STRIP_DEPTH = 1.2;
/** Building wall band: wall-hugging items stand within this distance outside a footprint. */
export const WALL_BAND = 0.8;
/** Items must keep this far from spawn-zone rects when they stand in an interior (tall items). */
export const SPAWN_CLEARANCE = 1.5;
export const GUARD_CLEARANCE = 1.2;
export const START_LINE_CLEARANCE = 2;
/** Non-flat items keep this far from a lane centreline (plus their own radius). */
export const LANE_CLEARANCE = 1.6;

const SEED = 0x7a1c0de5;
const SIDEWALK_Y = 0.155;
const CURB_OFFSET = 0.15;

/** Local half extents (X along the item's width, Z its depth/front) at scale 1. Flat kinds use sx/sz instead. */
const DIMS: Readonly<Record<DressingKind, readonly [number, number]>> = {
  streetlight: [0.3, 0.3], busStop: [1.6, 0.6], bench: [0.9, 0.3], trashCan: [0.3, 0.3], mailbox: [0.25, 0.25],
  newsStand: [0.5, 0.4], bikeRack: [0.6, 0.25], hydrant: [0.25, 0.25], bollard: [0.15, 0.15], planter: [0.5, 0.5],
  roadSign: [0.2, 0.2], utilityBox: [0.5, 0.4], patioTable: [0.6, 0.6], patioUmbrella: [1.1, 1.1], dumpster: [1.0, 0.65],
  trashBags: [0.4, 0.35], crates: [0.45, 0.45], shoppingCart: [0.5, 0.3], parkedBike: [0.5, 0.25],
  constructionBarrier: [1.0, 0.15], fenceSection: [1.0, 0.1], gasPump: [0.5, 0.5], basketballHoop: [0.5, 0.5],
  trafficCone: [0.2, 0.2], manhole: [0.45, 0.45], stormDrain: [0.55, 0.25], roadPatch: [1, 1], curb: [1.5, 0.15],
  curbRamp: [1.5, 0.5], driveway: [1.5, 1.5], medianHatch: [4, 0.8], trafficIsland: [1, 1],
  palmCoconut: [0.45, 0.45], palmRoyal: [0.5, 0.5], palmFan: [0.5, 0.5], palmCluster: [0.8, 0.8],
  shrubFlowering: [0.45, 0.45], bushRound: [0.6, 0.6], grassClump: [0.25, 0.25], flowersTropical: [0.3, 0.3],
  hedge: [1.0, 0.4], planterBox: [0.55, 0.3], vine: [0.6, 0.2], ornamentalTree: [0.7, 0.7],
};

/** Kinds at most 0.5 m tall (flat kinds included): free of the VP2-3 tall-item zone rule. */
export const LOW_KINDS: ReadonlySet<DressingKind> = new Set<DressingKind>([
  ...FLAT_KINDS, 'grassClump', 'flowersTropical', 'trashBags',
]);
/** Kinds that hug a building wall: they may stand up to WALL_BAND outside it (centre outside the footprint). */
export const WALL_MOUNTED_KINDS: ReadonlySet<DressingKind> = new Set<DressingKind>(['vine']);

/** World-aligned half extents of an instance's footprint (rotation + scale + flat stretch applied). */
export function dressingHalfExtents(it: Pick<DressingInstance, 'kind' | 'rotY' | 'scale' | 'sx' | 'sz'>): { hx: number; hz: number } {
  const [bx, bz] = DIMS[it.kind];
  const ax = it.sx !== undefined ? it.sx / 2 : bx * it.scale, az = it.sz !== undefined ? it.sz / 2 : bz * it.scale;
  const c = Math.abs(Math.cos(it.rotY)), s = Math.abs(Math.sin(it.rotY));
  return { hx: c * ax + s * az, hz: s * ax + c * az };
}

export function populationStats(items: readonly DressingInstance[]): PopulationStats {
  const byKind: Record<string, number> = {};
  const byTier: [number, number, number] = [0, 0, 0];
  for (const it of items) { byKind[it.kind] = (byKind[it.kind] ?? 0) + 1; byTier[it.tier]++; }
  return { total: items.length, byKind, byTier };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hash / small geometry helpers
// ---------------------------------------------------------------------------------------------------------------------

function fnv(...vals: number[]): number {
  let h = 0x811c9dc5;
  for (const v of vals) {
    let x = v | 0;
    for (let i = 0; i < 4; i++) { h ^= x & 0xff; h = Math.imul(h, 0x01000193); x >>>= 8; }
  }
  return h >>> 0;
}
function hash01(...vals: number[]): number { return fnv(SEED, ...vals) / 4294967296; }

function distToRect(x: number, z: number, r: AABB): number {
  return Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
}
function inRect(x: number, z: number, r: AABB): boolean { return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ; }
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

class Grid {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}
  private key(i: number, j: number): number { return (i + 4096) * 16384 + (j + 4096); }
  addRect(id: number, r: AABB, pad = 0): void {
    const i0 = Math.floor((r.minX - pad) / this.cell), i1 = Math.floor((r.maxX + pad) / this.cell);
    const j0 = Math.floor((r.minZ - pad) / this.cell), j1 = Math.floor((r.maxZ + pad) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j), list = this.cells.get(k);
      if (list) list.push(id); else this.cells.set(k, [id]);
    }
  }
  addPoint(id: number, x: number, z: number): void { this.addRect(id, { minX: x, maxX: x, minZ: z, maxZ: z }); }
  /** Visit ids in cells touching the box; `fn` returning true stops the scan (returns true). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, fn: (id: number) => boolean): boolean {
    const i0 = Math.floor(minX / this.cell), i1 = Math.floor(maxX / this.cell);
    const j0 = Math.floor(minZ / this.cell), j1 = Math.floor(maxZ / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.cells.get(this.key(i, j));
      if (list) for (const id of list) if (fn(id)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-layout index
// ---------------------------------------------------------------------------------------------------------------------

type BizClass = 'house' | 'shop' | 'office' | 'industrial' | 'apartment' | 'civic';
type Surface = 'road' | 'sidewalk' | 'court' | 'plaza' | 'park' | 'lot' | 'compound' | 'sand';
const SURFACE_RANK: Record<Surface, number> = { road: 0, sidewalk: 1, court: 2, plaza: 3, park: 4, lot: 5, compound: 6, sand: 7 };

interface Side {
  id: number;
  /** Tangent axis of the curb line: 'z' = vertical edge (x = edge), 'x' = horizontal edge (z = edge). */
  axis: 'x' | 'z';
  edge: number; nx: number; nz: number; depth: number; lo: number; hi: number;
  gaps: [number, number][];
}
interface Bld {
  def: BuildingDef; idx: number; cls: BizClass; cx: number; cz: number; fx: number; fz: number; sideId: number; sideGap: number;
}
interface Fixed { kind: DressingKind; x: number; z: number; rotY: number; sx: number; sz: number; tier: 0 | 1 | 2; variant: number }

interface Index {
  layout: DistrictLayout;
  pa: AABB;
  colliders: AABB[]; colGrid: Grid;
  roads: AABB[]; roadGrid: Grid;
  sidewalks: AABB[]; swGrid: Grid;
  ground: { rect: AABB; surface: Surface }[]; groundGrid: Grid;
  interiors: AABB[]; intKinds: string[]; intGrid: Grid;
  courts: AABB[];
  buildings: Bld[]; bldGrid: Grid; bizGrid: Grid;
  spawn: AABB[]; spawnGrid: Grid;
  nests: { x: number; z: number }[];
  guardPts: { x: number; z: number }[]; guardGrid: Grid;
  props: { x: number; z: number }[]; propGrid: Grid;
  lights: { x: number; z: number }[]; lightGrid: Grid;
  lanes: NetworkLane[]; laneGrid: Grid;
  junctions: AABB[]; junGrid: Grid;
  crosswalks: AABB[];
  sides: Side[];
  fixedByChunk: Map<number, Fixed[]>;
  startA: { x: number; z: number }; startB: { x: number; z: number };
  claim: number;
}

const cache = new WeakMap<DistrictLayout, Index>();

function classOf(b: BuildingDef): BizClass {
  switch (b.archetype) {
    case 'bungalow': case 'villa': return 'house';
    case 'convenienceStore': case 'restaurant': case 'beachShop': case 'gasStation': return 'shop';
    case 'office': case 'municipal': case 'parkingGarage': return 'office';
    case 'warehouse': return 'industrial';
    case 'apartment': case 'artDecoHotel': return 'apartment';
    case 'landmark': return 'civic';
    default: break;
  }
  switch (b.style) {
    case 'house': return 'house';
    case 'storefront': return 'shop';
    case 'apartment': return 'apartment';
    case 'warehouse': case 'garage': return 'industrial';
    case 'civic': case 'mall': return 'civic';
    default: return 'office';
  }
}

function frontageVec(f: NonNullable<BuildingDef['frontage']>): [number, number] {
  return f === 'north' ? [0, -1] : f === 'south' ? [0, 1] : f === 'east' ? [1, 0] : [-1, 0];
}

function buildIndex(layout: DistrictLayout): Index {
  const cell = 16;
  const colGrid = new Grid(cell), roadGrid = new Grid(cell), swGrid = new Grid(cell), groundGrid = new Grid(cell);
  const intGrid = new Grid(cell), bldGrid = new Grid(cell), bizGrid = new Grid(cell), spawnGrid = new Grid(cell);
  const junGrid = new Grid(cell), guardGrid = new Grid(cell), propGrid = new Grid(cell), lightGrid = new Grid(cell), laneGrid = new Grid(cell);

  const colliders: AABB[] = layout.colliders.map(c => ({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ }));
  colliders.forEach((r, i) => colGrid.addRect(i, r));

  const roads: AABB[] = [], sidewalks: AABB[] = [], ground: Index['ground'] = [], interiors: AABB[] = [], courts: AABB[] = [];
  const intKinds: string[] = [];
  for (const g of layout.ground) {
    const r = g.rect;
    ground.push({ rect: r, surface: g.kind as Surface });
    groundGrid.addRect(ground.length - 1, r);
    if (g.kind === 'road') { roadGrid.addRect(roads.length, r); roads.push(r); }
    else if (g.kind === 'sidewalk') { swGrid.addRect(sidewalks.length, r); sidewalks.push(r); }
    else if (g.kind === 'park' || g.kind === 'plaza' || g.kind === 'court' || g.kind === 'lot') {
      intGrid.addRect(interiors.length, r); interiors.push(r); intKinds.push(g.kind);
      if (g.kind === 'court') courts.push(r);
    }
  }
  for (const b of layout.buildings) if (b.lot) { intGrid.addRect(interiors.length, b.lot); interiors.push(b.lot); intKinds.push('yard'); }

  const spawn: AABB[] = layout.spawnZones.map(z => z.rect);
  spawn.forEach((r, i) => spawnGrid.addRect(i, r, SPAWN_CLEARANCE));
  const nests = layout.nests.map(n => ({ x: n.pos.x, z: n.pos.z }));
  const guardPts: { x: number; z: number }[] = [];
  for (const g of layout.guards) {
    guardPts.push({ x: g.pos.x, z: g.pos.z });
    for (const w of g.waypoints) guardPts.push({ x: w.x, z: w.z });
  }
  guardPts.forEach((p, i) => guardGrid.addPoint(i, p.x, p.z));
  const props: { x: number; z: number }[] = [], lights: { x: number; z: number }[] = [];
  for (const p of layout.props) {
    if (p.kind === 'streetlight') { lightGrid.addPoint(lights.length, p.pos.x, p.pos.z); lights.push({ x: p.pos.x, z: p.pos.z }); }
    propGrid.addPoint(props.length, p.pos.x, p.pos.z); props.push({ x: p.pos.x, z: p.pos.z });
  }

  const net = buildTrafficNetwork(layout);
  net.lanes.forEach((l, i) => laneGrid.addRect(i, {
    minX: Math.min(l.from.x, l.to.x), maxX: Math.max(l.from.x, l.to.x),
    minZ: Math.min(l.from.z, l.to.z), maxZ: Math.max(l.from.z, l.to.z),
  }, 3));
  const junctions = net.junctions.map(j => j.rect);
  junctions.forEach((r, i) => junGrid.addRect(i, r, 4));
  const crosswalks = layout.markings.filter(m => m.kind === 'crosswalk').map(m => m.rect);

  const nest0 = layout.nests.find(n => n.claim) ?? layout.nests[0];
  const ix: Index = {
    layout, pa: layout.playArea, colliders, colGrid, roads, roadGrid, sidewalks, swGrid, ground, groundGrid,
    interiors, intKinds, intGrid, courts, buildings: [], bldGrid, bizGrid, spawn, spawnGrid, nests, guardPts, guardGrid,
    props, propGrid, lights, lightGrid, lanes: net.lanes, laneGrid, junctions, junGrid, crosswalks, sides: [],
    fixedByChunk: new Map(),
    startA: { x: layout.playerStart.x, z: layout.playerStart.z },
    startB: nest0 ? { x: nest0.pos.x, z: nest0.pos.z } : { x: layout.playerStart.x, z: layout.playerStart.z },
    claim: BALANCE.nest.claimRadius,
  };
  buildSides(ix);
  buildBuildings(ix);
  buildFixed(ix);
  return ix;
}

function mergeIntervals(list: [number, number][], gap: number): [number, number][] {
  list.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const iv of list) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + gap) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Curb sides: every sidewalk edge that runs alongside a road (>= 6 m), with gaps where crossing roads cut it. */
function buildSides(ix: Index): void {
  const found = new Map<string, { axis: 'x' | 'z'; edge: number; nx: number; nz: number; depth: number; iv: [number, number][]; si: number }>();
  ix.sidewalks.forEach((s, si) => {
    ix.roadGrid.query(s.minX - 1, s.minZ - 1, s.maxX + 1, s.maxZ + 1, ri => {
      const r = ix.roads[ri];
      const addSide = (axis: 'x' | 'z', edge: number, nx: number, nz: number, depth: number, a: number, b: number): void => {
        if (b - a < 6) return;
        const key = `${si}:${axis}:${edge}`;
        let rec = found.get(key);
        if (!rec) { rec = { axis, edge, nx, nz, depth, iv: [], si }; found.set(key, rec); }
        rec.iv.push([a, b]);
      };
      const zA = Math.max(s.minZ, r.minZ), zB = Math.min(s.maxZ, r.maxZ);
      const xA = Math.max(s.minX, r.minX), xB = Math.min(s.maxX, r.maxX);
      if (Math.abs(r.maxX - s.minX) < 0.3) addSide('z', s.minX, -1, 0, s.maxX - s.minX, zA, zB);
      if (Math.abs(r.minX - s.maxX) < 0.3) addSide('z', s.maxX, 1, 0, s.maxX - s.minX, zA, zB);
      if (Math.abs(r.maxZ - s.minZ) < 0.3) addSide('x', s.minZ, 0, -1, s.maxZ - s.minZ, xA, xB);
      if (Math.abs(r.minZ - s.maxZ) < 0.3) addSide('x', s.maxZ, 0, 1, s.maxZ - s.minZ, xA, xB);
      return false;
    });
  });
  for (const rec of found.values()) {
    for (const [lo, hi] of mergeIntervals(rec.iv, 0.5)) {
      if (hi - lo < 6) continue;
      const side: Side = { id: ix.sides.length, axis: rec.axis, edge: rec.edge, nx: rec.nx, nz: rec.nz, depth: rec.depth, lo, hi, gaps: [] };
      // Crossing roads cover the curb line: no curb there.
      const c = rec.edge - (rec.axis === 'z' ? rec.nx : rec.nz) * CURB_OFFSET;
      const box = sideBox(side, 2);
      ix.roadGrid.query(box.minX, box.minZ, box.maxX, box.maxZ, ri => {
        const r = ix.roads[ri];
        const cover = side.axis === 'z' ? c >= r.minX && c <= r.maxX : c >= r.minZ && c <= r.maxZ;
        if (cover) side.gaps.push(side.axis === 'z' ? [r.minZ, r.maxZ] : [r.minX, r.maxX]);
        return false;
      });
      ix.sides.push(side);
    }
  }
}

function sideBox(s: Side, pad: number): AABB {
  return s.axis === 'z'
    ? { minX: s.edge - s.depth - pad, maxX: s.edge + s.depth + pad, minZ: s.lo, maxZ: s.hi }
    : { minX: s.lo, maxX: s.hi, minZ: s.edge - s.depth - pad, maxZ: s.edge + s.depth + pad };
}
/** Point at tangent t and depth u inward from the curb edge. */
function sidePoint(s: Side, t: number, u: number): { x: number; z: number } {
  return s.axis === 'z' ? { x: s.edge - s.nx * u, z: t } : { x: t, z: s.edge - s.nz * u };
}
function sideYaw(s: Side): number { return Math.atan2(s.nx, s.nz); }

const BLD_DRIVE_CHANCE: Record<BizClass, number> = { house: 0.7, industrial: 0.8, shop: 0.4, office: 0.15, apartment: 0.3, civic: 0.2 };

function buildBuildings(ix: Index): void {
  ix.layout.buildings.forEach((def, idx) => {
    const f = def.footprint, cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
    let fx = 0, fz = 1, sideId = -1, sideGap = 1e9;
    if (def.frontage) { [fx, fz] = frontageVec(def.frontage); }
    // Nearest curb side the building faces (footprint beyond the sidewalk's back edge).
    let best: Side | null = null, bestGap = 1e9;
    for (const s of ix.sides) {
      const box = sideBox(s, 14);
      if (f.maxX < box.minX || f.minX > box.maxX || f.maxZ < box.minZ || f.minZ > box.maxZ) continue;
      const t0 = s.axis === 'z' ? f.minZ : f.minX, t1 = s.axis === 'z' ? f.maxZ : f.maxX;
      if (t1 < s.lo + 1 || t0 > s.hi - 1) continue;
      // Gap between the sidewalk back edge and the nearest building face on the inward side.
      const back = s.axis === 'z' ? s.edge - s.nx * s.depth : s.edge - s.nz * s.depth;
      const inward = s.axis === 'z' ? -s.nx : -s.nz;
      const face = s.axis === 'z' ? (inward > 0 ? f.minX : f.maxX) : (inward > 0 ? f.minZ : f.maxZ);
      const gap = (face - back) * inward;
      if (gap < -0.01 || gap > 14) continue;
      if (gap < bestGap) { bestGap = gap; best = s; }
    }
    if (best) {
      sideId = best.id; sideGap = bestGap;
      if (!def.frontage) { fx = best.nx; fz = best.nz; }
    } else if (!def.frontage) {
      let bd = 1e9;
      for (const r of ix.roads) {
        const d = distToRect(cx, cz, r);
        if (d < bd) { bd = d; const rx = (r.minX + r.maxX) / 2 - cx, rz = (r.minZ + r.maxZ) / 2 - cz; [fx, fz] = Math.abs(rx) > Math.abs(rz) ? [Math.sign(rx), 0] : [0, Math.sign(rz) || 1]; }
      }
    }
    const b: Bld = { def, idx, cls: classOf(def), cx, cz, fx, fz, sideId, sideGap };
    ix.bldGrid.addRect(ix.buildings.length, f, 1);
    if (b.cls !== 'house' && b.cls !== 'industrial') ix.bizGrid.addRect(ix.buildings.length, f, 12);
    ix.buildings.push(b);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Placement rules shared by every generator
// ---------------------------------------------------------------------------------------------------------------------

function surfaceAt(ix: Index, x: number, z: number): Surface | null {
  let best: Surface | null = null, rank = 99;
  ix.groundGrid.query(x, z, x, z, id => {
    const g = ix.ground[id];
    if (SURFACE_RANK[g.surface] < rank && inRect(x, z, g.rect)) { rank = SURFACE_RANK[g.surface]; best = g.surface; }
    return false;
  });
  return best;
}
function isPaved(ix: Index, x: number, z: number): boolean {
  const s = surfaceAt(ix, x, z);
  return s === 'road' || s === 'sidewalk';
}
function roadDistance(ix: Index, x: number, z: number, limit: number): number {
  let best = limit + 1;
  ix.roadGrid.query(x - limit, z - limit, x + limit, z + limit, id => {
    const d = distToRect(x, z, ix.roads[id]);
    if (d < best) best = d;
    return false;
  });
  return best;
}
function inSidewalk(ix: Index, x: number, z: number): boolean {
  return ix.swGrid.query(x, z, x, z, id => inRect(x, z, ix.sidewalks[id]));
}
function nearBuilding(ix: Index, x: number, z: number, d: number): boolean {
  return ix.bldGrid.query(x - d, z - d, x + d, z + d, id => distToRect(x, z, ix.buildings[id].def.footprint) <= d);
}
function inJunction(ix: Index, x: number, z: number, pad: number): boolean {
  return ix.junGrid.query(x - pad, z - pad, x + pad, z + pad, id => {
    const r = ix.junctions[id];
    return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
  });
}

/** VP2-3 zone rule for items taller than 0.5 m: sidewalk strip, wall band, or a clear interior. */
function tallZoneOk(ix: Index, x: number, z: number): boolean {
  if (inSidewalk(ix, x, z)) {
    const d = roadDistance(ix, x, z, STRIP_DEPTH);
    if (d > 0 && d <= STRIP_DEPTH) return true;
  }
  if (ix.bldGrid.query(x - WALL_BAND, z - WALL_BAND, x + WALL_BAND, z + WALL_BAND,
    id => distToRect(x, z, ix.buildings[id].def.footprint) <= WALL_BAND)) return true;
  if (!ix.intGrid.query(x, z, x, z, id => inRect(x, z, ix.interiors[id]))) return false;
  if (ix.spawnGrid.query(x - SPAWN_CLEARANCE, z - SPAWN_CLEARANCE, x + SPAWN_CLEARANCE, z + SPAWN_CLEARANCE,
    id => distToRect(x, z, ix.spawn[id]) < SPAWN_CLEARANCE)) return false;
  for (const n of ix.nests) if (Math.hypot(x - n.x, z - n.z) < ix.claim + 1.5) return false;
  return true;
}

function blockedAt(ix: Index, kind: DressingKind, x: number, z: number, hx: number, hz: number): boolean {
  const flat = FLAT_KINDS.has(kind), wall = WALL_MOUNTED_KINDS.has(kind), r = Math.max(hx, hz);
  const pa = ix.pa;
  if (x - hx < pa.minX || x + hx > pa.maxX || z - hz < pa.minZ || z + hz > pa.maxZ) return true;
  // START_BEACH and the walk-in line from the player start to the first nest.
  if (x + hx > START_BEACH.minX - 0.5 && x - hx < START_BEACH.maxX + 0.5 &&
    z + hz > START_BEACH.minZ - 0.5 && z - hz < START_BEACH.maxZ + 0.5) return true;
  const extra = flat ? 0 : r;
  if (distToSegment(x, z, ix.startA.x, ix.startA.z, ix.startB.x, ix.startB.z) < START_LINE_CLEARANCE + extra) return true;
  for (const n of ix.nests) if (Math.hypot(x - n.x, z - n.z) < ix.claim + 1.5 + extra) return true;
  if (ix.guardGrid.query(x - 4, z - 4, x + 4, z + 4,
    id => Math.hypot(x - ix.guardPts[id].x, z - ix.guardPts[id].z) < GUARD_CLEARANCE + extra)) return true;
  // Colliders: the footprint must stay clear (wall-mounted kinds only need their centre outside).
  const m = 0.02;
  if (ix.colGrid.query(x - hx, z - hz, x + hx, z + hz, id => {
    const c = ix.colliders[id];
    return wall
      ? x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m
      : x - hx < c.maxX + m && x + hx > c.minX - m && z - hz < c.maxZ + m && z + hz > c.minZ - m;
  })) return true;
  if (flat) return false;
  // Keep clear of small layout props that have no collider of their own.
  if (ix.propGrid.query(x - r - 0.6, z - r - 0.6, x + r + 0.6, z + r + 0.6,
    id => Math.hypot(x - ix.props[id].x, z - ix.props[id].z) < r + 0.6)) return true;
  // Road surface and traffic lanes belong to FLAT kinds.
  if (!wall && roadDistance(ix, x, z, r) < r * 0.8) return true;
  if (wall && roadDistance(ix, x, z, 0.5) <= 0.3) return true;
  if (ix.laneGrid.query(x - 4, z - 4, x + 4, z + 4, id => {
    const l = ix.lanes[id];
    return distToSegment(x, z, l.from.x, l.from.z, l.to.x, l.to.z) < LANE_CLEARANCE + r;
  })) return true;
  if (!LOW_KINDS.has(kind) && !tallZoneOk(ix, x, z)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Global (chunk-independent) fixed items: curbs, curb ramps, driveways
// ---------------------------------------------------------------------------------------------------------------------

function addFixed(ix: Index, f: Fixed): void {
  const id = chunkIdAt(ix.layout, { x: f.x, z: f.z });
  const list = ix.fixedByChunk.get(id);
  if (list) list.push(f); else ix.fixedByChunk.set(id, [f]);
}
function overlapsGap(s: Side, a: number, b: number): boolean {
  return s.gaps.some(g => a < g[1] && b > g[0]);
}

function buildFixed(ix: Index): void {
  // Curb ramps where a crosswalk reaches the curb.
  for (const s of ix.sides) {
    for (const cw of ix.crosswalks) {
      const nExt = s.axis === 'z' ? cw.maxX - cw.minX : cw.maxZ - cw.minZ;
      const tLo = s.axis === 'z' ? cw.minZ : cw.minX, tHi = s.axis === 'z' ? cw.maxZ : cw.maxX;
      if (nExt < 5 || tHi - tLo > 6 || tLo < s.lo + 1 || tHi > s.hi - 1) continue;
      const reach = s.axis === 'z' ? (s.nx < 0 ? cw.maxX : cw.minX) : (s.nz < 0 ? cw.maxZ : cw.minZ);
      if (Math.abs(reach - s.edge) > 0.6) continue;
      const w = tHi - tLo + 1.2, tc = (tLo + tHi) / 2;
      if (overlapsGap(s, tc - w / 2, tc + w / 2)) continue;
      const p = sidePoint(s, tc, 0.5), rotY = sideYaw(s);
      const { hx, hz } = dressingHalfExtents({ kind: 'curbRamp', rotY, scale: 1, sx: w, sz: 1 });
      if (blockedAt(ix, 'curbRamp', p.x, p.z, hx, hz)) continue;
      s.gaps.push([tc - w / 2, tc + w / 2]);
      addFixed(ix, { kind: 'curbRamp', x: p.x, z: p.z, rotY, sx: w, sz: 1, tier: 0, variant: 0 });
    }
  }
  // Driveway aprons across the sidewalk in front of buildings that face a curb.
  for (const b of ix.buildings) {
    if (b.sideId < 0 || b.sideGap > 12) continue;
    if (hash01(b.idx, 11) >= BLD_DRIVE_CHANCE[b.cls]) continue;
    const s = ix.sides[b.sideId], f = b.def.footprint;
    const w = b.cls === 'industrial' ? 5.5 : 3.4;
    const bLo = s.axis === 'z' ? f.minZ : f.minX, bHi = s.axis === 'z' ? f.maxZ : f.maxX;
    if (bHi - bLo < w + 2) continue;
    const slack = Math.min(6, bHi - bLo - w - 2);
    let t = (bLo + bHi) / 2 + (hash01(b.idx, 12) - 0.5) * slack;
    t = Math.max(s.lo + w / 2 + 0.5, Math.min(s.hi - w / 2 - 0.5, t));
    if (t - w / 2 < bLo || t + w / 2 > bHi || overlapsGap(s, t - w / 2 - 0.4, t + w / 2 + 0.4)) continue;
    const p = sidePoint(s, t, s.depth / 2), rotY = sideYaw(s);
    const { hx, hz } = dressingHalfExtents({ kind: 'driveway', rotY, scale: 1, sx: w, sz: s.depth });
    if (blockedAt(ix, 'driveway', p.x, p.z, hx, hz)) continue;
    s.gaps.push([t - w / 2 - 0.1, t + w / 2 + 0.1]);
    addFixed(ix, { kind: 'driveway', x: p.x, z: p.z, rotY, sx: w, sz: s.depth, tier: 0, variant: b.idx % 3 });
  }
  // Curb pieces (<= 3 m) along every free interval of each side.
  for (const s of ix.sides) {
    const gaps = mergeIntervals(s.gaps.map(g => [g[0], g[1]] as [number, number]), 0);
    let cur = s.lo;
    const free: [number, number][] = [];
    for (const g of gaps) {
      if (g[0] > cur) free.push([cur, Math.min(g[0], s.hi)]);
      cur = Math.max(cur, g[1]);
    }
    if (cur < s.hi) free.push([cur, s.hi]);
    for (const [a, b] of free) {
      const len = b - a;
      if (len < 0.6) continue;
      const n = Math.ceil(len / 3), step = len / n;
      for (let i = 0; i < n; i++) {
        const tc = a + step * (i + 0.5), p = sidePoint(s, tc, CURB_OFFSET);
        addFixed(ix, { kind: 'curb', x: p.x, z: p.z, rotY: sideYaw(s), sx: step, sz: CURB_OFFSET * 2, tier: 0, variant: 0 });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Chunk assembly
// ---------------------------------------------------------------------------------------------------------------------

interface Ctx {
  ix: Index; chunkId: number; rect: AABB; items: DressingInstance[]; radii: number[]; placed: Map<number, number[]>;
}
const PLACE_CELL = 4;
const placeKey = (i: number, j: number): number => (i + 4096) * 16384 + (j + 4096);

function styleAt(c: Ctx, x: number, z: number): DistrictStyle {
  const ds = c.ix.layout.districts;
  const d = ds.find(q => x >= q.rect.minX && z >= q.rect.minZ && x < q.rect.maxX && z < q.rect.maxZ)
    ?? ds.find(q => x >= q.rect.minX && z >= q.rect.minZ && x <= q.rect.maxX && z <= q.rect.maxZ);
  return (d ? DISTRICT_STYLES[d.id] : undefined) ?? DISTRICT_STYLES.suburbs;
}

function groundY(ix: Index, kind: DressingKind, x: number, z: number): number {
  if (kind === 'curb' || kind === 'curbRamp' || kind === 'driveway') return 0;
  switch (surfaceAt(ix, x, z)) {
    case 'road': return GROUND_TOP.road;
    case 'sidewalk': return SIDEWALK_Y;
    case 'park': return GROUND_TOP.parkInner;
    case 'plaza': return GROUND_TOP.plazaTop;
    case 'court': case 'lot': return GROUND_TOP.lot;
    case 'compound': return GROUND_TOP.compound;
    case 'sand': return GROUND_TOP.sand;
    default: return 0;
  }
}

function put(c: Ctx, kind: DressingKind, x: number, z: number, rotY: number, scale: number, variant: number, tier: 0 | 1 | 2,
  sx?: number, sz?: number): boolean {
  const r = c.rect;
  if (!(x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ)) return false;
  const { hx, hz } = dressingHalfExtents({ kind, rotY, scale, sx, sz });
  if (blockedAt(c.ix, kind, x, z, hx, hz)) return false;
  const flat = FLAT_KINDS.has(kind), rr = Math.max(hx, hz);
  const ci = Math.floor(x / PLACE_CELL), cj = Math.floor(z / PLACE_CELL);
  if (!flat) {
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const list = c.placed.get(placeKey(i, j));
      if (!list) continue;
      for (const o of list) {
        const it = c.items[o];
        if (Math.hypot(it.x - x, it.z - z) < 0.8 * (c.radii[o] + rr)) return false;
      }
    }
  }
  const item: DressingInstance = { kind, x, y: groundY(c.ix, kind, x, z), z, rotY, scale, variant, tier };
  if (sx !== undefined) item.sx = sx;
  if (sz !== undefined) item.sz = sz;
  c.items.push(item);
  c.radii.push(rr);
  if (!flat) {
    const k = placeKey(ci, cj), list = c.placed.get(k);
    if (list) list.push(c.items.length - 1); else c.placed.set(k, [c.items.length - 1]);
  }
  return true;
}

function pickWeighted<T extends string>(rng: { next(): number }, entries: [T, number][]): T | null {
  let total = 0;
  for (const e of entries) total += e[1];
  if (total <= 0) return null;
  let t = rng.next() * total;
  for (const e of entries) { t -= e[1]; if (t < 0) return e[0]; }
  return entries[entries.length - 1][0];
}

const stream = (c: Ctx, cat: number) => mulberry32(fnv(SEED, c.chunkId, cat));
const TAU = Math.PI * 2;

function chunkFixed(c: Ctx): void {
  for (const f of c.ix.fixedByChunk.get(c.chunkId) ?? []) put(c, f.kind, f.x, f.z, f.rotY, 1, f.variant, f.tier, f.sx, f.sz);
}

function laneRange(l: NetworkLane, r: AABB): [number, number] | null {
  let a: number, b: number;
  if (l.axis === 'x') {
    if (l.from.z < r.minZ - 1 || l.from.z > r.maxZ + 1) return null;
    a = (r.minX - l.from.x) * l.dx; b = (r.maxX - l.from.x) * l.dx;
  } else {
    if (l.from.x < r.minX - 1 || l.from.x > r.maxX + 1) return null;
    a = (r.minZ - l.from.z) * l.dz; b = (r.maxZ - l.from.z) * l.dz;
  }
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(l.length, Math.max(a, b));
  return hi > lo ? [lo, hi] : null;
}

/** Calls fn(t, k) for lattice points t = lo + phase + k * spacing along a side that fall near the chunk. */
function lattice(s: Side, r: AABB, spacing: number, phase: number, fn: (t: number, k: number) => void): void {
  const a = s.axis === 'z' ? r.minZ : r.minX, b = s.axis === 'z' ? r.maxZ : r.maxX;
  const lo = Math.max(s.lo, a - 1), hi = Math.min(s.hi, b + 1);
  if (hi <= lo) return;
  for (let k = Math.ceil((lo - s.lo - phase) / spacing); ; k++) {
    const t = s.lo + phase + k * spacing;
    if (t > hi) break;
    fn(t, k);
  }
}
function sideNearChunk(s: Side, r: AABB): boolean {
  const box = sideBox(s, 1);
  return !(box.maxX < r.minX - 1 || box.minX > r.maxX + 1 || box.maxZ < r.minZ - 1 || box.minZ > r.maxZ + 1);
}

function chunkRoad(c: Ctx): void {
  const ix = c.ix, rng = stream(c, 1), r = c.rect;
  const laneIds = new Set<number>();
  ix.laneGrid.query(r.minX, r.minZ, r.maxX, r.maxZ, id => { laneIds.add(id); return false; });
  for (const li of [...laneIds].sort((a, b) => a - b)) {
    const l = ix.lanes[li], range = laneRange(l, r);
    if (!range) continue;
    const yaw = Math.atan2(-l.dz, l.dx);
    // Manholes down the lane centre line.
    const S = 44, phase = hash01(li, 21) * S;
    for (let k = Math.ceil((range[0] - phase) / S); phase + k * S <= range[1]; k++) {
      const t = phase + k * S + (rng.next() - 0.5) * 8, u = (rng.next() - 0.5) * 1.2, rot = rng.next() * TAU;
      const x = l.from.x + l.dx * t - l.dz * u, z = l.from.z + l.dz * t + l.dx * u;
      if (inJunction(ix, x, z, 3)) continue;
      put(c, 'manhole', x, z, rot, 1, Math.floor(rng.next() * 3), k % 2 === 0 ? 0 : 1, 0.9, 0.9);
    }
    // Patched asphalt.
    const S2 = 95, phase2 = hash01(li, 31) * S2;
    for (let k = Math.ceil((range[0] - phase2) / S2); phase2 + k * S2 <= range[1]; k++) {
      const keep = rng.next() < 0.6, t = phase2 + k * S2 + (rng.next() - 0.5) * 20, u = (rng.next() - 0.5) * 1.6;
      const sx = 1.4 + rng.next() * 2, sz = 1 + rng.next() * 1.4, rot = yaw + (rng.next() - 0.5) * 0.2;
      const v = Math.floor(rng.next() * 3);
      if (!keep) continue;
      const x = l.from.x + l.dx * t - l.dz * u, z = l.from.z + l.dz * t + l.dx * u;
      if (inJunction(ix, x, z, 3)) continue;
      put(c, 'roadPatch', x, z, rot, 1, v, 2, sx, sz);
    }
  }
  // Storm drains at the curb.
  for (const s of ix.sides) {
    if (!sideNearChunk(s, r)) continue;
    lattice(s, r, 30, hash01(s.id, 41) * 30, t => {
      const v = Math.floor(rng.next() * 2);
      if (overlapsGap(s, t - 1.2, t + 1.2)) return;
      const p = sidePoint(s, t, -0.3);
      put(c, 'stormDrain', p.x, p.z, sideYaw(s), 1, v, 1, 1.1, 0.45);
    });
  }
  // Median hatching on wide roads, between the opposing lanes and outside every junction / crosswalk.
  const roadIds = new Set<number>();
  ix.roadGrid.query(r.minX, r.minZ, r.maxX, r.maxZ, id => { roadIds.add(id); return false; });
  for (const id of [...roadIds].sort((a, b) => a - b)) {
    const rd = ix.roads[id], w = rd.maxX - rd.minX, d = rd.maxZ - rd.minZ;
    if (Math.min(w, d) < 12) continue;
    const alongX = w >= d, cl = alongX ? (rd.minZ + rd.maxZ) / 2 : (rd.minX + rd.maxX) / 2;
    const lo = alongX ? rd.minX : rd.minZ, hi = alongX ? rd.maxX : rd.maxZ;
    const cuts: [number, number][] = [];
    const bx = alongX ? { minX: lo, maxX: hi, minZ: cl - 1, maxZ: cl + 1 } : { minX: cl - 1, maxX: cl + 1, minZ: lo, maxZ: hi };
    ix.junGrid.query(bx.minX, bx.minZ, bx.maxX, bx.maxZ, ji => {
      const j = ix.junctions[ji];
      if (alongX ? cl >= j.minZ && cl <= j.maxZ : cl >= j.minX && cl <= j.maxX) cuts.push(alongX ? [j.minX - 3, j.maxX + 3] : [j.minZ - 3, j.maxZ + 3]);
      return false;
    });
    for (const cw of ix.crosswalks) {
      if (alongX ? cl >= cw.minZ && cl <= cw.maxZ : cl >= cw.minX && cl <= cw.maxX) {
        cuts.push(alongX ? [cw.minX - 1.5, cw.maxX + 1.5] : [cw.minZ - 1.5, cw.maxZ + 1.5]);
      }
    }
    let cur = lo;
    const free: [number, number][] = [];
    for (const g of mergeIntervals(cuts, 0)) { if (g[0] > cur) free.push([cur, Math.min(g[0], hi)]); cur = Math.max(cur, g[1]); }
    if (cur < hi) free.push([cur, hi]);
    for (const [a, b] of free) {
      for (let t = a + 1; t + 8 <= b - 1; t += 10) {
        const m = t + 4;
        put(c, 'medianHatch', alongX ? m : cl, alongX ? cl : m, alongX ? 0 : Math.PI / 2, 1, 0, 1, 8, 1.6);
      }
    }
  }
  // Pedestrian refuge islands in the corners of wide junctions.
  const junIds = new Set<number>();
  ix.junGrid.query(r.minX, r.minZ, r.maxX, r.maxZ, id => { junIds.add(id); return false; });
  for (const id of [...junIds].sort((a, b) => a - b)) {
    const j = ix.junctions[id];
    if (j.maxX - j.minX < 12 || j.maxZ - j.minZ < 12) continue;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      put(c, 'trafficIsland', (sx < 0 ? j.minX : j.maxX) - sx * 1.5, (sz < 0 ? j.minZ : j.maxZ) - sz * 1.5, 0, 1, 0, 1, 2, 2);
    }
  }
}

const STRIP_SKIP: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['streetlight', 'basketballHoop', 'gasPump']);
const STRIP_TIER0: ReadonlySet<DressingKind> = new Set<DressingKind>(['bench', 'trashCan', 'hydrant', 'mailbox', 'busStop']);

function chunkStrip(c: Ctx): void {
  const ix = c.ix, r = c.rect, rng = stream(c, 2);
  for (const s of ix.sides) {
    if (!sideNearChunk(s, r)) continue;
    const yaw = sideYaw(s), mid = sidePoint(s, (s.lo + s.hi) / 2, 0);
    // Streetlight rhythm (skipping layout streetlights already within 6 m).
    lattice(s, r, 27, hash01(s.id, 51) * 27, t => {
      const p = sidePoint(s, t, 0.55), style = styleAt(c, p.x, p.z);
      const w = style.furniture.streetlight ?? 0, keep = rng.next() < 0.4 + 0.2 * w, variant = Math.floor(rng.next() * 2);
      if (!keep || overlapsGap(s, t - 1.2, t + 1.2)) return;
      if (ix.lightGrid.query(p.x - 6, p.z - 6, p.x + 6, p.z + 6, id => Math.hypot(p.x - ix.lights[id].x, p.z - ix.lights[id].z) < 6)) return;
      put(c, 'streetlight', p.x, p.z, yaw, 1, variant, 0);
    });
    // Palms from the district's palm list (spacing from the vegetation level at the side's midpoint).
    const spacing = 20 - 11 * styleAt(c, mid.x, mid.z).vegetation;
    lattice(s, r, spacing, hash01(s.id, 53) * spacing, (t, k) => {
      const p = sidePoint(s, t, 0.95), style = styleAt(c, p.x, p.z);
      const roll = rng.next(), rot = rng.next() * TAU, scale = 0.9 + rng.next() * 0.35, variant = Math.floor(rng.next() * 3);
      if (style.palms.length === 0 || roll >= 0.35 + 0.65 * style.vegetation || overlapsGap(s, t - 1.5, t + 1.5)) return;
      const kind = style.palms[(((k + s.id) % style.palms.length) + style.palms.length) % style.palms.length];
      put(c, kind, p.x, p.z, rot, scale, variant, k % 2 === 0 ? 0 : 1);
    });
    // Furniture near storefronts, buildings and corners.
    lattice(s, r, 13, hash01(s.id, 56) * 13, t => {
      const u = 0.6 + rng.next() * 0.3, roll = rng.next(), pick = rng.next(), rot = rng.next() * TAU, variant = Math.floor(rng.next() * 3);
      const p = sidePoint(s, t, u), style = styleAt(c, p.x, p.z);
      const biz = ix.bizGrid.query(p.x, p.z, p.x, p.z, () => true);
      const prob = biz ? 0.6 : nearBuilding(ix, p.x, p.z, 10) ? 0.38 : 0.1;
      if (roll >= prob || overlapsGap(s, t - 1.2, t + 1.2)) return;
      const entries = (Object.entries(style.furniture) as [FurnitureKind, number][]).filter(e => !STRIP_SKIP.has(e[0]) && e[1] > 0);
      const kind = pickWeighted({ next: () => pick }, entries);
      if (!kind) return;
      const faceRoad = kind === 'bench' || kind === 'bikeRack' || kind === 'newsStand' || kind === 'busStop' || kind === 'planter';
      if (kind === 'bollard') {
        for (let i = 0; i < 3; i++) {
          const q = sidePoint(s, t + (i - 1) * 1.5, u);
          put(c, 'bollard', q.x, q.z, 0, 1, variant, i === 1 ? 1 : 2);
        }
        return;
      }
      put(c, kind, p.x, p.z, faceRoad ? yaw : rot, 0.95 + (rot / TAU) * 0.15, variant, STRIP_TIER0.has(kind) ? 0 : 1);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Building edges
// ---------------------------------------------------------------------------------------------------------------------

interface Face { ox: number; oz: number; tx: number; tz: number; nx: number; nz: number; half: number }
function faceOf(f: AABB, dx: number, dz: number): Face {
  const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
  if (dz > 0) return { ox: cx, oz: f.maxZ, tx: 1, tz: 0, nx: 0, nz: 1, half: (f.maxX - f.minX) / 2 };
  if (dz < 0) return { ox: cx, oz: f.minZ, tx: 1, tz: 0, nx: 0, nz: -1, half: (f.maxX - f.minX) / 2 };
  if (dx > 0) return { ox: f.maxX, oz: cz, tx: 0, tz: 1, nx: 1, nz: 0, half: (f.maxZ - f.minZ) / 2 };
  return { ox: f.minX, oz: cz, tx: 0, tz: 1, nx: -1, nz: 0, half: (f.maxZ - f.minZ) / 2 };
}
const facePt = (fc: Face, s: number, d: number): { x: number; z: number } =>
  ({ x: fc.ox + fc.tx * s + fc.nx * d, z: fc.oz + fc.tz * s + fc.nz * d });
const faceYaw = (fc: Face): number => Math.atan2(fc.nx, fc.nz);

const CLUTTER_BACK: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['dumpster', 'trashBags', 'crates', 'utilityBox',
  'constructionBarrier', 'trafficCone', 'shoppingCart', 'fenceSection']);
const CLUTTER_TIER: Partial<Record<DressingKind, 0 | 1 | 2>> = { dumpster: 0, crates: 1, utilityBox: 1, trashBags: 1, constructionBarrier: 1 };
const BACK_CHANCE: Record<BizClass, number> = { house: 0.12, shop: 0.9, office: 0.55, industrial: 0.9, apartment: 0.5, civic: 0.35 };

function chunkBuildings(c: Ctx): void {
  const ix = c.ix, r = c.rect, rng = stream(c, 3);
  const ids = new Set<number>();
  ix.bldGrid.query(r.minX - 3, r.minZ - 3, r.maxX + 3, r.maxZ + 3, id => { ids.add(id); return false; });
  for (const id of [...ids].sort((a, b) => a - b)) {
    const b = ix.buildings[id], f = b.def.footprint;
    const style = styleAt(c, b.cx, b.cz), veg = style.vegetation;
    const front = faceOf(f, b.fx, b.fz), back = faceOf(f, -b.fx, -b.fz);
    const faces: [Face, boolean][] = [[front, true], [back, false], [faceOf(f, b.fz, b.fx), false], [faceOf(f, -b.fz, -b.fx), false]];
    const residential = b.cls === 'house' || b.cls === 'apartment';

    // Vines creeping up the walls.
    if (residential || style.theme === 'entertainment' || style.theme === 'resort') {
      const pv = veg * (residential ? 0.65 : 0.35);
      for (const [fc, isFront] of faces) {
        for (let s = -fc.half + 1.4; s <= fc.half - 1.4; s += 3.6) {
          const roll = rng.next(), sc = 0.8 + rng.next() * 0.4, v = Math.floor(rng.next() * 3);
          if (roll >= pv || (isFront && Math.abs(s) < 1.8)) continue;
          const p = facePt(fc, s, 0.2 * sc + 0.06);
          put(c, 'vine', p.x, p.z, faceYaw(fc), sc, v, 2);
        }
      }
    }
    // House frontage: hedge run with a gap at the door, flowering shrubs.
    if (b.cls === 'house') {
      for (let s = -front.half + 1.2; s <= front.half - 1.2; s += 2.1) {
        const roll = rng.next(), roll2 = rng.next(), sc = 0.9 + rng.next() * 0.2, v = Math.floor(rng.next() * 3), rot = rng.next() * TAU;
        if (Math.abs(s) < 1.7 || roll >= 0.3 + 0.6 * veg) continue;
        if (roll2 < 0.65) { const p = facePt(front, s, 0.4 * sc + 0.06); put(c, 'hedge', p.x, p.z, faceYaw(front), sc, v, 1); }
        else { const p = facePt(front, s, 0.45 * sc + 0.06); put(c, 'shrubFlowering', p.x, p.z, rot, sc, v, 1); }
      }
    }
    // Planter boxes either side of a business door; bikes against the wall.
    if (b.cls === 'shop' || b.cls === 'office' || b.cls === 'apartment' || b.cls === 'civic') {
      for (const sgn of [-1, 1]) {
        const roll = rng.next(), s = sgn * (1.9 + rng.next() * 0.8), v = Math.floor(rng.next() * 3);
        if (roll >= 0.35 + 0.45 * veg || Math.abs(s) > front.half - 0.8) continue;
        const p = facePt(front, s, 0.3 + 0.06);
        put(c, 'planterBox', p.x, p.z, faceYaw(front), 1, v, 1);
      }
      const bike = style.clutter.parkedBike ?? 0, roll = rng.next(), s = (rng.next() - 0.5) * (front.half * 1.4), v = Math.floor(rng.next() * 3);
      if (bike > 0 && roll < 0.15 * bike && Math.abs(s) > 1.8) {
        const p = facePt(front, s, 0.25 + 0.06);
        put(c, 'parkedBike', p.x, p.z, faceYaw(front), 1, v, 2);
      }
    }
    // Back-of-house clutter (only where >= 1.5 m of unpaved space exists behind).
    if (rng.next() < BACK_CHANCE[b.cls]) {
      const entries = (Object.entries(style.clutter) as [FurnitureKind, number][]).filter(e => CLUTTER_BACK.has(e[0]) && e[1] > 0);
      const n = 1 + Math.floor(rng.next() * 2.4);
      for (let i = 0; i < n && entries.length > 0; i++) {
        const s = (rng.next() * 2 - 1) * Math.max(0, back.half - 1.8), sc = 0.95 + rng.next() * 0.15, v = Math.floor(rng.next() * 3);
        const kind = pickWeighted(rng, entries);
        if (!kind) break;
        const d = DIMS[kind][1] * sc + 0.06, probe = facePt(back, s, d + 1.7), p = facePt(back, s, d);
        if (isPaved(ix, probe.x, probe.z) || isPaved(ix, p.x, p.z)) continue;
        put(c, kind, p.x, p.z, faceYaw(back), sc, v, CLUTTER_TIER[kind] ?? 2);
      }
    }
    // Restaurant patios (archetype data only): tables + umbrellas in the forecourt, or tables hugging the wall.
    if (b.def.archetype === 'restaurant') {
      for (let i = 0; i < 4; i++) {
        const s = (i - 1.5) * 2.8, wall = !b.def.lot, rot = rng.next() * TAU;
        if (Math.abs(s) > front.half - 1) continue;
        const p = facePt(front, s, wall ? 0.68 : 2.4);
        if (put(c, 'patioTable', p.x, p.z, rot, 1, i % 3, 1) && !wall) put(c, 'patioUmbrella', p.x, p.z, 0, 1, i % 3, 2);
      }
    }
    // Front-yard grass and flowers for houses and apartments.
    if (residential) {
      const n = Math.round(front.half * veg * 0.9);
      for (let i = 0; i < n; i++) {
        const s = (rng.next() * 2 - 1) * front.half, d = 1.2 + rng.next() * 3.5, flower = rng.next() < 0.35;
        const v = Math.floor(rng.next() * 3), rot = rng.next() * TAU, sc = 0.8 + rng.next() * 0.5;
        const p = facePt(front, s, d);
        if (isPaved(ix, p.x, p.z)) continue;
        put(c, flower ? 'flowersTropical' : 'grassClump', p.x, p.z, rot, sc, v, flower ? 1 : 2);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Parks, plazas, lots, courts
// ---------------------------------------------------------------------------------------------------------------------

const INTERIOR_DENSITY: Record<string, number> = { park: 1, plaza: 0.35, lot: 0.22, court: 0, yard: 0.5 };

function chunkParks(c: Ctx): void {
  const ix = c.ix, r = c.rect, rng = stream(c, 4);
  const ids = new Set<number>();
  ix.intGrid.query(r.minX, r.minZ, r.maxX, r.maxZ, id => { ids.add(id); return false; });
  for (const id of [...ids].sort((a, b) => a - b)) {
    const rect = ix.interiors[id], dens = INTERIOR_DENSITY[ix.intKinds[id]] ?? 0;
    const cl: AABB = {
      minX: Math.max(rect.minX, r.minX), maxX: Math.min(rect.maxX, r.maxX),
      minZ: Math.max(rect.minZ, r.minZ), maxZ: Math.min(rect.maxZ, r.maxZ),
    };
    if (cl.maxX <= cl.minX || cl.maxZ <= cl.minZ || dens <= 0) continue;
    const cellsOf = (size: number, fn: (x: number, z: number, gi: number, gj: number, roll: number) => void): void => {
      for (let gi = Math.floor(cl.minX / size); gi <= Math.floor(cl.maxX / size); gi++) {
        for (let gj = Math.floor(cl.minZ / size); gj <= Math.floor(cl.maxZ / size); gj++) {
          const roll = rng.next(), x = (gi + rng.next()) * size, z = (gj + rng.next()) * size;
          if (x < cl.minX + 0.8 || x > cl.maxX - 0.8 || z < cl.minZ + 0.8 || z > cl.maxZ - 0.8) continue;
          fn(x, z, gi, gj, roll);
        }
      }
    };
    cellsOf(11, (x, z, gi, gj, roll) => {
      const style = styleAt(c, x, z);
      const pr = rng.next(), sc = 0.9 + rng.next() * 0.35, rot = rng.next() * TAU, v = Math.floor(rng.next() * 3), pi = rng.next();
      if (roll >= 0.6 * dens * (0.35 + 0.65 * style.vegetation)) return;
      const palm = pr < 0.25 + 0.45 * style.vegetation && style.palms.length > 0;
      const kind: DressingKind = palm ? style.palms[Math.floor(pi * style.palms.length)] : 'ornamentalTree';
      put(c, kind, x, z, rot, sc, v, (gi + gj) % 2 === 0 ? 0 : 1);
    });
    cellsOf(7, (x, z, gi, gj, roll) => {
      const style = styleAt(c, x, z);
      const kr = rng.next(), rot = rng.next() * TAU, sc = 0.85 + rng.next() * 0.4, v = Math.floor(rng.next() * 3);
      if (roll >= 0.45 * dens * (0.3 + 0.7 * style.vegetation)) return;
      put(c, kr < 0.5 ? 'bushRound' : 'shrubFlowering', x, z, rot, sc, v, (gi + gj) % 3 === 0 ? 0 : 1);
    });
    cellsOf(15, (x, z, _gi, _gj, roll) => {
      const style = styleAt(c, x, z);
      const n = 3 + Math.floor(rng.next() * 3);
      const flowers: number[][] = [];
      for (let i = 0; i < n; i++) flowers.push([rng.next() * TAU, rng.next() * 1.1, rng.next() * TAU, 0.8 + rng.next() * 0.5, Math.floor(rng.next() * 3)]);
      if (roll >= 0.55 * dens * (0.3 + 0.7 * style.vegetation)) return;
      flowers.forEach((q, i) => put(c, 'flowersTropical', x + Math.cos(q[0]) * q[1], z + Math.sin(q[0]) * q[1], q[2], q[3], q[4], i === 0 ? 1 : 2));
    });
    cellsOf(4.5, (x, z, gi, gj, roll) => {
      const style = styleAt(c, x, z);
      const rot = rng.next() * TAU, sc = 0.8 + rng.next() * 0.6, v = Math.floor(rng.next() * 3);
      if (roll >= (0.1 + 0.3 * style.vegetation) * Math.min(1, dens * 1.5)) return;
      put(c, 'grassClump', x, z, rot, sc, v, (gi + gj) % 4 === 0 ? 1 : 2);
    });
  }
  // Basketball hoops at both ends of every court.
  for (const ct of ix.courts) {
    const w = ct.maxX - ct.minX, d = ct.maxZ - ct.minZ, cx = (ct.minX + ct.maxX) / 2, cz = (ct.minZ + ct.maxZ) / 2;
    if (cx + w < r.minX || cx - w > r.maxX || cz + d < r.minZ || cz - d > r.maxZ) continue;
    const alongX = w >= d, e = (alongX ? w : d) / 2 - 0.7;
    for (const sg of [-1, 1]) {
      const x = alongX ? cx + sg * e : cx, z = alongX ? cz : cz + sg * e;
      put(c, 'basketballHoop', x, z, Math.atan2(cx - x, cz - z), 1, 0, 0);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------------------------------------------------

function indexFor(layout: DistrictLayout): Index {
  let ix = cache.get(layout);
  if (!ix) { ix = buildIndex(layout); cache.set(layout, ix); }
  return ix;
}

/**
 * Deterministic dressing for one chunk, sorted by (kind, x, z). Every item's centre lies inside the chunk rect and the
 * layout's playArea; at most MAX_ITEMS_PER_CHUNK items (tier 2 dropped first); tier 0 alone is a complete street.
 */
export function populateChunk(layout: DistrictLayout, chunkId: number): DressingInstance[] {
  const ix = indexFor(layout);
  const c: Ctx = { ix, chunkId, rect: chunkRect(layout, chunkId), items: [], radii: [], placed: new Map() };
  chunkFixed(c);
  chunkRoad(c);
  chunkStrip(c);
  chunkBuildings(c);
  chunkParks(c);

  let items = c.items;
  if (items.length > MAX_ITEMS_PER_CHUNK) {
    const order = items.map((it, i) => ({ i, tier: it.tier, h: hash01(chunkId, i, 99) }))
      .sort((a, b) => b.tier - a.tier || a.h - b.h);
    const drop = new Set(order.slice(0, items.length - MAX_ITEMS_PER_CHUNK).map(o => o.i));
    items = items.filter((_, i) => !drop.has(i));
  }
  // Every kind present keeps at least one tier-0 member so a tier-0-only render is still complete.
  const has0 = new Set<DressingKind>();
  for (const it of items) if (it.tier === 0) has0.add(it.kind);
  for (const it of items) if (!has0.has(it.kind)) { it.tier = 0; has0.add(it.kind); }
  items.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.x - b.x || a.z - b.z || a.rotY - b.rotY);
  return items;
}
