// [pure] todos #10a: street spawns live on the sidewalks, never on the carriageway.
// Runs once at the end of buildDistrictLayout (open world only): free ambient spawn zones that sit on a road are moved
// onto the adjacent sidewalk strip, district respawn points follow them, and street civilians (spawn + waypoints)
// step off the road. Held zones (inside enclosures) and armed patrols are untouched.
import { BALANCE } from '../../config/balance';
import type { AABB, ColliderDef, Vec2 } from '../../core/types';
import type { WorldDraft } from './common';

export function insideRect(r: AABB, p: Vec2, pad = 0): boolean {
  return p.x > r.minX - pad && p.x < r.maxX + pad && p.z > r.minZ - pad && p.z < r.maxZ + pad;
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/** Road (carriageway) patches of a layout. */
export function roadRects(w: Pick<WorldDraft, 'ground'>): AABB[] {
  return w.ground.filter(g => g.kind === 'road').map(g => g.rect);
}

export function isOnRoad(roads: readonly AABB[], p: Vec2, pad = 0): boolean {
  for (const r of roads) if (insideRect(r, p, pad)) return true;
  return false;
}

function circleBlocked(colliders: readonly ColliderDef[], p: Vec2, radius: number): boolean {
  for (const c of colliders) {
    if (!c.blocksMove) continue;
    const dx = Math.max(c.minX - p.x, 0, p.x - c.maxX), dz = Math.max(c.minZ - p.z, 0, p.z - c.maxZ);
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

/**
 * Nearest sidewalk point for a point on a road: step across the road to the middle of the strip beside it (the nearer
 * side first). Intersections need a second step across the crossing road. Returns the input unchanged if it is not on
 * a road or no clear sidewalk point exists.
 */
export function toSidewalk(w: Pick<WorldDraft, 'ground' | 'colliders'>, p: Vec2, radius = 0.45): Vec2 {
  const roads = roadRects(w);
  const sidewalks = w.ground.filter(g => g.kind === 'sidewalk').map(g => g.rect);
  const good = (q: Vec2) => !isOnRoad(roads, q, radius) && sidewalks.some(s => insideRect(s, q)) &&
    !circleBlocked(w.colliders, q, radius);
  let frontier: Vec2[] = [p];
  for (let pass = 0; pass < 2; pass++) {
    const next: Vec2[] = [];
    for (const q of frontier) {
      const road = roads.find(r => insideRect(r, q, radius));
      if (!road) { if (good(q)) return { ...q }; continue; }
      const alongX = road.maxX - road.minX >= road.maxZ - road.minZ;
      const sides = alongX
        ? [{ x: q.x, z: road.minZ - 1.5 }, { x: q.x, z: road.maxZ + 1.5 }]
        : [{ x: road.minX - 1.5, z: q.z }, { x: road.maxX + 1.5, z: q.z }];
      sides.sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z));
      for (const s of sides) { if (good(s)) return s; next.push(s); }
    }
    frontier = next;
  }
  return { ...p };
}

/** The sidewalk strip beside `road` on `side` (-1 = min side, +1 = max side), shrunk by the spawn inset. */
function stripBeside(road: AABB, side: number, span: [number, number]): AABB {
  const inset = BALANCE.sidewalkSpawn.inset;
  const alongX = road.maxX - road.minX >= road.maxZ - road.minZ;
  if (alongX) {
    const z0 = side < 0 ? road.minZ - 3 + inset : road.maxZ + inset;
    return { minX: span[0], maxX: span[1], minZ: z0, maxZ: z0 + 3 - 2 * inset };
  }
  const x0 = side < 0 ? road.minX - 3 + inset : road.maxX + inset;
  return { minX: x0, maxX: x0 + 3 - 2 * inset, minZ: span[0], maxZ: span[1] };
}

/** Longest part of [lo, hi] (along the strip's long axis) that does not cross another road. */
function clearSpan(strip: AABB, roads: readonly AABB[], alongX: boolean): [number, number] | null {
  let spans: [number, number][] = [alongX ? [strip.minX, strip.maxX] : [strip.minZ, strip.maxZ]];
  for (const r of roads) {
    if (!overlaps(r, strip)) continue;
    const a = (alongX ? r.minX : r.minZ) - 0.5, b = (alongX ? r.maxX : r.maxZ) + 0.5;
    spans = spans.flatMap(([lo, hi]): [number, number][] => {
      if (b <= lo || a >= hi) return [[lo, hi]];
      const out: [number, number][] = [];
      if (a > lo) out.push([lo, a]);
      if (b < hi) out.push([b, hi]);
      return out;
    });
  }
  let best: [number, number] | null = null;
  for (const s of spans) if (s[1] - s[0] >= 2 && (!best || s[1] - s[0] > best[1] - best[0])) best = s;
  return best;
}

function mostlyClear(w: WorldDraft, r: AABB): boolean {
  let clear = 0;
  for (let i = 0; i < 5; i++) {
    const p = { x: r.minX + (r.maxX - r.minX) * (i + 0.5) / 5, z: (r.minZ + r.maxZ) / 2 };
    const q = { x: (r.minX + r.maxX) / 2, z: r.minZ + (r.maxZ - r.minZ) * (i + 0.5) / 5 };
    if (!circleBlocked(w.colliders, r.maxX - r.minX >= r.maxZ - r.minZ ? p : q, 0.45)) clear++;
  }
  return clear >= 3;
}

function center(r: AABB): Vec2 { return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }; }

/** Move free street spawn zones, district respawn points and street civilians onto the sidewalks. */
export function moveStreetSpawnsToSidewalks(w: WorldDraft): void {
  const roads = roadRects(w);
  const moved = new Map<string, AABB>();
  w.spawnZones.forEach((zone, index) => {
    if (zone.heldBy) return;
    const c = center(zone.rect);
    const road = roads.find(r => insideRect(r, c));
    if (!road) return;
    const alongX = road.maxX - road.minX >= road.maxZ - road.minZ;
    const span: [number, number] = alongX ? [zone.rect.minX, zone.rect.maxX] : [zone.rect.minZ, zone.rect.maxZ];
    for (const side of index % 2 === 0 ? [1, -1] : [-1, 1]) {
      const strip = stripBeside(road, side, span);
      const clear = clearSpan(strip, roads, alongX);
      if (!clear) continue;
      const rect = alongX ? { ...strip, minX: clear[0], maxX: clear[1] } : { ...strip, minZ: clear[0], maxZ: clear[1] };
      if (!mostlyClear(w, rect)) continue;
      moved.set(zone.name, rect);
      zone.rect = rect;
      return;
    }
  });
  // District respawn points are the centers of their free zones (district() order: `${id}-free-${i}`).
  for (const d of w.districts) {
    d.spawnPoints = d.spawnPoints.map((p, i) => {
      const rect = moved.get(`${d.id}-free-${i}`);
      return rect ? center(rect) : isOnRoad(roads, p) ? toSidewalk(w, p) : p;
    });
  }
  for (const g of w.guards) {
    if ((g.role ?? 'soldier') !== 'civilian' || g.post !== 'street') continue;
    if (isOnRoad(roads, g.pos)) g.pos = toSidewalk(w, g.pos, BALANCE.civilian.radius);
    g.waypoints = g.waypoints.map(p => isOnRoad(roads, p) ? toSidewalk(w, p, BALANCE.civilian.radius) : p);
    // A home strip drawn on the carriageway also covers the sidewalks on both sides.
    const home = g.homeArea;
    if (home) {
      const road = roads.find(r => overlaps(r, home));
      if (road) {
        const alongX = home.maxX - home.minX >= home.maxZ - home.minZ;
        g.homeArea = alongX ? { ...home, minZ: Math.min(home.minZ, road.minZ - 3), maxZ: Math.max(home.maxZ, road.maxZ + 3) }
          : { ...home, minX: Math.min(home.minX, road.minX - 3), maxX: Math.max(home.maxX, road.maxX + 3) };
      }
    }
  }
}
