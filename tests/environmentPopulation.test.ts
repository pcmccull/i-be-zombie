// VP2-T007: render-only environment dressing placement (src/graphics/world/environmentPopulation.ts).
// Runs over every chunk of the real open world; yields to the event loop so vitest's RPC never times out.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { DISTRICT_STYLES } from '../src/content/districtStyles';
import type { AABB, DistrictLayout } from '../src/core/types';
import { FLAT_KINDS, type DressingKind } from '../src/graphics/environment/environmentKinds';
import {
  LOW_KINDS, MAX_ITEMS_PER_CHUNK, WALL_MOUNTED_KINDS, dressingHalfExtents, populateChunk, populationStats,
  type DressingInstance,
} from '../src/graphics/world/environmentPopulation';
import { buildTrafficNetwork } from '../src/systems/trafficControl';
import { START_BEACH, buildDistrictLayout } from '../src/world/districtLayout';
import { chunkCols, chunkRect, chunkRows, getDistrictAt } from '../src/world/worldQueries';

vi.setConfig({ testTimeout: 60000 });
const yieldLoop = (): Promise<void> => new Promise(r => setTimeout(r, 0));
const inRect = (x: number, z: number, r: AABB): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const distRect = (x: number, z: number, r: AABB): number =>
  Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

const layout = buildDistrictLayout();
const chunkTotal = chunkCols(layout) * chunkRows(layout);
const byChunk: DressingInstance[][] = [];
const times: number[] = [];

beforeAll(async () => {
  for (let id = 0; id < chunkTotal; id++) {
    const t0 = performance.now();
    byChunk.push(populateChunk(layout, id));
    times.push(performance.now() - t0);
    if (id % 6 === 5) await yieldLoop();
  }
}, 60000);

const eachItem = (fn: (it: DressingInstance, chunk: number) => void): void => {
  byChunk.forEach((items, chunk) => { for (const it of items) fn(it, chunk); });
};

describe('populateChunk', () => {
  it('covers all 99 chunks and reports timing', () => {
    expect(chunkTotal).toBe(99);
    expect(byChunk.length).toBe(99);
    const sorted = [...times].sort((a, b) => a - b), total = byChunk.reduce((n, c) => n + c.length, 0);
    const kinds: Record<string, number> = {};
    eachItem(it => { kinds[it.kind] = (kinds[it.kind] ?? 0) + 1; });
    console.log(`[VP2-T007] chunks=${chunkTotal} items=${total} cold(first)=${times[0].toFixed(1)}ms ` +
      `min/median/max=${sorted[0].toFixed(2)}/${sorted[sorted.length >> 1].toFixed(2)}/${sorted[sorted.length - 1].toFixed(2)}ms`);
    console.log('[VP2-T007] kinds', JSON.stringify(kinds));
    expect(total).toBeGreaterThan(5000);
    // Warm calls (index cached) must be fast: a dense chunk well under the 15 ms budget.
    const warm = performance.now();
    const dense = byChunk.reduce((best, c, i) => c.length > byChunk[best].length ? i : best, 0);
    populateChunk(layout, dense);
    expect(performance.now() - warm).toBeLessThan(15);
  });

  it('is deterministic: same chunk twice, fresh layout, any call order', async () => {
    const a = populateChunk(layout, 14), b = populateChunk(layout, 14);
    expect(a.length).toBeGreaterThan(50);
    expect(b).toEqual(a);
    const fresh = buildDistrictLayout();
    for (const id of [60, 14, 3, 98]) {
      expect(populateChunk(fresh, id)).toEqual(byChunk[id]);
      await yieldLoop();
    }
    expect(JSON.stringify(populateChunk(layout, 15))).not.toBe(JSON.stringify(a));
  });

  it('keeps every item inside its chunk and the play area, <= 900 per chunk, sorted by (kind, x, z)', () => {
    byChunk.forEach((items, id) => {
      const rect = chunkRect(layout, id);
      expect(items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_CHUNK);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!(it.x >= rect.minX && it.x < rect.maxX && it.z >= rect.minZ && it.z < rect.maxZ)) throw new Error('outside chunk');
        if (!inRect(it.x, it.z, layout.playArea)) throw new Error('outside playArea');
        if (!Number.isInteger(it.variant) || ![0, 1, 2].includes(it.tier)) throw new Error('bad variant/tier');
        if (i > 0) {
          const p = items[i - 1];
          const ord = p.kind < it.kind ? -1 : p.kind > it.kind ? 1 : Math.sign(p.x - it.x) || Math.sign(p.z - it.z);
          if (ord > 0) throw new Error('not sorted by (kind, x, z)');
        }
      }
    });
  });

  it('never intersects a collider footprint (wall-mounted kinds may hug a building within 0.8 m)', () => {
    const buildings = layout.buildings.map(b => b.footprint);
    eachItem(it => {
      const { hx, hz } = dressingHalfExtents(it);
      for (const c of layout.colliders) {
        if (WALL_MOUNTED_KINDS.has(it.kind)) {
          if (it.x > c.minX && it.x < c.maxX && it.z > c.minZ && it.z < c.maxZ) throw new Error(`${it.kind} centre inside a collider`);
        } else {
          const hit = it.x - hx < c.maxX && it.x + hx > c.minX && it.z - hz < c.maxZ && it.z + hz > c.minZ;
          if (hit) throw new Error(`${it.kind} at ${it.x.toFixed(2)},${it.z.toFixed(2)} overlaps ${c.kind} collider`);
        }
      }
      if (WALL_MOUNTED_KINDS.has(it.kind)) expect(buildings.some(f => distRect(it.x, it.z, f) <= 0.8)).toBe(true);
    });
  });

  it('puts items taller than 0.5 m only in the sidewalk strip, wall band or a clear interior', () => {
    const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
    const sidewalks = layout.ground.filter(g => g.kind === 'sidewalk').map(g => g.rect);
    const interiors = layout.ground.filter(g => ['park', 'plaza', 'court', 'lot'].includes(g.kind)).map(g => g.rect);
    for (const b of layout.buildings) if (b.lot) interiors.push(b.lot);
    const spawn = layout.spawnZones.map(z => z.rect), footprints = layout.buildings.map(b => b.footprint);
    const nestClear = BALANCE.nest.claimRadius + 1.5;
    let tall = 0;
    eachItem(it => {
      if (LOW_KINDS.has(it.kind)) return;
      tall++;
      const strip = sidewalks.some(s => inRect(it.x, it.z, s)) && (() => {
        const d = Math.min(...roads.map(r => distRect(it.x, it.z, r)));
        return d > 0 && d <= 1.2;
      })();
      const band = footprints.some(f => distRect(it.x, it.z, f) <= 0.8);
      const interior = interiors.some(r => inRect(it.x, it.z, r)) && spawn.every(z => distRect(it.x, it.z, z) >= 1.5) &&
        layout.nests.every(n => Math.hypot(it.x - n.pos.x, it.z - n.pos.z) >= nestClear);
      if (!(strip || band || interior)) throw new Error(`${it.kind} at ${it.x.toFixed(2)},${it.z.toFixed(2)} is outside every tall-item zone`);
    });
    expect(tall).toBeGreaterThan(1000);
  });

  it('keeps road surfaces and traffic lanes for FLAT kinds only', () => {
    const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
    const lanes = buildTrafficNetwork(layout).lanes;
    let flatOnRoad = 0;
    eachItem(it => {
      const onRoad = roads.some(r => inRect(it.x, it.z, r));
      if (FLAT_KINDS.has(it.kind)) { if (onRoad) flatOnRoad++; return; }
      if (onRoad) throw new Error(`${it.kind} stands on a road surface`);
      for (const l of lanes) if (segDist(it.x, it.z, l.from.x, l.from.z, l.to.x, l.to.z) < 1.5) {
        throw new Error(`${it.kind} at ${it.x.toFixed(2)},${it.z.toFixed(2)} stands on a traffic lane`);
      }
    });
    expect(flatOnRoad).toBeGreaterThan(100); // manholes, patches, hatching, islands, drains
  });

  it('gives every district its style palms and nothing outside the style list', () => {
    const palmKinds = new Set<DressingKind>(['palmCoconut', 'palmRoyal', 'palmFan', 'palmCluster']);
    const perDistrict = new Map<string, Set<string>>();
    eachItem(it => {
      if (!palmKinds.has(it.kind)) return;
      const id = getDistrictAt(layout, { x: it.x, z: it.z });
      expect(DISTRICT_STYLES[id].palms).toContain(it.kind);
      if (!perDistrict.has(id)) perDistrict.set(id, new Set());
      perDistrict.get(id)!.add(it.kind);
    });
    for (const d of layout.districts) {
      expect(perDistrict.get(d.id)?.size ?? 0, `palms in ${d.id}`).toBeGreaterThan(0);
    }
  });

  it('lays curbs along the road side of sidewalks in every chunk that has a real run of sidewalk', () => {
    const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
    let checked = 0;
    byChunk.forEach((items, id) => {
      const rect = chunkRect(layout, id);
      let run = 0;
      for (const g of layout.ground) {
        if (g.kind !== 'sidewalk') continue;
        const s = g.rect;
        if (!roads.some(r => Math.abs(r.maxX - s.minX) < 0.3 || Math.abs(r.minX - s.maxX) < 0.3 ||
          Math.abs(r.maxZ - s.minZ) < 0.3 || Math.abs(r.minZ - s.maxZ) < 0.3)) continue;
        const ox = Math.min(s.maxX, rect.maxX, layout.playArea.maxX) - Math.max(s.minX, rect.minX, layout.playArea.minX);
        const oz = Math.min(s.maxZ, rect.maxZ, layout.playArea.maxZ) - Math.max(s.minZ, rect.minZ, layout.playArea.minZ);
        if (ox > 0 && oz > 0) run = Math.max(run, Math.max(ox, oz));
      }
      if (run >= 40) { checked++; expect(items.filter(i => i.kind === 'curb').length, `curbs in chunk ${id}`).toBeGreaterThan(0); }
    });
    expect(checked).toBeGreaterThan(20);
  });

  it('keeps START_BEACH, the start-to-nest line, nest claim circles and guard waypoints clear', () => {
    const start = layout.playerStart, nest = layout.nests.find(n => n.claim)!;
    eachItem(it => {
      if (inRect(it.x, it.z, START_BEACH)) throw new Error(`${it.kind} on START_BEACH`);
      if (segDist(it.x, it.z, start.x, start.z, nest.pos.x, nest.pos.z) < 2) throw new Error(`${it.kind} on the start line`);
      for (const n of layout.nests) {
        if (Math.hypot(it.x - n.pos.x, it.z - n.pos.z) <= BALANCE.nest.claimRadius + 1) throw new Error(`${it.kind} inside a nest claim circle`);
      }
    });
    const pts = layout.guards.flatMap(g => [g.pos, ...g.waypoints]);
    eachItem(it => {
      for (const p of pts) if (Math.hypot(it.x - p.x, it.z - p.z) < 1.2) throw new Error(`${it.kind} within 1.2 m of a guard waypoint`);
    });
  });

  it('keeps tier 0 a complete street: every present kind has a tier-0 member', () => {
    byChunk.forEach(items => {
      const kinds = new Set(items.map(i => i.kind)), t0 = new Set(items.filter(i => i.tier === 0).map(i => i.kind));
      for (const k of kinds) expect(t0.has(k)).toBe(true);
    });
  });

  it('populationStats is consistent with the item list', () => {
    const items = byChunk[14];
    const st = populationStats(items);
    expect(st.total).toBe(items.length);
    expect(Object.values(st.byKind).reduce((a, b) => a + b, 0)).toBe(items.length);
    expect(st.byTier[0] + st.byTier[1] + st.byTier[2]).toBe(items.length);
    for (const [k, n] of Object.entries(st.byKind)) expect(items.filter(i => i.kind === k).length).toBe(n);
    expect(populationStats([])).toEqual({ total: 0, byKind: {}, byTier: [0, 0, 0] });
  });

  it('places restaurant patios and basketball hoops from layout data when present', () => {
    // Clone with a synthetic restaurant archetype + forecourt lot on a real storefront, and a court inside each big park.
    const base = layout.buildings.findIndex(b => b.style === 'storefront');
    const f = layout.buildings[base].footprint;
    const parks = layout.ground.filter(g => g.kind === 'park' && g.rect.maxX - g.rect.minX > 40 && g.rect.maxZ - g.rect.minZ > 30);
    const courts = parks.map(p => ({ kind: 'court' as const, rect: {
      minX: (p.rect.minX + p.rect.maxX) / 2 - 8, maxX: (p.rect.minX + p.rect.maxX) / 2 + 8,
      minZ: (p.rect.minZ + p.rect.maxZ) / 2 - 5, maxZ: (p.rect.minZ + p.rect.maxZ) / 2 + 5 } }));
    const variant: DistrictLayout = {
      ...layout,
      buildings: layout.buildings.map((b, i) => i === base
        ? { ...b, archetype: 'restaurant', frontage: 'south', lot: { minX: f.minX, maxX: f.maxX, minZ: f.maxZ, maxZ: f.maxZ + 6 } } : b),
      ground: [...layout.ground, ...courts],
    };
    let tables = 0, hoops = 0, umbrellas = 0;
    for (let id = 0; id < chunkTotal; id++) {
      for (const it of populateChunk(variant, id)) {
        if (it.kind === 'patioTable') tables++;
        if (it.kind === 'patioUmbrella') umbrellas++;
        if (it.kind === 'basketballHoop') hoops++;
      }
    }
    const baseTables = byChunk.flat().filter(i => i.kind === 'patioTable').length;
    expect(tables).toBeGreaterThan(baseTables);
    expect(hoops).toBeGreaterThanOrEqual(2);
    expect(hoops % 2).toBe(0);
    expect(umbrellas).toBeGreaterThanOrEqual(0);
  });
});
