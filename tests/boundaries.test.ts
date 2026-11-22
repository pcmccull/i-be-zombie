import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { AABB, BoundaryKind, DistrictArchetype, DistrictDef, Vec2 } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { Simulation } from '../src/sim/Simulation';
import { buildWorldBoundaries, type BoundaryDraft } from '../src/world/boundaryLayout';
import { CollisionWorld, isCrawlable } from '../src/world/CollisionWorld';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';
import { NavigationGrid } from '../src/world/NavigationGrid';

const rect = (minX: number, minZ: number, maxX: number, maxZ: number): AABB => ({ minX, minZ, maxX, maxZ });
const contains = (r: AABB, p: Vec2) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const within = (a: AABB, b: AABB) => a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ;
const layout = buildDistrictLayout(4242);

function fixture(): BoundaryDraft {
  const district = (id: DistrictDef['id'], archetype: DistrictArchetype, col: number, row: number): DistrictDef => ({
    id, archetype, cell: { col, row }, rect: rect(col * 30 - 30, row * 30 - 30, col * 30, row * 30),
    name: id, strongholdId: null, civilianBudget: 0, ambientBudget: 0, spawnPoints: [], landmark: '', threatTier: 1,
  });
  return {
    bounds: rect(-30, -30, 30, 30), playArea: rect(-20, -20, 20, 20),
    ground: [{ kind: 'road', rect: rect(3, -25, 7, 5) }], markings: [], buildings: [], props: [], colliders: [],
    playerStart: { x: 0, z: 0 }, playerStartFacing: 0, startFollowerArea: rect(-2, -2, 2, 2),
    spawnZones: [], guards: [], structures: [], strongholds: [], nests: [], boundaries: [], backdrop: [],
    districts: [district('airport', 'airport', 0, 0), district('golf_estates', 'estates', 1, 0),
      district('military_base', 'military', 0, 1), district('industrial', 'industrial', 1, 1)],
  };
}

function kindAt(w: BoundaryDraft, side: string, t: number): BoundaryKind | undefined {
  return w.boundaries.find(s => s.id.startsWith(`${side}-`) &&
    (side === 'north' || side === 'south'
      ? s.points[0].x <= t && t < s.points[1].x : s.points[0].z <= t && t < s.points[1].z))?.kind;
}

describe('world boundary authoring', () => {
  it('selects kinds from adjacent cells and cuts a road-end bridge from the north fence', () => {
    const w = fixture();
    buildWorldBoundaries(w, 42);
    expect(kindAt(w, 'north', -10)).toBe('military_perimeter');
    expect(kindAt(w, 'north', 1)).toBe('urban_fence');
    expect(kindAt(w, 'north', 5)).toBe('collapsed_bridge');
    expect(kindAt(w, 'north', 10)).toBe('urban_fence');
    expect(kindAt(w, 'west', -10)).toBe('military_perimeter');
    expect(kindAt(w, 'west', 10)).toBe('military_perimeter');
    expect(kindAt(w, 'east', -10)).toBe('deep_water');
    expect(kindAt(w, 'east', 10)).toBe('shipping_containers');
    expect(kindAt(w, 'south', 10)).toBe('deep_water');
    const bridge = w.boundaries.find(s => s.kind === 'collapsed_bridge')!;
    expect(bridge.points).toEqual([{ x: 3, z: -20 }, { x: 7, z: -20 }]);
  });

  it.each<DistrictArchetype>(['campus', 'marina', 'estates', 'downtown', 'airport', 'military', 'park'])(
    'handles a %s district without hard-coded grid coordinates', archetype => {
      const w = fixture();
      w.districts[0].archetype = archetype;
      // Translate all geometry to catch dependencies on the real world's origin or scale.
      for (const r of [w.bounds, w.playArea, ...w.districts.map(d => d.rect), ...w.ground.map(g => g.rect)]) {
        r.minX += 137; r.maxX += 137; r.minZ -= 81; r.maxZ -= 81;
      }
      buildWorldBoundaries(w, 17);
      const military = archetype === 'airport' || archetype === 'military';
      expect(kindAt(w, 'north', 127)).toBe(military ? 'military_perimeter'
        : ['campus', 'marina', 'estates'].includes(archetype) ? 'urban_fence' : 'concrete_debris');
      expect(kindAt(w, 'west', -91)).toBe(military ? 'military_perimeter' : 'mangrove_barrier');
      w.districts[1].archetype = archetype;
      const next = { ...w, colliders: [], boundaries: [], backdrop: [] };
      buildWorldBoundaries(next, 17);
      expect(kindAt(next, 'east', -91)).toBe(archetype === 'marina' || archetype === 'industrial'
        ? 'shipping_containers' : 'deep_water');
    },
  );

  it('reads roads at call time on every side and merges duplicate or overlapping road patches', () => {
    const w = fixture();
    w.ground.push({ kind: 'road', rect: rect(3, -24, 8, 1) },
      { kind: 'road', rect: rect(-25, 3, -5, 7) },
      { kind: 'road', rect: rect(-7, 5, -3, 25) },
      { kind: 'road', rect: rect(5, -7, 25, -3) },
      { kind: 'road', rect: rect(-2, -19, 2, 19) }); // stops short of every edge
    buildWorldBoundaries(w, 5);
    expect(kindAt(w, 'west', 5)).toBe('collapsed_bridge');
    expect(kindAt(w, 'south', -5)).toBe('vehicle_blockade');
    expect(kindAt(w, 'east', -5)).toBe('vehicle_blockade');
    expect(kindAt(w, 'north', 0)).toBe('urban_fence');
    expect(w.boundaries.filter(s => s.id.startsWith('north-') && s.kind === 'collapsed_bridge')).toHaveLength(1);
  });

  it('preserves existing colliders and structures and emits the correct sight/height profiles', () => {
    const w = fixture();
    const interior = { ...rect(-1, -1, 1, 1), kind: 'building' as const, height: 8, blocksMove: true, blocksSight: true };
    w.colliders.push(interior);
    const structures = w.structures, before = structuredClone(interior);
    buildWorldBoundaries(w, 5);
    expect(w.colliders[0]).toBe(interior);
    expect(interior).toEqual(before);
    expect(w.structures).toBe(structures);
    const profiles: Record<BoundaryKind, [number, boolean]> = {
      deep_water: [1, false], urban_fence: [3, false], vehicle_blockade: [1.8, true],
      concrete_debris: [3.5, true], shipping_containers: [5.2, true], military_perimeter: [4, true],
      mangrove_barrier: [5, true], collapsed_bridge: [4, true],
    };
    for (const archetype of ['park', 'airport', 'marina', 'industrial'] as const) {
      const f = fixture();
      f.districts[0].archetype = archetype;
      f.ground.push({ kind: 'road', rect: rect(-7, 5, -3, 25) });
      buildWorldBoundaries(f, 1);
      for (const s of f.boundaries) for (const tag of s.colliderTags) {
        const c = f.colliders.find(c => c.tag === tag)!;
        expect([c.height, c.blocksSight]).toEqual(profiles[s.kind]);
        expect(c.blocksMove).toBe(true);
      }
    }
  });

  it('is deterministic, gives unique stable ids/tags/seeds, and leaves the legacy layout alone', () => {
    const a = fixture(), b = fixture(), c = fixture();
    buildWorldBoundaries(a, 42); buildWorldBoundaries(b, 42); buildWorldBoundaries(c, 43);
    expect(a).toEqual(b);
    expect(c.boundaries.map(s => s.id)).toEqual(a.boundaries.map(s => s.id));
    expect(c.boundaries.map(s => s.scenerySeed)).not.toEqual(a.boundaries.map(s => s.scenerySeed));
    expect(new Set(a.boundaries.map(s => s.id)).size).toBe(a.boundaries.length);
    expect(new Set(a.colliders.map(c => c.tag)).size).toBe(a.colliders.length);
    expect(buildDistrictLayout(4242)).toEqual(layout);
    const legacy = buildLegacyDistrictLayout();
    expect(legacy.boundaries).toEqual([]);
    expect(legacy.backdrop).toEqual([]);
    expect(legacy.colliders.some(c => c.kind === 'boundary')).toBe(false);
  });

  it('puts all backdrop outside bounds with a deep ocean and an airport airfield', () => {
    expect(new Set(layout.backdrop.map(d => d.kind))).toEqual(new Set(['ocean', 'bay', 'mangroves', 'highway', 'skyline', 'airfield']));
    for (const d of layout.backdrop) {
      expect(overlaps(d.rect, layout.bounds), d.kind).toBe(false);
      expect(d.rect.maxX).toBeGreaterThan(d.rect.minX);
      expect(d.rect.maxZ).toBeGreaterThan(d.rect.minZ);
    }
    const ocean = layout.backdrop.find(d => d.kind === 'ocean')!.rect;
    expect(ocean.minZ).toBeGreaterThanOrEqual(layout.bounds.maxZ);
    expect(ocean.maxZ - ocean.minZ).toBeGreaterThanOrEqual(300);
    const airport = layout.districts.find(d => d.archetype === 'airport')!.rect;
    const airfield = layout.backdrop.find(d => d.kind === 'airfield')!.rect;
    expect(airfield.maxZ).toBeLessThanOrEqual(layout.bounds.minZ);
    expect(airfield.minX).toBeLessThan(airport.minX);
  });
});

describe('real-world boundary containment', () => {
  it('covers every half-meter of every edge through the full band, including corner squares', () => {
    const p = layout.playArea, b = layout.bounds, colliders = layout.colliders.filter(c => c.kind === 'boundary');
    const tags = layout.boundaries.flatMap(s => s.colliderTags);
    expect(colliders.length).toBeGreaterThan(0);
    expect(colliders.length).toBeLessThanOrEqual(120);
    expect(new Set(tags).size).toBe(colliders.length);
    for (const s of layout.boundaries) {
      expect([s.isWorldEdge, s.destructible, s.blocksPlayer, s.blocksNPCs, s.blocksVehicles]).toEqual([true, false, true, true, true]);
      expect(s.colliderTags.length).toBeGreaterThan(0);
      for (const pt of s.points) expect(contains(b, pt)).toBe(true);
      for (const tag of s.colliderTags) expect(colliders.some(c => c.tag === tag)).toBe(true);
    }
    for (const c of colliders) {
      expect(tags).toContain(c.tag);
      expect(within(c, b)).toBe(true);
      expect(overlaps(c, p)).toBe(false);
      expect(c.blocksMove).toBe(true);
      // Each straight collider spans the entire corresponding band thickness.
      if (c.tag!.includes('south-')) expect([c.minZ, c.maxZ]).toEqual([p.maxZ, b.maxZ]);
      if (c.tag!.includes('north-')) expect([c.minZ, c.maxZ]).toEqual([b.minZ, p.minZ]);
      if (c.tag!.includes('west-')) expect([c.minX, c.maxX]).toEqual([b.minX, p.minX]);
      if (c.tag!.includes('east-')) expect([c.minX, c.maxX]).toEqual([p.maxX, b.maxX]);
    }
    const covered = (x: number, z: number) => {
      if (!colliders.some(c => contains(c, { x, z }))) throw new Error(`Uncovered boundary: ${x}, ${z}`);
    };
    for (let x = b.minX; x <= b.maxX; x += 0.5) {
      for (const z of [p.minZ - 0.3, (b.minZ + p.minZ) / 2, b.minZ, p.maxZ + 0.3, (b.maxZ + p.maxZ) / 2, b.maxZ]) covered(x, z);
    }
    for (let z = b.minZ; z <= b.maxZ; z += 0.5) {
      for (const x of [p.minX - 0.3, (b.minX + p.minX) / 2, b.minX, p.maxX + 0.3, (b.maxX + p.maxX) / 2, b.maxX]) covered(x, z);
    }
    // Both meeting sides cover each corner, rather than merely abutting there.
    for (const x of [p.minX - 0.3, p.maxX + 0.3]) for (const z of [p.minZ - 0.3, p.maxZ + 0.3]) {
      expect(colliders.filter(c => contains(c, { x, z })).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps structures, objectives, humans, spawn zones and nests out of the boundary band', () => {
    const boundaries = layout.colliders.filter(c => c.kind === 'boundary');
    const clearRect = (r: AABB) => expect(boundaries.some(c => overlaps(c, r)), JSON.stringify(r)).toBe(false);
    const clearPoint = (p: Vec2) => expect(boundaries.some(c => contains(c, p)), JSON.stringify(p)).toBe(false);
    for (const s of layout.structures) {
      clearRect(s.rect); clearRect(s.enclosure);
      expect(boundaries.some(c => c.tag === s.tag)).toBe(false);
    }
    for (const s of layout.strongholds) for (const o of s.objectives) {
      if (o.point) clearRect(rect(o.point.x - (o.radius ?? 0), o.point.z - (o.radius ?? 0),
        o.point.x + (o.radius ?? 0), o.point.z + (o.radius ?? 0)));
      if (o.structureId !== undefined) expect(layout.structures.some(s => s.id === o.structureId)).toBe(true);
    }
    for (const g of layout.guards) { clearPoint(g.pos); for (const p of g.waypoints) clearPoint(p); }
    for (const z of layout.spawnZones) clearRect(z.rect);
    for (const n of layout.nests) clearPoint(n.pos);
    for (const d of layout.districts) for (const p of d.spawnPoints) clearPoint(p);
    for (const c of layout.colliders.filter(c => c.kind === 'gate' || c.kind === 'breakable')) expect(within(c, layout.playArea)).toBe(true);
  });

  it('has no walkable nav centre outside playArea even after every destructible collider is removed', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    for (const c of collision.colliders) {
      if (c.kind === 'breakable' || c.kind === 'gate') collision.setEnabled(c.id, false);
      if (c.kind === 'boundary') expect(isCrawlable(c)).toBe(false);
    }
    for (const passable of [undefined, isCrawlable]) {
      const nav = new NavigationGrid(collision, undefined, undefined, passable);
      let exterior = 0;
      for (let row = 0; row < nav.rows; row++) for (let col = 0; col < nav.cols; col++) {
        const p = { x: layout.bounds.minX + (col + 0.5) * nav.cellSize, z: layout.bounds.minZ + (row + 0.5) * nav.cellSize };
        if (!contains(layout.playArea, p)) {
          exterior++;
          if (nav.isWalkable(p)) throw new Error(`Walkable exterior cell: ${JSON.stringify(p)}`);
        }
      }
      expect(exterior).toBeGreaterThan(0);
    }
  }, 60000);

  it('contains the leader, followers and a fleeing human during 2400 simulated push steps at all edges and corners', async () => {
    const sim = new Simulation(buildDistrictLayout(4242), 4242), p = sim.ctx.layout.playArea;
    // Keep the real layout and systems; isolate the actors so combat elsewhere cannot end the probe.
    sim.state.zombies = sim.state.zombies.filter(z => z.state === 'follower');
    sim.state.followerCount = sim.state.zombies.length;
    const followers = [...sim.state.zombies];
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of directions) {
      const norm = Math.hypot(dx, dz), direction = { x: dx / norm, z: dz / norm };
      const candidate = (depth: number, lateral: number): Vec2 => ({
        x: dx < 0 ? p.minX + depth : dx > 0 ? p.maxX - depth : (p.minX + p.maxX) / 2 + lateral,
        z: dz < 0 ? p.minZ + depth : dz > 0 ? p.maxZ - depth : (p.minZ + p.maxZ) / 2 + lateral,
      });
      let start: Vec2 | undefined;
      for (let depth = 6; depth <= 12 && !start; depth++) for (const lateral of [0, -10, 10, -20, 20, -30, 30]) {
        const c = candidate(depth, lateral);
        const end = { x: dx < 0 ? p.minX + 0.8 : dx > 0 ? p.maxX - 0.8 : c.x,
          z: dz < 0 ? p.minZ + 0.8 : dz > 0 ? p.maxZ - 0.8 : c.z };
        if (sim.ctx.navGrid.isWalkable(c) && !sim.ctx.collision.isBlocked(c, 0.7) &&
          sim.ctx.navGrid.hasClearWalk(c, end)) { start = c; break; }
      }
      if (!start) throw new Error(`No walkable push corridor at ${dx},${dz}`);
      const leader = sim.state.leader;
      Object.assign(leader.pos, start); Object.assign(leader.prevPos, start);
      leader.vel.x = leader.vel.z = 0; leader.stamina = BALANCE.leader.staminaMax;
      for (let i = 0; i < followers.length; i++) {
        const z = followers[i];
        Object.assign(z.pos, { x: start.x - direction.x * (1 + i * 0.6), z: start.z - direction.z * (1 + i * 0.6) });
        sim.ctx.collision.resolveCircle(z.pos, z.radius);
        Object.assign(z.prevPos, z.pos); z.vel.x = z.vel.z = 0; z.engageTarget = null;
      }
      const humanStart = { x: start.x + direction.x * 2, z: start.z + direction.z * 2 };
      const human = createGuard(sim.ctx.newId(), { pos: humanStart, facing: Math.atan2(dx, dz), tower: null,
        role: 'civilian', post: 'street', waypoints: [humanStart] }, sim.ctx.collision);
      human.hp = human.maxHp = 100000; // Survives contact so movement is exercised for the full probe.
      sim.state.guards = [human];
      const input = { ...emptyInput(), cameraYaw: 0, moveForward: dz, moveRight: -dx, sprint: true };
      const assertInside = (e: { pos: Vec2; radius: number }) => {
        // Stronger than allowing the body's radius to protrude beyond the playable rectangle.
        if (e.pos.x < p.minX + e.radius - 1e-5 || e.pos.x > p.maxX - e.radius + 1e-5 ||
          e.pos.z < p.minZ + e.radius - 1e-5 || e.pos.z > p.maxZ - e.radius + 1e-5)
          throw new Error(`Actor escaped at ${dx},${dz}: ${JSON.stringify(e.pos)}`);
      };
      for (let step = 0; step < 300; step++) {
        sim.step(BALANCE.sim.fixedDt, input);
        assertInside(leader);
        for (const z of sim.state.zombies) assertInside(z);
        for (const g of sim.state.guards) assertInside(g);
        sim.drainEvents();
        if (step % 30 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // Verify the script reached the barrier, instead of passing while stuck on an interior prop.
      if (dx) expect(Math.abs(leader.pos.x - (dx < 0 ? p.minX : p.maxX))).toBeLessThan(1);
      if (dz) expect(Math.abs(leader.pos.z - (dz < 0 ? p.minZ : p.maxZ))).toBeLessThan(1);
      expect(human.state).toBe('RETREAT');
      expect(human.hp).toBeGreaterThan(0);
      expect(leader.alive).toBe(true);
      expect(sim.state.followerCount).toBe(sim.state.zombies.filter(z => z.state === 'follower').length);
      expect(sim.ctx.collision.colliders.filter(c => c.kind === 'boundary').every(c => c.enabled)).toBe(true);
    }
  }, 120000);
});
