// VP2-T010: per-chunk building LOD hysteresis + dressing cap helpers (pure).
import { describe, expect, it } from 'vitest';
import { LOD_HYSTERESIS, WorldLOD, capByTier, chunkLod, distanceToRect } from '../src/graphics/world/WorldLOD';

describe('chunkLod', () => {
  it('first decision has no hysteresis', () => {
    expect(chunkLod(undefined, 119, 120)).toBe(0);
    expect(chunkLod(undefined, 121, 120)).toBe(1);
  });
  it('switches to LOD1 only beyond distance + hysteresis and back only inside distance - hysteresis', () => {
    expect(chunkLod(0, 120 + LOD_HYSTERESIS - 0.1, 120)).toBe(0);
    expect(chunkLod(0, 120 + LOD_HYSTERESIS + 0.1, 120)).toBe(1);
    expect(chunkLod(1, 120 - LOD_HYSTERESIS + 0.1, 120)).toBe(1);
    expect(chunkLod(1, 120 - LOD_HYSTERESIS - 0.1, 120)).toBe(0);
  });
  it('does not flicker while the distance jitters inside the band', () => {
    let lod: 0 | 1 = 0;
    let flips = 0;
    for (let i = 0; i < 200; i++) {
      const d = 120 + Math.sin(i * 0.9) * (LOD_HYSTERESIS - 1);
      const next = chunkLod(lod, d, 120);
      if (next !== lod) flips++;
      lod = next;
    }
    expect(flips).toBe(0);
  });
});

describe('WorldLOD', () => {
  it('limits swaps per update and swaps the nearest chunk first', () => {
    const lod = new WorldLOD(60, 2);
    const dist = new Map<number, number>();
    for (let id = 0; id < 5; id++) { dist.set(id, 10); lod.admit(id, 10); }
    for (let id = 0; id < 5; id++) dist.set(id, 200 + id);
    const first = lod.update(id => dist.get(id)!);
    expect(first).toEqual([0, 1]);
    const second = lod.update(id => dist.get(id)!);
    expect(second).toEqual([2, 3]);
    expect(lod.update(id => dist.get(id)!)).toEqual([4]);
    expect(lod.update(id => dist.get(id)!)).toEqual([]);
    expect(lod.get(4)).toBe(1);
  });
  it('forget drops a chunk', () => {
    const lod = new WorldLOD(60);
    lod.admit(3, 500);
    expect(lod.get(3)).toBe(1);
    lod.forget(3);
    expect(lod.get(3)).toBeUndefined();
  });
});

describe('distanceToRect', () => {
  it('is zero inside and euclidean outside', () => {
    const r = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 };
    expect(distanceToRect(5, 5, r)).toBe(0);
    expect(distanceToRect(13, 14, r)).toBe(5);
    expect(distanceToRect(-3, 5, r)).toBe(3);
  });
});

describe('capByTier', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ i, tier: i % 3 }));
  it('filters by tier and keeps input order', () => {
    const t0 = capByTier(items, 0, 1000);
    expect(t0.every(x => x.tier === 0)).toBe(true);
    expect(t0.length).toBe(100);
    expect(t0.map(x => x.i)).toEqual([...t0.map(x => x.i)].sort((a, b) => a - b));
  });
  it('caps deterministically, dropping higher tiers first', () => {
    const a = capByTier(items, 2, 150);
    const b = capByTier(items, 2, 150);
    expect(a.length).toBe(150);
    expect(a).toEqual(b);
    expect(a.filter(x => x.tier === 0).length).toBe(100);
    expect(a.filter(x => x.tier === 2).length).toBe(0);
  });
});
