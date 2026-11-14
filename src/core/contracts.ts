// Module API contracts. Implementations MUST `implements` these interfaces so that
// systems written by different agents agree. Pure TS, no three.js.
// See AGENTS.md "Module contracts".

import type { BALANCE } from '../config/balance';
import type {
  AABB,
  Collider,
  DistrictLayout,
  GameEvent,
  GameState,
  Rng,
  SimInput,
  Vec2,
} from './types';

export interface SegmentOptions {
  /** Sight-line height at `a` and at `b` (meters). Defaults: 1.5 / 1.2. */
  fromHeight?: number;
  toHeight?: number;
  /** Collider ids to ignore (e.g. a tower guard's own tower). */
  ignoreIds?: readonly number[];
  /** 'sight' tests blocksSight colliders with height rule; 'move' tests blocksMove colliders (height ignored). */
  mode?: 'sight' | 'move';
}

/** src/world/CollisionWorld.ts — 2D X/Z AABB collision with a broad-phase grid. */
export interface ICollisionWorld {
  readonly bounds: AABB;
  readonly colliders: readonly Collider[];
  /** Enable/disable a collider (gate destruction). Must update broad-phase. */
  setEnabled(id: number, enabled: boolean): void;
  /** First enabled collider with this tag, or undefined. */
  findByTag(tag: string): Collider | undefined;
  /** Enabled colliders overlapping box (blocksMove or blocksSight). Fills & returns `out`. */
  queryAABB(box: AABB, out: Collider[]): Collider[];
  /**
   * Move a circle by (dx,dz) with sliding against blocksMove colliders and world bounds.
   * Mutates `pos` in place. Sub-steps internally so a single call never tunnels (|delta| may be up to ~2 m).
   * `passable` colliders are ignored (horde crawling over cars).
   */
  moveCircle(pos: Vec2, dx: number, dz: number, radius: number, passable?: (c: Collider) => boolean): void;
  /** Push a circle out of any overlapping blocksMove colliders / bounds. Returns true if it moved. */
  resolveCircle(pos: Vec2, radius: number, passable?: (c: Collider) => boolean): boolean;
  /** True if a circle at p overlaps any enabled blocksMove collider or leaves bounds. */
  isBlocked(p: Vec2, radius: number, passable?: (c: Collider) => boolean): boolean;
  /** True if segment a->b is obstructed (see SegmentOptions). */
  segmentBlocked(a: Vec2, b: Vec2, opts?: SegmentOptions): boolean;
}

/** Shared flow field toward a goal set. */
export interface IFlowField {
  /** Goal points this field was built for (after snapping to walkable cells). */
  readonly goals: readonly Vec2[];
  /** Nav grid version at build time. */
  readonly navVersion: number;
  /**
   * Write a unit direction toward the goal into `out` (bilinear/blended is fine).
   * Returns false if p is unreachable/unwalkable (out set to 0,0).
   */
  sample(p: Vec2, out: Vec2): boolean;
  /** Path distance (meters) from p to nearest goal; Infinity if unreachable. */
  distanceAt(p: Vec2): number;
}

/** src/world/NavigationGrid.ts — walkability grid rasterized from enabled blocksMove colliders. */
export interface INavigationGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /** Incremented on every rebuild(). */
  readonly version: number;
  /** Re-rasterize from the collision world's currently enabled colliders (dilated by agent radius). */
  rebuild(): void;
  isWalkable(p: Vec2): boolean;
  /** Nearest walkable world point (cell center) to p, searching outward; p itself if walkable. */
  nearestWalkable(p: Vec2, out?: Vec2): Vec2;
  /** A* (8-connected, no corner cutting) + string-pulling. Null if unreachable. Includes `to` (snapped) as last point. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null;
  /**
   * Dijkstra/BFS flow field from multiple goals. May reuse `reuse` storage.
   * `maxDistance` (meters, optional): stop expanding beyond this path distance; cells past it are unreachable
   * (sample() false, distanceAt() Infinity). Omitted = whole grid (legacy behaviour).
   */
  buildFlowField(goals: readonly Vec2[], reuse?: IFlowField, maxDistance?: number): IFlowField;
  /** True if the straight walk a->b stays on walkable cells (for path smoothing / direct steering). */
  hasClearWalk(a: Vec2, b: Vec2): boolean;
}

export interface ISpatialHash {
  clear(): void;
  insert(id: number, x: number, z: number): void;
  /** Push ids within radius r of (x,z) into out (exact distance check optional; callers re-check). */
  query(x: number, z: number, r: number, out: number[]): number[];
}

/**
 * Shared navigation guidance owned by NavigationSystem and read by HordeSystem.
 * Lives on SimContext.nav.
 */
export interface HordeGuidance {
  /** Flow field toward the follow anchor (leader). Null until first build. */
  followField: IFlowField | null;
  /** Flow field toward the effective attack target's approach points. Null when following. */
  attackField: IFlowField | null;
  /**
   * The target the horde should actually hit. Equals the order target, except it becomes
   * { kind: 'gate' } when the ordered guard is unreachable and the intact gate is the blocker,
   * or { kind: 'structure', id } when the ordered guard is sheltered behind an intact structure
   * (GuardAgent.shelter). Shelter is the only structure redirect rule.
   */
  effectiveTarget: import('./types').TargetRef | null;
  /** Per-squad attack guidance keyed by Squad.id (same semantics as attackField/effectiveTarget). */
  squads: Map<number, SquadGuidance>;
}

export interface SquadGuidance {
  attackField: IFlowField | null;
  effectiveTarget: import('./types').TargetRef | null;
}

/** Everything a system needs. Created by Simulation; systems are plain functions (ctx, dt). */
export interface SimContext {
  state: GameState;
  layout: DistrictLayout;
  collision: ICollisionWorld;
  navGrid: INavigationGrid;
  /** Horde-only grid where low crawlable obstacles (cars, barriers) are walkable. Rebuilt with navGrid. */
  crawlNavGrid: INavigationGrid;
  nav: HordeGuidance;
  zombieHash: ISpatialHash; // rebuilt once per step by HordeSystem before steering
  rng: Rng;
  balance: typeof BALANCE;
  emit(event: GameEvent): void;
  /** Allocate a fresh entity id. */
  newId(): number;
}

/** src/sim/Simulation.ts */
export interface ISimulation {
  readonly ctx: SimContext;
  readonly state: GameState;
  /** Advance exactly one fixed step of `dt` seconds. */
  step(dt: number, input: SimInput): void;
  /** Deterministically restore the initial state (same seed => same world). */
  reset(seed?: number): void;
  /** Return and clear queued events. */
  drainEvents(): GameEvent[];
}

/**
 * src/systems/MomentumSystem.ts — Outbreak Momentum (pure).
 *   addMomentum(ctx, reason): void          // gain = BALANCE.momentum.gain*(reason); resets idleTime; emits momentumGain (+ momentumTier on tier change)
 *   updateMomentum(ctx, dt): void           // idleTime += dt; decay after graceTime; tick gainFlash; tier events
 *   momentumTier(value): MomentumTier
 *   recruitRadiusMultiplier(state): number  // 1 + value * recruitRadiusPerPoint
 *   speedMultiplier(state): number          // 1 + value * speedPerPoint
 * Call sites: recruit (+1, every new follower incl. cascade, NOT start followers or conversions),
 * converted (+3), guardDied with role 'soldier' and source 'zombie' (+5), gate/structure destroyed with defensive (+10).
 *
 * src/systems/StructureSystem.ts — destructible landmark obstructions (pure).
 *   findStructure(state, id): StructureState | undefined
 *   damageStructure(ctx, s, amount): void   // hp, hitFlash, emits damage + structureDamaged; destroys at 0
 *   updateStructures(ctx, dt): void         // ticks hitFlash; steers just-released zombies out (releaseSpeed, releaseDuration)
 * Destruction: collision.setEnabled(colliderId,false); navGrid.rebuild(); crawlNavGrid.rebuild() exactly once;
 * every zombie with heldBy === id gets heldBy = 0 (stays ambient, now recruitable) and walks out;
 * emits structureDestroyed, plus released only when count > 0; stats.structuresDestroyed++; momentum if def.defensive.
 */
export type SystemUpdate =(ctx: SimContext, dt: number, input: SimInput) => void;

// ===========================================================================
// Open world (docs/3_open_world.md). Stubs ship in T001; owners in PROGRESS.md.
// ===========================================================================

/**
 * src/systems/ProgressionSystem.ts (T005) — mutations, biomass, loadout. Pure.
 *   addBiomass(ctx, amount, reason): void            // amount > 0; emits biomassGain
 *   isUnlocked(state, id) / isEquipped(state, id): boolean
 *   canActivate(state, id): AbilityDenyReason | null  // null = OK. unlocked ∧ equipped ∧ activatable ∧ cooldown 0 ∧ biomass >= cost
 *   activateAbility(ctx, id): boolean                 // atomic check+spend+cooldown; emits abilityUsed / abilityDenied
 *   unlockAbility(ctx, id): boolean                   // idempotent (false if already unlocked); auto-equips first empty slot; emits abilityUnlocked once
 *   equipAbility(ctx, slot, id | null): boolean       // requires unlocked + 'slot' behaviour + leader within nest.equipRadius of an active nest; no duplicates
 *   updateProgression(ctx, dt, input): void           // cooldown ticking, input.abilitySlot / input.equip, frenzy timer (frenzyEnd)
 *   isFrenzyActive(state): boolean
 *   hordeSpeedMultiplier(state): number               // frenzy.speedMultiplier while active, else 1
 *   hordeAttackRateMultiplier(state): number          // frenzy.attackRateMultiplier while active, else 1
 *
 * src/systems/ConquestSystem.ts (T009) — strongholds, territory, alert, nests, discovery. Pure.
 *   updateConquest(ctx, dt): void
 *   objectiveStatus(ctx, strongholdId): { id: string; label: string; done: boolean; progress: number }[]   // HUD read model
 *   isNestActive(ctx, nestId): boolean
 *   revealAround(state, layout, p, radius): DistrictId[]   // returns newly discovered districts
 *   Capture happens exactly once per stronghold: captured=true, unlockAbility(def.unlock), addBiomass(def.biomassReward,'capture'),
 *   nest activated (nestActivated), district status 'infected', autosave{reason:'capture'}.
 *
 * src/systems/RespawnSystem.ts (T009)
 *   updateRespawn(ctx, dt): void      // leader dead && phase 'playing' => phase 'respawning', respawnTimer = respawn.delay, deaths++;
 *                                     // timer 0 => leader at active nest, full hp, respawn.followers new followers, leaderRespawned
 *
 * src/systems/PopulationSystem.ts (T008)
 *   updatePopulation(ctx, dt): void   // dormant flags at population.dormantRefreshHz; budgeted civilian/ambient respawns; caps
 *
 * src/persistence/saveSchema.ts (T006) — pure, no DOM.
 *   createSave(state, seed): WorldSave
 *   applySave(ctx, save): void        // restores permanent progress into a freshly created state (see WorldSave docs)
 *   parseSave(raw: unknown): WorldSave | null   // validate + migrate older versions; null on corrupt/incompatible
 *   encodeBits(bits: Uint8Array): string / decodeBits(s: string, length: number): Uint8Array
 * src/persistence/SaveStore.ts (T006)
 *   class SaveStore { constructor(storage: StorageLike | null, key?: string); load(): WorldSave | null; save(s: WorldSave): boolean; clear(): void }  // never throws
 */
export type AbilityDenyReason = 'locked' | 'cooldown' | 'biomass' | 'noTarget' | 'notAtNest' | 'empty';

/** Minimal Web Storage subset (window.localStorage satisfies it; tests use an in-memory map). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
