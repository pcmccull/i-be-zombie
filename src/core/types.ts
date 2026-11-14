// Shared data model. This file is the cross-agent CONTRACT (see AGENTS.md).
// Pure data only: NO three.js imports here or anywhere under src/sim, src/systems,
// src/world/{CollisionWorld,NavigationGrid,districtLayout}.ts, src/utils.
//
// Coordinates: meters, X/Z ground plane, Y up. North = -Z, East = +X.
// Facing angles: radians, 0 = facing +Z, measured so that forward = (sin(a), cos(a)).

export type EntityId = number;

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

// ---------------------------------------------------------------------------
// World / layout
// ---------------------------------------------------------------------------

export type ColliderKind =
  | 'building'
  | 'vehicle'
  | 'prop' // dumpsters, barriers, large planters (small litter is NOT a collider)
  | 'wall' // checkpoint perimeter, sandbag walls
  | 'gate'
  | 'tower'
  | 'breakable'; // destructible landmark obstruction (bus door, alley gate, store door, pen gate)

export interface ColliderDef extends AABB {
  kind: ColliderKind;
  /** Visual + LOS height in meters. A sight line is blocked only where it passes below this height. */
  height: number;
  blocksMove: boolean;
  blocksSight: boolean;
  /** Optional authoring tag, e.g. 'gate', 'towerW', 'bldg-12'. */
  tag?: string;
}

export interface Collider extends ColliderDef {
  id: number; // index into CollisionWorld.colliders
  enabled: boolean;
}

export type BuildingStyle = 'apartment' | 'storefront' | 'warehouse' | 'office' | 'garage';

export interface BuildingDef {
  footprint: AABB;
  height: number;
  style: BuildingStyle;
  colorIndex: number; // into a palette chosen by the visual layer
}

export type PropKind =
  | 'streetlight'
  | 'trafficLight'
  | 'sign'
  | 'bench'
  | 'trashCan'
  | 'dumpster'
  | 'hydrant'
  | 'utilityPole'
  | 'tree'
  | 'bush'
  | 'barrier'
  | 'fence'
  | 'car'
  | 'truck'
  | 'debris'
  | 'sandbags'
  | 'floodlight'
  | 'warningSign'
  | 'acUnit';

export interface PropDef {
  kind: PropKind;
  pos: Vec2;
  rotation: number; // radians about Y
  variant?: number;
  /** If true, layout also emits a ColliderDef for it. */
  blocking: boolean;
}

export type GroundKind = 'road' | 'sidewalk' | 'park' | 'plaza' | 'lot' | 'compound';

export interface GroundPatch {
  kind: GroundKind;
  rect: AABB;
}

export interface RoadMarking {
  kind: 'laneDash' | 'crosswalk' | 'stopLine' | 'parkingBay' | 'crack' | 'drain';
  rect: AABB;
  rotation: number;
}

export interface SpawnZone {
  name: string; // 'residential', 'commercial', 'alley', 'courtyard', ...
  rect: AABB;
  count: number; // ambient walkers spawned here; all zones sum to BALANCE.horde.initialAmbient
  /** Structure id (StructureDef.id) that traps these zombies until it is destroyed. Omitted/0 = free. */
  heldBy?: number;
}

/** Destructible landmark obstruction (environmental recruitment opportunities). */
export type StructureKind = 'busDoor' | 'alleyGate' | 'storeDoor' | 'penGate';

/** Which landmark a structure / zone / human belongs to (visuals + HUD labels). */
export type LandmarkKind = 'bus' | 'alley' | 'store' | 'barricade';

export interface StructureDef {
  /** Stable id >= 1, unique within the layout (0 means "none" elsewhere). */
  id: number;
  kind: StructureKind;
  landmark: LandmarkKind;
  /** Tag of exactly one ColliderDef (kind 'breakable', blocksMove + blocksSight) with this exact footprint. */
  tag: string;
  rect: AABB;
  /** Facing of the structure's outer face (entity facing convention): points from the enclosure toward attackers. */
  facing: number;
  /** Walkable world points on the outside where attackers stand (>= 3). */
  approachOutside: Vec2[];
  /** Walkable world points just inside the enclosure (release exit path / sheltered side), >= 2. */
  approachInside: Vec2[];
  /** Interior area this structure seals (trapped zombies / sheltered humans live here). */
  enclosure: AABB;
  /** Awards BALANCE.momentum.gainStructure when destroyed. */
  defensive: boolean;
}

/** 'soldier' = armed human (shoots). 'civilian' = unarmed, flees, never shoots. */
export type HumanRole = 'soldier' | 'civilian';
/** Where a human belongs. Victory only requires every 'checkpoint' human DEAD. */
export type HumanPost = 'checkpoint' | 'barricade' | 'street' | 'store';

export interface GuardSpawn {
  /** Default 'soldier'. */
  role?: HumanRole;
  /** Default 'checkpoint'. */
  post?: HumanPost;
  /** Optional area the human stays inside (civilian flee clamp, store interior). */
  homeArea?: AABB;
  /** Structure id this human is sheltered behind (store door). Horde attack orders redirect to it while intact. */
  shelter?: number;
  pos: Vec2;
  facing: number;
  tower: 'W' | 'E' | null; // tower occupant?
  waypoints: Vec2[]; // patrol loop; may be [pos] for stationary
}

export interface CheckpointLayout {
  bounds: AABB; // ~42 x 32 m compound
  gate: { rect: AABB; facing: number; tag: 'gate' };
  /** World points just outside + inside the gate where attackers stand. */
  gateApproachOutside: Vec2[];
  gateApproachInside: Vec2[];
  towers: { id: 'W' | 'E'; rect: AABB; platformHeight: number }[];
  stagingArea: AABB; // roadside open area for staging the horde
}

export interface DistrictLayout {
  bounds: AABB;
  ground: GroundPatch[];
  markings: RoadMarking[];
  buildings: BuildingDef[];
  props: PropDef[];
  colliders: ColliderDef[]; // buildings + blocking props + checkpoint walls/gate/towers
  playerStart: Vec2;
  playerStartFacing: number;
  spawnZones: SpawnZone[];
  checkpoint: CheckpointLayout;
  /** All humans. Exactly BALANCE.guard.count with post 'checkpoint' (2 of them in towers), plus outposts/civilians. */
  guards: GuardSpawn[];
  /** Destructible landmark obstructions (bus door, alley gate, store door, police pen gate). */
  structures: StructureDef[];
  /** Walkable area around playerStart where BALANCE.horde.startFollowers initial followers spawn. */
  startFollowerArea: AABB;
}

// ---------------------------------------------------------------------------
// Entities (logical state; meshes mirror these, never the reverse)
// ---------------------------------------------------------------------------

export type AnimAction = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'dead' | 'rise' | 'climb';

interface MobileBase {
  id: EntityId;
  pos: Vec2;
  prevPos: Vec2; // copied from pos at the start of each fixed step (render interpolation)
  vel: Vec2;
  facing: number;
  prevFacing: number;
  radius: number;
  hp: number;
  maxHp: number;
  attackCooldown: number; // seconds until next attack allowed
  anim: AnimAction;
  animTime: number; // seconds since anim changed (visuals drive one-shot clips from this)
  hitFlash: number; // seconds remaining of damage flash
}

export interface LeaderState extends MobileBase {
  alive: boolean;
  stamina: number;
  exhausted: boolean; // latch: true from 0 stamina until stamina >= exhaustedRecoverThreshold
  sprinting: boolean;
}

export type ZombieState = 'ambient' | 'rising' | 'follower' | 'dead';

export interface ZombieAgent extends MobileBase {
  state: ZombieState;
  variant: number; // 0..5 palette/garment variant
  speedScale: number; // 1 +/- BALANCE.walker.speedVariance
  /** Personal offset (meters) around the follow anchor so the pack spreads organically. */
  followOffset: Vec2;
  /** Current melee target while follower (explicit order or opportunistic). */
  engageTarget: TargetRef | null;
  // ambient wandering
  spawnZone: number;
  wanderTarget: Vec2 | null;
  wanderTimer: number;
  // timers
  stateTime: number; // seconds in current state
  stuckTimer: number;
  isConverted: boolean; // came from a guard conversion
  /** 0 = group attacking `GameState.order` (or following); otherwise the id of a `Squad`. */
  squad: number;
  /** Height above ground (m): climbing a watchtower or crawling over a car. Visual + tower melee gate. */
  elevation: number;
  /** Structure id trapping this ambient zombie (0 = free). Held zombies cannot be recruited and wander only in their zone. */
  heldBy: number;
  /** Recruitment generation: -1 never recruited; 0 = joined via leader/rally/start/conversion; n = via a gen n-1 pulse. */
  recruitGen: number;
  /** Sim time at which this zombie's single recruitment pulse fires; -1 = none pending (fired or never scheduled). */
  pulseAt: number;
  /** Seconds remaining of the "just recruited" highlight (visual flash + catch-up speed boost). */
  recruitFlash: number;
}

export type GuardState = 'PATROL' | 'ALERT' | 'COMBAT' | 'RETREAT' | 'DEAD';

export type DamageSource = 'zombie' | 'other';

export interface GuardAgent extends MobileBase {
  role: HumanRole;
  post: HumanPost;
  homeArea: AABB | null;
  /** Structure id sheltering this human (0 = none). */
  shelter: number;
  state: GuardState;
  stateTime: number;
  tower: 'W' | 'E' | null;
  towerColliderId: number | null; // ignore this collider for LOS/melee access to the occupant
  elevation: number; // 0 on ground, platform height in tower
  waypoints: Vec2[];
  waypointIndex: number;
  path: Vec2[]; // current A* path (world points)
  pathIndex: number;
  idleTimer: number;
  perceptionTimer: number; // counts down to next LOS/perception tick
  target: TargetRef | null; // zombie or leader being shot at
  lostTargetTimer: number;
  lastDamageSource: DamageSource;
  deathTime: number | null; // sim time of death
}

export interface GateState {
  colliderId: number;
  rect: AABB;
  center: Vec2;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  hitFlash: number;
}

export interface StructureState {
  id: number; // StructureDef.id
  kind: StructureKind;
  landmark: LandmarkKind;
  colliderId: number;
  rect: AABB;
  center: Vec2;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  hitFlash: number;
  /** Sim time of destruction (release animation timing); null while intact. */
  destroyedAt: number | null;
}

export type MomentumTier = 'dormant' | 'growing' | 'full';
export type MomentumReason = 'recruit' | 'convert' | 'armedKill' | 'structure';

export interface MomentumState {
  value: number; // 0..BALANCE.momentum.max
  /** Seconds since the last gain (decay starts after BALANCE.momentum.graceTime). */
  idleTime: number;
  tier: MomentumTier;
  /** Seconds remaining of the HUD "gain" pulse. */
  gainFlash: number;
}

// ---------------------------------------------------------------------------
// Targets, orders, abilities
// ---------------------------------------------------------------------------

export type TargetRef =
  | { kind: 'guard'; id: EntityId }
  | { kind: 'gate' }
  | { kind: 'structure'; id: number } // StructureState.id
  | { kind: 'zombie'; id: EntityId } // used by guards only
  | { kind: 'leader' }; // used by guards only

export type HordeOrder = { type: 'follow' } | { type: 'attack'; target: TargetRef };

/**
 * An extra selected attack target. Clicking targets toggles them in/out of the selection:
 * `GameState.order` holds the first selected target (group 0), `squads` the others, and
 * followers are split evenly between all selected targets.
 */
export interface Squad {
  id: number;
  target: TargetRef;
}

export interface AbilityState {
  rallyCooldown: number; // seconds remaining, 0 = ready
  rushCooldown: number;
  rushTimeLeft: number; // > 0 while Rush active
}

export interface PendingConversion {
  guardId: EntityId;
  pos: Vec2;
  facing: number;
  resolveAt: number; // sim time at which the body rises (or stays dead)
  willConvert: boolean; // RNG rolled at death time
}

export interface GameStats {
  recruited: number; // ambient walkers that joined
  conversions: number; // counted when the new follower becomes active
  losses: number; // followers that died
  guardsKilled: number;
  /** Followers gained through cascade pulses (subset of recruited). */
  cascadeRecruits: number;
  structuresDestroyed: number;
}

export type GamePhase = 'playing' | 'victory' | 'defeat';

export interface GameState {
  time: number; // sim seconds since (re)start
  phase: GamePhase;
  nextEntityId: number;
  leader: LeaderState;
  zombies: ZombieAgent[]; // ambient + rising + followers + dead (corpses until faded)
  guards: GuardAgent[];
  gate: GateState;
  structures: StructureState[];
  momentum: MomentumState;
  order: HordeOrder;
  /** Additional selected targets; zombies with `squad === id` attack that squad's target instead of `order`. */
  squads: Squad[];
  abilities: AbilityState;
  pendingConversions: PendingConversion[];
  stats: GameStats;
  /** Live follower count; must always equal zombies.filter(z => z.state === 'follower').length. */
  followerCount: number;
  capReachedFlash: number; // seconds remaining of "HORDE FULL" HUD feedback
}

// ---------------------------------------------------------------------------
// Input (produced by InputController, consumed by Simulation.step)
// ---------------------------------------------------------------------------

export interface SimInput {
  /** Raw input axes in [-1,1]: forward (W=+1) and right (D=+1). Not yet normalized. */
  moveForward: number;
  moveRight: number;
  /** Camera yaw (radians, same convention as facing) for camera-relative movement. */
  cameraYaw: number;
  sprint: boolean;
  // one-shot edge-triggered actions (true for exactly one step)
  rally: boolean;
  rush: boolean;
  recall: boolean;
  attackTarget: TargetRef | null; // left-click on a valid guard/gate/structure: toggles it in/out of the selection
}

export function emptyInput(): SimInput {
  return {
    moveForward: 0,
    moveRight: 0,
    cameraYaw: 0,
    sprint: false,
    rally: false,
    rush: false,
    recall: false,
    attackTarget: null,
  };
}

// ---------------------------------------------------------------------------
// Events (sim -> visuals/audio/HUD). Drained once per rendered frame.
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'recruited'; zombieId: EntityId; pos: Vec2; viaRally: boolean; generation: number }
  | { type: 'recruitPulse'; zombieId: EntityId; pos: Vec2; radius: number; generation: number; recruits: number }
  | { type: 'structureDamaged'; id: number; kind: StructureKind; hp: number; maxHp: number; pos: Vec2 }
  | { type: 'structureDestroyed'; id: number; kind: StructureKind; landmark: LandmarkKind; pos: Vec2 }
  | { type: 'released'; structureId: number; count: number; pos: Vec2 }
  | { type: 'momentumGain'; amount: number; value: number; reason: MomentumReason }
  | { type: 'momentumTier'; tier: MomentumTier; value: number }
  | { type: 'rally'; pos: Vec2; radius: number }
  | { type: 'rushStart' }
  | { type: 'rushEnd' }
  | { type: 'capReached' }
  | { type: 'orderChanged'; order: HordeOrder }
  | { type: 'shot'; guardId: EntityId; from: Vec3; to: Vec3; hit: boolean }
  | { type: 'melee'; attacker: 'leader' | 'zombie'; attackerId: EntityId; target: TargetRef; pos: Vec2 }
  | { type: 'damage'; target: TargetRef; amount: number; pos: Vec2 }
  | { type: 'zombieDied'; zombieId: EntityId; pos: Vec2 }
  | { type: 'guardDied'; guardId: EntityId; pos: Vec2; source: DamageSource; role: HumanRole }
  | { type: 'guardAlert'; guardId: EntityId; pos: Vec2; role?: HumanRole } // role: set by R2; absent = soldier
  | { type: 'gateDestroyed'; pos: Vec2 }
  | { type: 'conversionStart'; guardId: EntityId; zombieId: EntityId; pos: Vec2 }
  | { type: 'converted'; guardId: EntityId; zombieId: EntityId; pos: Vec2 }
  | { type: 'leaderDied'; pos: Vec2 }
  | { type: 'victory' }
  | { type: 'defeat' };

// ---------------------------------------------------------------------------
// Utility interfaces
// ---------------------------------------------------------------------------

/** Injectable RNG so tests are deterministic. next() returns [0,1). */
export interface Rng {
  next(): number;
}
