// [pure] Seeded city blocks; authored roads and seam corridors remain clear for every archetype.
import type { DistrictMeta } from '../../content/districts';
import type { AABB, BuildingStyle, DistrictArchetype, PropKind, Rng } from '../../core/types';
import { building, district, human, prop, rect, streetPopulation, vehicle, type WorldDraft } from './common';
import { cellPlayRect, expansionRoads, overlaps } from './grid';

/** Public for stronghold placement and tests: a road-free compound and nest approach are reserved. */
export function expansionCenter(meta: DistrictMeta): { x: number; z: number } {
  const r = cellPlayRect(meta.cell.col, meta.cell.row);
  return { x: [-360, -155, 50, 360][meta.cell.col], z: r.minZ + 36 };
}

function intervals(min: number, max: number, cuts: { at: number; half: number }[]): [number, number][] {
  let parts: [number, number][] = [[min + 12, max - 12]];
  for (const { at, half } of cuts) {
    const lo = at - half - 5, hi = at + half + 5;
    const next: [number, number][] = [];
    for (const [a, b] of parts) {
      if (hi <= a || lo >= b) next.push([a, b]);
      else {
        if (lo - a >= 16) next.push([a, lo]);
        if (b - hi >= 16) next.push([hi, b]);
      }
    }
    parts = next;
  }
  return parts;
}

function blocks(meta: DistrictMeta): AABB[] {
  const r = cellPlayRect(meta.cell.col, meta.cell.row), roads = expansionRoads();
  const xs = intervals(r.minX, r.maxX, roads.filter(s => s.axis === 'x' && s.lo < r.maxZ && s.hi > r.minZ));
  const zs = intervals(r.minZ, r.maxZ, roads.filter(s => s.axis === 'z' && s.lo < r.maxX && s.hi > r.minX));
  return xs.flatMap(([a, b]) => zs.map(([c, d]) => rect(a, c, b, d)));
}

interface BlockProfile {
  count: number;
  lot: [number, number];
  styles: BuildingStyle[];
  height: [number, number];
  colors: [number, number];
  ground: 'park' | 'plaza' | 'lot' | 'compound';
  props: PropKind[];
}

// Lot sizes include a service passage; silhouettes and palette subsets differ by neighbourhood.
const PROFILES: Partial<Record<DistrictArchetype, BlockProfile>> = {
  downtown: { count: 26, lot: [17, 15], styles: ['office'], height: [20, 45], colors: [4, 7], ground: 'plaza', props: ['streetlight', 'bench', 'sign'] },
  nightlife: { count: 22, lot: [18, 16], styles: ['storefront', 'apartment', 'storefront'], height: [7, 16], colors: [2, 5], ground: 'plaza', props: ['sign', 'streetlight', 'dumpster'] },
  resort: { count: 14, lot: [22, 20], styles: ['apartment'], height: [18, 30], colors: [0, 2], ground: 'plaza', props: ['palm', 'bench', 'palm', 'sign'] },
  campus: { count: 16, lot: [20, 18], styles: ['civic', 'office'], height: [9, 19], colors: [1, 3], ground: 'plaza', props: ['bench', 'palm', 'sign'] },
  medical: { count: 12, lot: [24, 20], styles: ['civic', 'garage', 'civic'], height: [12, 24], colors: [0, 1], ground: 'lot', props: ['tent', 'jerseyBarrier', 'floodlight', 'warningSign'] },
  arts: { count: 18, lot: [19, 17], styles: ['storefront', 'apartment'], height: [7, 16], colors: [3, 6], ground: 'plaza', props: ['sign', 'debris', 'bench'] },
  boardwalk: { count: 14, lot: [22, 20], styles: ['storefront', 'house'], height: [3, 6], colors: [0, 4], ground: 'park', props: ['palm', 'bench', 'sign'] },
  marina: { count: 10, lot: [24, 20], styles: ['warehouse', 'garage', 'office'], height: [6, 11], colors: [5, 7], ground: 'lot', props: ['container', 'palm', 'bench', 'chainFence'] },
  estates: { count: 14, lot: [23, 20], styles: ['house'], height: [6, 10], colors: [0, 2], ground: 'park', props: ['palm', 'bench', 'tree'] },
  airport: { count: 8, lot: [28, 20], styles: ['warehouse'], height: [10, 14], colors: [5, 7], ground: 'lot', props: ['floodlight', 'wreck', 'container'] },
  military: { count: 10, lot: [24, 20], styles: ['warehouse', 'garage'], height: [6, 12], colors: [6, 7], ground: 'compound', props: ['watchtower', 'sandbags', 'chainFence', 'floodlight'] },
  park: { count: 4, lot: [24, 22], styles: ['garage'], height: [3, 5], colors: [1, 3], ground: 'park', props: ['palm', 'bench', 'palm', 'tree'] },
};

export function buildArchetype(w: WorldDraft, meta: DistrictMeta, rng: Rng): void {
  const r = cellPlayRect(meta.cell.col, meta.cell.row), c = expansionCenter(meta);
  const reserved = rect(c.x - 29, c.z - 24, c.x + 29, c.z + 32);
  const streetZ = r.minZ + 80;
  // Together with expansion.ts defenders and the street squads: 12 / 16 / 20 / 24 / 30 humans.
  const civilians = [0, 9, 9, 8, 4, 3][meta.threatTier];
  const ambient = [0, 20, 18, 16, 12, 10][meta.threatTier];
  const zones = [30, 65, 115, 150].map((dx, i) => ({
    rect: rect(r.minX + dx, streetZ - 2, r.minX + dx + 12, streetZ + 2),
    count: Math.floor(ambient / 4) + +(i < ambient % 4),
  }));
  district(w, meta.id, r, civilians, ambient, zones);
  streetPopulation(w, civilians, rect(r.minX + 24, streetZ - 3, r.maxX - 24, streetZ + 3));
  // Two separated patrol squads at higher tiers, with short routes on the existing street.
  const patrols = [0, 0, 2, 6, 12, 16][meta.threatTier];
  for (let i = 0; i < patrols; i++) {
    const squadSize = Math.ceil(patrols / 2), squad = Math.floor(i / squadSize), member = i % squadSize;
    const pos = { x: r.minX + 34 + squad * 100 + (member % 4) * 2.5, z: streetZ - 2 + Math.floor(member / 4) * 2.5 };
    human(w, meta.threatTier >= 4 ? 'soldier' : 'police', 'patrol', pos,
      [pos, { x: pos.x + 12, z: pos.z }, { x: pos.x + 12, z: pos.z + 1 }, { x: pos.x, z: pos.z + 1 }]);
  }

  const profile = PROFILES[meta.archetype]!;
  const cityBlocks = blocks(meta);
  // Check whole lots before jittering footprints: geometry can never drift into a reserved area.
  const protectedRects = [reserved, ...zones.map(z => z.rect), ...w.guards.flatMap(g =>
    [g.pos, ...g.waypoints].map(p => rect(p.x - 1, p.z - 1, p.x + 1, p.z + 1)))];
  const lots: AABB[][] = cityBlocks.map(block => {
    const width = block.maxX - block.minX, depth = block.maxZ - block.minZ - 10;
    const nx = Math.max(1, Math.floor(width / profile.lot[0]));
    const nz = Math.max(1, Math.floor(depth / profile.lot[1]));
    const result: AABB[] = [];
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const lot = rect(block.minX + x * width / nx, block.minZ + z * depth / nz,
        block.minX + (x + 1) * width / nx, block.minZ + (z + 1) * depth / nz);
      if (lot.maxZ - lot.minZ < 10 || protectedRects.some(p => overlaps(lot, p, 3))) continue;
      result.push(lot);
    }
    // Per-block shuffle avoids a repeated row pattern while keeping neighbourhoods independently seeded.
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  });
  // Open civic quad / runway / pond are explicit empty lots, rather than missing entire city blocks.
  const openLot = lots.flat().find(lot => !overlaps(lot, reserved, 8));
  if (openLot && ['campus', 'airport', 'park', 'estates'].includes(meta.archetype)) {
    for (const group of lots) {
      const index = group.indexOf(openLot);
      if (index >= 0) group.splice(index, 1);
    }
  }
  // Round-robin blocks fills both sides of the streets instead of exhausting one block first.
  const selected: AABB[] = [];
  for (let row = 0; lots.some(group => row < group.length); row++) {
    for (const group of lots) if (group[row]) selected.push(group[row]);
  }
  if (meta.archetype === 'resort') selected.sort((a, b) =>
    Math.min(r.maxX - a.maxX, r.maxZ - a.maxZ) - Math.min(r.maxX - b.maxX, r.maxZ - b.maxZ));
  if (selected.length < profile.count) throw new Error('Insufficient building lots for ' + meta.id + ': ' + selected.length);
  for (let i = 0; i < profile.count; i++) {
    const lot = selected[i], width = lot.maxX - lot.minX, depth = lot.maxZ - lot.minZ;
    // At least 4 m between adjacent building footprints, including all seeded offsets.
    const insetX = 2 + rng.next() * 1.5, insetZ = 2 + rng.next() * 1.5;
    const footprint = rect(lot.minX + insetX, lot.minZ + insetZ, lot.maxX - 2 - rng.next() * 1.5, lot.maxZ - 2 - rng.next() * 1.5);
    if (meta.archetype === 'park' || meta.archetype === 'boardwalk') {
      footprint.maxX = footprint.minX + Math.min(width - 6, meta.archetype === 'park' ? 8 : 12);
      footprint.maxZ = footprint.minZ + Math.min(depth - 6, meta.archetype === 'park' ? 7 : 10);
    }
    let style = profile.styles[i % profile.styles.length];
    if (((meta.archetype === 'airport' || meta.archetype === 'military') && i === 0) ||
      (meta.archetype === 'downtown' && i < 2)) style = 'civic';
    const height = style === 'garage' && meta.archetype !== 'park' ? 4 + rng.next() * 3 :
      profile.height[0] + rng.next() * (profile.height[1] - profile.height[0]);
    building(w, footprint, style, height, rng);
    w.buildings[w.buildings.length - 1].colorIndex = profile.colors[0] + Math.floor(rng.next() * (profile.colors[1] - profile.colors[0] + 1));
  }
  for (const [i, block] of cityBlocks.entries()) {
    const width = block.maxX - block.minX, depth = block.maxZ - block.minZ;
    const cx = (block.minX + block.maxX) / 2;
    w.ground.push({ kind: profile.ground, rect: block });
    for (let j = 0; j < 4; j++) prop(w, profile.props[j % profile.props.length],
      block.minX + 3 + j * (width - 6) / 3, block.maxZ - 2, 0, Math.floor(rng.next() * 6));
    if (overlaps(block, reserved)) continue;
    if (meta.archetype === 'airport') for (let j = 0; j < 3; j++) w.markings.push({ kind: 'parkingBay', rotation: 0,
      rect: rect(cx - 6 + j * 5, block.maxZ - 8, cx - 2 + j * 5, block.maxZ - 3) });
    if ((meta.archetype === 'military' || meta.archetype === 'airport') && depth >= 30) {
      vehicle(w, 'truck', cx, block.maxZ - 6, Math.PI / 2, rng);
    } else if (meta.archetype !== 'park' && meta.archetype !== 'boardwalk' && depth >= 30 && i % 2 === 0) {
      vehicle(w, 'car', cx, block.maxZ - 6, Math.PI / 2, rng);
    }
  }
  if (openLot && ['campus', 'airport', 'park', 'estates'].includes(meta.archetype)) {
    w.ground.push({ kind: meta.archetype === 'campus' ? 'plaza' : meta.archetype === 'estates' ? 'park' : 'lot', rect: openLot });
  }
}
