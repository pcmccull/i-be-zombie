import { describe, expect, it } from 'vitest';
import type { AABB, BuildingArchetype, BuildingDef, BuildingStyle, Facing4 } from '../src/core/types';
import { ARCHETYPE_MIN_FOOTPRINT, DISTRICT_STYLES, STYLE_ARCHETYPES, type DistrictStyle } from '../src/content/districtStyles';
import { BUILDING_ARCHETYPES, floorsForHeight, type StandardArchetype } from '../src/graphics/buildings/buildingArchetypes';
import { configForBuilding, planBuilding } from '../src/graphics/buildings/buildingPlan';
import { FLAT_COMPONENT_KINDS, GROUND_LEVEL_HEIGHT, MAX_CANOPY_REACH, MAX_OVERHANG,
  type BuildingConfig, type BuildingPlan, type ComponentInstance, type ComponentKind } from '../src/graphics/buildings/buildingTypes';
import { planLandmark } from '../src/graphics/buildings/landmarkPlans';
import { buildDistrictLayout } from '../src/world/districtLayout';

const SIDES: readonly Facing4[] = ['south', 'east', 'north', 'west'];
const ARCHETYPES = Object.keys(BUILDING_ARCHETYPES) as StandardArchetype[];
const OPENINGS: readonly ComponentKind[] = ['window', 'door', 'storefront', 'garageDoor', 'loadingBay'];
const SHARED_FORBIDDEN: readonly ComponentKind[] = [...OPENINGS, 'balcony', 'sign', 'neonSign', 'acUnit', 'shutter'];
const SMALL: readonly BuildingArchetype[] = ['bungalow', 'convenienceStore', 'restaurant', 'beachShop', 'gasStation'];
const MASS: readonly ComponentKind[] = ['foundation', 'wallPanel', 'flatRoof', 'hipRoof', 'gableRoof', 'tileRoof',
  'steppedRoof', 'parapet', 'cornerColumn', 'roundedCorner', 'floorBand', 'canopy', 'balcony', 'landmarkPart'];
const DETAIL: readonly ComponentKind[] = ['wallLamp', 'roofVent', 'mechanicalBox', 'waterTank', 'satelliteDish',
  'solarPanel', 'chimney', 'drainpipe', 'acUnit', 'shutter', 'sign', 'neonSign', 'decoPanel', 'verticalFin', 'railing'];

function bounds(c: ComponentInstance): AABB {
  const sx = Math.abs(Math.cos(c.rotY)) * c.w / 2 + Math.abs(Math.sin(c.rotY)) * c.d / 2;
  const sz = Math.abs(Math.sin(c.rotY)) * c.w / 2 + Math.abs(Math.cos(c.rotY)) * c.d / 2;
  return { minX: c.x - sx, maxX: c.x + sx, minZ: c.z - sz, maxZ: c.z + sz };
}
function contains(outer: AABB, inner: AABB, eps = 0.000001): boolean {
  return inner.minX >= outer.minX - eps && inner.maxX <= outer.maxX + eps &&
    inner.minZ >= outer.minZ - eps && inner.maxZ <= outer.maxZ + eps;
}
function sideOf(c: ComponentInstance): Facing4 {
  return SIDES[(Math.round(c.rotY / (Math.PI / 2)) % 4 + 4) % 4];
}
function assertPlan(plan: BuildingPlan): void {
  const { config: cfg, components } = plan;
  const check = (ok: boolean, reason: string): void => {
    if (!ok) throw new Error(`${cfg.archetype} seed=${cfg.seed} ${cfg.width}x${cfg.depth}x${cfg.height}: ${reason}`);
  };
  const footprint = { minX: -cfg.width / 2, maxX: cfg.width / 2, minZ: -cfg.depth / 2, maxZ: cfg.depth / 2 };
  const frontLot = { ...footprint, minZ: cfg.depth / 2, maxZ: cfg.depth / 2 + cfg.lotExtent.front };
  check(components.length <= (SMALL.includes(cfg.archetype) ? 120 : 600), `component budget ${components.length}`);
  // Landmarks (lighthouse, ferris wheel, …) have no wall/roof mass; their own invariants live in landmarkPlans.test.ts.
  if (cfg.archetype !== 'landmark') {
    const roofs = components.filter(c => c.kind === 'flatRoof');
    check(roofs.length > 0, 'no roof base');
    check(roofs.every(c => Math.abs(c.y - c.h / 2 - cfg.height) <= 0.5), 'roof base height');
    const walls = components.filter(c => c.kind === 'wallPanel' || c.kind === 'cornerColumn' || c.kind === 'roundedCorner');
    check(Math.abs(Math.max(...walls.map(c => c.y + c.h / 2)) - cfg.height) <= 0.5, 'main mass height');
  }
  check(cfg.archetype === 'landmark' || components.some(c => ['door', 'storefront', 'garageDoor', 'loadingBay'].includes(c.kind) &&
    sideOf(c) === 'south' && c.z > cfg.depth / 2 - 0.3), 'frontage entrance');
  for (const c of components) {
    check([c.x, c.y, c.z, c.w, c.h, c.d, c.rotY, c.variant].every(Number.isFinite), `nonfinite ${c.kind}`);
    check(c.w > 0 && c.h > 0 && c.d > 0, `nonpositive ${c.kind}`);
    const box = bounds(c), bottom = c.y - c.h / 2, top = c.y + c.h / 2;
    if (bottom < GROUND_LEVEL_HEIGHT - 0.000001) {
      const flat = FLAT_COMPONENT_KINDS.has(c.kind) && top <= 0.3 + 0.000001;
      const pump = c.kind === 'pumpIsland' && cfg.lotBlockers.some(r => contains(r, box));
      const front = ['gardenWall', 'stair', 'porch'].includes(c.kind) && cfg.lotExtent.front > 0 && contains(frontLot, box);
      check(flat || pump || front || contains(footprint, box, 0.05), `ground footprint ${c.kind} ${JSON.stringify(box)}`);
    } else {
      const canopy = cfg.archetype === 'gasStation' && c.kind === 'canopy';
      check(contains({ minX: footprint.minX - (canopy ? 0 : MAX_OVERHANG),
        maxX: footprint.maxX + (canopy ? 0 : MAX_OVERHANG), minZ: footprint.minZ - (canopy ? 0 : MAX_OVERHANG),
        maxZ: footprint.maxZ + (canopy ? MAX_CANOPY_REACH : MAX_OVERHANG) }, box), `overhang ${c.kind}`);
      if (canopy) {
        check(bottom >= GROUND_LEVEL_HEIGHT, 'low pump canopy');
        const lotCanopy = cfg.lotBlockers.length === 0 && cfg.lotExtent.front > 0 && contains(frontLot, box);
        check(lotCanopy || cfg.lotBlockers.some(r => contains(r, box)), 'canopy without lot or matching blocker');
      }
    }
    // Landmark set pieces: only finite / ground-footprint / overhang rules apply (landmarkPlans.test.ts covers the rest).
    if (cfg.archetype === 'landmark') continue;
    if (c.kind === 'balcony') check(bottom >= cfg.height / cfg.floors - 0.000001, 'ground-floor balcony');
    if (SHARED_FORBIDDEN.includes(c.kind)) check(!cfg.sharedWalls.includes(sideOf(c)), `shared wall ${c.kind}`);
    if (MASS.includes(c.kind)) check(c.lod === 1, `mass lod ${c.kind}`);
    if (DETAIL.includes(c.kind)) check(c.lod === 0, `detail lod ${c.kind}`);
  }
  const openings = components.filter(c => OPENINGS.includes(c.kind));
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    const a = openings[i], b = openings[j], side = sideOf(a);
    if (side !== sideOf(b)) continue;
    const uA = side === 'south' || side === 'north' ? a.x : a.z;
    const uB = side === 'south' || side === 'north' ? b.x : b.z;
    check(Math.abs(uA - uB) >= (a.w + b.w) / 2 - 0.000001 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 - 0.000001,
      `overlapping ${a.kind}/${b.kind} on ${side}`);
  }
  if (cfg.archetype !== 'landmark') {
    const rules = BUILDING_ARCHETYPES[cfg.archetype];
    const kitKinds: readonly ComponentKind[] = ['roofVent', 'mechanicalBox', 'waterTank', 'satelliteDish',
      'solarPanel', 'rooftopPatio', 'chimney'];
    for (const kind of kitKinds) {
      const kit = components.filter(c => c.kind === kind);
      const limits = rules.roofKit[kind as keyof typeof rules.roofKit] ?? [0, 0];
      check(kit.length >= limits[0] && kit.length <= limits[1], `roof-kit count ${kind}`);
      check(kit.every(c => c.y + c.h / 2 <= cfg.height + 3), `roof-kit height ${kind}`);
    }
    for (const side of SIDES) {
      const windows = openings.filter(c => c.kind === 'window' && sideOf(c) === side);
      const floors = new Map<number, number[]>();
      for (const c of windows) {
        const floor = Math.floor(c.y / (cfg.height / cfg.floors));
        const row = floors.get(floor) ?? [];
        row.push(side === 'south' || side === 'north' ? c.x : c.z);
        floors.set(floor, row);
      }
      const upperRows = [...floors].filter(([floor]) => floor > 0).map(([, row]) => row);
      check(upperRows.every(row => JSON.stringify(row) === JSON.stringify(upperRows[0])), `misaligned bays ${side}`);
    }
  }
}

function fixture(archetype: StandardArchetype, seed = 1): BuildingDef {
  const min = ARCHETYPE_MIN_FOOTPRINT[archetype];
  const style = (Object.keys(STYLE_ARCHETYPES) as BuildingStyle[]).find(s => STYLE_ARCHETYPES[s].includes(archetype))!;
  const w = min.d + 4, d = min.w + 4;
  return { footprint: { minX: -w / 2, minZ: -d / 2, maxX: w / 2, maxZ: d / 2 },
    height: Math.max(6, min.h + 3), style, archetype, seed, colorIndex: 0 };
}
function districtFor(b: BuildingDef, districts: ReturnType<typeof buildDistrictLayout>['districts']): DistrictStyle {
  const p = b.footprint, x = (p.minX + p.maxX) / 2, z = (p.minZ + p.maxZ) / 2;
  const district = districts.find(d => x >= d.rect.minX && x < d.rect.maxX && z >= d.rect.minZ && z < d.rect.maxZ);
  if (!district) throw new Error('Building has no district');
  return DISTRICT_STYLES[district.id];
}

describe('pure building plans', () => {
  it('is repeatable across the default world and satisfies every geometry invariant', () => {
    const layout = buildDistrictLayout();
    const counts = Object.fromEntries(ARCHETYPES.map(a => [a, 0])) as Record<BuildingArchetype, number>;
    for (const [index, b] of layout.buildings.entries()) {
      const style = districtFor(b, layout.districts);
      const cfg = configForBuilding(b, index, style);
      expect(configForBuilding(b, index, style)).toEqual(cfg);
      const plan = planBuilding(cfg);
      expect(planBuilding(cfg)).toEqual(plan);
      assertPlan(plan);
      counts[cfg.archetype]++;
    }
    // The unmodified base world may lack a compatible footprint/style for some archetypes.
    const reachable = new Set(Object.entries(counts).filter(([, count]) => count > 0).map(([a]) => a));
    for (const a of ARCHETYPES) {
      if (!reachable.has(a)) {
        const b = fixture(a);
        delete b.archetype;
        const style = { ...DISTRICT_STYLES.suburbs, archetypeWeights: { [a]: 1 } };
        const cfg = configForBuilding(b, 0, style);
        expect(cfg.archetype).toBe(a);
        assertPlan(planBuilding(cfg));
        reachable.add(cfg.archetype);
      }
    }
    expect(reachable.size).toBe(12);
    console.info('Default-world archetype distribution:', JSON.stringify(counts));
  });

  it.each(ARCHETYPES)('%s satisfies all invariants over 50 seeds, lot sizes and shared walls', a => {
    const snapshots = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const b = fixture(a, seed);
      b.frontage = SIDES[seed % 4];
      b.sharedWalls = seed % 3 === 0 ? SIDES.filter(s => s !== b.frontage) : [];
      const cfg = configForBuilding(b, 3, DISTRICT_STYLES.oceanfront_hotels);
      cfg.lotExtent.front = seed % 3 === 0 ? 0 : seed % 2 ? 12 : 1.2;
      if (a === 'gasStation' && seed % 2 === 0) cfg.lotBlockers = [
        { minX: -cfg.width / 2 + 0.5, maxX: -cfg.width / 2 + 1.5, minZ: cfg.depth / 2 + 2, maxZ: cfg.depth / 2 + 4 },
        { minX: cfg.width / 2 - 1.5, maxX: cfg.width / 2 - 0.5, minZ: cfg.depth / 2 + 2, maxZ: cfg.depth / 2 + 4 },
      ];
      const plan = planBuilding(cfg);
      expect(planBuilding(cfg)).toEqual(plan);
      assertPlan(plan);
      snapshots.add(JSON.stringify(plan.components));
      const rules = BUILDING_ARCHETYPES[a];
      expect(rules.minSize).toEqual(ARCHETYPE_MIN_FOOTPRINT[a]);
      expect(cfg.floorHeight).toBeGreaterThanOrEqual(2.8);
      expect(cfg.floorHeight).toBeLessThanOrEqual(3.6);
      if (a === 'gasStation' && cfg.lotBlockers.length) {
        expect(plan.components.filter(c => c.kind === 'pumpIsland')).toHaveLength(cfg.lotBlockers.length);
        // No ground posts may invent collision obstacles in an empty front lot.
        expect(plan.components.filter(c => c.kind === 'column' && c.z > cfg.depth / 2)).toHaveLength(0);
      }
    }
    expect(snapshots.size).toBeGreaterThan(1);
  });

  it.each(SIDES)('maps dimensions, shared walls and lot margins with %s frontage', frontage => {
    const b = fixture('bungalow');
    b.footprint = { minX: 10, maxX: 22, minZ: 30, maxZ: 38 };
    b.lot = { minX: 6, maxX: 24, minZ: 27, maxZ: 43 };
    b.frontage = frontage;
    const turn = SIDES.indexOf(frontage);
    const expectedWalls: Facing4[] = ['east', 'north', 'west'];
    b.sharedWalls = [SIDES[(turn + 1) % 4], SIDES[(turn + 2) % 4], SIDES[(turn + 3) % 4]];
    const cfg = configForBuilding(b, 0, DISTRICT_STYLES.suburbs);
    expect([cfg.width, cfg.depth]).toEqual(turn % 2 ? [8, 12] : [12, 8]);
    expect(cfg.sharedWalls).toEqual(expectedWalls);
    const margins = [5, 2, 3, 4];
    expect(cfg.lotExtent).toEqual({ front: margins[turn], right: margins[(turn + 1) % 4],
      back: margins[(turn + 2) % 4], left: margins[(turn + 3) % 4] });
    const plan = planBuilding(cfg);
    assertPlan(plan);
    expect(plan.components.filter(c => c.kind === 'door').every(c => c.z > cfg.depth / 2 - 0.2 && c.rotY === 0)).toBe(true);
  });

  it('filters weighted picks by style, both sorted footprint sides and height, then uses compatible fallbacks', () => {
    const b: BuildingDef = { footprint: { minX: 0, minZ: 0, maxX: 8, maxZ: 7 }, height: 4, style: 'house', colorIndex: 0 };
    const style = { ...DISTRICT_STYLES.suburbs, archetypeWeights: { villa: 1000, office: 1000 } };
    expect(configForBuilding(b, 0, style).archetype).toBe('bungalow');
    b.footprint.maxX = 12; b.footprint.maxZ = 10;
    expect(configForBuilding(b, 0, style).archetype).toBe('villa');
    b.height = 3.5;
    expect(configForBuilding(b, 0, style).archetype).toBe('bungalow');
    b.footprint.maxX = 2;
    expect(configForBuilding(b, 0, style).archetype).toBe(STYLE_ARCHETYPES.house[0]);
    expect(configForBuilding(b, 0, style).lotExtent).toEqual({ front: 0, back: 0, left: 0, right: 0 });
  });

  it('keeps explicit seeds, hashes unseeded footprints and does not mutate input/config data', () => {
    const b = fixture('office');
    delete b.seed;
    const before = JSON.stringify(b), style = DISTRICT_STYLES.financial_core;
    const cfg = configForBuilding(b, 8, style), copy = JSON.stringify(cfg);
    expect(configForBuilding(b, 8, style).seed).toBe(cfg.seed);
    expect(configForBuilding(b, 9, style).seed).not.toBe(cfg.seed);
    expect(configForBuilding({ ...b, footprint: { ...b.footprint, maxX: b.footprint.maxX + 0.01 } }, 8, style).seed).not.toBe(cfg.seed);
    expect(configForBuilding({ ...b, seed: 0 }, 8, style).seed).toBe(0);
    expect(configForBuilding({ ...b, style: 'warehouse', archetype: 'warehouse' }, 8, style).palette).toEqual(cfg.palette);
    planBuilding(cfg);
    expect(JSON.stringify(cfg)).toBe(copy);
    expect(JSON.stringify(b)).toBe(before);
  });

  it('uses the closest nominal floor module while preserving awkward legacy collider heights', () => {
    for (const a of ARCHETYPES) for (const height of [2.8, 3, 4, 4.5, 5, 5.2, 7.6, 9, 12, 24, 45]) {
      const module = floorsForHeight(height, BUILDING_ARCHETYPES[a]);
      const error = Math.abs(module.floors * module.floorHeight - height);
      for (let floors = 1; floors <= Math.ceil(height / 2.8); floors++) {
        const alternative = floors * Math.max(2.8, Math.min(3.6, height / floors));
        expect(error).toBeLessThanOrEqual(Math.abs(alternative - height) + 0.000001);
      }
      const b = fixture(a);
      b.height = height;
      // Small archetypes at high-rise heights are outside the real-world fixtures and their budget class.
      if (height <= Math.max(9, ARCHETYPE_MIN_FOOTPRINT[a].h)) {
        const cfg = configForBuilding(b, 0, DISTRICT_STYLES.suburbs);
        assertPlan(planBuilding(cfg));
      }
    }
  });

  it('delegates landmarks and rejects an impossible shared frontage', () => {
    const b = { ...fixture('municipal'), archetype: 'landmark' as const, landmark: 'lighthouse' as const };
    const cfg = configForBuilding(b, 0, DISTRICT_STYLES.sunny_boardwalk);
    expect(cfg.landmark).toBe('lighthouse');
    expect(planBuilding(cfg)).toEqual(planLandmark(cfg));
    expect(() => configForBuilding({ ...b, sharedWalls: ['south'] }, 0, DISTRICT_STYLES.suburbs)).toThrow(/frontage/);
    expect(() => planBuilding({ ...cfg, archetype: 'municipal', sharedWalls: ['south'] })).toThrow(/frontage/);
  });

  it('omits gas canopy/pumps when blockers are outside the safe front reach', () => {
    const cfg = configForBuilding(fixture('gasStation'), 0, DISTRICT_STYLES.suburbs);
    cfg.lotExtent.front = 12;
    cfg.lotBlockers = [{ minX: 50, maxX: 51, minZ: 50, maxZ: 51 }];
    const plan = planBuilding(cfg);
    assertPlan(plan);
    expect(plan.components.some(c => c.kind === 'canopy' || c.kind === 'pumpIsland')).toBe(false);
  });
});
