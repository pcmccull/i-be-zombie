// [pure] Hand-built expansion strongholds: every capture point has its own floor plan, approach and defence.
// Coordinates are relative to the reserved compound centre `c` (expansionCenter). The usable plot is
// x ∈ [-24, 24], z ∈ [-20, 22] (+Z = south, toward the street and the nest). Narrow alleys are 3-3.5 m wide.
// Heavy weapons (HeavyWeapon): mounted MGs behind open-backed sandbag crescents, tanks inside a blocking hull.
import { BALANCE } from '../../config/balance';
import type {
  AABB, BuildingStyle, GroundKind, HeavyWeapon, HumanRole, LandmarkKind, ObjectiveDef, PropKind, Rng, StructureDef,
  StructureKind, StrongholdId, Vec2,
} from '../../core/types';
import { building, enclosure, human, prop, rect, solid, stronghold, vehicle, type WorldDraft } from './common';

type Dir = 'N' | 'S' | 'E' | 'W';
const DIR_ANGLE: Record<Dir, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

export interface CompoundKit {
  w: WorldDraft;
  c: Vec2;
  id: StrongholdId;
  tier: number;
  rng: Rng;
  /** Shell prefix `<landmark>-<structureId>`: extra walls with it render in the room's style (fence / armored). */
  prefix: string;
  landmark: LandmarkKind;
  wallHeight: number;
  n: number;
}

const X = (k: CompoundKit, x: number): number => k.c.x + x;
const Z = (k: CompoundKit, z: number): number => k.c.z + z;
const R = (k: CompoundKit, x0: number, z0: number, x1: number, z1: number): AABB => rect(X(k, x0), Z(k, z0), X(k, x1), Z(k, z1));

/** Perimeter / alley wall in the breach room's style (chain-link for 'barricade', armored concrete for 'station'). */
function shell(k: CompoundKit, x0: number, z0: number, x1: number, z1: number): void {
  solid(k.w, R(k, x0, z0, x1, z1), `${k.prefix}-x${k.n++}`, 'wall', k.wallHeight, k.landmark !== 'barricade');
}
/** Straight axis-aligned wall line of thickness 0.6 from (x0,z0) to (x1,z1). */
function shellLine(k: CompoundKit, x0: number, z0: number, x1: number, z1: number): void {
  if (z0 === z1) shell(k, Math.min(x0, x1), z0 - 0.3, Math.max(x0, x1), z0 + 0.3);
  else shell(k, x0 - 0.3, Math.min(z0, z1), x0 + 0.3, Math.max(z0, z1));
}

/** Free-standing chain-link fence run (blocks movement, not sight). */
function fence(k: CompoundKit, x0: number, z0: number, x1: number, z1: number): void {
  const alongX = z0 === z1, len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const panels = Math.max(1, Math.round(len / 3.2));
  for (let i = 0; i < panels; i++) {
    const t = (i + 0.5) / panels;
    k.w.props.push({ kind: 'chainFence', pos: { x: X(k, x0 + (x1 - x0) * t), z: Z(k, z0 + (z1 - z0) * t) },
      rotation: alongX ? 0 : Math.PI / 2, variant: 0, blocking: true });
  }
  // 0.6 m like every other wall: thinner colliders on a nav-cell boundary let A* cut round their ends.
  const r = alongX ? R(k, Math.min(x0, x1), z0 - 0.3, Math.max(x0, x1), z0 + 0.3)
    : R(k, x0 - 0.3, Math.min(z0, z1), x0 + 0.3, Math.max(z0, z1));
  solid(k.w, r, `${k.id}-fence-${k.n++}`, 'wall', 2.4, false);
}

const PROP_SIZE: Partial<Record<PropKind, { len: number; depth: number; height: number; sight: boolean; kind: 'wall' | 'prop' }>> = {
  container: { len: 6, depth: 2.45, height: 2.6, sight: true, kind: 'wall' },
  jerseyBarrier: { len: 2.8, depth: 0.82, height: 1.1, sight: false, kind: 'prop' }, // climbable
  sandbags: { len: 3.95, depth: 0.95, height: 1.0, sight: false, kind: 'prop' }, // climbable cover
  tent: { len: 4.0, depth: 3.8, height: 2.0, sight: true, kind: 'wall' },
};

/** Blocking prop with a matching collider. `alongZ` turns its long side north-south. */
function block(k: CompoundKit, kind: PropKind, x: number, z: number, alongZ = false): void {
  const s = PROP_SIZE[kind]!;
  const hx = (alongZ ? s.depth : s.len) / 2, hz = (alongZ ? s.len : s.depth) / 2;
  k.w.props.push({ kind, pos: { x: X(k, x), z: Z(k, z) }, rotation: alongZ ? Math.PI / 2 : 0,
    variant: Math.floor(k.rng.next() * 5), blocking: true });
  solid(k.w, R(k, x - hx, z - hz, x + hx, z + hz), `${k.id}-${kind}-${k.n++}`, s.kind, s.height, s.sight);
}
/** Row of `count` touching props starting at (x, z), running east (or south when alongZ). */
function row(k: CompoundKit, kind: PropKind, x: number, z: number, count: number, alongZ = false): void {
  const len = PROP_SIZE[kind]!.len;
  for (let i = 0; i < count; i++) block(k, kind, alongZ ? x : x + len * (i + 0.5), alongZ ? z + len * (i + 0.5) : z, alongZ);
}

function deco(k: CompoundKit, kind: PropKind, x: number, z: number, rotation = 0): void {
  prop(k.w, kind, X(k, x), Z(k, z), rotation, Math.floor(k.rng.next() * 6));
}

function bldg(k: CompoundKit, x0: number, z0: number, x1: number, z1: number, style: BuildingStyle, height: number,
  color: number): void {
  building(k.w, R(k, x0, z0, x1, z1), style, height, k.rng);
  k.w.buildings[k.w.buildings.length - 1].colorIndex = color;
}

function defender(k: CompoundKit, role: HumanRole, x: number, z: number, walk?: [number, number]): void {
  const p = { x: X(k, x), z: Z(k, z) };
  const route = walk ? [p, { x: p.x + walk[0], z: p.z + walk[1] }] : [p];
  human(k.w, role, 'stronghold', p, route, { strongholdId: k.id, facing: 0 });
}
function crew(k: CompoundKit, heavy: HeavyWeapon, x: number, z: number, dir: Dir, hullTag?: string): void {
  const p = { x: X(k, x), z: Z(k, z) };
  human(k.w, 'soldier', 'stronghold', p, [p], { strongholdId: k.id, facing: DIR_ANGLE[dir], heavy, ...(hullTag ? { hullTag } : {}) });
}

/** Mounted machine gun facing `dir`: sandbag front + two side bags, open back (the way to flank it). */
function mgNest(k: CompoundKit, x: number, z: number, dir: Dir): void {
  const fx = dir === 'E' ? 1 : dir === 'W' ? -1 : 0, fz = dir === 'S' ? 1 : dir === 'N' ? -1 : 0;
  const ns = fz !== 0; // forward along z
  block(k, 'sandbags', x + fx * 1.45, z + fz * 1.45, !ns);
  for (const side of [-1, 1]) {
    const px = ns ? side * 2.25 : fx * 0.5, pz = ns ? fz * 0.5 : side * 2.25;
    block(k, 'sandbags', x + px, z + pz, ns);
  }
  crew(k, 'mg', x, z, dir);
}

/** Tank parked facing `dir` (hull = blocking collider the crew sits inside; it stays as the wreck). */
function tank(k: CompoundKit, x: number, z: number, dir: Dir): void {
  const t = BALANCE.heavy.tank, ns = dir === 'N' || dir === 'S';
  const hx = (ns ? t.hullWidth : t.hullLength) / 2, hz = (ns ? t.hullLength : t.hullWidth) / 2;
  const tag = `hull-${k.id}-${k.n++}`;
  solid(k.w, R(k, x - hx, z - hz, x + hx, z + hz), tag, 'vehicle', t.hullHeight, true);
  crew(k, 'tank', x, z, dir, tag);
}

function ground(k: CompoundKit, kind: GroundKind, x0: number, z0: number, x1: number, z1: number): void {
  k.w.ground.push({ kind, rect: R(k, x0, z0, x1, z1) });
}

interface RoomSpec {
  kind: StructureKind;
  landmark: 'barricade' | 'station';
  room: [number, number, number, number];
  side: 'south' | 'west' | 'north' | 'east';
  gap: [number, number];
}

/** Breach room + stronghold record. Bounds = the whole compound; the hold point (tier >= 3) is the room centre. */
function core(w: WorldDraft, c: Vec2, id: StrongholdId, tier: number, structureId: number, rng: Rng, spec: RoomSpec,
  bounds: [number, number, number, number], nestZ = 28): { k: CompoundKit; door: StructureDef } {
  const height = spec.landmark === 'station' ? 3.2 : 2.4;
  const k: CompoundKit = { w, c, id, tier, rng, prefix: `${spec.landmark}-${structureId}`, landmark: spec.landmark,
    wallHeight: height, n: 0 };
  const [x0, z0, x1, z1] = spec.room;
  const ns = spec.side === 'south' || spec.side === 'north';
  const gap: [number, number] = ns ? [X(k, spec.gap[0]), X(k, spec.gap[1])] : [Z(k, spec.gap[0]), Z(k, spec.gap[1])];
  const door = enclosure(w, structureId, spec.kind, spec.landmark, R(k, x0, z0, x1, z1), spec.side, gap, height, true);
  const hold: Partial<ObjectiveDef> = { point: { x: X(k, (x0 + x1) / 2), z: Z(k, (z0 + z1) / 2) }, radius: 5,
    holdTime: 6 + tier, minZombies: tier + 2, requires: ['breach'] };
  stronghold(w, id, R(k, ...bounds), { x: c.x, z: c.z + nestZ }, [], [{ structureId: door.id }, {}, hold]);
  return { k, door };
}

type Builder = (w: WorldDraft, c: Vec2, sid: number, rng: Rng) => void;

/** Palm Park — ranger cabin inside a fenced yard; the only gap is on the far (east) side. */
const parkRangerPost: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'park_ranger_post', 1, sid, rng,
    { kind: 'alleyGate', landmark: 'barricade', room: [-7, -14, 7, -4], side: 'south', gap: [-2, 2] }, [-16, -19, 16, 7]);
  ground(k, 'park', -16, -19, 16, 7);
  fence(k, -15, -18, 15, -18); fence(k, -15, -18, -15, 6); fence(k, -15, 6, 15, 6);
  fence(k, 15, -18, 15, -9.5); fence(k, 15, -3.5, 15, 6);
  defender(k, 'police', 12, -6.5); defender(k, 'police', -6, 1, [8, 0]); defender(k, 'police', 0, -9);
  for (const [x, z] of [[-20, -12], [-19, 2], [19, -14], [20, 2], [-10, 12], [11, 12]]) deco(k, 'palm', x, z);
  deco(k, 'bench', -6, 10); deco(k, 'sign', 3, 8); deco(k, 'tree', 18, -6);
};

/** Sunny Boardwalk — lifeguard HQ behind dune fences; a 3 m boardwalk corridor runs up the west side. */
const boardwalkPatrol: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'boardwalk_patrol', 1, sid, rng,
    { kind: 'securityShutter', landmark: 'barricade', room: [-9, -6, 9, 6], side: 'west', gap: [-2, 2] }, [-17, -11, 13, 22]);
  ground(k, 'sand', -17, -11, 13, 22);
  fence(k, -16, -10, 12, -10); fence(k, 12, -10, 12, 10); fence(k, -13, 10, 12, 10);
  fence(k, -16, -10, -16, 22); fence(k, -13, 10, -13, 22);
  defender(k, 'police', -14.5, 8); defender(k, 'police', -12.5, -6, [0, 8]); defender(k, 'police', 4, 8, [4, 0]);
  deco(k, 'watchtower', 8, -8); deco(k, 'palm', -20, 4); deco(k, 'palm', 17, 14); deco(k, 'palm', 5, 16);
  deco(k, 'bench', 0, 15); deco(k, 'sign', -11, 20);
};

/** Arts District — gallery behind two mural blocks; the 3.5 m alley between them ends at a climbable barricade. */
const artsBarricade: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'arts_barricade', 1, sid, rng,
    { kind: 'penGate', landmark: 'barricade', room: [-8, -18, 8, -6], side: 'south', gap: [-2, 2] }, [-24.5, -20.5, 24.5, 10.5]);
  ground(k, 'plaza', -24.5, -20.5, 24.5, 10.5);
  bldg(k, -24, 0, -2, 10, 'apartment', 11, 4);
  bldg(k, 1.5, -4, 24, 6, 'storefront', 8, 5);
  shellLine(k, -24, -20, 24, -20); shellLine(k, -24, -20, -24, 0); shellLine(k, 24, -20, 24, -4);
  defender(k, 'police', 0, -3.6, [-3, 0]); defender(k, 'police', -14, -10); defender(k, 'police', 14, -12);
  deco(k, 'debris', -1, 4); deco(k, 'debris', 0, 8); deco(k, 'sign', -4, 12); deco(k, 'bench', 10, 14);
};

/** Neon Nights — club back-alley: a 3.5 m gap between the club blocks opens onto a cluttered service yard. */
const neonSecurity: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'neon_security', 2, sid, rng,
    { kind: 'storeDoor', landmark: 'barricade', room: [4, -19, 20, -7], side: 'west', gap: [-15, -11] }, [-24.5, -20.5, 24.5, 12.5]);
  ground(k, 'lot', -24.5, -20.5, 24.5, 12.5);
  bldg(k, -24, -2, -4, 12, 'apartment', 13, 2);
  bldg(k, -0.5, -2, 24, 12, 'storefront', 9, 3);
  shellLine(k, -24, -20, 24, -20); shellLine(k, -24, -20, -24, -2); shellLine(k, 24, -20, 24, -2);
  vehicle(w, 'dumpster', X(k, -15), Z(k, -8), 0, rng); vehicle(w, 'dumpster', X(k, -8), Z(k, -14), Math.PI / 2, rng);
  vehicle(w, 'dumpster', X(k, -20), Z(k, -16), 0, rng);
  defender(k, 'police', -2.2, -5); defender(k, 'police', -14, -12, [3, 0]); defender(k, 'police', 0, -17, [-4, 0]);
  defender(k, 'police', 9, -4.5); defender(k, 'police', 17, -4.5);
  for (const z of [0, 5, 10]) deco(k, 'sign', -3.7, z, Math.PI / 2);
  deco(k, 'streetlight', -2.2, 14); deco(k, 'trashCan', 2, 14);
};

/** Oceanfront Hotels — lobby between two towers; the pool fence forces a switchback across the deck. */
const hotelSecurity: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'hotel_security', 2, sid, rng,
    { kind: 'securityShutter', landmark: 'barricade', room: [-7, -19, 7, -7], side: 'south', gap: [-2, 2] }, [-24.5, -20.5, 24.5, 8.5]);
  ground(k, 'plaza', -24.5, -20.5, 24.5, 8.5);
  bldg(k, -24, -20, -10, 0, 'apartment', 24, 1);
  bldg(k, 10, -20, 24, 0, 'apartment', 27, 0);
  shellLine(k, -10, -20, 10, -20);
  fence(k, -10, 0, -10, 8); fence(k, 10, 0, 10, 8);
  fence(k, -10, 2, 6, 2); fence(k, -6, -3, 10, -3);
  defender(k, 'police', 0, -5, [3, 0]); defender(k, 'police', -8, -0.5); defender(k, 'police', 8.5, 5, [-4, 0]);
  defender(k, 'police', -8.5, -12); defender(k, 'police', 8.5, -12);
  for (const [x, z] of [[-18, 6], [-14, 14], [16, 6], [20, 14], [0, 14]]) deco(k, 'palm', x, z);
  deco(k, 'bench', -6, 12); deco(k, 'bench', 6, 12); deco(k, 'bush', 0, 5.5);
};

/** Luxury Marina — three container rows make a snaking lane to the harbor office at the back of the yard. */
const marinaCrews: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'marina_crews', 2, sid, rng,
    { kind: 'alleyGate', landmark: 'barricade', room: [8, -19, 22, -9], side: 'west', gap: [-16, -12] }, [-24.5, -20.5, 24.5, 17]);
  ground(k, 'lot', -24.5, -20.5, 24.5, 17);
  row(k, 'container', -12, 15, 6); row(k, 'container', -24, 9.2, 6); row(k, 'container', -12, 3.4, 6);
  shellLine(k, -24, -20, 24, -20); shellLine(k, -24, -20, -24, 8); shellLine(k, 24, -20, 24, 16.2);
  defender(k, 'police', -18, 12.2); defender(k, 'police', 18, 6.3); defender(k, 'police', -18, -1, [4, 0]);
  defender(k, 'police', 0, -6, [-4, 0]); defender(k, 'police', 4, -14);
  deco(k, 'floodlight', -22, -18); deco(k, 'floodlight', 2, -18); deco(k, 'bench', -18, 20); deco(k, 'palm', 20, 20);
};

/** Golf Estates — walled drive with a single gate covered by a mounted MG; a narrow service gap flanks it. */
const golfGatehouse: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'golf_gatehouse', 3, sid, rng,
    { kind: 'penGate', landmark: 'barricade', room: [10, -18, 22, -6], side: 'west', gap: [-14, -10] }, [-24.5, -20.5, 24.5, 10.5]);
  ground(k, 'park', -24.5, -20.5, 24.5, 10.5);
  shellLine(k, -24, 10, -3, 10); shellLine(k, 3, 10, 24, 10);
  shellLine(k, -24, -20, -24, 10); shellLine(k, -24, -20, 24, -20);
  shellLine(k, 24, -20, 24, -4); shellLine(k, 24, -1, 24, 10); // 3 m service gap at z -4..-1
  block(k, 'jerseyBarrier', -1.5, 10.9); block(k, 'jerseyBarrier', 1.5, 10.9); // boom barrier (climbable)
  mgNest(k, 0, -1, 'S');
  defender(k, 'soldier', 16, -2, [0, 2]);
  defender(k, 'police', -12, -10, [4, 0]); defender(k, 'police', -14, 4); defender(k, 'police', 14, 4, [3, 0]);
  defender(k, 'police', 6, -14);
  for (const [x, z] of [[-6, 14], [6, 14], [-18, -14], [-8, -16], [-20, 0], [18, 14]]) deco(k, 'tree', x, z);
  for (const x of [-12, -6, 6, 12]) deco(k, 'bush', x, 8.5);
};

/** Medical Center — quarantine fence lanes snake past two MG nests; tents clutter the triage yard. */
const medicalQuarantine: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'medical_quarantine', 4, sid, rng,
    { kind: 'penGate', landmark: 'barricade', room: [-7, -19, 7, -7], side: 'south', gap: [-2, 2] }, [-24.5, -20.5, 24.5, 12.5]);
  ground(k, 'lot', -24.5, -20.5, 24.5, 12.5);
  shellLine(k, -20, 12, 24, 12); shellLine(k, -24, -20, -24, 12); shellLine(k, 24, -20, 24, 12);
  shellLine(k, -24, -20, 24, -20);
  fence(k, -24, 6, 18, 6); fence(k, -18, 2, 24, 2);
  block(k, 'tent', 15, -7); block(k, 'tent', 15, -14); block(k, 'tent', -16, -14);
  mgNest(k, -6, -3, 'S'); mgNest(k, 8, -3, 'S');
  for (const [x, z, walk] of [[-14, -4, [0, -4]], [18, -1.8, [-3, 0]], [20, -10, [0, -4]], [-19, -8, [0, 3]],
    [20, 9, [-4, 0]], [-20, 3, [4, 0]]] as [number, number, [number, number] | undefined][]) {
    defender(k, 'soldier', x, z, walk);
  }
  deco(k, 'watchtower', -21, -17); deco(k, 'watchtower', 21, -17);
  deco(k, 'warningSign', -22, 14); deco(k, 'floodlight', -18, 14); deco(k, 'floodlight', 0, -17);
};

/** University — lecture halls with two 3 m breezeways; the camera room sits in the courtyard behind, MGs on both exits. */
const campusSecurity: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'campus_security', 4, sid, rng,
    { kind: 'stationDoor', landmark: 'station', room: [-8, -20, 8, -8], side: 'south', gap: [-2, 2] }, [-24.5, -20.5, 24.5, 16]);
  ground(k, 'plaza', -24.5, -20.5, 24.5, 16);
  bldg(k, -24, -4, -9.5, 8, 'civic', 12, 1);
  bldg(k, -6.5, -4, 6.5, 8, 'office', 15, 2);
  bldg(k, 9.5, -4, 24, 8, 'civic', 11, 3);
  shellLine(k, -24, -20, -8, -20); shellLine(k, 8, -20, 24, -20);
  shellLine(k, -24, -20, -24, -4); shellLine(k, 24, -20, 24, -4);
  mgNest(k, -18, -7, 'E'); mgNest(k, 18, -7, 'W'); // crossfire along the strip in front of the camera room
  defender(k, 'soldier', 0, -6, [-3, 0]); defender(k, 'soldier', -21, -14, [0, 3]); defender(k, 'soldier', 21, -14, [0, 3]);
  defender(k, 'soldier', -12, -17); defender(k, 'soldier', 12, -17); defender(k, 'soldier', 0, 12, [4, 0]);
  deco(k, 'watchtower', -21, -17); deco(k, 'watchtower', 21, -17);
  for (const x of [-16, 16]) deco(k, 'bench', x, 12);
  deco(k, 'palm', -8, 13); deco(k, 'palm', 9, 13); deco(k, 'sign', -8, 9);
};

/** Financial Core — bank plaza in a tower canyon: a tank holds the main gate, MGs cover the vault and the west alley. */
const financialTower: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'financial_tower', 5, sid, rng,
    { kind: 'stationDoor', landmark: 'station', room: [-9, -20, 9, -8], side: 'south', gap: [-2.5, 2.5] }, [-24.5, -20.5, 24.5, 16.5]);
  ground(k, 'plaza', -24.5, -20.5, 24.5, 16.5);
  bldg(k, -24, -20, -12, -4, 'office', 38, 5);
  bldg(k, 12, -20, 24, -4, 'office', 32, 6);
  shellLine(k, -12, -20, -9, -20); shellLine(k, 9, -20, 12, -20);
  shellLine(k, -24, -4, -24, 6); shellLine(k, -24, 9, -24, 16); // 3 m alley gaps at z 6..9 on both sides
  shellLine(k, 24, -4, 24, 6); shellLine(k, 24, 9, 24, 16);
  shellLine(k, -24, 16, -3, 16); shellLine(k, 3, 16, 24, 16);
  tank(k, 0, 4, 'S');
  mgNest(k, -7, -4, 'S'); mgNest(k, 7, -4, 'S'); mgNest(k, -19, 7.5, 'W');
  defender(k, 'soldier', -18, 0, [0, 2]); defender(k, 'soldier', 18, 0, [0, 2]); defender(k, 'soldier', -16, 12.5, [3, 0]);
  defender(k, 'soldier', 18, 12.5, [-3, 0]); defender(k, 'soldier', -6, 12); defender(k, 'soldier', 6, 12);
  defender(k, 'soldier', 0, -6);
  block(k, 'jerseyBarrier', -10, 10); block(k, 'jerseyBarrier', 10, 10);
  deco(k, 'watchtower', -21, 13.5); deco(k, 'watchtower', 21, 13.5);
  deco(k, 'streetlight', -4, 18); deco(k, 'streetlight', 4, 18); deco(k, 'sign', 0, 18.5);
};

/** Airport — open apron with container cover islands under a tank; a 3 m baggage tunnel runs up the east fence. */
const airportTerminal: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'airport_terminal', 5, sid, rng,
    { kind: 'stationDoor', landmark: 'station', room: [-14, -20, 14, -8], side: 'south', gap: [-3, 3] }, [-24.5, -20.5, 24.5, 18.5]);
  ground(k, 'lot', -24.5, -20.5, 24.5, 18.5);
  fence(k, -24, -20, -14, -20); fence(k, 14, -20, 24, -20);
  fence(k, -24, -20, -24, 18); fence(k, 24, -20, 24, 18);
  fence(k, -24, 18, -20, 18); fence(k, -14, 18, 21, 18); // main gate x -20..-14, tunnel mouth x 21..24
  row(k, 'container', 19.8, -6, 4, true); // tunnel wall: x 18.6..21, z -6..18
  block(k, 'container', -12, 10); block(k, 'container', 4, 11); block(k, 'container', -4, 3, true);
  block(k, 'container', -16, -2); block(k, 'jerseyBarrier', 8, 2); block(k, 'jerseyBarrier', -10, 14);
  tank(k, 10, 7, 'W');
  mgNest(k, -9, -3.5, 'S'); mgNest(k, 9, -3.5, 'S');
  for (const [x, z, walk] of [[-20, -4, [0, 3]], [16, -6, [0, 3]], [-20, 12, [3, 0]], [0, -6, undefined],
    [-6, 14, [4, 0]], [14, 14, [-3, 0]], [-2, 8, undefined], [22.5, -14, [0, 3]]] as [number, number, [number, number] | undefined][]) {
    defender(k, 'soldier', x, z, walk);
  }
  deco(k, 'watchtower', -21, -17); deco(k, 'watchtower', 17, -17);
  deco(k, 'wreck', -2, 15); deco(k, 'floodlight', -18, 20); deco(k, 'floodlight', 0, -18);
};

/** Military Base — double wall with a 3.4 m chicane lane, two tanks in the yard, MG nests on the lane exit and the bunker. */
const militaryHq: Builder = (w, c, sid, rng) => {
  const { k } = core(w, c, 'military_hq', 5, sid, rng,
    { kind: 'stationDoor', landmark: 'station', room: [-8, -20, 8, -8], side: 'south', gap: [-2, 2] }, [-24.5, -20.5, 24.5, 18.5]);
  ground(k, 'compound', -24.5, -20.5, 24.5, 18.5);
  shellLine(k, -24, 18, 18, 18); shellLine(k, 22, 18, 24, 18); // outer gate x 18..22
  shellLine(k, -24, 13.7, -22, 13.7); shellLine(k, -18, 13.7, 24, 13.7); // inner gate x -22..-18
  shellLine(k, -24, -20, -24, 18); shellLine(k, 24, -20, 24, 18);
  shellLine(k, -24, -20, -8, -20); shellLine(k, 8, -20, 24, -20);
  tank(k, -8, 4, 'S'); tank(k, 10, -2, 'W');
  mgNest(k, -14, 7, 'W'); mgNest(k, 14, -12, 'W');
  for (const [x, z, walk] of [[0, -6, [3, 0]], [-18, -14, [0, 3]], [20, -16, [0, 3]], [4, 8, [3, 0]],
    [18, 6, [0, 3]], [-2, 11, undefined], [-20, 0, [0, 3]]] as [number, number, [number, number] | undefined][]) {
    defender(k, 'soldier', x, z, walk);
  }
  block(k, 'sandbags', 2, 1); block(k, 'sandbags', -16, -6);
  deco(k, 'watchtower', -21, -17); deco(k, 'watchtower', 21, -17); deco(k, 'watchtower', 21, 10);
  deco(k, 'floodlight', -10, -18); deco(k, 'floodlight', 10, -18); deco(k, 'warningSign', 20, 20);
};

export const COMPOUND_BUILDERS: Readonly<Partial<Record<StrongholdId, Builder>>> = {
  park_ranger_post: parkRangerPost,
  boardwalk_patrol: boardwalkPatrol,
  arts_barricade: artsBarricade,
  neon_security: neonSecurity,
  hotel_security: hotelSecurity,
  marina_crews: marinaCrews,
  golf_gatehouse: golfGatehouse,
  medical_quarantine: medicalQuarantine,
  campus_security: campusSecurity,
  financial_tower: financialTower,
  airport_terminal: airportTerminal,
  military_hq: militaryHq,
};
