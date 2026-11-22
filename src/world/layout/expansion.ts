// [pure] Expansion strongholds realize the content contract, with hollow, independently breachable rooms.
import { BALANCE } from '../../config/balance';
import { DISTRICTS, type DistrictMeta } from '../../content/districts';
import { STRONGHOLDS } from '../../content/strongholds';
import type { Vec2 } from '../../core/types';
import { mulberry32 } from '../../utils/rng';
import { CollisionWorld } from '../CollisionWorld';
import { buildArchetype, expansionCenter } from './archetypes';
import { prop, type WorldDraft } from './common';
import { COMPOUND_BUILDERS } from './compounds';
import { cellPlayRect, districtSeed, ORIGINAL_DISTRICTS, seamCrossings } from './grid';

export function buildExpansion(w: WorldDraft, seed: number): void {
  for (const meta of DISTRICTS) {
    if (!ORIGINAL_DISTRICTS.has(meta.id)) buildArchetype(w, meta, mulberry32(districtSeed(seed, meta.id)));
  }
  let id = 100;
  for (const entry of STRONGHOLDS) {
    if (ORIGINAL_DISTRICTS.has(entry.districtId)) continue;
    const meta = DISTRICTS.find(d => d.id === entry.districtId)!;
    const build = COMPOUND_BUILDERS[entry.id];
    if (!build) throw new Error(`No compound layout for ${entry.id}`);
    // Own stream per compound: layouts never shift the district builders' randomness.
    build(w, expansionCenter(meta), id++, mulberry32(districtSeed(seed, `${entry.id}-compound`)));
  }
  dressDangerBorders(w);
  placeReinforcements(w);
}

function dressDangerBorders(w: WorldDraft): void {
  for (const high of w.districts.filter(d => d.threatTier >= 4)) {
    for (const low of w.districts.filter(d => d.threatTier <= 2)) {
      const adjacent = Math.abs(high.cell.col - low.cell.col) + Math.abs(high.cell.row - low.cell.row) === 1;
      if (!adjacent) continue;
      const a = cellPlayRect(high.cell.col, high.cell.row), b = cellPlayRect(low.cell.col, low.cell.row);
      for (const cross of seamCrossings(a, b)) {
        const p = { x: (cross.a.x + cross.b.x) / 2, z: (cross.a.z + cross.b.z) / 2 };
        const dx = Math.sign(high.cell.col - low.cell.col), dz = Math.sign(high.cell.row - low.cell.row);
        const vertical = dx !== 0;
        // Off the crossing, on the dangerous side. All props are nonblocking.
        const x = p.x + dx * 7 + (vertical ? 0 : 9), z = p.z + dz * 7 + (vertical ? 9 : 0);
        prop(w, 'jerseyBarrier', x, z, vertical ? Math.PI / 2 : 0);
        prop(w, 'warningSign', x + dx, z + dz);
        prop(w, 'floodlight', x + dx * 2, z + dz * 2);
        prop(w, 'watchtower', x + dx * 3, z + dz * 3);
      }
    }
  }
}

/** Road candidates are checked against completed geography, so spawns never appear in the opening sight line. */
function placeReinforcements(w: WorldDraft): void {
  const collision = new CollisionWorld(w.bounds, w.colliders);
  for (const s of w.strongholds) {
    if (ORIGINAL_DISTRICTS.has(s.districtId)) continue;
    const meta: DistrictMeta = DISTRICTS.find(d => d.id === s.districtId)!;
    const r = cellPlayRect(meta.cell.col, meta.cell.row), candidates: Vec2[] = [];
    for (const g of w.ground) {
      if (g.kind !== 'road') continue;
      const minX = Math.max(g.rect.minX + 1, r.minX + 8), maxX = Math.min(g.rect.maxX - 1, r.maxX - 8);
      const minZ = Math.max(g.rect.minZ + 1, r.minZ + 8), maxZ = Math.min(g.rect.maxZ - 1, r.maxZ - 8);
      if (maxX <= minX || maxZ <= minZ) continue;
      const vertical = maxZ - minZ > maxX - minX;
      for (let t = vertical ? minZ : minX; t <= (vertical ? maxZ : maxX); t += 12) {
        const p = vertical ? { x: (minX + maxX) / 2, z: t } : { x: t, z: (minZ + maxZ) / 2 };
        if (p.x >= s.bounds.minX - 8 && p.x <= s.bounds.maxX + 8 && p.z >= s.bounds.minZ - 8 && p.z <= s.bounds.maxZ + 8) continue;
        if (!collision.isBlocked(p, BALANCE.guard.radius) && collision.segmentBlocked(w.playerStart, p, { mode: 'sight' })) candidates.push(p);
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - s.center.x, a.z - s.center.z) - Math.hypot(b.x - s.center.x, b.z - s.center.z));
    const first = candidates[0], second = candidates.find(p => first && Math.hypot(p.x - first.x, p.z - first.z) >= 24);
    if (!first || !second) throw new Error(`No concealed road reinforcements for ${s.id}`);
    s.reinforcementPoints.push(first, second);
  }
}
