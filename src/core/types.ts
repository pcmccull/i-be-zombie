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
  | 'breakable' // destructible landmark obstruction (bus door, alley gate, store door, pen gate)
  | 'boundary'; // EW: indestructible world edge (never breakable, never disabled, never a StructureDef)

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

/** VP2: visual building archetype (render-only; assigned by the buildingAssign layout pass). */
export type BuildingArchetype = 'bungalow' | 'artDecoHotel' | 'apartment' | 'convenienceStore' | 'restaurant' | 'office'
  | 'warehouse' | 'gasStation' | 'beachShop' | 'parkingGarage' | 'villa' | 'municipal' | 'landmark';
/** VP2 district landmark (render-only set piece; not the structure LandmarkKind). */
export type CityLandmarkKind = 'lighthouse' | 'neonArch' | 'waterTower' | 'clockTower' | 'controlTower' | 'radioMast'
  | 'fountainPlaza' | 'bandshell' | 'ferrisWheel' | 'domeObservatory' | 'glassTower' | 'hangar';
export type Facing4 = 'north' | 'south' | 'east' | 'west';

export interface BuildingDef {
  footprint: AABB;
  height: number;
  style: BuildingStyle;
  colorIndex: number; // into a palette chosen by the visual layer
  // ---- VP2 (all optional, render-only; legacy/base layouts leave them unset) ----
  archetype?: BuildingArchetype;
  /** Plan seed (deterministic per building). */
  seed?: number;
  /** Side facing the street (entrance/storefront side). */
  frontage?: Facing4;
  /** Whole parcel incl. forecourt/patio/yard (contains footprint). Ground-level extras outside the footprint follow VP2-0. */
  lot?: AABB;
  landmark?: CityLandmarkKind;
  /** Sides that touch a neighbour (shared walls: no openings/trim there). */
  sharedWalls?: Facing4[];
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
  | 'acUnit'
  // EW district dressing
  | 'container'
  | 'jerseyBarrier'
  | 'chainFence'
  | 'watchtower'
  | 'tent'
  | 'palm'
  | 'wreck'
  // VP2 street furniture (blocking props from the streetFurniture/urbanInfill layout passes)
  | 'busStop'
  | 'mailbox'
  | 'newsStand'
  | 'bikeRack'
  | 'bollard'
  | 'planter'
  | 'patioTable'
  | 'gasPump'
  | 'utilityBox'
  | 'crates'
  | 'shoppingCart'
  | 'constructionBarrier'
  | 'basketballHoop';

export interface PropDef {
  kind: PropKind;
  pos: Vec2;
  rotation: number; // radians about Y
  variant?: number;
  /** If true, layout also emits a ColliderDef for it. */
  blocking: boolean;
}

export type GroundKind = 'road' | 'sidewalk' | 'park' | 'plaza' | 'lot' | 'compound' | 'sand' | 'court';

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
export type StructureKind = 'busDoor' | 'alleyGate' | 'storeDoor' | 'penGate' | 'stationDoor' | 'securityShutter'
  /** todos #10b: corner-shop glass door; breaking in exposes healing drinks (ShopSystem). */
  | 'shopDoor';

/** Which landmark a structure / zone / human belongs to (visuals + HUD labels). */
export type LandmarkKind = 'bus' | 'alley' | 'store' | 'barricade' | 'station' | 'mall' | 'shop';

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
 * Heavy stronghold weapon crewed by a 'soldier' (docs: hard capture points). 'mg' = mounted machine gun behind sandbags
 * (stationary, long bursts); 'tank' = armored hull (stationary, splash cannon + coaxial MG). The tank sits inside its own
 * blocking hull collider (GuardSpawn.hullTag), handled like a tower footprint (towerColliderId) without the climb.
 */
export type HeavyWeapon = 'mg' | 'tank';
/**
 * Where a human belongs. 'stronghold' = defender of GuardSpawn.strongholdId; 'patrol' = district patrol / reinforcement.
 * @deprecated 'checkpoint' | 'barricade' are legacy-layout posts (removed in T015); new layouts use 'stronghold'.
 */
export type HumanPost = 'checkpoint' | 'barricade' | 'stronghold' | 'patrol' | 'street' | 'store';

// ---------------------------------------------------------------------------
// Open world (docs/3_open_world.md): districts, strongholds, nests, abilities
// ---------------------------------------------------------------------------

export type DistrictId =
  | 'suburbs' | 'police' | 'shopping' | 'industrial'
  // EW expansion (docs/5_expand_world.md, ARCHITECTURE §EW-1)
  | 'palm_park' | 'sunny_boardwalk' | 'neon_nights' | 'arts_district' | 'oceanfront_hotels' | 'luxury_marina'
  | 'golf_estates' | 'medical_center' | 'university' | 'financial_core' | 'airport' | 'military_base';
/** All districts in grid order r0c0..r3c3 (north-west to south-east, row-major). */
export const DISTRICT_IDS: readonly DistrictId[] = [
  'airport', 'golf_estates', 'university', 'luxury_marina',
  'palm_park', 'financial_core', 'neon_nights', 'medical_center',
  'military_base', 'police', 'industrial', 'arts_district',
  'sunny_boardwalk', 'suburbs', 'shopping', 'oceanfront_hotels',
];
export type ThreatTier = 1 | 2 | 3 | 4 | 5;
export type DistrictArchetype =
  | 'suburban' | 'civic' | 'retail' | 'industrial' | 'park' | 'boardwalk' | 'nightlife' | 'arts'
  | 'resort' | 'marina' | 'estates' | 'medical' | 'campus' | 'downtown' | 'airport' | 'military';
/** Territory control. Independent of fog discovery (discovering never conquers). */
export type TerritoryStatus = 'unknown' | 'human' | 'contested' | 'infected';
export type StrongholdId =
  | 'suburb_checkpoint' | 'police_station' | 'mall_security' | 'industrial_yard'
  // EW expansion: one per new district, unlock null (biomass by tier)
  | 'park_ranger_post' | 'boardwalk_patrol' | 'neon_security' | 'arts_barricade' | 'hotel_security' | 'marina_crews'
  | 'golf_gatehouse' | 'medical_quarantine' | 'campus_security' | 'financial_tower' | 'airport_terminal' | 'military_hq';
/** 'pounce' is data-only this milestone (no unlock source). */
export type AbilityId = 'bite' | 'infect' | 'rush' | 'alpha_claws' | 'horde_frenzy' | 'pounce' | 'brute_evolution';
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
  defenseTier: number; // 1..5, difficulty shown on the map (EW: equals the district threatTier for new strongholds)
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
  /** Walk-in nest: inactive until the Alpha walks into it (GameState.claimedNests). Claiming the first raises the horde. */
  claim?: boolean;
}

/**
 * Nest teleport: the Alpha and every follower converge on `from` and dive in; when `timer` runs out the party crawls
 * out around `to`. A zombie within `nest.teleportHoleRadius` of `from` stops there (the renderer plays its dive).
 */
export interface NestTravel {
  fromNestId: string;
  toNestId: string;
  from: Vec2;
  to: Vec2;
  /** Seconds left until the party arrives at `to`. */
  timer: number;
  duration: number;
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
  /** EW: danger rating 1..5 shown before entering (defense composition, not distance from spawn). */
  threatTier: ThreatTier;
  archetype: DistrictArchetype;
  /** EW: cell in the 4 x 4 district grid (col 0 = west, row 0 = north). */
  cell: { col: number; row: number };
}

// ---------------------------------------------------------------------------
// EW: world boundaries (docs/5_expand_world.md §3)
// ---------------------------------------------------------------------------

export type BoundaryKind =
  | 'urban_fence' | 'concrete_debris' | 'vehicle_blockade' | 'shipping_containers'
  | 'military_perimeter' | 'deep_water' | 'mangrove_barrier' | 'collapsed_bridge';

/** One run of indestructible world edge inside the boundary band (between playArea and bounds). */
export interface WorldBoundarySegment {
  id: string;
  kind: BoundaryKind;
  /** Polyline along the edge, inside the band. */
  points: Vec2[];
  isWorldEdge: true;
  destructible: false;
  blocksPlayer: true;
  blocksNPCs: true;
  blocksVehicles: true;
  scenerySeed: number;
  /** Tags of this segment's kind:'boundary' colliders in layout.colliders. */
  colliderTags: string[];
}

/** Render-only scenery beyond layout.bounds. Never pickable, never collides. */
export interface BackdropDef {
  kind: 'skyline' | 'mangroves' | 'ocean' | 'bay' | 'highway' | 'airfield';
  rect: AABB;
  seed: number;
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
  /** Heavy weapon crew (role 'soldier', stationary). */
  heavy?: HeavyWeapon;
  /** Tank only: tag of the blocking hull collider the crew sits inside. */
  hullTag?: string;
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
  /** Walkable area around playerStart where the initial followers spawn (createInitialState.startFollowerCount). */
  startFollowerArea: AABB;
  // --- open world (legacy layout fills these with a single-district equivalent) ---
  districts: DistrictDef[];
  strongholds: StrongholdDef[];
  nests: NestDef[];
  // --- EW (legacy: playArea = bounds, boundaries = [], backdrop = []) ---
  /** Walkable world inside the boundary band. bounds = playArea grown by BALANCE.openWorld.boundaryBand. */
  playArea: AABB;
  boundaries: WorldBoundarySegment[];
  backdrop: BackdropDef[];
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

/** HH: the Alpha has no HP — survival is `GameState.horde` (Horde Strength). */
export interface LeaderState extends Omit<MobileBase, 'hp' | 'maxHp'> {
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
  /** Seconds left climbing up out of the ground at a nest (game start / respawn); no move or attack meanwhile. */
  emergeTimer: number;
  /** Height above ground (m) while climbing over a car-height obstacle (`isCrawlable`). Visual only. */
  elevation: number;
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
  /** Seconds left crawling up out of the ground (followers spawned at a nest); no move or attack meanwhile. */
  emergeTimer: number;
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
  /** Heavy weapon crew (see HeavyWeapon); absent = ordinary human. */
  heavy?: HeavyWeapon;
  /** Tank only: fixed hull heading (facing = turret aim). */
  hullFacing?: number;
}

// ---------------------------------------------------------------------------
// todos #10b-#12: traffic, shop drinks, citizen resistance
// ---------------------------------------------------------------------------

/** 'traffic' = ambient car on its lane; 'rammer' = hostile driver who hunts the horde (resistance level >= 2). */
export type VehicleKind = 'traffic' | 'rammer';
/** Body type (size, handling, look). Police drivers bail out as armed police. */
export type VehicleModel = 'sedan' | 'hatchback' | 'pickup' | 'van' | 'boxTruck' | 'bus' | 'police';
/** cruise: on its lane; ram: off-lane charge at the horde; turn: rammer swinging round for another pass;
 * flee: rammer driving away to despawn; stalled: stopped for good (driver bailed), fades then despawns. */
export type VehicleMode = 'cruise' | 'ram' | 'turn' | 'flee' | 'stalled';

/** Simulated car (TrafficSystem). Footprint = BALANCE.traffic.carLength x carWidth, oriented by facing. */
export interface VehicleAgent {
  id: EntityId;
  kind: VehicleKind;
  mode: VehicleMode;
  pos: Vec2;
  prevPos: Vec2;
  facing: number;
  prevFacing: number;
  /** Signed speed along facing (m/s). */
  speed: number;
  /** Index into TrafficSystem's lane list (cruise); -1 off-lane. */
  lane: number;
  /** Seconds in the current mode. */
  modeTime: number;
  /** Rammer passes made through the horde. */
  passes: number;
  /** 0..5 paint variant (visual). */
  variant: number;
  /** Seconds remaining of the impact jolt (visual). */
  hitFlash: number;
  /** Seconds the car has been (nearly) stopped while trying to move. */
  stuckTime: number;
  /** Driver's grip: zombie claws wear it down; at 0 the driver is pulled out (car stalls). */
  hp: number;
  /** Seconds left during which impacts/clinging zombies keep the car from accelerating again. */
  bogTime: number;
  /** Body type; absent = 'sedan'. Footprint = BALANCE.vehicleModels[model] length x width. */
  model?: VehicleModel;
}

/** Healing drink lying in a broken-into shop (ShopSystem). Only the Alpha drinks. */
export interface Pickup {
  id: EntityId;
  kind: 'drink';
  /** StructureDef.id of the shop it belongs to. */
  shopId: number;
  pos: Vec2;
}

/** Weapon a civilian picks up as the resistance rises (derived per id, never stored on the agent). */
export type CivilianWeapon = 'none' | 'bat' | 'pistol' | 'shotgun';

/** Citizen fight-back level 0..4, from strongholds captured (BALANCE.resistance.levelAtCaptures). Only ResistanceSystem writes it. */
export interface ResistanceState {
  level: number;
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
  | { kind: 'vehicle'; id: EntityId } // VehicleAgent.id: claw at a car to pull its driver out
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

export type DistrictAlert = 'normal' | 'concerned' | 'panic' | 'lockdown' | 'overrun';
export type ControlState = 'humanControlled' | 'contested' | 'zombieInfluenced' | 'zombieControlled';

/** Spec §3 DistrictState + living-city extensions (docs/11_cityupgrade.md). */
export interface DistrictState {
  id: DistrictId;
  status: TerritoryStatus;
  discovered: boolean;
  infection: number; // 0..1 (share of the district's humans converted/killed, 1 when captured)
  humanStrength: number; // 0..1 living armed humans / initial armed humans in the district
  alertLevel: number; // 0..1, rises with aggression in the district, decays
  strongholdCaptured: boolean;
  /** Five-stage local alert state (docs/11_cityupgrade.md §2.3). */
  alert?: DistrictAlert;
  /** Territorial control stage (docs/11_cityupgrade.md §2.9). */
  control?: ControlState;
  /** Continuous local heat 0..100 driving alert transitions. */
  heat?: number;
  discoveredPOIs?: string[];
  completedUniqueEvents?: string[];
  unlockedShortcuts?: string[];
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
  /**
   * Ability slots the player owns, 0..BALANCE.progression.slots (todos #9). 0 until the first 'slot' ability unlock grants
   * slot 0; the rest are bought with biomass at a nest (progression.slotCosts). Slots >= slotsOwned are hidden and unusable.
   */
  slotsOwned: number;
  /** EW: permanent eyesight mutation tier, 1 (Rotten Eyes) .. 4 (Apex Vision). Bought at a nest (vision.tierCosts). */
  visionTier: VisionTier;
  /** Nest trait: running-speed mutation level, 0..BALANCE.traits.speed.costs.length. Bought at a nest (rising costs). */
  speedLevel: number;
  /** Nest trait: attack-speed mutation level, 0..BALANCE.traits.attack.costs.length. Bought at a nest (rising costs). */
  attackLevel: number;
}

/** Permanent nest traits bought with biomass (besides eyesight). */
export type TraitId = 'speed' | 'attack';

// ---------------------------------------------------------------------------
// EW: zombie vision and senses (docs/5_expand_world.md §4-5, ARCHITECTURE §EW-3)
// ---------------------------------------------------------------------------

export type VisionTier = 1 | 2 | 3 | 4;
/** heard/sensed come only from SenseCues (fuzzy); seen = silhouette, not targetable; identified = full info + targetable. */
export type Awareness = 'none' | 'heard' | 'sensed' | 'seen' | 'identified';

export interface VisionProfile {
  tier: VisionTier;
  name: string;
  clearRadius: number;
  hazeRadius: number;
  hazeStrength: number;
  detectMovingHumans: boolean;
  movingDetectRadius: number;
  detectDefenses: boolean;
  defenseRadius: number;
  detectReinforcements: boolean;
  reinforcementRadius: number;
}

export type SenseKind = 'gunshot' | 'scream' | 'siren' | 'crowd';

export interface SenseCue {
  id: number;
  kind: SenseKind;
  /** crowd = sensed (scent); gunshot/scream/siren = heard. */
  awareness: 'heard' | 'sensed';
  /** FUZZED source estimate, fixed at creation/refresh. Never the live entity position. */
  pos: Vec2;
  /** 0..1 after distance attenuation. */
  intensity: number;
  age: number;
  ttl: number;
  /** Number of aggregated events. */
  count: number;
}

/** Transient (never saved). Only AwarenessSystem writes it. */
export interface VisionState {
  /** Mirrors progression.visionTier (AwarenessSystem copies it each update). */
  tier: VisionTier;
  /** Sorted ascending. Full info, targetable. */
  identified: EntityId[];
  /** Sorted ascending, disjoint from identified. Silhouette/marker only: no hp, labels or targeting. */
  seen: EntityId[];
  /** <= BALANCE.senses.maxCues. */
  cues: SenseCue[];
  nextCueId: number;
  /** Incremented whenever identified/seen change. */
  revision: number;
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

// --- HH: Horde Strength replaces Alpha health (docs/13_hode_health.md, ARCHITECTURE §HH) ---
export type AlphaDamageSource = 'bullet' | 'melee' | 'explosion' | 'vehicle' | 'hazard';
export interface LastBrainState {
  active: boolean;
  timeLeft: number;
}
/** Only HordeHealthSystem writes this (createInitialState / applySave set defaults). Strength is derived, never subtracted. */
export interface HordeHealthState {
  /** Authoritative: clamp(followerStrength + (alphaCore - coreDamage), 0, maxStrength). */
  strength: number;
  /** alphaCore + followerCap * capUnitsPerFollower. */
  maxStrength: number;
  /** Sum of strengthValueOf over live followers. */
  followerStrength: number;
  /** Alpha-core units depleted, 0..alphaCore (the shared-damage accumulator). */
  coreDamage: number;
  /** == state.followerCount after the step. */
  activeFollowers: number;
  /** Seconds of hit protection (Last Brain entry / recovery). */
  graceLeft: number;
  lastBrain: LastBrainState;
  // session telemetry (not saved; tests + F3)
  alphaDamageTaken: number;
  sharedDamageDealt: number;
  strengthGained: number;
  strengthLost: number;
}

export interface GameState {
  /** HH: Horde Strength — the Alpha's only survival resource. */
  horde: HordeHealthState;
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
  /**
   * todos #8: true from the step a recruit was refused at capacity until the horde has stayed below cap for
   * BALANCE.horde.capNoticeRearm seconds. capReached is emitted only on false -> true. Only HordeSystem writes it.
   */
  atCapacity: boolean;
  // --- open world ---
  districts: Record<DistrictId, DistrictState>;
  /** Same order as layout.strongholds. */
  strongholds: StrongholdState[];
  progression: ProgressionState;
  discovery: DiscoveryState;
  /** NestDef.id the leader respawns at (start nest until another is chosen). */
  activeNestId: string;
  /** Walk-in (`NestDef.claim`) nests the Alpha has claimed, in claim order. Persistent (PlayerSave.claimedNests). */
  claimedNests: string[];
  /** Nest teleport in progress (the Alpha + horde diving into a nest), else null. Transient; only NestTravelSystem writes it. */
  nestTravel: NestTravel | null;
  /** Number of leader deaths this session (stats/HUD). */
  deaths: number;
  /** EW: what the Alpha can currently see/hear. Transient. */
  vision: VisionState;
  /** todos #12: simulated traffic + hostile drivers (open world only; transient). */
  vehicles: VehicleAgent[];
  /** todos #10b: healing drinks in broken-into shops (transient). */
  pickups: Pickup[];
  /** todos #12: citizen fight-back level (derived from captures). */
  resistance: ResistanceState;
  /** Living City & Expanded Rewards (docs/11_cityupgrade.md). */
  rewards: PlayerRewardState;
  cityEvents: ActiveDynamicEvent[];
  interactables: WorldInteractable[];
  playerVehicle: PlayerVehicleState | null;
  companions: CompanionAgentState[];
}

// ---------------------------------------------------------------------------
// Living City & Expanded Rewards (docs/11_cityupgrade.md)
// ---------------------------------------------------------------------------

export type RewardType =
  | 'cosmetic'
  | 'companion'
  | 'vehicle'
  | 'hideout'
  | 'trophy'
  | 'experience'
  | 'currency'
  | 'ability'
  | 'hordeUpgrade';

export type CosmeticSlot = 'hat' | 'glasses' | 'back' | 'hand';
export type CompanionId = 'larry_lifeguard' | 'chef_brainsley' | 'grandma_rot';
export type PlayerVehicleKind = 'golf_cart' | 'scooter' | 'ice_cream_truck' | 'parade_float';
export type HideoutId = 'suburb_depot' | 'beach_hotel' | 'mall_safehouse' | 'marina_boathouse';

export type DynamicEventKind =
  | 'tourist_bus'
  | 'beach_volleyball'
  | 'police_patrol'
  | 'food_truck_crowd'
  | 'zombie_in_trouble'
  | 'car_accident'
  | 'supply_convoy'
  | 'street_festival'
  | 'rival_zombie_pack'
  /** Post-conquest pool (zombie-controlled districts): ambient zombies partying, all recruitable. */
  | 'zombie_block_party'
  /** Post-conquest pool: a small human raid squad pushing back into zombie turf. */
  | 'survivor_raid';

/** Render-only event dressing (CityEventProps draws these; the sim never collides with them). */
export type CityEventPropKind = 'bus' | 'foodTruck' | 'volleyNet' | 'stage' | 'partyLights' | 'wreck' | 'convoyTruck' | 'barricade';

export interface CityEventProp {
  kind: CityEventPropKind;
  pos: Vec2;
  facing: number;
}

export type InteractableKind =
  | 'trashCan'
  | 'carAlarm'
  | 'fireHydrant'
  | 'shopWindow'
  | 'sirenPost'
  | 'constructionBarrier';

export interface RewardDefinition {
  id: string;
  type: RewardType;
  displayName: string;
  description: string;
  iconId?: string;
  assetId?: string;
  unique: boolean;
  sourceIds: string[];
  costBrains?: number;
  slot?: CosmeticSlot;
  companionId?: CompanionId;
  vehicleKind?: PlayerVehicleKind;
  hideoutId?: HideoutId;
  hiddenUntilUnlocked?: boolean;
}

export interface PlayerRewardState {
  brains: number;
  unlockedRewardIds: string[];
  equippedCosmeticIdsBySlot: Record<CosmeticSlot, string | null>;
  unlockedCompanionIds: CompanionId[];
  activeCompanionIds: CompanionId[];
  achievementProgress: Record<string, number>;
  discoveredSecretIds: string[];
  unlockedHideoutIds: HideoutId[];
  unlockedVehicleIds: PlayerVehicleKind[];
  activeVehicleId: PlayerVehicleKind | null;
}

export interface DynamicEventDefinition {
  id: DynamicEventKind;
  label: string;
  weight: number;
  allowedDistrictTags: DistrictArchetype[];
  allowedAlertLevels?: DistrictAlert[];
  cooldownSeconds: number;
  maxConcurrent: number;
  durationSeconds: number;
  brainsReward: number;
  /** Only in districts whose control state is listed (post-conquest pools). Omitted = any control. */
  allowedControl?: ControlState[];
}

export interface ActiveDynamicEvent {
  id: string;
  kind: DynamicEventKind;
  districtId: DistrictId;
  pos: Vec2;
  startedAt: number;
  expiresAt: number;
  participantGuardIds: EntityId[];
  participantZombieIds: EntityId[];
  resolved: boolean;
  /** Render-only dressing (bus, truck, net, stage...). */
  props: CityEventProp[];
  /** Participants still to arrive (e.g. tourists stepping off the bus one by one). */
  pendingSpawns: number;
  nextSpawnAt: number;
  /** Responders (police) already called to this event; at most once per event. */
  escalated: boolean;
  /** The player's horde has disturbed it (a participant panicked, died or was recruited). */
  disturbed: boolean;
}

export interface WorldInteractable {
  id: number;
  kind: InteractableKind;
  pos: Vec2;
  radius: number;
  cooldown: number;
  lastTriggeredAt: number;
  triggerCount: number;
}

export interface PlayerVehicleState {
  kind: PlayerVehicleKind;
  pos: Vec2;
  facing: number;
  speed: number;
  mounted: boolean;
  hp: number;
  maxHp: number;
  honkCooldown: number;
}

export interface CompanionAgentState {
  id: CompanionId;
  zombieId: EntityId | null;
  recoverAt: number;
  abilityCooldown: number;
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
  /** Nest panel edge: buy the next ability slot (cost progression.slotCosts[slotsOwned]). Only within nest.equipRadius of an active nest. */
  buySlot: boolean;
  /** EW nest panel edge: buy the next eyesight tier (cost vision.tierCosts[visionTier]). Only near an active nest. */
  buyVision: boolean;
  /** Nest panel edge: buy the next level of a trait (cost traits[id].costs[level]). Only near an active nest. */
  buyTrait: TraitId | null;
  /** Living City: context interact / mount-dismount vehicle / honk / trigger nearby secret. */
  interact: boolean;
  /** Collection/Wardrobe edge: equip or clear a cosmetic item. */
  equipCosmetic: { slot: CosmeticSlot; rewardId: string | null } | null;
  /** Collection/Wardrobe edge: purchase a reward item with Brains. */
  buyReward: string | null;
  /** Collection edge: toggle an unlocked companion in/out of active slots. */
  toggleCompanion: CompanionId | null;
  /** Collection/Hideout edge: summon or swap to an unlocked player vehicle. */
  summonVehicle: PlayerVehicleKind | null;
  /** WorldMap/Hideout edge: fast travel to an unlocked hideout. */
  fastTravelHideout: HideoutId | null;
  /** Nest teleport map edge: dive into the nest the Alpha stands at and crawl out of this (active) nest. */
  nestTeleport: string | null;
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
    buySlot: false,
    buyVision: false,
    buyTrait: null,
    interact: false,
    equipCosmetic: null,
    buyReward: null,
    toggleCompanion: null,
    summonVehicle: null,
    fastTravelHideout: null,
    nestTeleport: null,
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
  | { type: 'shot'; guardId: EntityId; from: Vec3; to: Vec3; hit: boolean; heavy?: 'mg' | 'coax' | 'cannon' }
  /** Tank shell burst: splash damage around `pos` (VFX/audio/camera shake). */
  | { type: 'shellBlast'; guardId: EntityId; pos: Vec2; radius: number }
  | { type: 'melee'; attacker: 'leader' | 'zombie'; attackerId: EntityId; target: TargetRef; pos: Vec2 }
  | { type: 'damage'; target: TargetRef; amount: number; pos: Vec2 }
  | { type: 'zombieDied'; zombieId: EntityId; pos: Vec2 }
  | { type: 'guardDied'; guardId: EntityId; pos: Vec2; source: DamageSource; role: HumanRole }
  | { type: 'guardAlert'; guardId: EntityId; pos: Vec2; role?: HumanRole } // role: set by R2; absent = soldier
  | { type: 'gateDestroyed'; pos: Vec2 }
  | { type: 'conversionStart'; guardId: EntityId; zombieId: EntityId; pos: Vec2 }
  | { type: 'converted'; guardId: EntityId; zombieId: EntityId; pos: Vec2 }
  | { type: 'leaderDied'; pos: Vec2 }
  // --- HH: Horde Strength ---
  | {
      type: 'hordeStrengthChanged';
      strength: number;
      maxStrength: number;
      delta: number;
      cause: 'recruit' | 'death' | 'alphaHit' | 'heal' | 'evolve' | 'capacity' | 'respawn';
    } // <= 1 per step, dominant cause
  | { type: 'sharedDamage'; pos: Vec2; incoming: number; shared: number; recipients: EntityId[]; core: number }
  | { type: 'lastBrainStart'; pos: Vec2; duration: number }
  | { type: 'lastBrainEnd'; pos: Vec2; outcome: 'recovered' | 'expired' | 'finished' }
  | { type: 'hordeCritical'; strength: number; maxStrength: number } // edge below criticalFrac, re-armed above criticalFrac + 0.05
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
  | { type: 'abilityDenied'; abilityId: AbilityId | null; reason: 'locked' | 'cooldown' | 'biomass' | 'noTarget' | 'notAtNest' | 'empty' | 'maxSlots' | 'maxVision' | 'maxTrait' }
  | { type: 'slotPurchased'; slot: number; cost: number }
  | { type: 'visionUpgraded'; tier: VisionTier; cost: number }
  | { type: 'traitUpgraded'; trait: TraitId; level: number; cost: number }
  /** fresh = false: an existing cue was refreshed by aggregation. */
  | { type: 'senseCue'; cueId: number; kind: SenseKind; fresh: boolean }
  /** Brains (biomass) collected. pos = where they came from (the body / structure / stronghold) for the fly-to-Alpha pickup. */
  | { type: 'biomassGain'; amount: number; total: number; reason: 'infect' | 'kill' | 'convert' | 'structure' | 'capture'; pos?: Vec2 }
  | { type: 'frenzyStart'; pos: Vec2; radius: number }
  | { type: 'frenzyEnd' }
  | { type: 'bruteEvolved'; zombieId: EntityId; pos: Vec2 }
  | { type: 'reinforcements'; strongholdId: StrongholdId | null; districtId: DistrictId; count: number; pos: Vec2 }
  | { type: 'nestActivated'; nestId: string; pos: Vec2 }
  /** First walk-in nest claimed: the Alpha's first horde (`count` free followers) rises around `pos`; horde cap is now `cap`. */
  | { type: 'hordeUnlocked'; count: number; cap: number; pos: Vec2 }
  | { type: 'leaderRespawned'; nestId: string; pos: Vec2 }
  /** The Alpha starts clawing its way up out of the ground at `pos` (game start at the last nest / respawn). */
  | { type: 'leaderEmerge'; pos: Vec2 }
  /** V at an active nest with somewhere to go: the client opens the nest teleport map. */
  | { type: 'nestTravelMenu'; nestId: string }
  /** The Alpha + `count` followers start diving into nest `fromNestId` at `from`. */
  | { type: 'nestTravelStarted'; fromNestId: string; toNestId: string; from: Vec2; to: Vec2; count: number }
  /** The party arrived at `toNestId` and starts crawling out around `pos`. */
  | { type: 'nestTravelArrived'; nestId: string; pos: Vec2; count: number }
  | { type: 'autosave'; reason: 'capture' | 'unlock' | 'discover' | 'equip' | 'respawn' }
  // --- todos #10b-#12 ---
  /** A car struck a zombie or the Alpha (thrown + damaged). */
  | { type: 'vehicleHit'; vehicleId: EntityId; pos: Vec2; target: 'zombie' | 'leader'; speed: number; killed: boolean }
  /** A hostile driver locked onto the horde (horn). */
  | { type: 'vehicleRam'; vehicleId: EntityId; pos: Vec2 }
  /** Car-on-car accident (a fleeing / ramming car hit another car); `speed` = closing speed. */
  | { type: 'vehicleCrash'; vehicleId: EntityId; otherId: EntityId; pos: Vec2; speed: number } // otherId -1 = the Alpha's own vehicle
  /** A stalled car's driver got out (a new civilian). */
  | { type: 'driverBailed'; vehicleId: EntityId; guardId: EntityId; pos: Vec2; pulled?: boolean }
  /** A civilian swung a bat. */
  | { type: 'humanMelee'; guardId: EntityId; pos: Vec2; hit: boolean }
  | { type: 'resistanceRaised'; level: number; label: string }
  /** A shop was broken into: its drinks are up for grabs. */
  | { type: 'shopLooted'; shopId: number; pos: Vec2; drinks: number }
  | { type: 'pickup'; kind: 'drink'; pos: Vec2; heal: number; hp: number }
  // --- Living City & Expanded Rewards (docs/11_cityupgrade.md) ---
  | { type: 'districtAlertChanged'; districtId: DistrictId; alert: DistrictAlert; prev: DistrictAlert }
  | { type: 'cityEventStarted'; eventId: string; kind: DynamicEventKind; districtId: DistrictId; pos: Vec2; label: string }
  | { type: 'cityEventResolved'; eventId: string; kind: DynamicEventKind; outcome: 'completed' | 'expired'; pos: Vec2 }
  | { type: 'worldInteractable'; id: number; kind: InteractableKind; pos: Vec2; label: string }
  | { type: 'brainsGain'; amount: number; total: number; reason: string; pos?: Vec2 }
  | { type: 'rewardGranted'; rewardId: string; rewardType: RewardType; displayName: string }
  | { type: 'cosmeticEquipped'; slot: CosmeticSlot; rewardId: string | null }
  | { type: 'companionRecruited'; companionId: CompanionId; name: string; pos: Vec2 }
  | { type: 'vehicleMounted'; vehicleId: PlayerVehicleKind; pos: Vec2 }
  | { type: 'vehicleDismounted'; vehicleId: PlayerVehicleKind; pos: Vec2 }
  | { type: 'hideoutUnlocked'; hideoutId: HideoutId; name: string; pos: Vec2 }
  | { type: 'fastTraveled'; hideoutId: HideoutId; pos: Vec2 }
  | { type: 'secretDiscovered'; secretId: string; title: string; pos: Vec2 }
  /** Responders arrive at a city event (police called to an accident, a disturbed festival...). */
  | { type: 'cityEventEscalated'; eventId: string; kind: DynamicEventKind; pos: Vec2 }
  /** A named companion used its comic perk (whistle, pan clang, handbag). */
  | { type: 'companionPerk'; companionId: CompanionId; pos: Vec2; label: string }
  /** The Alpha (and horde) took a discovered shortcut (storm drain...). */
  | { type: 'shortcutUsed'; secretId: string; from: Vec2; to: Vec2 }
  /** A convoy was intercepted: its supplies patched the Alpha up. */
  | { type: 'suppliesLooted'; pos: Vec2; heal: number };

// ---------------------------------------------------------------------------
// Persistence (versioned JSON in localStorage). Never contains meshes, timers or nav objects.
// ---------------------------------------------------------------------------

export interface PlayerSave {
  biomass: number;
  unlockedAbilities: AbilityId[];
  equippedAbilities: (AbilityId | null)[]; // length BALANCE.progression.slots
  selectedNestId: string;
  /** ProgressionState.slotsOwned (save v2). v1 saves are migrated: derived from the loadout (ARCHITECTURE §TD-0). */
  slotsOwned: number;
  /** ProgressionState.visionTier (save v3). Missing/invalid in older saves ⇒ 1. */
  visionTier: VisionTier;
  /** ProgressionState.speedLevel / attackLevel. Missing/invalid in older saves ⇒ 0. */
  speedLevel?: number;
  attackLevel?: number;
  /** GameState.claimedNests. Missing in older v3 saves ⇒ claimed if any stronghold was captured. */
  claimedNests?: string[];
  /** Living City & Expanded Rewards (save v4). */
  rewards?: PlayerRewardState;
  /** HH: HordeHealthState.coreDamage (v4 optional). Missing/invalid ⇒ 0 (core full). */
  alphaCoreDamage?: number;
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
