// [pure] Per-chunk building LOD selection + dressing thinning helpers used by CityDistrict (VP2-T010).
// No `three` import: runs under Vitest in Node.

/** Hysteresis band (m): a chunk switches to LOD1 beyond `lod1Distance + H` and back to LOD0 inside `lod1Distance - H`. */
export const LOD_HYSTERESIS = 10;

export interface RectLike { minX: number; minZ: number; maxX: number; maxZ: number }

/** Distance (m) from a point to the nearest edge of a rect (0 inside). */
export function distanceToRect(x: number, z: number, r: RectLike): number {
  return Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
}

/** LOD for one chunk given its previous LOD (undefined = first decision, no hysteresis). */
export function chunkLod(prev: 0 | 1 | undefined, dist: number, lod1Distance: number, hysteresis = LOD_HYSTERESIS): 0 | 1 {
  if (prev === undefined) return dist > lod1Distance ? 1 : 0;
  if (prev === 0) return dist > lod1Distance + hysteresis ? 1 : 0;
  return dist < lod1Distance - hysteresis ? 0 : 1;
}

/**
 * Tracks the building LOD of every loaded chunk. `update` returns only the chunks whose LOD changed this call, at most
 * `maxSwapsPerUpdate` of them (nearest first) so a fast camera never swaps every chunk on the same frame.
 */
export class WorldLOD {
  private readonly current = new Map<number, 0 | 1>();
  private lod1Distance: number;

  constructor(lod1Distance: number, private readonly maxSwapsPerUpdate = 2) {
    this.lod1Distance = lod1Distance;
  }

  setLod1Distance(d: number): void { this.lod1Distance = d; }

  get(chunkId: number): 0 | 1 | undefined { return this.current.get(chunkId); }

  /** First decision for a freshly loaded chunk (no hysteresis, never counted as a swap). */
  admit(chunkId: number, dist: number): 0 | 1 {
    const lod = chunkLod(undefined, dist, this.lod1Distance);
    this.current.set(chunkId, lod);
    return lod;
  }

  forget(chunkId: number): void { this.current.delete(chunkId); }

  update(distanceOf: (chunkId: number) => number, out: number[] = []): number[] {
    out.length = 0;
    const pending: { id: number; lod: 0 | 1; dist: number }[] = [];
    for (const [id, prev] of this.current) {
      const dist = distanceOf(id);
      const lod = chunkLod(prev, dist, this.lod1Distance);
      if (lod !== prev) pending.push({ id, lod, dist });
    }
    pending.sort((a, b) => a.dist - b.dist || a.id - b.id);
    for (let i = 0; i < pending.length && i < this.maxSwapsPerUpdate; i++) {
      this.current.set(pending[i].id, pending[i].lod);
      out.push(pending[i].id);
    }
    return out;
  }
}

/**
 * Deterministic cap: keeps at most `max` items, dropping the highest `tier` first, thinning inside a tier by a stable
 * index hash (never by kind, so no kind disappears wholesale). Result keeps the input order.
 */
export function capByTier<T extends { tier: number }>(items: readonly T[], maxTier: number, max: number): T[] {
  const kept: { it: T; i: number }[] = [];
  for (let i = 0; i < items.length; i++) if (items[i].tier <= maxTier) kept.push({ it: items[i], i });
  if (kept.length <= max) return kept.map(k => k.it);
  const h = (i: number): number => ((Math.imul(i + 1, 2654435761) >>> 0) % 100003) / 100003;
  const ranked = kept.slice().sort((a, b) => a.it.tier - b.it.tier || h(a.i) - h(b.i) || a.i - b.i).slice(0, Math.max(0, max));
  ranked.sort((a, b) => a.i - b.i);
  return ranked.map(k => k.it);
}
