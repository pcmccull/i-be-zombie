// [pure] Traffic control: the road network as driving data (merged through-lanes + junctions) and the rules at each
// junction. Main-road and city-core junctions have traffic lights (N-S green → yellow → all-red → E-W green → …, each
// junction with its own deterministic offset); every other junction is a 4-way stop (full stop, then first come first
// served, cars on the same road may go together). Shared by TrafficSystem (sim) and TrafficSignals (render): the
// light colour is a pure function of the junction and sim time, so the renderer never reads sim-private state.
import { BALANCE } from '../config/balance';
import type { AABB, DistrictLayout, Vec2 } from '../core/types';

/** 'x' = the lane runs east-west, 'z' = north-south. */
export type TravelAxis = 'x' | 'z';
export type SignalColor = 'green' | 'yellow' | 'red';
export type JunctionControl = 'light' | 'stop';

export interface Junction {
  id: number;
  rect: AABB;
  center: Vec2;
  control: JunctionControl;
  /** Seconds added to sim time before reading the light cycle (lights only). */
  offset: number;
}

/** Where a lane passes through a junction, as distances along the lane. */
export interface LaneCrossing { junction: number; entry: number; exit: number }

export interface NetworkLane {
  from: Vec2;
  to: Vec2;
  length: number;
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  axis: TravelAxis;
  /** Distance to the oncoming lane (cars swerve this far left around a wreck). */
  spacing: number;
  /** Junction crossings sorted by entry. */
  crossings: LaneCrossing[];
}

export interface TrafficNetwork { lanes: NetworkLane[]; junctions: Junction[] }

interface Band { lo: number; hi: number; a: number; b: number }

/** Road patches split by crossings this short still count as one through-road. */
const MERGE_GAP = 16;
const EPS = 0.5;

function bands(roads: AABB[], vertical: boolean): Band[] {
  const groups = new Map<string, Band[]>();
  for (const r of roads) {
    const band: Band = vertical ? { lo: r.minX, hi: r.maxX, a: r.minZ, b: r.maxZ } : { lo: r.minZ, hi: r.maxZ, a: r.minX, b: r.maxX };
    const key = `${band.lo}:${band.hi}`;
    const list = groups.get(key);
    if (list) list.push(band); else groups.set(key, [band]);
  }
  const out: Band[] = [];
  for (const list of groups.values()) {
    list.sort((p, q) => p.a - q.a);
    let cur = { ...list[0] };
    for (let i = 1; i < list.length; i++) {
      const next = list[i];
      if (next.a - cur.b <= MERGE_GAP) cur.b = Math.max(cur.b, next.b);
      else { out.push(cur); cur = { ...next }; }
    }
    out.push(cur);
  }
  return out;
}

function hash01(i: number): number {
  const s = Math.sin(i * 91.7 + 17.3) * 43758.5453;
  return s - Math.floor(s);
}

export function signalCycle(): number {
  const s = BALANCE.traffic.signals;
  return 2 * (s.green + s.yellow + s.allRed);
}

/** Light colour a car travelling along `axis` sees at junction `j` (stop junctions are always 'red' = stop first). */
export function signalFor(j: Junction, axis: TravelAxis, time: number): SignalColor {
  if (j.control !== 'light') return 'red';
  const s = BALANCE.traffic.signals, half = s.green + s.yellow + s.allRed, cycle = 2 * half;
  let t = (time + j.offset) % cycle;
  if (t < 0) t += cycle;
  // First half: N-S ('z') runs; second half: E-W ('x').
  const mine = axis === 'z' ? t < half : t >= half;
  if (!mine) return 'red';
  const u = t % half;
  return u < s.green ? 'green' : u < s.green + s.yellow ? 'yellow' : 'red';
}

/** Is the junction lit (main road or the city core)? Everything else is a 4-way stop. */
function controlFor(rect: AABB): JunctionControl {
  const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
  const main = rect.maxX - rect.minX >= 12 || rect.maxZ - rect.minZ >= 12;
  const core = Math.abs(cx) <= 150 && cz > -160 && cz < 160;
  return main || core ? 'light' : 'stop';
}

export function buildTrafficNetwork(layout: DistrictLayout): TrafficNetwork {
  const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
  const vertical = bands(roads.filter(r => r.maxZ - r.minZ > r.maxX - r.minX), true);
  const horizontal = bands(roads.filter(r => r.maxZ - r.minZ <= r.maxX - r.minX), false);

  const junctions: Junction[] = [];
  for (const v of vertical) for (const h of horizontal) {
    // The horizontal road reaches the vertical carriageway and the vertical road reaches the horizontal one.
    if (h.a > v.hi + EPS || h.b < v.lo - EPS || v.a > h.hi + EPS || v.b < h.lo - EPS) continue;
    const rect: AABB = { minX: v.lo, maxX: v.hi, minZ: h.lo, maxZ: h.hi };
    const id = junctions.length;
    const control = controlFor(rect);
    junctions.push({ id, rect, center: { x: (v.lo + v.hi) / 2, z: (h.lo + h.hi) / 2 }, control,
      offset: control === 'light' ? hash01(id + rect.minX * 0.37 + rect.minZ * 0.11) * signalCycle() : 0 });
  }

  const lanes: NetworkLane[] = [];
  const addLane = (from: Vec2, to: Vec2, axis: TravelAxis, spacing: number): void => {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length <= 1) return;
    const dx = (to.x - from.x) / length, dz = (to.z - from.z) / length;
    const crossings: LaneCrossing[] = [];
    for (const j of junctions) {
      const r = j.rect;
      if (axis === 'x' ? from.z <= r.minZ || from.z >= r.maxZ : from.x <= r.minX || from.x >= r.maxX) continue;
      const e0 = axis === 'x' ? (r.minX - from.x) * dx : (r.minZ - from.z) * dz;
      const e1 = axis === 'x' ? (r.maxX - from.x) * dx : (r.maxZ - from.z) * dz;
      const entry = Math.min(e0, e1), exit = Math.max(e0, e1);
      if (exit <= 0 || entry >= length) continue;
      crossings.push({ junction: j.id, entry, exit });
    }
    crossings.sort((p, q) => p.entry - q.entry);
    lanes.push({ from, to, length, dx, dz, axis, spacing, crossings });
  };
  // Two lanes per road, driving on the right.
  for (const h of horizontal) {
    const z = (h.lo + h.hi) / 2, off = (h.hi - h.lo) / 4;
    addLane({ x: h.a, z: z + off }, { x: h.b, z: z + off }, 'x', off * 2);
    addLane({ x: h.b, z: z - off }, { x: h.a, z: z - off }, 'x', off * 2);
  }
  for (const v of vertical) {
    const x = (v.lo + v.hi) / 2, off = (v.hi - v.lo) / 4;
    addLane({ x: x - off, z: v.a }, { x: x - off, z: v.b }, 'z', off * 2);
    addLane({ x: x + off, z: v.b }, { x: x + off, z: v.a }, 'z', off * 2);
  }
  return { lanes, junctions };
}

/** Speed (m/s) from which a car can still brake to a stop within `d` meters (with a comfort margin). */
export function stopSpeed(d: number): number {
  if (d <= 0.25) return 0;
  return Math.sqrt(2 * BALANCE.traffic.brake * 0.6 * d);
}

/** Distance a car at `speed` needs to stop at full brake. */
export function stoppingDistance(speed: number): number {
  return speed > 0 ? (speed * speed) / (2 * BALANCE.traffic.brake) : 0;
}

/** Approach (stop line) position for a lane entering junction `j`, with its facing; used by the renderer. */
export interface Approach { junction: number; axis: TravelAxis; dx: number; dz: number; line: Vec2; laneOffset: number; halfWidth: number }

/** Every lane approach into every junction (one per lane per junction it enters, de-duplicated per side). */
export function junctionApproaches(net: TrafficNetwork): Approach[] {
  const out: Approach[] = [];
  const seen = new Set<string>();
  for (const lane of net.lanes) for (const c of lane.crossings) {
    if (c.entry <= 0.5) continue; // lane starts inside the junction (world edge): no approach
    const key = `${c.junction}:${lane.dx}:${lane.dz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ junction: c.junction, axis: lane.axis, dx: lane.dx, dz: lane.dz,
      line: { x: lane.from.x + lane.dx * c.entry, z: lane.from.z + lane.dz * c.entry },
      laneOffset: lane.spacing / 2, halfWidth: lane.spacing });
  }
  return out;
}
