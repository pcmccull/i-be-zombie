import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { AABB, ColliderDef, Vec2 } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { createStructures } from '../src/entities/Structure';
import { createZombie } from '../src/entities/Zombie';
import { createInitialState } from '../src/sim/createInitialState';
import { mulberry32 } from '../src/utils/rng';
import { CollisionWorld, isCrawlable } from '../src/world/CollisionWorld';
import { NavigationGrid } from '../src/world/NavigationGrid';
import { buildDistrictLayout } from '../src/world/districtLayout';

function pointToAABBDistance(p: Vec2, box: AABB): number {
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
  const dz = Math.max(box.minZ - p.z, 0, p.z - box.maxZ);
  return Math.hypot(dx, dz);
}

function aabbToAABBDistance(a: AABB, b: AABB): number {
  const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
  const dz = Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ);
  return Math.hypot(dx, dz);
}

function rectCenter(box: AABB): Vec2 {
  return {
    x: 0.5 * (box.minX + box.maxX),
    z: 0.5 * (box.minZ + box.maxZ),
  };
}

function pointInsideAABB(p: Vec2, box: AABB): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
}

/**
 * Rasterize `blocksMove` colliders (dilated by `dilation` meters) onto a 1 m grid
 * over `bounds` and flood-fill (4-connected) from `start`.
 */
function buildReachabilityGrid(
  bounds: AABB,
  colliders: readonly ColliderDef[],
  start: Vec2,
  dilation = 0.5,
): { isReachable(p: Vec2): boolean; isBlockedCell(p: Vec2): boolean } {
  const cellSize = 1;
  const cols = Math.round((bounds.maxX - bounds.minX) / cellSize);
  const rows = Math.round((bounds.maxZ - bounds.minZ) / cellSize);
  const blocked = new Uint8Array(cols * rows);
  const visited = new Uint8Array(cols * rows);

  const toCell = (p: Vec2): { col: number; row: number } => {
    const col = Math.min(cols - 1, Math.max(0, Math.floor((p.x - bounds.minX) / cellSize)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((p.z - bounds.minZ) / cellSize)));
    return { col, row };
  };

  for (const c of colliders) {
    if (!c.blocksMove) continue;
    const minX = c.minX - dilation;
    const maxX = c.maxX + dilation;
    const minZ = c.minZ - dilation;
    const maxZ = c.maxZ + dilation;

    const c0 = Math.max(0, Math.floor((minX - bounds.minX) / cellSize));
    const c1 = Math.min(cols - 1, Math.floor((maxX - bounds.minX) / cellSize));
    const r0 = Math.max(0, Math.floor((minZ - bounds.minZ) / cellSize));
    const r1 = Math.min(rows - 1, Math.floor((maxZ - bounds.minZ) / cellSize));

    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const cx = bounds.minX + (col + 0.5) * cellSize;
        const cz = bounds.minZ + (r + 0.5) * cellSize;
        if (cx >= minX && cx <= maxX && cz >= minZ && cz <= maxZ) {
          blocked[r * cols + col] = 1;
        }
      }
    }
  }

  const startCell = toCell(start);
  const startIdx = startCell.row * cols + startCell.col;
  const queue: number[] = [];
  if (!blocked[startIdx]) {
    visited[startIdx] = 1;
    queue.push(startIdx);
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++]!;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    for (const [dc, dr] of dirs) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (blocked[nIdx] || visited[nIdx]) continue;
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  return {
    isReachable(p: Vec2): boolean {
      const { col, row } = toCell(p);
      return visited[row * cols + col] === 1;
    },
    isBlockedCell(p: Vec2): boolean {
      const { col, row } = toCell(p);
      return blocked[row * cols + col] === 1;
    },
  };
}

describe('buildDistrictLayout', () => {
  const layout = buildDistrictLayout();

  it('is deterministic across calls', () => {
    const layout2 = buildDistrictLayout();
    expect(layout2).toEqual(layout);
  });

  it('(a) preserves 8 checkpoint soldiers and exactly 2 tower guards (W and E)', () => {
    const checkpointGuards = layout.guards.filter(g => g.post === 'checkpoint');
    expect(checkpointGuards).toHaveLength(BALANCE.guard.count);
    expect(checkpointGuards.every(g => g.role === 'soldier')).toBe(true);
    const towerGuards = checkpointGuards.filter((g) => g.tower !== null);
    expect(towerGuards).toHaveLength(2);
    expect(towerGuards.map((g) => g.tower).sort()).toEqual(['E', 'W']);
  });

  it('(b) has the authored spawn zone distribution summing to exactly 85', () => {
    expect(layout.spawnZones.length).toBeGreaterThanOrEqual(5);
    const total = layout.spawnZones.reduce((sum, z) => sum + z.count, 0);
    expect(total).toBe(BALANCE.horde.initialAmbient);
    expect(layout.spawnZones.map(z => [z.name, z.count, z.heldBy ?? 0])).toEqual([
      ['park-edge', 6, 0], ['bus', 15, 1], ['parking-lot', 12, 0], ['police-pen', 10, 4],
      ['alley', 20, 2], ['commercial', 8, 0], ['residential-west', 6, 0], ['east-lot', 8, 0],
    ]);
    for (const zone of layout.spawnZones) if (zone.heldBy) {
      const def = layout.structures.find(s => s.id === zone.heldBy);
      expect(def).toBeDefined();
      expect(pointInsideAABB({ x: zone.rect.minX, z: zone.rect.minZ }, def!.enclosure)).toBe(true);
      expect(pointInsideAABB({ x: zone.rect.maxX, z: zone.rect.maxZ }, def!.enclosure)).toBe(true);
    }
  });

  it('(c) has exactly one collider with kind "gate" and tag "gate"', () => {
    const gates = layout.colliders.filter((c) => c.kind === 'gate' || c.tag === 'gate');
    expect(gates).toHaveLength(1);
    expect(gates[0]!.kind).toBe('gate');
    expect(gates[0]!.tag).toBe('gate');
    expect(gates[0]!.blocksMove).toBe(true);
    expect(gates[0]!.blocksSight).toBe(true);
  });

  it('(d) has checkpoint bounds of ~42x32 m in NE block', () => {
    const b = layout.checkpoint.bounds;
    const width = b.maxX - b.minX;
    const depth = b.maxZ - b.minZ;
    expect(width).toBeCloseTo(42, 0);
    expect(depth).toBeCloseTo(32, 0);
    expect(layout.checkpoint.gateApproachOutside.length).toBeGreaterThanOrEqual(6);
    expect(layout.checkpoint.gateApproachInside.length).toBeGreaterThanOrEqual(6);
    expect(layout.checkpoint.towers).toHaveLength(2);
  });

  it('(e) keeps all colliders strictly valid and within world bounds', () => {
    expect(layout.bounds).toEqual({ minX: -120, minZ: -90, maxX: 120, maxZ: 90 });
    for (const c of layout.colliders) {
      expect(c.minX).toBeLessThan(c.maxX);
      expect(c.minZ).toBeLessThan(c.maxZ);
      expect(c.minX).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(c.maxX).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(c.minZ).toBeGreaterThanOrEqual(layout.bounds.minZ);
      expect(c.maxZ).toBeLessThanOrEqual(layout.bounds.maxZ);
    }
  });

  it('(f) enforces >= 0.6 m clearance from blocking colliders for playerStart, spawnZones, guard waypoints, and gate approaches', () => {
    const clearance = 0.6;
    const blocking = layout.colliders.filter((c) => c.blocksMove);

    for (const c of blocking) {
      expect(pointToAABBDistance(layout.playerStart, c)).toBeGreaterThanOrEqual(clearance);

      for (const zone of layout.spawnZones) {
        expect(aabbToAABBDistance(zone.rect, c)).toBeGreaterThanOrEqual(clearance);
      }

      for (const pt of layout.checkpoint.gateApproachOutside) {
        expect(pointToAABBDistance(pt, c)).toBeGreaterThanOrEqual(clearance);
      }

      for (const pt of layout.checkpoint.gateApproachInside) {
        expect(pointToAABBDistance(pt, c)).toBeGreaterThanOrEqual(clearance);
      }
    }

    for (const guard of layout.guards) {
      const ownTowerTag = guard.tower ? `tower${guard.tower}` : null;
      for (const wp of [guard.pos, ...guard.waypoints]) {
        for (const c of blocking) {
          if (ownTowerTag && c.tag === ownTowerTag) continue;
          expect(pointToAABBDistance(wp, c)).toBeGreaterThanOrEqual(clearance);
        }
      }
    }
  });

  it('(g) satisfies reachability rules with gate intact vs removed', () => {
    const gridIntact = buildReachabilityGrid(layout.bounds, layout.colliders, layout.playerStart, 0.5);

    // Player start itself is walkable and reachable
    expect(gridIntact.isBlockedCell(layout.playerStart)).toBe(false);
    expect(gridIntact.isReachable(layout.playerStart)).toBe(true);

    // Free clusters are reachable; trapped clusters stay sealed until their structure opens.
    for (const zone of layout.spawnZones) {
      const center = rectCenter(zone.rect);
      expect(gridIntact.isReachable(center)).toBe(!zone.heldBy);
    }

    // North service alley (around x = -5, z = -60) is reachable
    expect(gridIntact.isReachable({ x: -5, z: -60 })).toBe(true);

    // Every gateApproachOutside point is reachable while gate is intact
    for (const pt of layout.checkpoint.gateApproachOutside) {
      expect(gridIntact.isReachable(pt)).toBe(true);
    }

    // Separate ground guards into inside vs outside compound
    const groundGuards = layout.guards.filter((g) => g.post === 'checkpoint' && g.tower === null);
    const outsideGuards = groundGuards.filter((g) => !pointInsideAABB(g.pos, layout.checkpoint.bounds));
    const insideGuards = groundGuards.filter((g) => pointInsideAABB(g.pos, layout.checkpoint.bounds));

    expect(outsideGuards).toHaveLength(3);
    expect(insideGuards).toHaveLength(3);

    // Outside guard waypoints ARE reachable while gate is present
    for (const g of outsideGuards) {
      for (const wp of g.waypoints) {
        expect(gridIntact.isReachable(wp)).toBe(true);
      }
    }

    // Inside guard waypoints and gateApproachInside points are NOT reachable while gate is present
    for (const pt of layout.checkpoint.gateApproachInside) {
      expect(gridIntact.isReachable(pt)).toBe(false);
    }
    for (const g of insideGuards) {
      for (const wp of g.waypoints) {
        expect(gridIntact.isReachable(wp)).toBe(false);
      }
    }

    // Remove the gate collider and re-run flood fill
    const collidersWithoutGate = layout.colliders.filter((c) => c.tag !== 'gate');
    const gridGateOpen = buildReachabilityGrid(
      layout.bounds,
      collidersWithoutGate,
      layout.playerStart,
      0.5,
    );

    // Now gateApproachInside points and inside guard waypoints ARE reachable
    for (const pt of layout.checkpoint.gateApproachInside) {
      expect(gridGateOpen.isReachable(pt)).toBe(true);
    }
    for (const g of insideGuards) {
      for (const wp of g.waypoints) {
        expect(gridGateOpen.isReachable(wp)).toBe(true);
      }
    }
  });

  it('authors one solid breakable per structure and hollow non-crawlable shells', () => {
    expect(layout.structures.map(s => s.id)).toEqual([1, 2, 3, 4]);
    expect(layout.structures.map(s => [s.kind, s.landmark, s.defensive])).toEqual([
      ['busDoor', 'bus', false], ['alleyGate', 'alley', false],
      ['storeDoor', 'store', true], ['penGate', 'barricade', true],
    ]);
    expect(layout.colliders.filter(c => c.kind === 'breakable')).toHaveLength(4);
    for (const def of layout.structures) {
      const matches = layout.colliders.filter(c => c.tag === def.tag);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ ...def.rect, kind: 'breakable', blocksMove: true, blocksSight: true });
      expect(def.approachOutside.length).toBeGreaterThanOrEqual(3);
      expect(def.approachInside.length).toBeGreaterThanOrEqual(2);
      for (const building of layout.buildings) {
        expect(pointInsideAABB(rectCenter(def.enclosure), building.footprint)).toBe(false);
      }
    }
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const busShell = collision.colliders.filter(c => c.tag?.startsWith('bus-shell-'));
    expect(busShell).toHaveLength(5);
    expect(busShell.every(c => c.kind === 'vehicle' && c.height === 3.2 && c.blocksSight && !isCrawlable(c))).toBe(true);
    const fences = layout.colliders.filter(c => c.tag?.startsWith('pen-fence-'));
    expect(fences).toHaveLength(5);
    expect(fences.every(c => c.kind === 'wall' && c.height === 2.2 && c.blocksMove && !c.blocksSight)).toBe(true);
  });

  it('keeps approaches walkable and opens every enclosure after disabling structures and rebuilding nav', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const nav = new NavigationGrid(collision);
    expect(nav.isWalkable(rectCenter(layout.startFollowerArea))).toBe(true);
    for (const c of layout.colliders.filter(c => c.blocksMove)) {
      expect(aabbToAABBDistance(layout.startFollowerArea, c)).toBeGreaterThanOrEqual(BALANCE.world.navAgentRadius);
    }
    for (const def of layout.structures) {
      for (const point of [...def.approachOutside, ...def.approachInside]) {
        expect(nav.isWalkable(point), `${def.tag} approach ${JSON.stringify(point)}`).toBe(true);
        expect(collision.isBlocked(point, BALANCE.world.navAgentRadius)).toBe(false);
      }
      expect(nav.isWalkable(rectCenter(def.enclosure))).toBe(true);
      expect(nav.findPath(layout.playerStart, rectCenter(def.enclosure)), def.tag).toBeNull();
    }
    expect(nav.findPath(layout.playerStart, rectCenter(layout.checkpoint.stagingArea))).not.toBeNull();
    for (const point of layout.checkpoint.gateApproachOutside) expect(nav.findPath(layout.playerStart, point)).not.toBeNull();
    for (const def of layout.structures) collision.setEnabled(collision.findByTag(def.tag)!.id, false);
    nav.rebuild();
    for (const def of layout.structures) {
      expect(nav.findPath(layout.playerStart, rectCenter(def.enclosure)), def.tag).not.toBeNull();
    }
  });

  it('places visible early civilians and bus, barricade soldiers, store residents and edge parking', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const bus = layout.structures[0];
    expect(Math.hypot(rectCenter(bus.rect).x - layout.playerStart.x, rectCenter(bus.rect).z - layout.playerStart.z)).toBeLessThan(45);
    expect(collision.segmentBlocked(layout.playerStart, rectCenter(bus.rect), { ignoreIds: [collision.findByTag(bus.tag)!.id] })).toBe(false);
    expect(layout.playerStartFacing).toBeCloseTo(Math.atan2(rectCenter(bus.rect).x - layout.playerStart.x, rectCenter(bus.rect).z - layout.playerStart.z));
    const street = layout.guards.filter(g => g.post === 'street');
    expect(street).toHaveLength(2);
    for (const g of street) {
      expect(g.role).toBe('civilian');
      expect(Math.hypot(g.pos.x - layout.playerStart.x, g.pos.z - layout.playerStart.z)).toBeLessThan(30);
      expect(collision.segmentBlocked(layout.playerStart, g.pos)).toBe(false);
      expect(g.homeArea).toEqual({ minX: -82, minZ: 41, maxX: -56, maxZ: 58 });
    }
    const barricade = layout.guards.filter(g => g.post === 'barricade');
    expect(barricade).toHaveLength(BALANCE.outposts.barricadeGuards);
    for (const g of barricade) {
      expect(g.role).toBe('soldier'); expect(g.facing).toBe(-Math.PI / 2); expect(g.waypoints).toEqual([g.pos]);
    }
    const store = layout.guards.filter(g => g.post === 'store');
    expect(store).toHaveLength(4);
    for (const g of store) {
      expect(g.role).toBe('civilian'); expect(g.shelter).toBe(3); expect(g.homeArea).toEqual(layout.structures[2].enclosure);
      expect(pointInsideAABB(g.pos, g.homeArea!)).toBe(true);
    }
    const lot = layout.spawnZones.find(z => z.name === 'parking-lot')!.rect;
    const parking = layout.markings.filter(m => m.kind === 'parkingBay' && m.rect.minZ > 54 && m.rect.maxZ < 76);
    expect(parking.length).toBeGreaterThanOrEqual(4);
    expect(parking.length).toBeLessThanOrEqual(6);
    for (const bay of parking) {
      expect(aabbToAABBDistance(bay.rect, lot)).toBeGreaterThan(0);
      expect(layout.props.some(p => p.kind === 'car' && p.blocking && pointInsideAABB(p.pos, bay.rect))).toBe(true);
    }
  });

  it('initializes deterministic, independent followers, held ambient, humans, structures and momentum', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const state = createInitialState(layout, collision, mulberry32(91));
    expect(state).toEqual(createInitialState(layout, collision, mulberry32(91)));
    const followers = state.zombies.filter(z => z.state === 'follower');
    const ambient = state.zombies.filter(z => z.state === 'ambient');
    expect(followers).toHaveLength(BALANCE.horde.startFollowers);
    expect(state.followerCount).toBe(followers.length);
    expect(ambient).toHaveLength(BALANCE.horde.initialAmbient);
    expect(state.stats).toEqual({ recruited: 0, conversions: 0, losses: 0, guardsKilled: 0, cascadeRecruits: 0, structuresDestroyed: 0 });
    expect(state.momentum).toEqual({ value: 0, idleTime: 0, tier: 'dormant', gainFlash: 0 });
    expect(new Set([state.leader.id, ...state.zombies.map(z => z.id), ...state.guards.map(g => g.id)]).size)
      .toBe(1 + state.zombies.length + state.guards.length);
    expect(state.nextEntityId).toBe(2 + state.zombies.length + state.guards.length);
    for (const z of followers) {
      expect(pointInsideAABB(z.pos, layout.startFollowerArea)).toBe(true);
      expect(collision.isBlocked(z.pos, 0.45)).toBe(false);
      expect(z).toMatchObject({ recruitGen: 0, pulseAt: -1, recruitFlash: 0, heldBy: 0, spawnZone: -1, anim: 'idle' });
      expect(z.pos).not.toBe(z.prevPos);
      for (const other of followers) if (other !== z) expect(Math.hypot(z.pos.x - other.pos.x, z.pos.z - other.pos.z)).toBeGreaterThanOrEqual(2 * z.radius);
    }
    for (const z of ambient) {
      const zone = layout.spawnZones[z.spawnZone];
      expect(z.heldBy).toBe(zone.heldBy ?? 0);
      expect(pointInsideAABB(z.pos, zone.rect)).toBe(true);
      expect(z).toMatchObject({ recruitGen: -1, pulseAt: -1, recruitFlash: 0 });
      expect(collision.isBlocked(z.pos, 0.45)).toBe(false);
    }
    for (const g of state.guards) {
      const civilian = g.role === 'civilian';
      expect(g.hp).toBe(civilian ? BALANCE.civilian.maxHp : BALANCE.guard.maxHp);
      expect(g.maxHp).toBe(g.hp);
      expect(g.radius).toBe(civilian ? BALANCE.civilian.radius : BALANCE.guard.radius);
      expect(g.homeArea).toEqual(layout.guards.find(spawn => spawn.pos.x === g.pos.x && spawn.pos.z === g.pos.z)!.homeArea ?? null);
    }
    for (const s of state.structures) {
      const def = layout.structures.find(d => d.id === s.id)!;
      expect(s).toMatchObject({ kind: def.kind, landmark: def.landmark, rect: def.rect, center: rectCenter(def.rect),
        hp: BALANCE.structures[s.kind].maxHp, maxHp: BALANCE.structures[s.kind].maxHp, destroyed: false, destroyedAt: null, hitFlash: 0 });
      expect(collision.colliders[s.colliderId].tag).toBe(def.tag);
      expect(s.rect).not.toBe(def.rect);
    }
    expect(state.structures).toHaveLength(4);
    collision.setEnabled(state.structures[0].colliderId, false);
    expect(() => createStructures(layout, collision)).toThrow('bus-door');
  });

  it('defaults legacy guard and zombie factory callers to checkpoint soldiers and unheld ambient/rising', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const guard = createGuard(1, { pos: layout.playerStart, facing: 0, tower: null, waypoints: [layout.playerStart] }, collision);
    expect(guard).toMatchObject({ role: 'soldier', post: 'checkpoint', homeArea: null, shelter: 0, hp: BALANCE.guard.maxHp, radius: BALANCE.guard.radius });
    for (const state of ['ambient', 'rising'] as const) {
      const zombie = createZombie(2, layout.playerStart, { state, variant: 0, spawnZone: -1, isConverted: false, rng: mulberry32(1) });
      expect(zombie).toMatchObject({ heldBy: 0, recruitGen: -1, pulseAt: -1, recruitFlash: 0 });
    }
  });
});
