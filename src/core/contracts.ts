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
   */
  moveCircle(pos: Vec2, dx: number, dz: number, radius: number): void;
  /** Push a circle out of any overlapping blocksMove colliders / bounds. Returns true if it moved. */
  resolveCircle(pos: Vec2, radius: number): boolean;
  /** True if a circle at p overlaps any enabled blocksMove collider or leaves bounds. */
  isBlocked(p: Vec2, radius: number): boolean;
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
  /** Dijkstra/BFS flow field from multiple goals. May reuse `reuse` storage. */
  buildFlowField(goals: readonly Vec2[], reuse?: IFlowField): IFlowField;
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
   * { kind: 'gate' } when the ordered guard is unreachable and the intact gate is the blocker.
   */
  effectiveTarget: import('./types').TargetRef | null;
}

/** Everything a system needs. Created by Simulation; systems are plain functions (ctx, dt). */
export interface SimContext {
  state: GameState;
  layout: DistrictLayout;
  collision: ICollisionWorld;
  navGrid: INavigationGrid;
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

export type SystemUpdate = (ctx: SimContext, dt: number, input: SimInput) => void;
