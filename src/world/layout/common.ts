import type {
  AABB, BuildingStyle, ColliderDef, DistrictId, DistrictLayout, GuardSpawn, ObjectiveDef,
  PropDef, Rng, StrongholdDef, StrongholdId, StructureDef, StructureKind, Vec2,
} from '../../core/types';
import { DISTRICTS } from '../../content/districts';
import { strongholdMeta } from '../../content/strongholds';

export type WorldDraft = Omit<DistrictLayout, 'checkpoint'>;
export function rect(minX: number, minZ: number, maxX: number, maxZ: number): AABB {
  return { minX, minZ, maxX, maxZ };
}
export function center(r: AABB): Vec2 { return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }; }
export function solid(w: WorldDraft, r: AABB, tag: string, kind: ColliderDef['kind'] = 'wall', height = 2.4,
  blocksSight = true): void {
  w.colliders.push({ ...r, tag, kind, height, blocksMove: true, blocksSight });
}
export function building(w: WorldDraft, r: AABB, style: BuildingStyle, height: number, rng: Rng): void {
  w.buildings.push({ footprint: r, style, height, colorIndex: Math.floor(rng.next() * 8) });
  solid(w, r, `building-${w.buildings.length}`, 'building', height);
}
export function prop(w: WorldDraft, kind: PropDef['kind'], x: number, z: number, rotation = 0, variant = 0): void {
  w.props.push({ kind, pos: { x, z }, rotation, variant, blocking: false });
}
export function vehicle(w: WorldDraft, kind: 'car' | 'truck' | 'dumpster' | 'barrier', x: number, z: number,
  rotation: number, rng: Rng): void {
  const dims = { car: [2, 4.4, 1.7], truck: [2.6, 7, 3], dumpster: [2, 1.2, 1.4], barrier: [3, 0.9, 1.1] }[kind];
  const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation));
  const hx = (dims[0] * c + dims[1] * s) / 2, hz = (dims[0] * s + dims[1] * c) / 2;
  w.props.push({ kind, pos: { x, z }, rotation, variant: Math.floor(rng.next() * 6), blocking: true });
  solid(w, rect(x - hx, z - hz, x + hx, z + hz), `prop-${w.props.length}`,
    kind === 'car' || kind === 'truck' ? 'vehicle' : 'prop', dims[2], kind !== 'barrier' && kind !== 'dumpster');
}

/** Hollow room with one breakable opening, never a solid building over its interior. */
export function enclosure(w: WorldDraft, id: number, kind: StructureKind, landmark: StructureDef['landmark'],
  bounds: AABB, side: 'south' | 'west' | 'north' | 'east', gap: [number, number], height: number, defensive: boolean): StructureDef {
  const b = bounds, t = 0.6, prefix = `${landmark}-${id}`;
  const shellKind = landmark === 'bus' ? 'vehicle' : landmark === 'store' ? 'building' : 'wall';
  const wall = (suffix: string, r: AABB): void => solid(w, r, `${prefix}-${suffix}`, shellKind, height, landmark !== 'barricade');
  if (side !== 'north') wall('n', rect(b.minX, b.minZ, b.maxX, b.minZ + t));
  if (side !== 'east') wall('e', rect(b.maxX - t, b.minZ, b.maxX, b.maxZ));
  let door: AABB, approachOutside: Vec2[], approachInside: Vec2[];
  const mid = (gap[0] + gap[1]) / 2;
  let facing = side === 'south' ? 0 : -Math.PI / 2;
  if (side === 'north' || side === 'east') {
    // Door on the far side: the rest of the shell is closed (n/e walls above are skipped for this side).
    wall('w', rect(b.minX, b.minZ, b.minX + t, b.maxZ));
    wall('s', rect(b.minX, b.maxZ - t, b.maxX, b.maxZ));
    if (side === 'north') {
      wall('nw', rect(b.minX, b.minZ, gap[0], b.minZ + t));
      wall('ne', rect(gap[1], b.minZ, b.maxX, b.minZ + t));
      door = rect(gap[0], b.minZ, gap[1], b.minZ + t);
      approachOutside = [-1, 0, 1].map(dx => ({ x: mid + dx, z: b.minZ - 1.8 }));
      approachInside = [-0.8, 0.8].map(dx => ({ x: mid + dx, z: b.minZ + 2 }));
      facing = Math.PI;
    } else {
      wall('en', rect(b.maxX - t, b.minZ, b.maxX, gap[0]));
      wall('es', rect(b.maxX - t, gap[1], b.maxX, b.maxZ));
      door = rect(b.maxX - t, gap[0], b.maxX, gap[1]);
      approachOutside = [-1, 0, 1].map(dz => ({ x: b.maxX + 1.8, z: mid + dz }));
      approachInside = [-0.8, 0.8].map(dz => ({ x: b.maxX - 2, z: mid + dz }));
      facing = Math.PI / 2;
    }
  } else if (side === 'south') {
    wall('w', rect(b.minX, b.minZ, b.minX + t, b.maxZ));
    wall('sw', rect(b.minX, b.maxZ - t, gap[0], b.maxZ));
    wall('se', rect(gap[1], b.maxZ - t, b.maxX, b.maxZ));
    door = rect(gap[0], b.maxZ - t, gap[1], b.maxZ);
    approachOutside = [-1, 0, 1].map(dx => ({ x: mid + dx, z: b.maxZ + 1.8 }));
    approachInside = [-0.8, 0.8].map(dx => ({ x: mid + dx, z: b.maxZ - 2 }));
  } else {
    wall('s', rect(b.minX, b.maxZ - t, b.maxX, b.maxZ));
    wall('wn', rect(b.minX, b.minZ, b.minX + t, gap[0]));
    wall('ws', rect(b.minX, gap[1], b.minX + t, b.maxZ));
    door = rect(b.minX, gap[0], b.minX + t, gap[1]);
    approachOutside = [-1, 0, 1].map(dz => ({ x: b.minX - 1.8, z: mid + dz }));
    approachInside = [-0.8, 0.8].map(dz => ({ x: b.minX + 2, z: mid + dz }));
  }
  const def: StructureDef = {
    id, kind, landmark, tag: `${prefix}-door`, rect: door, facing,
    approachOutside, approachInside, enclosure: rect(b.minX + t, b.minZ + t, b.maxX - t, b.maxZ - t), defensive,
  };
  solid(w, door, def.tag, 'breakable', height);
  w.structures.push(def);
  w.ground.push({ kind: landmark === 'bus' ? 'lot' : 'compound', rect: bounds });
  return def;
}
export function district(w: WorldDraft, id: DistrictId, bounds: AABB, civilianBudget: number, ambientBudget: number,
  zones: { rect: AABB; count: number }[]): void {
  const meta = DISTRICTS.find(d => d.id === id)!;
  w.districts.push({ ...meta, rect: bounds, civilianBudget, ambientBudget, spawnPoints: zones.map(z => center(z.rect)) });
  zones.forEach((z, i) => w.spawnZones.push({ ...z, name: `${id}-free-${i}` }));
}
export function stronghold(w: WorldDraft, id: StrongholdId, bounds: AABB, nest: Vec2, reinforcementPoints: Vec2[],
  details: Partial<ObjectiveDef>[]): StrongholdDef {
  const meta = strongholdMeta(id), nestId = `nest_${id}`;
  const def: StrongholdDef = { ...meta, bounds, center: center(bounds), nestId, reinforcementPoints,
    objectives: meta.objectives.map((objective, i) => ({ ...objective, ...details[i] })) };
  w.strongholds.push(def);
  w.nests.push({ id: nestId, districtId: meta.districtId, pos: nest, strongholdId: id });
  return def;
}
export function human(w: WorldDraft, role: GuardSpawn['role'], post: GuardSpawn['post'], pos: Vec2,
  waypoints: Vec2[] = [pos], extras: Partial<GuardSpawn> = {}): void {
  w.guards.push({ role, post, pos: { ...pos }, facing: Math.PI, tower: null,
    waypoints: waypoints.map(p => ({ ...p })), strongholdId: null, ...extras });
}
export function streetPopulation(w: WorldDraft, count: number, home: AABB, patrols = false): void {
  for (let i = 0; i < count; i++) {
    const x = home.minX + 4 + (i % 8) * (home.maxX - home.minX - 8) / 7;
    const z = home.minZ + 2 + Math.floor(i / 8) * 1.6;
    const points = [{ x, z }, { x: Math.min(home.maxX - 2, x + 4), z }];
    human(w, 'civilian', 'street', points[0], points, { homeArea: home });
  }
  if (patrols) {
    for (const x of [home.minX + 12, home.maxX - 12]) {
      const z = (home.minZ + home.maxZ) / 2;
      human(w, 'police', 'patrol', { x, z }, [{ x, z }, { x: x + 6, z }, { x: x + 6, z: z + 2 }, { x, z: z + 2 }]);
    }
  }
}
