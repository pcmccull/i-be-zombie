// [pure] District lookup and stable row-major chunk ids (northwest = 0).
import { BALANCE } from '../config/balance';
import type { AABB, DistrictId, DistrictLayout, StrongholdDef, Vec2 } from '../core/types';
import { clamp } from '../utils/math';

export function getDistrictAt(layout: DistrictLayout, p: Vec2): DistrictId {
  const b = layout.bounds, x = clamp(p.x, b.minX, b.maxX), z = clamp(p.z, b.minZ, b.maxZ);
  const district = layout.districts.find(d => x >= d.rect.minX && z >= d.rect.minZ &&
    (x < d.rect.maxX || x === b.maxX && d.rect.maxX === b.maxX) &&
    (z < d.rect.maxZ || z === b.maxZ && d.rect.maxZ === b.maxZ));
  if (!district) throw new Error('Layout districts do not cover world bounds');
  return district.id;
}

export function strongholdAt(layout: DistrictLayout, p: Vec2): StrongholdDef | undefined {
  return layout.strongholds.find(s => p.x >= s.bounds.minX && p.x <= s.bounds.maxX &&
    p.z >= s.bounds.minZ && p.z <= s.bounds.maxZ);
}
export function chunkCols(layout: DistrictLayout): number {
  return Math.ceil((layout.bounds.maxX - layout.bounds.minX) / BALANCE.chunks.size);
}
export function chunkRows(layout: DistrictLayout): number {
  return Math.ceil((layout.bounds.maxZ - layout.bounds.minZ) / BALANCE.chunks.size);
}
export function chunkIdAt(layout: DistrictLayout, p: Vec2): number {
  const col = clamp(Math.floor((p.x - layout.bounds.minX) / BALANCE.chunks.size), 0, chunkCols(layout) - 1);
  const row = clamp(Math.floor((p.z - layout.bounds.minZ) / BALANCE.chunks.size), 0, chunkRows(layout) - 1);
  return row * chunkCols(layout) + col;
}
export function chunkRect(layout: DistrictLayout, id: number,
  out: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }): AABB {
  const cols = chunkCols(layout);
  if (!Number.isInteger(id) || id < 0 || id >= cols * chunkRows(layout)) throw new RangeError('Invalid chunk id');
  out.minX = layout.bounds.minX + id % cols * BALANCE.chunks.size;
  out.minZ = layout.bounds.minZ + Math.floor(id / cols) * BALANCE.chunks.size;
  out.maxX = Math.min(layout.bounds.maxX, out.minX + BALANCE.chunks.size);
  out.maxZ = Math.min(layout.bounds.maxZ, out.minZ + BALANCE.chunks.size);
  return out;
}
function distanceSquared(p: Vec2, b: AABB): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
  return dx * dx + dz * dz;
}
/** Circle/rectangle intersection, including tangent chunks; clears and reuses out. */
export function chunksInRadius(layout: DistrictLayout, p: Vec2, r: number, out: number[]): number[] {
  out.length = 0;
  if (r < 0 || Number.isNaN(r)) throw new RangeError('Invalid chunk radius');
  const bounds = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  for (let id = 0; id < chunkCols(layout) * chunkRows(layout); id++) {
    if (distanceSquared(p, chunkRect(layout, id, bounds)) <= r * r) out.push(id);
  }
  return out;
}

/**
 * Radius hysteresis plus T002's twelve-chunk render budget. When the radii cover
 * more than twelve chunks, keep the nearest twelve (containing chunk first).
 * Retained chunks may live between loadRadius and unloadRadius until displaced.
 */
export class ChunkStreamer {
  private readonly active = new Set<number>();
  get loaded(): ReadonlySet<number> { return this.active; }
  constructor(private readonly layout: DistrictLayout) {}

  update(p: Vec2): { load: number[]; unload: number[] } {
    const candidates = chunksInRadius(this.layout, p, BALANCE.chunks.loadRadius, []);
    const box = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
    for (const id of this.active) {
      if (!candidates.includes(id) && distanceSquared(p, chunkRect(this.layout, id, box)) <= BALANCE.chunks.unloadRadius ** 2) {
        candidates.push(id);
      }
    }
    const containing = chunkIdAt(this.layout, p);
    const score = (id: number): number => {
      const b = chunkRect(this.layout, id, box);
      return ((b.minX + b.maxX) / 2 - p.x) ** 2 + ((b.minZ + b.maxZ) / 2 - p.z) ** 2;
    };
    candidates.sort((a, b) => a === b ? 0 : a === containing ? -1 : b === containing ? 1 : score(a) - score(b) || a - b);
    const desired = new Set(candidates.slice(0, 12));
    const load: number[] = [], unload: number[] = [];
    for (const id of this.active) if (!desired.has(id)) { this.active.delete(id); unload.push(id); }
    for (const id of desired) if (!this.active.has(id)) { this.active.add(id); load.push(id); }
    return { load, unload };
  }
}
