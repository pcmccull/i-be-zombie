import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { DISTRICTS } from '../src/content/districts';
import { STRONGHOLDS } from '../src/content/strongholds';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { DISTRICT_IDS, type AABB, type DistrictLayout, type Vec2 } from '../src/core/types';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';
import { cellPlayRect, districtCellRect, districtSeed, ORIGINAL_DISTRICTS, overlaps, seamCrossings } from '../src/world/layout/grid';
import { getDistrictAt } from '../src/world/worldQueries';

const world = buildDistrictLayout();
/** VP2 passes add shared-wall infill, furniture and landscaping; the base-content invariants below test the base builders. */
const VP2_OFF = { buildingArchetypes: false, urbanInfill: false, streetFurniture: false };
const inside = (p: Vec2, r: AABB): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;

const inOld = (p: Vec2): boolean => p.x > -200 && p.x < 200 && p.z > -160 && p.z < 160;
const oldRect = (r: AABB): boolean => r.minX >= -200 && r.maxX <= 200 && r.minZ >= -160 && r.maxZ <= 160;
function originalSnapshot(w: DistrictLayout): number {
  const value = JSON.stringify({
    // The start pose, start nest and start-beach sand moved on purpose (lone Alpha on the beach); builders did not.
    checkpoint: w.checkpoint,
    ground: w.ground.filter(g => oldRect(g.rect) && g.kind !== 'sand'), markings: w.markings.filter(g => oldRect(g.rect)),
    buildings: w.buildings.filter(b => oldRect(b.footprint)), props: w.props.filter(p => inOld(p.pos)),
    colliders: w.colliders.filter(oldRect), structures: w.structures.filter(s => s.id < 100),
    guards: w.guards.filter(g => inOld(g.pos)), spawnZones: w.spawnZones.filter(z => oldRect(z.rect)),
    strongholds: w.strongholds.slice(0, 4), nests: w.nests.filter(n => inOld(n.pos) && n.id !== 'nest_start'),
  });
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

describe('expanded city content', () => {
  it('preserves the original four districts byte-for-byte at three seeds', () => {
    // Captured before replacing EW-T001 placeholders, from the unchanged HEAD-era builders/road data.
    // todos #10a/#10b append-only passes (sidewalk spawns, shops) are covered in tests/todos10to12.test.ts.
    const base = { sidewalkSpawns: false, shops: false, ...VP2_OFF };
    expect([undefined, 42, 1234].map(seed => originalSnapshot(buildDistrictLayout(seed, base))))
      .toEqual([67702145, 2557154139, 2278995827]);
  });

  it('builds independent deterministic districts, with seeded geometry variation', () => {
    const other = buildDistrictLayout(42);
    expect(other).toEqual(buildDistrictLayout(42));
    expect(new Set(DISTRICTS.map(d => districtSeed(42, d.id))).size).toBe(16);
    for (const meta of DISTRICTS.filter(d => !ORIGINAL_DISTRICTS.has(d.id))) {
      const buildings = (w: DistrictLayout) => w.buildings.filter(b => inside({ x: b.footprint.minX, z: b.footprint.minZ }, cellPlayRect(meta.cell.col, meta.cell.row)));
      expect(buildings(world).length, meta.id).toBeGreaterThan(0);
      expect(buildings(other), meta.id).not.toEqual(buildings(world));
    }
  });

  it('tiles all 16 grid cells without overlaps, and places high tiers beside low tiers', () => {
    expect(world.districts.map(d => d.id)).toEqual([...DISTRICT_IDS]);
    expect(world.districts.map(d => d.id)).toEqual(DISTRICTS.map(d => d.id));
    let totalArea = 0;
    for (const [i, d] of world.districts.entries()) {
      expect(d.cell).toEqual({ col: i % 4, row: Math.floor(i / 4) });
      expect(d.rect).toEqual(districtCellRect(d.cell.col, d.cell.row));
      totalArea += (d.rect.maxX - d.rect.minX) * (d.rect.maxZ - d.rect.minZ);
      for (const other of world.districts.slice(i + 1)) expect(overlaps(d.rect, other.rect)).toBe(false);
      if (d.threatTier >= 4) expect(world.districts.some(other => other.threatTier <= 2 &&
        Math.abs(d.cell.col - other.cell.col) + Math.abs(d.cell.row - other.cell.row) === 1), d.id).toBe(true);
    }
    expect(totalArea).toBe((world.bounds.maxX - world.bounds.minX) * (world.bounds.maxZ - world.bounds.minZ));
    expect(world.strongholds.map(s => s.id)).toEqual(STRONGHOLDS.map(s => s.id));
    expect(new Set(world.strongholds.map(s => s.id)).size).toBe(16);
  });

  it('realizes tiered defenders and ordered objectives with unique expansion doors', () => {
    const doors = world.structures.filter(s => s.id >= 100 && s.kind !== 'shopDoor'), collision = new CollisionWorld(world.bounds, world.colliders);
    expect(doors).toHaveLength(12);
    expect(new Set(doors.map(s => s.id)).size).toBe(12);
    for (const s of world.strongholds.filter(s => !ORIGINAL_DISTRICTS.has(s.districtId))) {
      const tier = s.defenseTier, guards = world.guards.filter(g => g.strongholdId === s.id);
      expect(s.objectives.map(o => [o.id, o.kind, o.label])).toEqual(STRONGHOLDS.find(m => m.id === s.id)!.objectives.map(o => [o.id, o.kind, o.label]));
      const door = doors.find(d => d.id === s.objectives[0].structureId)!;
      expect(door).toBeDefined();
      expect(collision.findByTag(door.tag)?.kind).toBe('breakable');
      // Defenders hold the whole compound (alleys, yards, emplacements), not just the breach room.
      expect(guards.every(g => g.post === 'stronghold' && g.tower === null && inside(g.pos, s.bounds))).toBe(true);
      const mgs = guards.filter(g => g.heavy === 'mg').length, tanks = guards.filter(g => g.heavy === 'tank').length;
      expect(guards.filter(g => g.heavy).every(g => g.role === 'soldier')).toBe(true);
      expect([mgs >= (tier >= 4 ? 2 : tier === 3 ? 1 : 0), tanks >= (tier === 5 ? 1 : 0)], s.id).toEqual([true, true]);
      if (tier <= 2) expect(mgs + tanks).toBe(0);
      const police = guards.filter(g => g.role === 'police').length, soldiers = guards.filter(g => g.role === 'soldier').length;
      if (tier <= 2) expect([police, soldiers]).toEqual([tier === 1 ? 3 : 5, 0]);
      else if (tier === 3) expect([police, soldiers]).toEqual([4, 2]);
      else if (tier === 4) expect([police, soldiers]).toEqual([0, 8]);
      else { expect(police).toBe(0); expect(soldiers).toBeGreaterThanOrEqual(10); expect(soldiers).toBeLessThanOrEqual(12); }
      const hold = s.objectives.find(o => o.id === 'take_control');
      expect(!!hold).toBe(tier >= 3);
      if (hold) {
        expect(hold.requires).toEqual(['breach']);
        expect(inside(hold.point!, door.enclosure)).toBe(true);
        expect(collision.isBlocked(hold.point!, hold.radius!)).toBe(false);
      }
      const nest = world.nests.find(n => n.id === s.nestId)!;
      expect(inside(nest.pos, s.bounds)).toBe(false);
      expect(collision.isBlocked(nest.pos, 0.45)).toBe(false);
      if (tier >= 4) for (const kind of ['watchtower', 'sandbags']) {
        expect(world.props.filter(p => p.kind === kind && inside(p.pos, s.bounds)).length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(world.guards.filter(g => g.tower)).toHaveLength(2);
  });

  it('gives every archetype distinct buildings/grounds/props within the population caps', () => {
    const world = buildDistrictLayout(undefined, VP2_OFF);
    expect(world.guards.length).toBeLessThanOrEqual(BALANCE.population.maxHumans);
    expect(world.spawnZones.reduce((sum, z) => sum + z.count, 0)).toBeLessThanOrEqual(BALANCE.population.maxAmbient);
    const style: Partial<Record<string, string>> = { airport: 'warehouse', estates: 'house', campus: 'civic', downtown: 'office',
      nightlife: 'storefront', medical: 'civic', military: 'warehouse', arts: 'apartment', boardwalk: 'storefront', resort: 'apartment' };
    const propKinds: Partial<Record<string, string[]>> = { airport: ['container', 'wreck'], marina: ['container', 'chainFence'],
      park: ['palm', 'bench'], medical: ['tent', 'jerseyBarrier'], military: ['watchtower', 'sandbags'], nightlife: ['sign'],
      boardwalk: ['palm', 'bench'], resort: ['palm'], arts: ['debris'] };
    for (const d of world.districts.filter(d => !ORIGINAL_DISTRICTS.has(d.id))) {
      const b = world.buildings.filter(b => getDistrictAt(world, { x: b.footprint.minX, z: b.footprint.minZ }) === d.id);
      if (style[d.archetype]) expect(b.some(b => b.style === style[d.archetype]), d.id).toBe(true);
      for (const kind of propKinds[d.archetype] ?? []) expect(world.props.some(p => p.kind === kind && getDistrictAt(world, p.pos) === d.id), `${d.id}:${kind}`).toBe(true);
      if (d.archetype === 'downtown') {
        expect(b.every(b => b.height >= 20 && b.height <= 45)).toBe(true);
        expect(b.filter(b => b.style === 'civic')).toHaveLength(2);
        expect(b.every(b => b.colorIndex >= 4 && b.colorIndex <= 7)).toBe(true);
      }
      if (d.archetype === 'resort') expect(b.every(b => b.style === 'apartment' && b.height >= 18 && b.height <= 30)).toBe(true);
      if (d.archetype === 'airport') {
        expect(b.filter(b => b.style === 'civic')).toHaveLength(1);
        expect(b.filter(b => b.style === 'warehouse').every(b => b.height >= 10 && b.height <= 14)).toBe(true);
      }
      if (d.archetype === 'park') expect(b.every(b => b.style === 'garage' && b.height <= 5)).toBe(true);
      if (['nightlife', 'arts'].includes(d.archetype)) expect(new Set(b.map(b => b.style))).toEqual(new Set(['storefront', 'apartment']));
      if (d.archetype === 'marina') expect(new Set(b.map(b => b.style))).toEqual(new Set(['warehouse', 'garage', 'office']));
      if (d.archetype === 'medical') {
        expect(b.some(b => b.style === 'garage')).toBe(true);
        expect(b.every(b => b.colorIndex <= 1)).toBe(true);
      }
      if (d.archetype === 'military') {
        expect(b.filter(b => b.style === 'civic')).toHaveLength(1);
        expect(b.every(b => b.colorIndex >= 6 && b.colorIndex <= 7)).toBe(true);
      }
      expect(d.spawnPoints.length).toBeGreaterThanOrEqual(4);
      if (d.threatTier >= 4) expect(d.civilianBudget).toBeLessThanOrEqual(4);
      else expect(d.civilianBudget).toBeGreaterThanOrEqual(8);
    }
  });

  it.each([BALANCE.sim.seed, 42, 1234, 0, 0xffffffff])('fills archetype blocks and scales humans with tier at seed %i', seed => {
    const w = seed === BALANCE.sim.seed ? world : buildDistrictLayout(seed);
    const minima: Partial<Record<string, number>> = { downtown: 24, nightlife: 20, resort: 14, campus: 16,
      medical: 12, arts: 18, boardwalk: 12, marina: 10, estates: 14, airport: 8, military: 10, park: 4 };
    const ranges = [[0, 0], [10, 14], [14, 18], [18, 22], [22, 28], [28, 36]];
    const totals = Array(6).fill(0), districts = Array(6).fill(0);
    for (const d of w.districts) {
      const humans = w.guards.filter(g => getDistrictAt(w, g.pos) === d.id);
      totals[d.threatTier] += humans.length;
      districts[d.threatTier]++;
      if (ORIGINAL_DISTRICTS.has(d.id)) continue;
      const buildings = w.buildings.filter(b => getDistrictAt(w, { x: b.footprint.minX, z: b.footprint.minZ }) === d.id);
      expect(buildings.length, d.id).toBeGreaterThanOrEqual(minima[d.archetype]!);
      expect(humans.length, d.id).toBeGreaterThanOrEqual(ranges[d.threatTier][0]);
      expect(humans.length, d.id).toBeLessThanOrEqual(ranges[d.threatTier][1]);
      if (d.threatTier === 1) expect(humans.filter(g => g.role === 'civilian').length).toBeGreaterThan(humans.length / 2);
      if (d.threatTier === 5) {
        expect(humans.filter(g => g.role === 'civilian')).toHaveLength(3);
        // Two eight-person street squads, in addition to the 11 compound defenders.
        expect(humans.filter(g => g.post === 'patrol' && g.role === 'soldier')).toHaveLength(16);
      }
    }
    const means = totals.map((total, tier) => total / districts[tier]);
    for (let tier = 2; tier <= 5; tier++) expect(means[tier], `tier ${tier}`).toBeGreaterThanOrEqual(means[tier - 1]);
    expect(means[5]).toBeGreaterThan(means[1] + 10);
    expect(w.guards.length).toBeLessThanOrEqual(BALANCE.population.maxHumans);
    expect(w.spawnZones.reduce((sum, z) => sum + z.count, 0)).toBeLessThanOrEqual(BALANCE.population.maxAmbient);
    expect(w.buildings.length).toBeLessThanOrEqual(600);
    expect(w.colliders.length).toBeLessThanOrEqual(4000);
  });

  it.each([BALANCE.sim.seed, 42, 1234])('keeps every footprint off roads, sidewalks and the boundary band at seed %i', seed => {
    const w = buildDistrictLayout(seed, VP2_OFF);
    const streets = w.ground.filter(g => g.kind === 'road' || g.kind === 'sidewalk');
    for (const b of w.buildings) {
      const f = b.footprint;
      expect(inside({ x: f.minX, z: f.minZ }, w.playArea) && inside({ x: f.maxX, z: f.maxZ }, w.playArea)).toBe(true);
      expect(streets.some(g => overlaps(f, g.rect)), JSON.stringify(f)).toBe(false);
      if (ORIGINAL_DISTRICTS.has(getDistrictAt(w, { x: f.minX, z: f.minZ }))) continue;
      expect(w.buildings.some(other => other !== b && overlaps(f, other.footprint, 3)), JSON.stringify(f)).toBe(false);
      expect(w.spawnZones.some(z => overlaps(f, z.rect, 3))).toBe(false);
      // Compound buildings (alley walls) sit wholly inside their stronghold; nothing else crowds a compound.
      expect(w.strongholds.some(s => overlaps(f, s.bounds, 3) && !(f.minX >= s.bounds.minX && f.maxX <= s.bounds.maxX &&
        f.minZ >= s.bounds.minZ && f.maxZ <= s.bounds.maxZ))).toBe(false);
      for (const p of [...w.nests.map(n => n.pos), ...w.strongholds.flatMap(s => s.reinforcementPoints)]) {
        expect(overlaps(f, { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }, 3)).toBe(false);
      }
    }
  });

  it('warns on the high-tier side of every shared high/low border without blocking crossings', () => {
    const collision = new CollisionWorld(world.bounds, world.colliders);
    for (const high of world.districts.filter(d => d.threatTier >= 4)) for (const low of world.districts.filter(d => d.threatTier <= 2)) {
      if (Math.abs(high.cell.col - low.cell.col) + Math.abs(high.cell.row - low.cell.row) !== 1) continue;
      const vertical = high.cell.col !== low.cell.col;
      const edge = vertical ? Math.max(high.rect.minX, low.rect.minX) : Math.max(high.rect.minZ, low.rect.minZ);
      for (const kind of ['warningSign', 'jerseyBarrier', 'floodlight', 'watchtower']) {
        const cues = world.props.filter(p => p.kind === kind && getDistrictAt(world, p.pos) === high.id && Math.abs((vertical ? p.pos.x : p.pos.z) - edge) <= 12);
        expect(cues.length, `${high.id}/${low.id}:${kind}`).toBeGreaterThanOrEqual(3);
        expect(cues.every(p => !p.blocking)).toBe(true);
      }
      for (const cross of seamCrossings(high.rect, low.rect)) expect(collision.segmentBlocked(cross.a, cross.b, { mode: 'move' })).toBe(false);
    }
  });
});

describe('expanded navigation', () => {
  it('keeps three independent walkable crossings on all 24 shared edges, including the old perimeter', async () => {
    const collision = new CollisionWorld(world.bounds, world.colliders), nav = new NavigationGrid(collision);
    let edges = 0;
    for (let i = 0; i < world.districts.length; i++) {
      const a = world.districts[i];
      for (const b of world.districts.slice(i + 1)) {
        if (Math.abs(a.cell.col - b.cell.col) + Math.abs(a.cell.row - b.cell.row) !== 1) continue;
        edges++;
        const crossings = seamCrossings(a.rect, b.rect);
        expect(crossings).toHaveLength(3);
        for (const cross of crossings) {
          const label = `${a.id}/${b.id} ${JSON.stringify(cross)}`;
          expect(collision.segmentBlocked(cross.a, cross.b, { mode: 'move' }), label).toBe(false);
          expect(nav.hasClearWalk(cross.a, cross.b), label).toBe(true);
        }
      }
      await new Promise(r => setTimeout(r, 0));
    }
    expect(edges).toBe(24);
  }, 60000);

  it.each([BALANCE.sim.seed, 42])('connects every walkable play-area cell before/after breaching at seed %i', async seed => {
    const w = seed === BALANCE.sim.seed ? world : buildDistrictLayout(seed);
    const collision = new CollisionWorld(w.bounds, w.colliders), nav = new NavigationGrid(collision);
    const sealed = [...w.structures.map(s => s.enclosure), w.checkpoint.bounds];
    for (const breached of [false, true]) {
      if (breached) {
        for (const s of w.structures) collision.setEnabled(collision.findByTag(s.tag)!.id, false);
        collision.setEnabled(collision.findByTag(w.checkpoint.gate.tag)!.id, false);
        nav.rebuild();
      }
      // Actual navigation edges (including no-corner-cutting), rather than an approximate flood fill.
      const field = nav.buildFlowField([w.playerStart]), unreachable: Vec2[] = [], p = { x: 0, z: 0 };
      let walkable = 0;
      for (let row = 0; row < nav.rows; row++) {
        p.z = w.bounds.minZ + (row + 0.5) * nav.cellSize;
        for (let col = 0; col < nav.cols; col++) {
          p.x = w.bounds.minX + (col + 0.5) * nav.cellSize;
          if (!inside(p, w.playArea) || !nav.isWalkable(p)) continue;
          walkable++;
          if (!Number.isFinite(field.distance[row * nav.cols + col]) && (breached || !sealed.some(r => inside(p, r)))) {
            if (unreachable.length < 10) unreachable.push({ ...p });
          }
        }
        if (row % 32 === 0) await new Promise(r => setTimeout(r, 0));
      }
      expect(walkable).toBeGreaterThan(200000);
      expect(unreachable, `breached=${breached}`).toEqual([]);
      for (const s of w.structures) expect(Number.isFinite(field.distanceAt(s.approachInside[0])), s.tag).toBe(breached);
    }
  }, 60000);
});
