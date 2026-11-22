// [pure] VP2 street furniture (docs/12_visual_polish2.md §6, ARCHITECTURE VP2-0 "Density" layer 1). Append-only pass: small
// blocking props on the sidewalks (bus stops near corners, mailboxes, news stands, bike racks, bollards, planters, patio tables
// outside storefronts) picked from `DISTRICT_STYLES[...].furniture` weights. Each one gets a small collider (PROP_SIZES); every
// item sits flush against the curb (patio tables against the building side) so >= 1.6 m of sidewalk stays clear, and none sits
// near a crosswalk, spawn zone, patrol waypoint, shop door / structure approach, nest, existing prop or strip end.
import { DISTRICT_STYLES } from '../../content/districtStyles';
import type { AABB, DistrictId, PropDef } from '../../core/types';
import { mulberry32 } from '../../utils/rng';
import { rect, type WorldDraft } from './common';
import { blockingProp, buildOccupancy, FLAG, grow, hashString, PROP_SIZES, type InfillExtras } from './urbanInfill';

type FurnitureProp = 'busStop' | 'mailbox' | 'newsStand' | 'bikeRack' | 'bollard' | 'planter' | 'patioTable';
const KINDS: readonly FurnitureProp[] = ['busStop', 'mailbox', 'newsStand', 'bikeRack', 'bollard', 'planter', 'patioTable'];

/** Sidewalk width that must stay clear beside any blocking furniture. */
export const MIN_CLEAR_SIDEWALK = 1.6;
const END_MARGIN = 8, CURB_GAP = 0.1;

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
function inside(outer: AABB, r: AABB): boolean {
  return r.minX >= outer.minX && r.maxX <= outer.maxX && r.minZ >= outer.minZ && r.maxZ <= outer.maxZ;
}
function districtAt(w: WorldDraft, x: number, z: number): DistrictId | null {
  for (const d of w.districts) if (x >= d.rect.minX && x < d.rect.maxX && z >= d.rect.minZ && z < d.rect.maxZ) return d.id;
  return null;
}

export interface FurnitureReport { count: number; byKind: Record<string, number> }

export function placeStreetFurniture(w: WorldDraft, seed: number, extra: InfillExtras = {}): FurnitureReport {
  const report: FurnitureReport = { count: 0, byKind: {} };
  const g = buildOccupancy(w, extra);
  const roads = w.ground.filter(p => p.kind === 'road').map(p => p.rect);
  const crosswalks = w.markings.filter(m => m.kind === 'crosswalk').map(m => grow(m.rect, 3));
  const storefronts = w.buildings.filter(b => b.style === 'storefront').map(b => b.footprint);
  const rngs = new Map<DistrictId, ReturnType<typeof mulberry32>>();
  for (const gp of w.ground) {
    if (gp.kind !== 'sidewalk') continue;
    const r = gp.rect, alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
    const long = alongX ? r.maxX - r.minX : r.maxZ - r.minZ, short = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
    if (long < 2 * END_MARGIN + 6 || short < 2.5 || short > 4.5) continue;
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    const did = districtAt(w, cx, cz);
    if (!did) continue;
    const style = DISTRICT_STYLES[did];
    const weights = KINDS.map(k => [k, style.furniture[k] ?? 0] as const).filter(([, v]) => v > 0);
    if (!weights.length) continue;
    // Curb side: the long side that touches a carriageway.
    const probe = (n: number): boolean => {
      const p = alongX ? { x: cx, z: n < 0 ? r.minZ - 0.5 : r.maxZ + 0.5 } : { x: n < 0 ? r.minX - 0.5 : r.maxX + 0.5, z: cz };
      return roads.some(q => p.x > q.minX && p.x < q.maxX && p.z > q.minZ && p.z < q.maxZ);
    };
    const curb = probe(1) ? 1 : probe(-1) ? -1 : 0;
    const cp = alongX ? { x: cx, z: curb > 0 ? r.maxZ + 0.5 : r.minZ - 0.5 } : { x: curb > 0 ? r.maxX + 0.5 : r.minX - 0.5, z: cz };
    const curbRoad = roads.find(q => cp.x > q.minX && cp.x < q.maxX && cp.z > q.minZ && cp.z < q.maxZ);
    if (!curb) continue;
    const curbEdge = alongX ? (curb > 0 ? r.maxZ : r.minZ) : (curb > 0 ? r.maxX : r.minX);
    const farEdge = alongX ? (curb > 0 ? r.minZ : r.maxZ) : (curb > 0 ? r.minX : r.maxX);
    const lo = alongX ? r.minX : r.minZ, hi = alongX ? r.maxX : r.maxZ;
    let rng = rngs.get(did);
    if (!rng) { rng = mulberry32(hashString(`vp2-furniture:${seed}:${did}`)); rngs.set(did, rng); }
    for (let t = lo + END_MARGIN + rng.next() * 12; t < hi - END_MARGIN; t += 26 + rng.next() * 14) {
      // Weighted pick with local eligibility (bus stops near strip ends, patio tables near storefronts).
      const nearEnd = t - lo < 26 || hi - t < 26;
      const nearStore = storefronts.some(b => alongX
        ? t > b.minX - 14 && t < b.maxX + 14 && (cz > b.maxZ ? cz - b.maxZ : b.minZ - cz) < 22
        : t > b.minZ - 14 && t < b.maxZ + 14 && (cx > b.maxX ? cx - b.maxX : b.minX - cx) < 22);
      const pool = weights.filter(([k]) => (k !== 'busStop' || nearEnd) && (k !== 'patioTable' || nearStore));
      const total = pool.reduce((n, [, v]) => n + v, 0);
      if (total <= 0) continue;
      let ticket = rng.next() * total, kind: FurnitureProp = pool[0][0];
      for (const [k, v] of pool) { ticket -= v; if (ticket < 0) { kind = k; break; } }
      const s = PROP_SIZES[kind]!;
      if (short - CURB_GAP - s.d < MIN_CLEAR_SIDEWALK) continue;
      const count = kind === 'patioTable' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const along = Math.round((t + i * 2.2) * 2) / 2;
        const toward = kind === 'busStop' || kind === 'bikeRack' ? curb : -curb;
        const rot = alongX ? (toward > 0 ? 0 : Math.PI) : (toward > 0 ? Math.PI / 2 : -Math.PI / 2);
        const offset = CURB_GAP + s.d / 2;
        const cross = kind === 'patioTable' ? farEdge + curb * offset : curbEdge - curb * offset;
        const x = alongX ? along : cross, z = alongX ? cross : along;
        const half = { x: (alongX ? s.w : s.d) / 2, z: (alongX ? s.d : s.w) / 2 };
        const box = rect(x - half.x, z - half.z, x + half.x, z + half.z);
        if (!inside(grow(r, 1e-6), box) || g.hit(box, FLAG.SOLID | FLAG.SOFT | FLAG.JUNC | FLAG.NEAR) || crosswalks.some(c => overlaps(c, box))) continue;
        // Never in a junction box or lane: the only road within 6 m is the carriageway the strip runs beside.
        if (roads.some(q => q !== curbRoad && overlaps(grow(box, 6), q))) continue;
        blockingProp(w, kind as PropDef['kind'], x, z, rot, Math.floor(rng.next() * 4));
        g.mark(FLAG.SOLID, box);
        g.mark(FLAG.SOFT, box, 0.8);
        report.count++;
        report.byKind[kind] = (report.byKind[kind] ?? 0) + 1;
      }
    }
  }
  return report;
}
