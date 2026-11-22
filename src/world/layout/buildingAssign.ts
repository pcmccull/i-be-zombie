// [pure] VP2 building archetype assignment (docs/12_visual_polish2.md §6, ARCHITECTURE VP2-0 "Building archetypes").
// Append-only pass that runs LAST (so infill buildings are covered too): for every BuildingDef it fills the optional render
// fields -- archetype (district style weights x style compatibility x footprint fit), seed, frontage (the side facing the nearest
// road/sidewalk, the wider road at a corner), sharedWalls (sides within 0.6 m of a neighbour, never the frontage) and lot (the
// footprint grown towards the street into free non-paved space, <= 12 m). Footprint, height, style and colorIndex never change;
// fields a previous pass already set (infill archetype/frontage/lot, landmarks) are kept.
import {
  ARCHETYPE_MIN_FOOTPRINT, DISTRICT_STYLES, STYLE_ARCHETYPES,
} from '../../content/districtStyles';
import type { AABB, BuildingArchetype, BuildingDef, DistrictId, Facing4 } from '../../core/types';
import { mulberry32 } from '../../utils/rng';
import { rect, type WorldDraft } from './common';
import { buildOccupancy, FLAG, hashString, Occupancy, type InfillExtras } from './urbanInfill';

export const SIDES: readonly Facing4[] = ['south', 'east', 'north', 'west'];
const SHARED_GAP = 0.6, MAX_LOT_FRONT = 12, RAY = 40;
/** Garages that miss the parking-garage minimum (16 x 20) by a little still read as garages. */
const RELAXED_GARAGE = { w: 14, d: 14, h: 4.5 };

interface Side { side: Facing4; dx: number; dz: number; mid: { x: number; z: number } }

function sidesOf(f: AABB): Side[] {
  const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
  return [
    { side: 'south', dx: 0, dz: 1, mid: { x: cx, z: f.maxZ } },
    { side: 'east', dx: 1, dz: 0, mid: { x: f.maxX, z: cz } },
    { side: 'north', dx: 0, dz: -1, mid: { x: cx, z: f.minZ } },
    { side: 'west', dx: -1, dz: 0, mid: { x: f.minX, z: cz } },
  ];
}

function fitsMin(a: BuildingArchetype, f: AABB, height: number, relaxed = false): boolean {
  const m = relaxed && a === 'parkingGarage' ? RELAXED_GARAGE : ARCHETYPE_MIN_FOOTPRINT[a];
  const dx = f.maxX - f.minX, dz = f.maxZ - f.minZ;
  // +1 m headroom over the plan minimum: a villa at exactly its minimum height gets a ground-level balcony outside its footprint.
  return Math.min(dx, dz) >= m.w && Math.max(dx, dz) >= m.d && height >= m.h + (a === 'villa' ? 1.5 : 0);
}

/** Sides of `b` that sit within SHARED_GAP of another building (needs >= 2 m of overlap along the wall). */
export function sharedSides(b: BuildingDef, others: readonly BuildingDef[]): Facing4[] {
  const f = b.footprint, out = new Set<Facing4>();
  for (const o of others) {
    if (o === b) continue;
    const g = o.footprint;
    const alongX = Math.min(f.maxX, g.maxX) - Math.max(f.minX, g.minX);
    const alongZ = Math.min(f.maxZ, g.maxZ) - Math.max(f.minZ, g.minZ);
    if (alongX >= 2 && g.minZ - f.maxZ >= -0.01 && g.minZ - f.maxZ <= SHARED_GAP) out.add('south');
    if (alongX >= 2 && f.minZ - g.maxZ >= -0.01 && f.minZ - g.maxZ <= SHARED_GAP) out.add('north');
    if (alongZ >= 2 && g.minX - f.maxX >= -0.01 && g.minX - f.maxX <= SHARED_GAP) out.add('east');
    if (alongZ >= 2 && f.minX - g.maxX >= -0.01 && f.minX - g.maxX <= SHARED_GAP) out.add('west');
  }
  return SIDES.filter(s => out.has(s));
}

interface Ray { side: Facing4; dist: number; roadWidth: number }

function castRays(w: WorldDraft, g: Occupancy, f: AABB, ignoreSolid: boolean): Ray[] {
  const roads = w.ground.filter(p => p.kind === 'road').map(p => p.rect);
  const walks = w.ground.filter(p => p.kind === 'sidewalk').map(p => p.rect);
  const at = (rs: AABB[], x: number, z: number): AABB | undefined => rs.find(r => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  return sidesOf(f).map(s => {
    for (let k = 0; k < RAY; k++) {
      const x = s.mid.x + s.dx * (k + 0.5), z = s.mid.z + s.dz * (k + 0.5);
      const cell = rect(x - 0.1, z - 0.1, x + 0.1, z + 0.1);
      if (g.hit(cell, FLAG.PAVED)) {
        let road = at(roads, x, z);
        for (let j = 0; !road && j < 8; j++) road = at(roads, x + s.dx * j, z + s.dz * j);
        const walk = at(walks, x, z);
        const r = road ?? walk;
        return { side: s.side, dist: k + 0.5, roadWidth: r ? Math.min(r.maxX - r.minX, r.maxZ - r.minZ) : 0 };
      }
      if (!ignoreSolid && g.hit(cell, FLAG.SOLID)) break;
    }
    return { side: s.side, dist: Infinity, roadWidth: 0 };
  });
}

/** Frontage ranking: nearest paving first; sides within 4 m of the best (corner lots) prefer the wider road. */
function frontageOrder(rays: Ray[]): Facing4[] {
  const live = rays.filter(r => Number.isFinite(r.dist)).sort((a, b) => a.dist - b.dist);
  if (!live.length) return [];
  const best = live[0].dist;
  const corner = live.filter(r => r.dist <= best + 4).sort((a, b) => b.roadWidth - a.roadWidth || a.dist - b.dist);
  return [...corner, ...live.filter(r => !corner.includes(r))].map(r => r.side);
}

function districtOf(w: WorldDraft, f: AABB): DistrictId {
  const x = (f.minX + f.maxX) / 2, z = (f.minZ + f.maxZ) / 2;
  for (const d of w.districts) if (x >= d.rect.minX && x < d.rect.maxX && z >= d.rect.minZ && z < d.rect.maxZ) return d.id;
  return w.districts[0].id;
}

export interface AssignReport {
  /** archetype -> count per district. */
  byDistrict: Partial<Record<DistrictId, Partial<Record<BuildingArchetype, number>>>>;
}

export function assignBuildings(w: WorldDraft, seed: number, extra: InfillExtras = {}): AssignReport {
  const g = buildOccupancy(w, extra);
  const report: AssignReport = { byDistrict: {} };
  const gasCount: Partial<Record<DistrictId, number>> = {};
  for (const b of w.buildings) if (b.archetype === 'gasStation') { const d = districtOf(w, b.footprint); gasCount[d] = (gasCount[d] ?? 0) + 1; }

  // Phase A: pick the few gas stations (corner / main-road garages only; <= 1 or 2 per district).
  const gasPick = new Set<BuildingDef>();
  for (const d of w.districts) {
    const weight = DISTRICT_STYLES[d.id].archetypeWeights.gasStation ?? 0;
    if (weight <= 0) continue;
    const quota = Math.max(0, (weight >= 2 ? 2 : 1) - (gasCount[d.id] ?? 0));
    const cands = w.buildings.filter(b => b.archetype === undefined && b.style === 'garage' && districtOf(w, b.footprint) === d.id
      && fitsMin('gasStation', b.footprint, b.height)).map(b => {
      const live = castRays(w, g, b.footprint, false).filter(r => Number.isFinite(r.dist) && r.dist <= 24);
      const main = Math.max(0, ...live.map(r => r.roadWidth));
      return { b, ok: live.length >= 2 && main >= 10, score: main + (hashString(`vp2-gas:${seed}:${w.buildings.indexOf(b)}`) % 1000) / 1000 };
    }).filter(c => c.ok).sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, quota)) gasPick.add(c.b);
  }

  const claim = new Occupancy(w.bounds.minX, w.bounds.minZ, w.bounds.maxX, w.bounds.maxZ);
  for (let index = 0; index < w.buildings.length; index++) {
    const b = w.buildings[index], f = b.footprint, did = districtOf(w, f);
    const style = DISTRICT_STYLES[did];
    const rng = mulberry32(hashString(`vp2-assign:${seed}:${index}`));
    // ---- archetype
    if (b.archetype === undefined) {
      if (gasPick.has(b)) b.archetype = 'gasStation';
      else {
        const weight = (a: BuildingArchetype): number => style.archetypeWeights[a] ?? 0;
        const usable = (a: BuildingArchetype): boolean => a !== 'gasStation' && a !== 'landmark';
        const compat = STYLE_ARCHETYPES[b.style].filter(a => usable(a) && weight(a) > 0 && fitsMin(a, f, b.height, true));
        const wide = (Object.keys(style.archetypeWeights) as BuildingArchetype[]).filter(a => usable(a) && weight(a) > 0 && fitsMin(a, f, b.height));
        const pool = compat.length ? compat : b.style === 'garage' ? wide : [];
        let pick: BuildingArchetype | undefined;
        if (pool.length) {
          let ticket = rng.next() * pool.reduce((n, a) => n + weight(a), 0);
          pick = pool[pool.length - 1];
          for (const a of pool) { ticket -= weight(a); if (ticket < 0) { pick = a; break; } }
        } else {
          // Same fallback as configForBuilding: first fitting compatible archetype, else the first one (never a surplus gas station).
          const all = STYLE_ARCHETYPES[b.style].filter(usable);
          pick = all.find(a => fitsMin(a, f, b.height, true)) ?? all[0] ?? STYLE_ARCHETYPES[b.style][0];
        }
        b.archetype = pick;
      }
      if (b.archetype === 'gasStation') gasCount[did] = (gasCount[did] ?? 0) + 1;
    }
    if (b.seed === undefined) {
      // Same FNV-1a key buildingPlan derives for an unseeded building (index + centimetre extents): plans stay as tested.
      b.seed = hashString([index, ...[f.minX, f.minZ, f.maxX, f.maxZ].map(n => Math.round(n * 100))].join(':'));
    }
    // ---- shared walls, then frontage (never a shared side)
    const shared = sharedSides(b, w.buildings);
    if (b.frontage === undefined) {
      let order = frontageOrder(castRays(w, g, f, false));
      if (!order.length) order = frontageOrder(castRays(w, g, f, true));
      b.frontage = order.find(s => !shared.includes(s)) ?? order[0] ?? 'south';
    }
    const frontage = b.frontage;
    const walls = shared.filter(s => s !== frontage);
    if (walls.length) b.sharedWalls = walls; else delete b.sharedWalls;
    // ---- lot: footprint plus the free ground between the frontage and the street (<= 12 m, never over paving/other lots)
    if (b.lot === undefined) {
      const sd = sidesOf(f).find(s => s.side === frontage)!;
      let depth = 0;
      for (; depth < MAX_LOT_FRONT; depth++) {
        const strip = frontage === 'south' ? rect(f.minX, f.maxZ + depth, f.maxX, f.maxZ + depth + 1)
          : frontage === 'north' ? rect(f.minX, f.minZ - depth - 1, f.maxX, f.minZ - depth)
            : frontage === 'east' ? rect(f.maxX + depth, f.minZ, f.maxX + depth + 1, f.maxZ)
              : rect(f.minX - depth - 1, f.minZ, f.minX - depth, f.maxZ);
        if (g.hit(strip, FLAG.SOLID | FLAG.PAVED) || claim.hit(strip, FLAG.USED)) break;
      }
      const lot = { minX: f.minX, minZ: f.minZ, maxX: f.maxX, maxZ: f.maxZ };
      if (depth > 0) {
        if (sd.dz > 0) lot.maxZ += depth; else if (sd.dz < 0) lot.minZ -= depth;
        else if (sd.dx > 0) lot.maxX += depth; else lot.minX -= depth;
      }
      b.lot = lot;
      claim.mark(FLAG.USED, lot);
    }
    const slot = (report.byDistrict[did] ??= {});
    slot[b.archetype!] = (slot[b.archetype!] ?? 0) + 1;
  }
  return report;
}
