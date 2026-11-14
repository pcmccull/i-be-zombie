import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { DISTRICTS } from '../src/content/districts';
import { STRONGHOLDS } from '../src/content/strongholds';
import { emptyInput, type AABB, type Vec2 } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { center } from '../src/world/layout/common';
import { chunkCols, chunkRows, chunkIdAt, chunkRect, chunksInRadius, ChunkStreamer,
  getDistrictAt, strongholdAt } from '../src/world/worldQueries';

const world = buildDistrictLayout();
const collision = new CollisionWorld(world.bounds, world.colliders);
const inside = (p: Vec2, b: AABB): boolean => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
const area = (b: AABB): number => (b.maxX - b.minX) * (b.maxZ - b.minZ);

describe('open-world layout', () => {
  it('is deterministic, seed-varied, independent between builds and within geometry budgets', () => {
    expect(buildDistrictLayout()).toEqual(buildDistrictLayout(BALANCE.sim.seed));
    expect(buildDistrictLayout(42)).toEqual(buildDistrictLayout(42));
    expect(buildDistrictLayout(42).buildings).not.toEqual(world.buildings);
    const changed = buildDistrictLayout();
    changed.strongholds[1].objectives[1].requires!.push('changed');
    changed.buildings[0].height = 100;
    expect(buildDistrictLayout()).toEqual(world);
    expect(world.buildings.length).toBeLessThanOrEqual(260);
    expect(world.colliders.length).toBeLessThanOrEqual(1500);
    expect(world.markings.length).toBeLessThan(400);
    expect(world.buildings.filter(b => b.style === 'mall')).toHaveLength(1);
    const mall = world.buildings.find(b => b.style === 'mall')!;
    expect(area(mall.footprint)).toBe(70 * 40);
    expect(mall.height).toBe(10);
  });

  it('tiles the exact world bounds without interior gaps/overlap and clamps district queries', () => {
    expect(world.bounds).toEqual({ minX: -200, minZ: -160, maxX: 200, maxZ: 160 });
    expect(world.districts).toHaveLength(4);
    expect(world.districts.reduce((sum, d) => sum + area(d.rect), 0)).toBe(area(world.bounds));
    for (const meta of DISTRICTS) {
      const d = world.districts.find(d => d.id === meta.id)!;
      expect(d).toMatchObject(meta);
      expect(d.spawnPoints.length).toBeGreaterThanOrEqual(4);
      expect(getDistrictAt(world, center(d.rect))).toBe(d.id);
    }
    for (let x = -199; x <= 199; x += 10) for (let z = -159; z <= 159; z += 10) {
      const owners = world.districts.filter(d => inside({ x, z }, d.rect));
      expect(owners).toHaveLength(1);
      expect(getDistrictAt(world, { x, z })).toBe(owners[0].id);
    }
    expect(getDistrictAt(world, { x: 0, z: 0 })).toBe('shopping');
    expect(getDistrictAt(world, { x: -2000, z: 2000 })).toBe('suburbs');
    expect(getDistrictAt(world, { x: 2000, z: -2000 })).toBe('industrial');
    expect(getDistrictAt(world, { x: 200, z: 160 })).toBe('shopping');
    expect(getDistrictAt(world, { x: -200, z: -160 })).toBe('police');
  });

  it('realizes the content metadata and resolves all objective, structure and nest references', () => {
    expect(world.strongholds.map(s => s.id)).toEqual(STRONGHOLDS.map(s => s.id));
    expect(new Set(world.structures.map(s => s.id)).size).toBe(world.structures.length);
    expect(new Set(world.nests.map(n => n.id)).size).toBe(5);
    expect(world.nests.filter(n => n.strongholdId === null).map(n => n.id)).toEqual(['nest_start']);
    const startNest = world.nests.find(n => n.strongholdId === null)!;
    expect(Math.hypot(startNest.pos.x - world.playerStart.x, startNest.pos.z - world.playerStart.z)).toBeLessThan(BALANCE.nest.equipRadius);
    for (const meta of STRONGHOLDS) {
      const s = world.strongholds.find(s => s.id === meta.id)!;
      expect(s).toMatchObject({ ...meta, objectives: meta.objectives.map(o => ({ ...o })) });
      expect(strongholdAt(world, s.center)?.id).toBe(s.id);
      expect(getDistrictAt(world, s.center)).toBe(s.districtId);
      expect(world.nests.find(n => n.id === s.nestId)).toMatchObject({ strongholdId: s.id, districtId: s.districtId });
      expect(s.reinforcementPoints.length).toBeGreaterThanOrEqual(2);
      for (const p of s.reinforcementPoints) {
        expect(inside(p, s.bounds)).toBe(false);
        expect(collision.isBlocked(p, BALANCE.guard.radius)).toBe(false);
        expect(collision.segmentBlocked(world.playerStart, p, { mode: 'sight' })).toBe(true);
        expect(world.ground.some(g => g.kind === 'road' && inside(p, g.rect))).toBe(true);
      }
      for (const o of s.objectives) {
        if (o.kind === 'destroyStructure') expect(world.structures.some(d => d.id === o.structureId)).toBe(true);
        if (o.kind === 'destroyGate') expect(collision.findByTag(world.checkpoint.gate.tag)?.kind).toBe('gate');
        if (o.kind === 'holdPoint') {
          expect(o.requires?.length).toBeGreaterThan(0);
          expect(collision.isBlocked(o.point!, o.radius!)).toBe(false);
          for (const id of o.requires!) expect(s.objectives.some(other => other.id === id)).toBe(true);
        }
      }
    }
    expect(strongholdAt(world, world.playerStart)).toBeUndefined();
    for (const s of world.structures) {
      const matches = world.colliders.filter(c => c.tag === s.tag);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ ...s.rect, kind: 'breakable', blocksMove: true, blocksSight: true });
      expect(s.id).toBeGreaterThanOrEqual(1);
      expect(s.approachOutside.length).toBeGreaterThanOrEqual(3);
      expect(s.approachInside.length).toBeGreaterThanOrEqual(2);
      for (const p of [...s.approachInside, ...s.approachOutside]) expect(collision.isBlocked(p, 0.45), `${s.kind} ${JSON.stringify(p)}`).toBe(false);
    }
  });

  it('keeps every spawn, nest, patrol waypoint and whole spawn rectangle walkable', () => {
    const points = [world.playerStart, ...world.nests.map(n => n.pos), ...world.districts.flatMap(d => d.spawnPoints),
      ...world.guards.flatMap(g => [g.pos, ...g.waypoints])];
    for (const p of points) expect(collision.isBlocked(p, 0.45), JSON.stringify(p)).toBe(false);
    for (const zone of [...world.spawnZones, { rect: world.startFollowerArea, name: 'followers' }]) {
      for (let x = zone.rect.minX; x <= zone.rect.maxX; x += 0.5) {
        for (let z = zone.rect.minZ; z <= zone.rect.maxZ; z += 0.5) {
          expect(collision.isBlocked({ x, z }, 0.45), `${zone.name} at ${x},${z}`).toBe(false);
        }
      }
    }
    for (const g of world.guards) {
      if (g.homeArea) {
        expect(inside(g.pos, g.homeArea)).toBe(true);
        for (const p of g.waypoints) expect(inside(p, g.homeArea)).toBe(true);
      }
      if (g.shelter) expect(world.structures.some(s => s.id === g.shelter)).toBe(true);
      if (g.strongholdId) expect(world.strongholds.some(s => s.id === g.strongholdId)).toBe(true);
    }
  });

  it('has exact district population budgets, defender roles, held zombies and nearby opening encounters', () => {
    const budgets = { suburbs: [16, 30], police: [10, 18], shopping: [22, 26], industrial: [8, 22] };
    for (const d of world.districts) {
      expect([d.civilianBudget, d.ambientBudget]).toEqual(budgets[d.id]);
      expect(world.guards.filter(g => g.role === 'civilian' && getDistrictAt(world, g.pos) === d.id)).toHaveLength(d.civilianBudget);
      expect(world.guards.filter(g => g.post === 'patrol' && getDistrictAt(world, g.pos) === d.id)).toHaveLength(d.id === 'suburbs' ? 0 : 2);
      const zones = world.spawnZones.filter(z => !z.heldBy && getDistrictAt(world, center(z.rect)) === d.id);
      expect(zones.reduce((sum, z) => sum + z.count, 0)).toBe(d.ambientBudget);
    }
    for (const [id, role, count] of [['suburb_checkpoint', 'police', 3], ['police_station', 'police', 8],
      ['mall_security', 'police', 5], ['industrial_yard', 'soldier', 8]] as const) {
      const guards = world.guards.filter(g => g.strongholdId === id);
      expect(guards).toHaveLength(count);
      expect(guards.every(g => g.role === role && g.post === 'stronghold')).toBe(true);
    }
    expect(world.guards.filter(g => g.tower).map(g => g.tower)).toEqual(['W', 'E']);
    expect(world.guards.length).toBeLessThanOrEqual(BALANCE.population.maxHumans);
    expect(world.spawnZones.reduce((sum, z) => sum + z.count, 0)).toBeLessThanOrEqual(BALANCE.population.maxAmbient);
    for (const z of world.spawnZones.filter(z => z.heldBy)) {
      const s = world.structures.find(s => s.id === z.heldBy)!;
      expect(s).toBeDefined();
      expect(inside(center(z.rect), s.enclosure)).toBe(true);
    }
    expect(world.guards.some(g => g.role === 'civilian' && Math.hypot(g.pos.x + 150, g.pos.z - 115) < 40)).toBe(true);
    for (const kind of ['busDoor', 'alleyGate']) {
      const p = center(world.structures.find(s => s.kind === kind)!.enclosure);
      expect(Math.hypot(p.x + 150, p.z - 115)).toBeLessThan(50);
    }
    const p = world.strongholds[0].center;
    expect(Math.hypot(p.x + 150, p.z - 115)).toBeGreaterThanOrEqual(60);
    expect(Math.hypot(p.x + 150, p.z - 115)).toBeLessThanOrEqual(80);
  });

  it('connects the start to all exterior approaches/nests and has three crossings per shared edge', () => {
    const nav = new NavigationGrid(collision);
    for (const p of [...world.nests.map(n => n.pos), ...world.structures.flatMap(s => s.approachOutside),
      ...world.checkpoint.gateApproachOutside, ...world.districts.flatMap(d => d.spawnPoints)]) {
      expect(nav.isWalkable(p), JSON.stringify(p)).toBe(true);
      expect(nav.findPath(world.playerStart, p), JSON.stringify(p)).not.toBeNull();
    }
    for (const x of [-170, -100, -30, 30, 100, 170]) {
      const a = { x, z: -12 }, b = { x, z: 12 };
      expect(collision.segmentBlocked(a, b, { mode: 'move' })).toBe(false);
      expect(nav.findPath(a, b)).not.toBeNull();
    }
    for (const z of [-130, -80, -30, 30, 80, 130]) {
      const a = { x: -12, z }, b = { x: 12, z };
      expect(collision.segmentBlocked(a, b, { mode: 'move' })).toBe(false);
      expect(nav.findPath(a, b)).not.toBeNull();
    }
    // No authored obstacle occupies any carriageway, including local streets.
    for (const r of world.ground.filter(g => g.kind === 'road').map(g => g.rect)) {
      for (const c of world.colliders.filter(c => c.blocksMove)) {
        expect(c.minX < r.maxX && c.maxX > r.minX && c.minZ < r.maxZ && c.maxZ > r.minZ).toBe(false);
      }
    }
  }, 30000);

  it('seals each enclosure and connects its interior/objective after its own entrance is destroyed', () => {
    const c = new CollisionWorld(world.bounds, world.colliders), nav = new NavigationGrid(c);
    for (const s of world.structures) {
      expect(nav.findPath(s.approachOutside[1], s.approachInside[0]), s.kind).toBeNull();
      c.setEnabled(c.findByTag(s.tag)!.id, false);
      nav.rebuild();
      for (const p of s.approachInside) expect(nav.findPath(world.playerStart, p), s.kind).not.toBeNull();
    }
    expect(nav.findPath(world.playerStart, world.checkpoint.gateApproachInside[3])).toBeNull();
    c.setEnabled(c.findByTag('gate')!.id, false); nav.rebuild();
    for (const s of world.strongholds) for (const objective of s.objectives) {
      if (objective.point) expect(nav.findPath(world.playerStart, objective.point), s.id).not.toBeNull();
    }
    expect(nav.findPath(world.playerStart, world.checkpoint.gateApproachInside[3])).not.toBeNull();
  }, 30000);

  it('constructs and advances the existing simulation for 120 fixed steps', () => {
    const sim = new Simulation(buildDistrictLayout());
    for (let i = 0; i < 120; i++) sim.step(BALANCE.sim.fixedDt, emptyInput());
    expect(sim.state.time).toBeCloseTo(2);
    expect(sim.state.followerCount).toBe(sim.state.zombies.filter(z => z.state === 'follower').length);
    expect(sim.state.guards.length).toBe(world.guards.length);
  }, 30000);

  it('has no walkable islands except sealed enclosures, and no islands at all once entrances open', () => {
    const c = new CollisionWorld(world.bounds, world.colliders), nav = new NavigationGrid(c);
    const unreachable = (): Vec2[] => {
      const open = new Uint8Array(nav.cols * nav.rows), seen = new Uint8Array(open.length);
      const queue = new Int32Array(open.length), p = { x: 0, z: 0 };
      const point = (id: number): Vec2 => {
        p.x = world.bounds.minX + (id % nav.cols + 0.5) * nav.cellSize;
        p.z = world.bounds.minZ + (Math.floor(id / nav.cols) + 0.5) * nav.cellSize;
        return p;
      };
      for (let id = 0; id < open.length; id++) open[id] = +nav.isWalkable(point(id));
      const start = Math.floor((world.playerStart.z - world.bounds.minZ) / nav.cellSize) * nav.cols +
        Math.floor((world.playerStart.x - world.bounds.minX) / nav.cellSize);
      let read = 0, write = 1;
      queue[0] = start; seen[start] = 1;
      const visit = (id: number): void => {
        if (open[id] && !seen[id]) { seen[id] = 1; queue[write++] = id; }
      };
      while (read < write) {
        const id = queue[read++], x = id % nav.cols, z = Math.floor(id / nav.cols);
        if (x > 0) visit(id - 1);
        if (x + 1 < nav.cols) visit(id + 1);
        if (z > 0) visit(id - nav.cols);
        if (z + 1 < nav.rows) visit(id + nav.cols);
      }
      const result: Vec2[] = [];
      for (let id = 0; id < open.length; id++) if (open[id] && !seen[id]) result.push({ ...point(id) });
      return result;
    };
    const rooms = [...world.structures.map(s => s.enclosure), world.checkpoint.bounds];
    expect(unreachable().filter(p => !rooms.some(b => inside(p, b))).slice(0, 10)).toEqual([]);
    for (const s of world.structures) c.setEnabled(c.findByTag(s.tag)!.id, false);
    c.setEnabled(c.findByTag('gate')!.id, false); nav.rebuild();
    expect(unreachable().slice(0, 10)).toEqual([]);
  }, 30000);
});

describe('world chunk queries and streaming', () => {
  it('uses stable 5 by 4 row-major chunks, clamps edges and reuses output objects', () => {
    expect([chunkCols(world), chunkRows(world)]).toEqual([5, 4]);
    expect(chunkIdAt(world, { x: -1000, z: -1000 })).toBe(0);
    expect(chunkIdAt(world, { x: 1000, z: 1000 })).toBe(19);
    const out = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
    for (let id = 0; id < 20; id++) {
      expect(chunkRect(world, id, out)).toBe(out);
      expect(area(out)).toBe(80 * 80);
      expect(chunkIdAt(world, center(out))).toBe(id);
    }
    expect(() => chunkRect(world, -1)).toThrow(RangeError);
    expect(() => chunkRect(world, 20)).toThrow(RangeError);
    expect(() => chunkRect(world, 0.5)).toThrow(RangeError);
    const partial = { ...world, bounds: { minX: 10, minZ: 20, maxX: 100, maxZ: 110 } };
    expect(chunkRect(partial, 3)).toEqual({ minX: 90, minZ: 100, maxX: 100, maxZ: 110 });
  });

  it('uses exact circle/rectangle overlap including tangency and clears reused arrays', () => {
    const out = [99];
    expect(chunksInRadius(world, { x: -160, z: -120 }, 0, out)).toBe(out);
    expect(out).toEqual([0]);
    expect(chunksInRadius(world, { x: -120, z: -120 }, 0, out)).toEqual([0, 1]);
    expect(chunksInRadius(world, { x: -201, z: -120 }, 0, out)).toEqual([]);
    expect(chunksInRadius(world, { x: -201, z: -120 }, 1, out)).toEqual([0]);
    expect(chunksInRadius(world, world.playerStart, Infinity, out)).toHaveLength(20);
    expect(() => chunksInRadius(world, world.playerStart, -1, out)).toThrow(RangeError);
  });

  it('returns exact load/unload diffs, retains a hysteresis band and stays at most twelve chunks on loops/teleports', () => {
    const streamer = new ChunkStreamer(world), mirror = new Set<number>();
    const route = [world.playerStart, { x: -100, z: 80 }, { x: -100, z: -80 }, { x: 100, z: -80 },
      { x: 100, z: 80 }, { x: 0, z: 0 }, world.playerStart];
    const scratch: number[] = [];
    for (let lap = 0; lap < 3; lap++) for (let leg = 1; leg < route.length; leg++) {
      const a = route[leg - 1], b = route[leg];
      for (let step = 0; step <= 10; step++) {
        const p = { x: a.x + (b.x - a.x) * step / 10, z: a.z + (b.z - a.z) * step / 10 };
        const diff = streamer.update(p);
        for (const id of diff.unload) { expect(mirror.delete(id)).toBe(true); }
        for (const id of diff.load) { expect(mirror.has(id)).toBe(false); mirror.add(id); }
        expect([...streamer.loaded].sort()).toEqual([...mirror].sort());
        expect(streamer.loaded.size).toBeLessThanOrEqual(12);
        expect(streamer.loaded.has(chunkIdAt(world, p))).toBe(true);
        const retained = chunksInRadius(world, p, BALANCE.chunks.unloadRadius, scratch);
        for (const id of streamer.loaded) expect(retained).toContain(id);
        expect(streamer.update(p)).toEqual({ load: [], unload: [] });
      }
    }
    const fresh = new ChunkStreamer(world);
    fresh.update({ x: -190, z: -160 });
    // id 2 is outside the load radius at the new point, but inside unloadRadius.
    fresh.update({ x: -200, z: -160 });
    expect(fresh.loaded.has(2)).toBe(true);
    fresh.update({ x: 200, z: 160 });
    expect(fresh.loaded.has(0)).toBe(false);
    expect(fresh.loaded.size).toBeLessThanOrEqual(12);
    expect(new ChunkStreamer(world).loaded.size).toBe(0);
  });
});
