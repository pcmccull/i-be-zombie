// [pure] Render-only tropical dressing derived from a DistrictLayout: beach + ocean past the south edge,
// palm rows along sidewalks, and traffic lanes on the roads. Nothing here affects gameplay or collision.
import type { AABB, DistrictLayout, Vec2 } from '../core/types';

export interface TrafficLane {
  /** Lane start / end (cars drive start -> end, then wrap). */
  from: Vec2;
  to: Vec2;
  length: number;
}

export interface TropicalLayout {
  beach: AABB;
  ocean: AABB;
  palms: { pos: Vec2; height: number; lean: number; rot: number }[];
  lanes: TrafficLane[];
  /** Road crossings (centers + half sizes) — cars do not enter a busy one. */
  intersections: AABB[];
}

const PALM_SPACING = 11;
const PALM_CLEARANCE = 1.6;

function inside(r: AABB, x: number, z: number, pad = 0): boolean {
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
}

function hash(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildTropicalLayout(layout: DistrictLayout): TropicalLayout {
  const b = layout.bounds;
  const beach: AABB = { minX: b.minX - 60, maxX: b.maxX + 60, minZ: b.maxZ, maxZ: b.maxZ + 26 };
  const ocean: AABB = { minX: b.minX - 400, maxX: b.maxX + 400, minZ: b.maxZ + 22, maxZ: b.maxZ + 420 };
  const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
  const sidewalks = layout.ground.filter(g => g.kind === 'sidewalk').map(g => g.rect);
  const blocked = (x: number, z: number): boolean =>
    layout.colliders.some(c => inside(c, x, z, PALM_CLEARANCE)) ||
    roads.some(r => inside(r, x, z, 0.4)) ||
    layout.props.some(p => Math.hypot(p.pos.x - x, p.pos.z - z) < 2.2);

  const palms: TropicalLayout['palms'] = [];
  let seed = 1;
  const add = (x: number, z: number): void => {
    if (blocked(x, z)) return;
    if (palms.some(q => Math.hypot(q.pos.x - x, q.pos.z - z) < PALM_SPACING * 0.6)) return;
    const h = hash(seed++);
    palms.push({ pos: { x, z }, height: 6.5 + h * 3.5, lean: 0.06 + hash(seed++) * 0.16, rot: hash(seed++) * Math.PI * 2 });
  };
  // Palm rows down the middle of every sidewalk strip.
  for (const s of sidewalks) {
    const alongX = s.maxX - s.minX > s.maxZ - s.minZ;
    if (alongX) {
      const z = (s.minZ + s.maxZ) / 2;
      for (let x = s.minX + 6; x < s.maxX - 4; x += PALM_SPACING) add(x, z);
    } else {
      const x = (s.minX + s.maxX) / 2;
      for (let z = s.minZ + 6; z < s.maxZ - 4; z += PALM_SPACING) add(x, z);
    }
  }
  // Beach promenade palms.
  for (let x = b.minX - 40; x <= b.maxX + 40; x += PALM_SPACING * 0.8) {
    const h = hash(seed++);
    palms.push({ pos: { x: x + (h - 0.5) * 4, z: b.maxZ + 5 + hash(seed++) * 10 }, height: 7 + h * 4,
      lean: 0.1 + hash(seed++) * 0.2, rot: hash(seed++) * Math.PI * 2 });
  }

  // Two lanes per road (driving on the right).
  const lanes: TrafficLane[] = [];
  for (const r of roads) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    if (w > d) {
      const off = d / 4;
      const z = (r.minZ + r.maxZ) / 2;
      lanes.push({ from: { x: r.minX, z: z + off }, to: { x: r.maxX, z: z + off }, length: w });
      lanes.push({ from: { x: r.maxX, z: z - off }, to: { x: r.minX, z: z - off }, length: w });
    } else {
      const off = w / 4;
      const x = (r.minX + r.maxX) / 2;
      lanes.push({ from: { x: x - off, z: r.minZ }, to: { x: x - off, z: r.maxZ }, length: d });
      lanes.push({ from: { x: x + off, z: r.maxZ }, to: { x: x + off, z: r.minZ }, length: d });
    }
  }
  const intersections: AABB[] = [];
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    const a = roads[i], c = roads[j];
    const minX = Math.max(a.minX, c.minX), maxX = Math.min(a.maxX, c.maxX);
    const minZ = Math.max(a.minZ, c.minZ), maxZ = Math.min(a.maxZ, c.maxZ);
    if (minX < maxX && minZ < maxZ) intersections.push({ minX, maxX, minZ, maxZ });
  }
  return { beach, ocean, palms, lanes, intersections };
}
