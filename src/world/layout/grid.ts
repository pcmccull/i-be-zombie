// [pure] Shared expansion geometry. The original streets/builders keep their authored coordinates.
import { BALANCE } from '../../config/balance';
import type { AABB, Vec2 } from '../../core/types';
import { rect } from './common';

export const ORIGINAL_DISTRICTS: ReadonlySet<string> = new Set(['suburbs', 'police', 'shopping', 'industrial']);

/** Districts include the outer boundary band; generated content uses cellPlayRect instead. */
export function districtCellRect(col: number, row: number): AABB {
  const x = BALANCE.openWorld.gridX, z = BALANCE.openWorld.gridZ;
  return rect(x[col], z[row], x[col + 1], z[row + 1]);
}

export function cellPlayRect(col: number, row: number): AABB {
  const r = districtCellRect(col, row), p = BALANCE.openWorld.play;
  return rect(Math.max(r.minX, p.minX), Math.max(r.minZ, p.minZ), Math.min(r.maxX, p.maxX), Math.min(r.maxZ, p.maxZ));
}

/** Stable per-id streams: expansion never advances the original builders' shared RNG. */
export function districtSeed(seed: number, id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (seed ^ hash) >>> 0;
}

export interface RoadSegment { axis: 'x' | 'z'; at: number; lo: number; hi: number; half: number }

/** No new carriageway or sidewalk intrudes into the original 400 x 320 m rectangle. */
export function expansionRoads(): RoadSegment[] {
  const p = BALANCE.openWorld.play;
  const roads: RoadSegment[] = [];
  for (const at of [-310, -210, 210, 310]) roads.push({ axis: 'x', at, lo: p.minZ, hi: p.maxZ, half: 5 });
  for (const at of [-100, 0, 100]) roads.push({ axis: 'x', at, lo: p.minZ, hi: -160, half: at === 0 ? 7 : 5 });
  for (const at of [-400, -330, -240, -170]) roads.push({ axis: 'z', at, lo: p.minX, hi: p.maxX, half: 5 });
  for (const at of [-80, 0, 80]) {
    roads.push({ axis: 'z', at, lo: p.minX, hi: -200, half: at === 0 ? 7 : 5 },
      { axis: 'z', at, lo: 200, hi: p.maxX, half: at === 0 ? 7 : 5 });
  }
  return roads;
}

/** Three independent crossing corridors on each edge (far enough apart for a whole horde). */
export function seamCrossings(a: AABB, b: AABB): { a: Vec2; b: Vec2 }[] {
  const vertical = a.maxX === b.minX || b.maxX === a.minX;
  if (vertical) {
    const x = a.maxX === b.minX ? a.maxX : b.maxX;
    const lo = Math.max(a.minZ, b.minZ, BALANCE.openWorld.play.minZ);
    const hi = Math.min(a.maxZ, b.maxZ, BALANCE.openWorld.play.maxZ);
    if (hi <= lo) return [];
    return [0.2, 0.5, 0.8].map(t => ({ a: { x: x - 4, z: lo + (hi - lo) * t }, b: { x: x + 4, z: lo + (hi - lo) * t } }));
  }
  if (a.maxZ !== b.minZ && b.maxZ !== a.minZ) return [];
  const z = a.maxZ === b.minZ ? a.maxZ : b.maxZ;
  const lo = Math.max(a.minX, b.minX, BALANCE.openWorld.play.minX);
  const hi = Math.min(a.maxX, b.maxX, BALANCE.openWorld.play.maxX);
  if (hi <= lo) return [];
  return [0.2, 0.5, 0.8].map(t => ({ a: { x: lo + (hi - lo) * t, z: z - 4 }, b: { x: lo + (hi - lo) * t, z: z + 4 } }));
}

export function overlaps(a: AABB, b: AABB, margin = 0): boolean {
  return a.minX < b.maxX + margin && a.maxX > b.minX - margin && a.minZ < b.maxZ + margin && a.maxZ > b.minZ - margin;
}
