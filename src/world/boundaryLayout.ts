// [pure] Impassable world-edge geometry; scenery consumes the same segment data.
import type { AABB, BoundaryKind, DistrictArchetype, DistrictLayout, Vec2 } from '../core/types';
import { mulberry32 } from '../utils/rng';

export type BoundaryDraft = Omit<DistrictLayout, 'checkpoint'>;

type Side = 'south' | 'east' | 'west' | 'north';
interface Run { min: number; max: number; kind: BoundaryKind }

const PROFILE: Record<BoundaryKind, { height: number; blocksSight: boolean }> = {
  deep_water: { height: 1, blocksSight: false },
  urban_fence: { height: 3, blocksSight: false },
  vehicle_blockade: { height: 1.8, blocksSight: true },
  concrete_debris: { height: 3.5, blocksSight: true },
  shipping_containers: { height: 5.2, blocksSight: true },
  military_perimeter: { height: 4, blocksSight: true },
  mangrove_barrier: { height: 5, blocksSight: true },
  collapsed_bridge: { height: 4, blocksSight: true },
};

function horizontal(side: Side): boolean { return side === 'south' || side === 'north'; }

/** Include patches crossing the edge, as well as roads ending exactly on it. */
function touches(r: AABB, p: AABB, side: Side): boolean {
  switch (side) {
    case 'south': return r.minZ < p.maxZ && r.maxZ >= p.maxZ;
    case 'north': return r.minZ <= p.minZ && r.maxZ > p.minZ;
    case 'east': return r.minX < p.maxX && r.maxX >= p.maxX;
    case 'west': return r.minX <= p.minX && r.maxX > p.minX;
  }
}

function kindFor(side: Side, archetype?: DistrictArchetype): BoundaryKind {
  if (side === 'south') return 'deep_water';
  if (side === 'east') return archetype === 'industrial' || archetype === 'marina'
    ? 'shipping_containers' : 'deep_water';
  if (archetype === 'airport' || archetype === 'military') return 'military_perimeter';
  if (side === 'west') return 'mangrove_barrier';
  return archetype === 'estates' || archetype === 'campus' || archetype === 'marina'
    ? 'urban_fence' : 'concrete_debris';
}

/** Partition at district and road ends, then merge adjacent equal kinds. */
function sideRuns(world: BoundaryDraft, side: Side): Run[] {
  const p = world.playArea, h = horizontal(side);
  const min = h ? p.minX : p.minZ, max = h ? p.maxX : p.maxZ;
  const districts = world.districts.filter(d => touches(d.rect, p, side))
    .sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col);
  const roads = world.ground.filter(g => g.kind === 'road' && touches(g.rect, p, side));
  const cuts = new Set([min, max]);
  for (const { rect } of [...districts, ...roads]) {
    cuts.add(Math.max(min, Math.min(max, h ? rect.minX : rect.minZ)));
    cuts.add(Math.max(min, Math.min(max, h ? rect.maxX : rect.maxZ)));
  }
  const sorted = [...cuts].sort((a, b) => a - b), runs: Run[] = [];
  const contains = (r: AABB, t: number) => h ? r.minX <= t && t < r.maxX : r.minZ <= t && t < r.maxZ;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1], hi = sorted[i], mid = (lo + hi) / 2;
    const road = roads.some(g => contains(g.rect, mid));
    const kind = road ? (side === 'north' || side === 'west' ? 'collapsed_bridge' : 'vehicle_blockade')
      : kindFor(side, districts.find(d => contains(d.rect, mid))?.archetype);
    const previous = runs[runs.length - 1];
    if (previous?.kind === kind) previous.max = hi;
    else runs.push({ min: lo, max: hi, kind });
  }
  return runs;
}

export function buildWorldBoundaries(world: BoundaryDraft, seed: number): void {
  const p = world.playArea, b = world.bounds, rng = mulberry32(seed);
  world.boundaries.length = 0;
  world.backdrop.length = 0;
  for (const side of ['south', 'east', 'west', 'north'] as const) {
    const h = horizontal(side), runs = sideRuns(world, side);
    const edge = side === 'south' ? p.maxZ : side === 'north' ? p.minZ : side === 'east' ? p.maxX : p.minX;
    const outer = side === 'south' ? b.maxZ : side === 'north' ? b.minZ : side === 'east' ? b.maxX : b.minX;
    if (edge === outer) continue; // No band (e.g. a legacy-sized fixture).
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i], id = `${side}-${i}`, tag = `boundary-${id}-0`;
      const point = (t: number): Vec2 => h ? { x: t, z: edge } : { x: edge, z: t };
      // A small overlap prevents join seams. End runs extend through the corner squares.
      const lo = i === 0 ? (h ? b.minX : b.minZ) : run.min - 0.1;
      const hi = i === runs.length - 1 ? (h ? b.maxX : b.maxZ) : run.max + 0.1;
      const rect: AABB = h
        ? { minX: Math.max(b.minX, lo), maxX: Math.min(b.maxX, hi), minZ: Math.min(edge, outer), maxZ: Math.max(edge, outer) }
        : { minX: Math.min(edge, outer), maxX: Math.max(edge, outer), minZ: Math.max(b.minZ, lo), maxZ: Math.min(b.maxZ, hi) };
      world.colliders.push({ ...rect, kind: 'boundary', tag, blocksMove: true, ...PROFILE[run.kind] });
      world.boundaries.push({
        id, kind: run.kind, points: [point(run.min), point(run.max)],
        isWorldEdge: true, destructible: false, blocksPlayer: true, blocksNPCs: true, blocksVehicles: true,
        scenerySeed: Math.floor(rng.next() * 0x100000000), colliderTags: [tag],
      });
    }
  }

  // These rectangles are exclusively scenery. None intersects the interior of bounds.
  const depth = 300;
  const backdrop = (kind: DistrictLayout['backdrop'][number]['kind'], rect: AABB) =>
    world.backdrop.push({ kind, rect, seed: Math.floor(rng.next() * 0x100000000) });
  backdrop('ocean', { minX: b.minX - depth, maxX: b.maxX + depth, minZ: b.maxZ, maxZ: b.maxZ + depth });
  backdrop('bay', { minX: b.maxX, maxX: b.maxX + depth, minZ: b.minZ - depth, maxZ: b.maxZ });
  backdrop('mangroves', { minX: b.minX - depth, maxX: b.minX, minZ: b.minZ, maxZ: b.maxZ });
  backdrop('highway', { minX: b.minX, maxX: b.maxX, minZ: b.minZ - 20, maxZ: b.minZ });
  backdrop('skyline', { minX: b.minX, maxX: b.maxX, minZ: b.minZ - depth, maxZ: b.minZ - 20 });
  const airport = world.districts.find(d => d.archetype === 'airport');
  if (airport) {
    // Follow the airport cell; it need not be at any particular literal coordinate.
    if (touches(airport.rect, p, 'north')) backdrop('airfield', {
      minX: airport.rect.minX - depth, maxX: airport.rect.maxX, minZ: b.minZ - depth, maxZ: b.minZ,
    });
    else if (touches(airport.rect, p, 'west')) backdrop('airfield', {
      minX: b.minX - depth, maxX: b.minX, minZ: airport.rect.minZ, maxZ: airport.rect.maxZ,
    });
  }
}
