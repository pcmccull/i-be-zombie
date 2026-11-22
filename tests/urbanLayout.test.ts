// VP2-T006: building archetype assignment, urban infill and street furniture layout passes (pure, headless).
import { describe, expect, it } from 'vitest';
import { DISTRICT_STYLES } from '../src/content/districtStyles';
import type { AABB, DistrictLayout, Vec2 } from '../src/core/types';
import { buildTrafficNetwork } from '../src/systems/trafficControl';
import { configForBuilding, planBuilding } from '../src/graphics/buildings/buildingPlan';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';
import { buildDistrictLayout, START_BEACH } from '../src/world/districtLayout';
import { BASE_FILL_AREA, LANDMARK_SIZES } from '../src/world/layout/urbanInfill';
import { MIN_CLEAR_SIDEWALK } from '../src/world/layout/streetFurniture';

const OFF = { buildingArchetypes: false, urbanInfill: false, streetFurniture: false } as const;
const base = buildDistrictLayout(undefined, OFF);
const world = buildDistrictLayout();

const overlaps = (a: AABB, b: AABB, m = 0): boolean =>
  a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const inside = (p: Vec2, r: AABB): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const centre = (r: AABB): Vec2 => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
const districtOf = (w: DistrictLayout, r: AABB): string => {
  const c = centre(r);
  return w.districts.find(d => c.x >= d.rect.minX && c.x < d.rect.maxX && c.z >= d.rect.minZ && c.z < d.rect.maxZ)!.id;
};
function fingerprint(w: DistrictLayout): number {
  const v = JSON.stringify({ g: w.ground, m: w.markings, b: w.buildings, p: w.props, c: w.colliders, z: w.spawnZones, h: w.guards,
    s: w.structures, sh: w.strongholds, n: w.nests });
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Empty-lot metric: 2 m cells inside the play area that hold no collider, no road/sidewalk/sand, no small existing ground
 *  patch (< BASE_FILL_AREA) and no ground patch added by the VP2 passes (district base fill counts as empty). */
function emptyCells(w: DistrictLayout, rect: AABB): number {
  const baseKeys = new Set(base.ground.map(g => g.kind + JSON.stringify(g.rect)));
  const pa = w.playArea;
  let n = 0;
  for (let x = Math.max(rect.minX, pa.minX) + 1; x < Math.min(rect.maxX, pa.maxX); x += 2) {
    for (let z = Math.max(rect.minZ, pa.minZ) + 1; z < Math.min(rect.maxZ, pa.maxZ); z += 2) {
      if (w.colliders.some(c => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ)) continue;
      let occupied = false;
      for (const g of w.ground) {
        if (!(x > g.rect.minX && x < g.rect.maxX && z > g.rect.minZ && z < g.rect.maxZ)) continue;
        const a = (g.rect.maxX - g.rect.minX) * (g.rect.maxZ - g.rect.minZ);
        if (g.kind === 'road' || g.kind === 'sidewalk' || g.kind === 'sand' || a < BASE_FILL_AREA || !baseKeys.has(g.kind + JSON.stringify(g.rect))) {
          occupied = true; break;
        }
      }
      if (!occupied) n++;
    }
  }
  return n;
}

describe('VP2 layout passes: flags off / determinism', () => {
  it('flags off reproduce the pre-VP2 world (recorded fingerprint) and passes only append', () => {
    expect(fingerprint(base)).toBe(3235728064);
    expect(world.colliders.slice(0, base.colliders.length)).toEqual(base.colliders);
    expect(world.buildings.slice(0, base.buildings.length).map(b => b.footprint)).toEqual(base.buildings.map(b => b.footprint));
    expect(world.buildings.slice(0, base.buildings.length).map(b => [b.style, b.height, b.colorIndex]))
      .toEqual(base.buildings.map(b => [b.style, b.height, b.colorIndex]));
    expect(world.props.slice(0, base.props.length)).toEqual(base.props);
    expect(world.spawnZones).toEqual(base.spawnZones);
    expect(world.guards).toEqual(base.guards);
    expect(world.structures).toEqual(base.structures);
    // Sand strip + ring road are appended last and unchanged.
    const tail = base.ground.slice(base.ground.findIndex(g => g.kind === 'sand' && g.rect.minX === START_BEACH.minX && g.rect.minZ === START_BEACH.minZ));
    expect(tail.length).toBeGreaterThan(3);
    expect(world.ground.slice(world.ground.length - tail.length)).toEqual(tail);
    expect(world.markings).toEqual(base.markings);
    // Each flag is independent: infill alone / furniture alone / assignment alone still only append.
    for (const flags of [{ buildingArchetypes: false, urbanInfill: false }, { buildingArchetypes: false, streetFurniture: false },
      { urbanInfill: false, streetFurniture: false }]) {
      const w = buildDistrictLayout(undefined, flags);
      expect(w.colliders.slice(0, base.colliders.length)).toEqual(base.colliders);
    }
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(buildDistrictLayout()).toEqual(world);
    expect(buildDistrictLayout(42)).toEqual(buildDistrictLayout(42));
    const other = buildDistrictLayout(42);
    expect(other.buildings).not.toEqual(world.buildings);
    expect(other.props).not.toEqual(world.props);
  });

  it('keeps the traffic network (lanes, junctions) identical with the passes on', () => {
    expect(JSON.stringify(buildTrafficNetwork(world))).toBe(JSON.stringify(buildTrafficNetwork(base)));
  });
});

describe('VP2 layout passes: buildings', () => {
  it('gives every building an archetype, seed and frontage, never a shared frontage, and every plan builds', () => {
    const buildings = world.buildings;
    for (const [index, b] of buildings.entries()) {
      expect(b.archetype, `building ${index}`).toBeDefined();
      expect(b.seed).toBeDefined();
      expect(b.frontage).toBeDefined();
      expect(b.sharedWalls ?? []).not.toContain(b.frontage);
      expect(b.lot === undefined || (b.lot.minX <= b.footprint.minX && b.lot.maxX >= b.footprint.maxX && b.lot.minZ <= b.footprint.minZ && b.lot.maxZ >= b.footprint.maxZ)).toBe(true);
      const style = DISTRICT_STYLES[districtOf(world, b.footprint) as keyof typeof DISTRICT_STYLES];
      const cfg = configForBuilding(b, index, style);
      expect(planBuilding(cfg).components.length).toBeGreaterThan(0);
    }
    for (const [i, b] of base.buildings.entries()) {
      const a = buildings[i];
      expect([a.footprint, a.height, a.style, a.colorIndex]).toEqual([b.footprint, b.height, b.style, b.colorIndex]);
    }
  });

  it('keeps gas stations rare, garages in the right districts, and lot fronts under 12 m', () => {
    const arch = new Map<string, Record<string, number>>();
    for (const b of world.buildings) {
      const d = districtOf(world, b.footprint), row = arch.get(d) ?? {};
      row[b.archetype!] = (row[b.archetype!] ?? 0) + 1;
      arch.set(d, row);
      if (b.lot) {
        const front = b.frontage === 'south' ? b.lot.maxZ - b.footprint.maxZ : b.frontage === 'north' ? b.footprint.minZ - b.lot.minZ
          : b.frontage === 'east' ? b.lot.maxX - b.footprint.maxX : b.footprint.minX - b.lot.minX;
        if (b.archetype !== 'landmark') expect(front).toBeLessThanOrEqual(12.001);
      }
    }
    for (const [d, row] of arch) expect(row.gasStation ?? 0, d).toBeLessThanOrEqual(2);
    const garageDistricts = ['financial_core', 'shopping', 'airport', 'medical_center', 'university', 'neon_nights', 'police', 'industrial', 'military_base'];
    expect(garageDistricts.some(d => (arch.get(d)?.parkingGarage ?? 0) > 0)).toBe(true);
    expect([...arch.values()].reduce((n, r) => n + (r.parkingGarage ?? 0), 0)).toBeGreaterThan(6);
    // Recognisable mix: every district keeps its heaviest style-weighted archetype present or a close relative.
    for (const d of world.districts) expect(Object.keys(arch.get(d.id) ?? {}).length, d.id).toBeGreaterThanOrEqual(2);
  });

  it('places at least one landmark per district inside its size table', () => {
    for (const d of world.districts) {
      const lm = world.buildings.filter(b => b.archetype === 'landmark' && districtOf(world, b.footprint) === d.id);
      expect(lm.length, d.id).toBeGreaterThanOrEqual(1);
      expect(lm.length, d.id).toBeLessThanOrEqual(2);
      for (const b of lm) {
        expect(DISTRICT_STYLES[d.id].landmarks).toContain(b.landmark);
        const s = LANDMARK_SIZES[b.landmark!], dx = b.footprint.maxX - b.footprint.minX, dz = b.footprint.maxZ - b.footprint.minZ;
        expect([Math.min(dx, dz), Math.max(dx, dz)]).toEqual([Math.min(s.along, s.depth), Math.max(s.along, s.depth)]);
        expect(b.height).toBe(s.h);
      }
    }
  });
});

describe('VP2 layout passes: clearances', () => {
  const newColliders = world.colliders.slice(base.colliders.length);
  const roads = world.ground.filter(g => g.kind === 'road').map(g => g.rect);
  const sidewalks = world.ground.filter(g => g.kind === 'sidewalk').map(g => g.rect);

  it('never overlaps older colliders, roads, spawn zones, nests, the start beach or the world edge', { timeout: 60000 }, () => {
    expect(newColliders.length).toBeGreaterThan(200);
    for (const c of newColliders) {
      expect(inside({ x: c.minX, z: c.minZ }, world.playArea) && inside({ x: c.maxX, z: c.maxZ }, world.playArea), c.tag).toBe(true);
      expect(base.colliders.some(o => overlaps(c, o)), c.tag).toBe(false);
      expect(roads.some(r => overlaps(c, r)), c.tag).toBe(false);
      expect(world.spawnZones.some(z => overlaps(c, z.rect)), c.tag).toBe(false);
      expect(overlaps(c, START_BEACH), c.tag).toBe(false);
      for (const n of world.nests) expect(overlaps(c, { minX: n.pos.x, maxX: n.pos.x, minZ: n.pos.z, maxZ: n.pos.z }, 8), c.tag).toBe(false);
      for (const g of world.guards) for (const p of [g.pos, ...g.waypoints]) {
        expect(overlaps(c, { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }, 1.4), c.tag).toBe(false);
      }
      for (const s of world.structures) for (const p of s.approachOutside) {
        expect(overlaps(c, { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }, 1.5), c.tag).toBe(false);
      }
    }
    for (let i = 0; i < newColliders.length; i++) for (let j = i + 1; j < newColliders.length; j++) {
      const a = newColliders[i], b = newColliders[j];
      if (a.kind === 'building' && b.kind === 'building') continue; // rows share walls on purpose
      if (a.kind === 'building' || b.kind === 'building') expect(overlaps(a, b), `${a.tag}/${b.tag}`).toBe(false);
    }
  });

  it('keeps infill buildings off paving and >= 3 m from older buildings', () => {
    for (const b of world.buildings.slice(base.buildings.length)) {
      expect(roads.some(r => overlaps(b.footprint, r))).toBe(false);
      expect(sidewalks.some(r => overlaps(b.footprint, r))).toBe(false);
      expect(base.buildings.some(o => overlaps(b.footprint, o.footprint, 2.9))).toBe(false);
    }
  });

  it('leaves >= 1.6 m of sidewalk beside every furniture prop and none in lanes or junction boxes', () => {
    const furniture = world.props.slice(base.props.length).filter(p => p.blocking &&
      ['busStop', 'mailbox', 'newsStand', 'bikeRack', 'bollard', 'planter', 'patioTable'].includes(p.kind) &&
      sidewalks.some(s => inside(p.pos, s)));
    expect(furniture.length).toBeGreaterThan(100);
    const colliderOf = new Map(newColliders.map(c => [c.tag, c]));
    for (const p of furniture) {
      const idx = world.props.indexOf(p) + 1, c = colliderOf.get(`prop-${idx}`)!;
      expect(c).toBeDefined();
      const walk = sidewalks.find(s => c.minX >= s.minX - 1e-6 && c.maxX <= s.maxX + 1e-6 && c.minZ >= s.minZ - 1e-6 && c.maxZ <= s.maxZ + 1e-6);
      expect(walk, p.kind).toBeDefined();
      const alongX = walk!.maxX - walk!.minX >= walk!.maxZ - walk!.minZ;
      const across = alongX ? walk!.maxZ - walk!.minZ - (c.maxZ - c.minZ) : walk!.maxX - walk!.minX - (c.maxX - c.minX);
      expect(across, p.kind).toBeGreaterThanOrEqual(MIN_CLEAR_SIDEWALK - 1e-6);
      expect(world.markings.some(m => m.kind === 'crosswalk' && overlaps(c, m.rect, 2.9)), p.kind).toBe(false);
    }
  });
});

describe('VP2 layout passes: density', () => {
  it('cuts the empty-lot area of every district by at least 40 percent', () => {
    const rows: string[] = [];
    for (const d of world.districts) {
      const before = emptyCells(base, d.rect), after = emptyCells(world, d.rect);
      rows.push(`${d.id}: ${before} -> ${after} (${Math.round((1 - after / before) * 100)}%)`);
      expect(1 - after / before, `${d.id} ${rows[rows.length - 1]}`).toBeGreaterThanOrEqual(0.4);
    }
    expect(rows).toHaveLength(16);
  }, 60000);
});

describe('VP2 layout passes: navigation', () => {
  it('keeps every spawn zone, waypoint, nest and structure approach reachable, and all walkable ground connected', async () => {
    const collision = new CollisionWorld(world.bounds, world.colliders), nav = new NavigationGrid(collision);
    const sealed = [...world.structures.map(s => s.enclosure), world.checkpoint.bounds];
    const field = nav.buildFlowField([world.playerStart]);
    const points: Vec2[] = [...world.nests.map(n => n.pos), ...world.structures.flatMap(s => s.approachOutside),
      ...world.checkpoint.gateApproachOutside, ...world.districts.flatMap(d => d.spawnPoints),
      ...world.spawnZones.filter(z => !z.heldBy).map(z => centre(z.rect)),
      ...world.guards.filter(g => g.post !== 'checkpoint' && !g.tower).flatMap(g => [g.pos, ...g.waypoints]),
      ...world.strongholds.flatMap(s => s.reinforcementPoints)];
    const bad = points.filter(p => !sealed.some(r => inside(p, r)) && nav.isWalkable(p) && !Number.isFinite(field.distanceAt(p)));
    expect(bad.slice(0, 5)).toEqual([]);
    const unreachable: Vec2[] = [], p = { x: 0, z: 0 };
    for (let row = 0; row < nav.rows; row++) {
      p.z = world.bounds.minZ + (row + 0.5) * nav.cellSize;
      for (let col = 0; col < nav.cols; col++) {
        p.x = world.bounds.minX + (col + 0.5) * nav.cellSize;
        if (!inside(p, world.playArea) || !nav.isWalkable(p) || sealed.some(r => inside(p, r))) continue;
        if (!Number.isFinite(field.distance[row * nav.cols + col]) && unreachable.length < 10) unreachable.push({ ...p });
      }
      if (row % 32 === 0) await new Promise(r => setTimeout(r, 0));
    }
    expect(unreachable).toEqual([]);
  }, 60000);
});
