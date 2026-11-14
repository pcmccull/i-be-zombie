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

export type BuildingStyle = 'apartment' | 'storefront' | 'warehouse' | 'office' | 'garage' | 'house' | 'mall' | 'civic';

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
export type StructureKind = 'busDoor' | 'alleyGate' | 'storeDoor' | 'penGate' | 'stationDoor' | 'securityShutter';

/** Which landmark a structure / zone / human belongs to (visuals + HUD labels). */
export type LandmarkKind = 'bus' | 'alley' | 'store' | 'barricade' | 'station' | 'mall';

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

/**
 * 'soldier' = rifle (towers, industrial yard). 'police' = pistol (BALANCE.police). 'civilian' = unarmed, flees, never shoots.
 * Both 'soldier' and 'police' are "armed" everywhere the code says soldier/armed.
 */
export type HumanRole = 'soldier' | 'police' | 'civilian';
/**
 * Where a human belongs. 'stronghold' = defender of GuardSpawn.strongholdId; 'patrol' = district patrol / reinforcement.
 * @deprecated 'checkpoint' | 'barricade' are legacy-layout posts (removed in T015); new layouts use 'stronghold'.
 */
export type HumanPost = 'checkpoint' | 'barricade' | 'stronghold' | 'patrol' | 'street' | 'store';

// ---------------------------------------------------------------------------
// Open world (docs/3_open_world.md): districts, strongholds, nests, abilities
// ---------------------------------------------------------------------------

export type DistrictId = 'suburbs' | 'police' | 'shopping' | 'industrial';
export const DISTRICT_IDS: readonly DistrictId[] = ['suburbs', 'police', 'shopping', 'industrial'];
/** Territory control. Independent of fog discovery (discovering never conquers). */
export type TerritoryStatus = 'unknown' | 'human' | 'contested' | 'infected';
export type StrongholdId = 'suburb_checkpoint' | 'police_station' | 'mall_security' | 'industrial_yard';
/** 'pounce' is data-only this milestone (no unlock source). */
export type AbilityId = 'bite' | 'infect' | 'alpha_claws' | 'horde_frenzy' | 'pounce' | 'brute_evolution';
export type AbilityType = 'alpha' | 'horde' | 'passive';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  type: AbilityType;
  /** Stronghold whose capture unlocks it; null = innate (bite/infect) or not obtainable (pounce). */
  source: StrongholdId | null;
  /** 'slot' = must be equipped in one of the 4 slots (Q/E/R/F) to work; 'innate' = always on, never slotted. */
  slotBehavior: 'slot' | 'innate';
  /** true = pressing its slot key activates it (cooldown/cost); false = works while equipped (alpha_claws modifies LMB). */
  activatable: boolean;
  cooldown: number; // seconds, 0 for passives
  biomassCost: number; // per activation (brute_evolution: per brute created)
  duration: number; // seconds of effect, 0 if instant/passive
  description: string;
}

export type ObjectiveKind = 'destroyStructure' | 'destroyGate' | 'killDefenders' | 'holdPoint';

export interface ObjectiveDef {
  /** Unique within its stronghold, e.g. 'breach', 'disable_command'. */
  id: string;
  label: string; // HUD text, e.g. 'Breach the front doors'
  kind: ObjectiveKind;
  /** destroyStructure: StructureDef.id. */
  structureId?: number;
  /** holdPoint: center/radius; satisfied after holdTime s with >= minZombies followers inside and no living armed defender of this stronghold inside. */
  point?: Vec2;
  radius?: number;
  holdTime?: number;
  minZombies?: number;
  /** Objective ids that must be done before this one can progress (default none). */
  requires?: string[];
}

export interface StrongholdDef {
  id: StrongholdId;
  districtId: DistrictId;
  name: string;
  bounds: AABB; // defended area (HUD/map annotation, contested detection)
  center: Vec2;
  defenseTier: number; // 1..3, difficulty shown on the map
  unlock: AbilityId | null;
  biomassReward: number;
  /** All must be done (in any allowed order) to capture. */
  objectives: ObjectiveDef[];
  /** NestDef.id activated on capture. */
  nestId: string;
  /** Walkable points (outside bounds, out of sight lines) where reinforcement squads appear. */
  reinforcementPoints: Vec2[];
}

export interface NestDef {
  id: string;
  districtId: DistrictId;
  pos: Vec2;
  /** null = the start nest (always active). Otherwise active once that stronghold is captured. */
  strongholdId: StrongholdId | null;
}

export interface DistrictDef {
  id: DistrictId;
  name: string;
  rect: AABB; // districts tile layout.bounds exactly, no gaps / overlaps
  strongholdId: StrongholdId | null;
  /** Living civilians the PopulationSystem keeps (respawns) while the district is not 'infected'. */
  civilianBudget: number;
  /** Free ambient zombies the PopulationSystem keeps topped up. */
  ambientBudget: number;
  /** Walkable respawn points for civilians / ambient zombies (>= 4). */
  spawnPoints: Vec2[];
  /** Short map/landmark description. */
  landmark: string;
}

export interface GuardSpawn {
  /** Default 'soldier'. */
  role?: HumanRole;
  /** Default 'checkpoint' (legacy). */
  post?: HumanPost;
  /** Stronghold this human defends (post 'stronghold'); default null. */
  strongholdId?: StrongholdId | null;
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
  // --- open world (legacy layout fills these with a single-district equivalent) ---
  districts: DistrictDef[];
  strongholds: StrongholdDef[];
  nests: NestDef[];
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

export type LeaderAttackPhase = 'ready' | 'windup' | 'recovery';

export interface LeaderState extends MobileBase {
  alive: boolean;
  stamina: number;
  exhausted: boolean; // latch: true from 0 stamina until stamina >= exhaustedRecoverThreshold
  sprinting: boolean;
  // Direct (LMB) attack state machine — BALANCE.alpha
  attackPhase: LeaderAttackPhase;
  attackTimer: number; // seconds left in windup/recovery
  /** 0 = bite; with alpha_claws equipped 1..3 = claw combo hit index of the current/last swing. */
  comboStep: number;
  comboWindow: number; // seconds left to chain the next combo hit
  /** Seconds of hit stun (no move/attack) after taking a big hit. */
  hitStun: number;
  /** Seconds until respawn while GameState.phase === 'respawning'. */
  respawnTimer: number;
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
  /** Beyond population.activeRadius of the leader: not simulated this step (PopulationSystem, 2 Hz). Followers are never dormant. */
  dormant: boolean;
  /** Brute Evolution siege unit (BALANCE.brute stats). Only followers become brutes. */
  brute: boolean;
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
  strongholdId: StrongholdId | null;
  /** See ZombieAgent.dormant. */
  dormant: boolean;
  /** Seconds of stagger (Alpha Claws finisher): cannot move or shoot. */
  staggerTime: number;
  /** Killed by the Alpha's own attack: conversion is guaranteed ('infect'). */
  killedByAlpha: boolean;
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

export type HordeOrder =
  | { type: 'follow' }
  | { type: 'attack'; target: TargetRef }
  /** Go to a ground point; reverts to follow on arrival or at expiresAt (sim time). Followers still auto-engage nearby enemies. */
  | { type: 'move'; point: Vec2; expiresAt: number };

/** High-level horde command produced by input/UI (edge-triggered, one step). */
export type HordeCommand =
  | { type: 'attack'; target: TargetRef; additive: boolean } // additive (Ctrl) = toggle as split squad target
  | { type: 'move'; point: Vec2 }
  | { type: 'regroup' } // rally: pull + recruit around the leader (rally cooldown)
  | { type: 'follow' }; // recall everyone

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

/** @deprecated 'victory' | 'defeat' are legacy (removed in T015). Open world: 'playing' | 'respawning'. */
export type GamePhase = 'playing' | 'respawning' | 'victory' | 'defeat';

/** Spec §3 DistrictState, unchanged shape. */
export interface DistrictState {
  id: DistrictId;
  status: TerritoryStatus;
  discovered: boolean;
  infection: number; // 0..1 (share of the district's humans converted/killed, 1 when captured)
  humanStrength: number; // 0..1 living armed humans / initial armed humans in the district
  alertLevel: number; // 0..1, rises with aggression in the district, decays
  strongholdCaptured: boolean;
}

export interface StrongholdState {
  id: StrongholdId;
  captured: boolean;
  /** Under coordinated attack / an objective damaged or done, and not captured. */
  contested: boolean;
  /** 0..1 living defenders / initial defenders. */
  defenderStrength: number;
  objectivesDone: string[];
  /** Seconds accumulated on the current holdPoint objective (resets when the hold breaks). */
  holdProgress: number;
  /** Reinforcement squads already sent (bounded by BALANCE.conquest.maxReinforcementWaves). */
  reinforcementsSpent: number;
  /** Sim time of the last reinforcement wave (-Infinity = never). */
  lastReinforcementAt: number;
}

export interface ProgressionState {
  biomass: number; // never negative
  unlocked: AbilityId[]; // includes innate 'bite','infect' from the start
  /** Exactly BALANCE.progression.slots entries (Q, E, R, F). */
  equipped: (AbilityId | null)[];
  /** Seconds remaining per ability; missing/0 = ready. */
  cooldowns: Partial<Record<AbilityId, number>>;
  /** > 0 while Horde Frenzy is active. */
  frenzyTimeLeft: number;
}

/** Fog of war. Revealed cells are independent of territory status. */
export interface DiscoveryState {
  cellSize: number;
  cols: number;
  rows: number;
  /** Row-major, 1 byte per cell: 1 = revealed. Origin = layout.bounds min corner. */
  bits: Uint8Array;
  /** Revealed cell count (kept in sync with bits). */
  revealed: number;
}

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
  // --- open world ---
  districts: Record<DistrictId, DistrictState>;
  /** Same order as layout.strongholds. */
  strongholds: StrongholdState[];
  progression: ProgressionState;
  discovery: DiscoveryState;
  /** NestDef.id the leader respawns at (start nest until another is chosen). */
  activeNestId: string;
  /** Number of leader deaths this session (stats/HUD). */
  deaths: number;
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
  // --- open world input model (ARCHITECTURE.md §4). Legacy rally/rush/recall/attackTarget are removed in T015. ---
  /** LMB edge: Alpha direct attack (bite, or claw combo when alpha_claws is equipped). */
  attack: boolean;
  /** Ground point under the cursor (aim hint for the forgiving auto-aim); null = swing forward. */
  aimPoint: Vec2 | null;
  hordeCommand: HordeCommand | null;
  /** Q/E/R/F edge: activate equipped slot 0..3. */
  abilitySlot: number | null;
  /** Nest panel: put `ability` (null = clear) into `slot`. Only applied within nest.equipRadius of an active nest. */
  equip: { slot: number; ability: AbilityId | null } | null;
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
    attack: false,
    aimPoint: null,
    hordeCommand: null,
    abilitySlot: null,
    equip: null,
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
  | { type: 'victory' } // @deprecated legacy
  | { type: 'defeat' } // @deprecated legacy
  // --- open world ---
  | { type: 'attackSwing'; pos: Vec2; facing: number; combo: number; hit: boolean }
  | { type: 'moveOrder'; point: Vec2 }
  | { type: 'districtDiscovered'; districtId: DistrictId }
  | { type: 'districtStatus'; districtId: DistrictId; status: TerritoryStatus; prev: TerritoryStatus }
  | { type: 'strongholdContested'; strongholdId: StrongholdId; districtId: DistrictId }
  | { type: 'objectiveComplete'; strongholdId: StrongholdId; objectiveId: string; label: string }
  | { type: 'strongholdCaptured'; strongholdId: StrongholdId; districtId: DistrictId; unlock: AbilityId | null; biomass: number }
  | { type: 'abilityUnlocked'; abilityId: AbilityId; slot: number | null }
  | { type: 'abilityEquipped'; abilityId: AbilityId | null; slot: number }
  | { type: 'abilityUsed'; abilityId: AbilityId; pos: Vec2 }
  | { type: 'abilityDenied'; abilityId: AbilityId | null; reason: 'locked' | 'cooldown' | 'biomass' | 'noTarget' | 'notAtNest' | 'empty' }
  | { type: 'biomassGain'; amount: number; total: number; reason: 'infect' | 'kill' | 'convert' | 'structure' | 'capture' }
  | { type: 'frenzyStart'; pos: Vec2; radius: number }
  | { type: 'frenzyEnd' }
  | { type: 'bruteEvolved'; zombieId: EntityId; pos: Vec2 }
  | { type: 'reinforcements'; strongholdId: StrongholdId | null; districtId: DistrictId; count: number; pos: Vec2 }
  | { type: 'nestActivated'; nestId: string; pos: Vec2 }
  | { type: 'leaderRespawned'; nestId: string; pos: Vec2 }
  | { type: 'autosave'; reason: 'capture' | 'unlock' | 'discover' | 'equip' | 'respawn' };

// ---------------------------------------------------------------------------
// Persistence (versioned JSON in localStorage). Never contains meshes, timers or nav objects.
// ---------------------------------------------------------------------------

export interface PlayerSave {
  biomass: number;
  unlockedAbilities: AbilityId[];
  equippedAbilities: (AbilityId | null)[]; // length BALANCE.progression.slots
  selectedNestId: string;
}

export interface WorldSave {
  version: number; // BALANCE.save.version
  seed: number;
  savedAt: number; // Date.now() supplied by the caller (pure code never reads clocks)
  player: PlayerSave;
  districts: Record<DistrictId, DistrictState>;
  strongholds: Record<StrongholdId, Pick<StrongholdState, 'id' | 'captured' | 'objectivesDone' | 'reinforcementsSpent'>>;
  /** Destroyed StructureDef ids (captured strongholds' doors stay broken) and whether the industrial gate is down. */
  destroyedStructures: number[];
  gateDestroyed: boolean;
  /** base64 of DiscoveryState.bits. */
  discoveryBits: string;
  acquiredUpgrades: AbilityId[]; // == player.unlockedAbilities minus innate (spec field kept for compatibility)
}

// ---------------------------------------------------------------------------
// Utility interfaces
// ---------------------------------------------------------------------------

/** Injectable RNG so tests are deterministic. next() returns [0,1). */
export interface Rng {
  next(): number;
}
