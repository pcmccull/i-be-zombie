// [pure] todos #10b: corner shops you can break into for healing drinks.
// One small walk-in shop per district (BALANCE.shops.perDistrict), placed beside a sidewalk on free ground with its
// breakable glass door facing the street. Each is a normal enclosure (structure kind 'shopDoor', landmark 'shop'),
// so picking, attack orders, damage and nav rebuilds all reuse the structure path. Runs after every other builder,
// so ids/colliders/props of the rest of the world are unchanged.
import { BALANCE } from '../../config/balance';
import type { AABB, StructureDef, Vec2 } from '../../core/types';
import { enclosure, type WorldDraft } from './common';

/** First shop StructureDef id (shops are 200, 201, ...). */
export const SHOP_ID_BASE = 200;

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
function grow(r: AABB, by: number): AABB {
  return { minX: r.minX - by, minZ: r.minZ - by, maxX: r.maxX + by, maxZ: r.maxZ + by };
}
function contains(outer: AABB, inner: AABB): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;
}
function near(p: Vec2, r: AABB, pad: number): boolean {
  return p.x > r.minX - pad && p.x < r.maxX + pad && p.z > r.minZ - pad && p.z < r.maxZ + pad;
}

interface Candidate { rect: AABB; side: 'south' | 'west'; score: number }

function free(w: WorldDraft, r: AABB): boolean {
  const pad = grow(r, 2.5);
  if (!contains(grow(w.playArea, -8), r)) return false;
  for (const c of w.colliders) if (overlaps(c, pad)) return false;
  for (const g of w.ground) {
    if ((g.kind === 'road' || g.kind === 'sidewalk' || g.kind === 'compound') && overlaps(g.rect, grow(r, 0.6))) return false;
  }
  for (const s of w.structures) if (overlaps(grow(s.enclosure, 6), r)) return false;
  for (const s of w.strongholds) if (overlaps(grow(s.bounds, 8), r)) return false;
  for (const z of w.spawnZones) if (overlaps(grow(z.rect, 2), r)) return false;
  for (const p of w.props) if (near(p.pos, r, 1.5)) return false;
  for (const g of w.guards) {
    if (near(g.pos, r, 2)) return false;
    for (const wp of g.waypoints) if (near(wp, r, 1.5)) return false;
  }
  for (const n of w.nests) if (near(n.pos, r, 12)) return false;
  if (near(w.playerStart, r, 14) || overlaps(grow(w.startFollowerArea, 6), r)) return false;
  return true;
}

/** Shops sit just behind a sidewalk: north of an east-west strip (door south) or east of a north-south strip (door west). */
function candidates(w: WorldDraft, cell: AABB): Candidate[] {
  const [sx, sz] = BALANCE.shops.size;
  const out: Candidate[] = [];
  const mid = { x: (cell.minX + cell.maxX) / 2, z: (cell.minZ + cell.maxZ) / 2 };
  for (const g of w.ground) {
    if (g.kind !== 'sidewalk' || !overlaps(g.rect, cell)) continue;
    const s = g.rect, alongX = s.maxX - s.minX >= s.maxZ - s.minZ;
    if (alongX) {
      for (let x = Math.max(s.minX, cell.minX) + 6; x + sx < Math.min(s.maxX, cell.maxX) - 6; x += 6) {
        const rect = { minX: x, maxX: x + sx, minZ: s.minZ - 1.2 - sz, maxZ: s.minZ - 1.2 };
        out.push({ rect, side: 'south', score: Math.hypot(x + sx / 2 - mid.x, rect.minZ - mid.z) });
      }
    } else {
      for (let z = Math.max(s.minZ, cell.minZ) + 6; z + sz < Math.min(s.maxZ, cell.maxZ) - 6; z += 6) {
        const rect = { minX: s.maxX + 1.2, maxX: s.maxX + 1.2 + sx, minZ: z, maxZ: z + sz };
        out.push({ rect, side: 'west', score: Math.hypot(rect.minX - mid.x, z + sz / 2 - mid.z) });
      }
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

export function placeShops(w: WorldDraft): StructureDef[] {
  const placed: StructureDef[] = [];
  let id = SHOP_ID_BASE;
  for (const d of w.districts) {
    const cell = d.rect;
    let count = 0;
    for (const c of candidates(w, cell)) {
      if (count >= BALANCE.shops.perDistrict) break;
      if (!contains(cell, grow(c.rect, 3)) || !free(w, c.rect)) continue;
      const r = c.rect, half = BALANCE.shops.doorWidth / 2;
      const gap: [number, number] = c.side === 'south'
        ? [(r.minX + r.maxX) / 2 - half, (r.minX + r.maxX) / 2 + half]
        : [(r.minZ + r.maxZ) / 2 - half, (r.minZ + r.maxZ) / 2 + half];
      placed.push(enclosure(w, id++, 'shopDoor', 'shop', r, c.side, gap, BALANCE.shops.wallHeight, false));
      count++;
    }
  }
  return placed;
}

/** Where a shop's drinks stand: along the back wall, opposite the door. */
export function shopDrinkSpots(def: StructureDef, count: number): Vec2[] {
  const e = def.enclosure, spots: Vec2[] = [];
  const southDoor = Math.abs(def.facing) < 1e-6;
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    spots.push(southDoor
      ? { x: e.minX + (e.maxX - e.minX) * t, z: e.minZ + 1 }
      : { x: e.maxX - 1, z: e.minZ + (e.maxZ - e.minZ) * t });
  }
  return spots;
}
