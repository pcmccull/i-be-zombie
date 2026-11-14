import { describe, expect, it } from 'vitest';
import type { AABB, ColliderDef, Vec2 } from '../src/core/types';
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

  it('(a) has exactly 8 guards and exactly 2 tower guards (W and E)', () => {
    expect(layout.guards).toHaveLength(8);
    const towerGuards = layout.guards.filter((g) => g.tower !== null);
    expect(towerGuards).toHaveLength(2);
    expect(towerGuards.map((g) => g.tower).sort()).toEqual(['E', 'W']);
  });

  it('(b) has spawn zone counts summing to exactly 60', () => {
    expect(layout.spawnZones.length).toBeGreaterThanOrEqual(5);
    const total = layout.spawnZones.reduce((sum, z) => sum + z.count, 0);
    expect(total).toBe(60);
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

    // Every spawn zone center is reachable
    for (const zone of layout.spawnZones) {
      const center = rectCenter(zone.rect);
      expect(gridIntact.isReachable(center)).toBe(true);
    }

    // North service alley (around x = -5, z = -60) is reachable
    expect(gridIntact.isReachable({ x: -5, z: -60 })).toBe(true);

    // Every gateApproachOutside point is reachable while gate is intact
    for (const pt of layout.checkpoint.gateApproachOutside) {
      expect(gridIntact.isReachable(pt)).toBe(true);
    }

    // Separate ground guards into inside vs outside compound
    const groundGuards = layout.guards.filter((g) => g.tower === null);
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
});
