import { BALANCE } from '../config/balance';
import type { SegmentOptions, SimContext } from '../core/contracts';
import { VISION_EDGE_BAND } from '../core/visionMath';
import type { Awareness, EntityId, GameEvent, GameState, GuardAgent, GuardState, SenseKind, Vec2, VisionProfile, VisionTier } from '../core/types';

export function visionProfile(tier: VisionTier): VisionProfile {
  const p = BALANCE.vision.tiers[tier - 1];
  return { tier, ...p, detectMovingHumans: p.movingDetectRadius > 0,
    detectDefenses: p.defenseRadius > 0, detectReinforcements: p.reinforcementRadius > 0 };
}

// Profiles are immutable internally; the public factory returns a fresh value for callers.
const profiles = [visionProfile(1), visionProfile(2), visionProfile(3), visionProfile(4)];
interface HumanMemory {
  id: EntityId;
  previousState: GuardState;
  los: boolean;
  engagedUntil: number;
  reinforcement: boolean;
  epoch: number;
}
interface CrowdCell { x: number; z: number; count: number }
interface Scratch {
  humans: Map<EntityId, HumanMemory>;
  candidates: GuardAgent[];
  identified: EntityId[];
  seen: EntityId[];
  cueSources: Map<number, Vec2>;
  crowd: Map<number, CrowdCell>;
  point: Vec2;
  sight: SegmentOptions;
  ignoreIds: number[];
  elapsed: number;
  crowdElapsed: number;
  cursor: number;
  epoch: number;
  blind: boolean;
}
const runtime = new WeakMap<GameState, Scratch>();
function scratchFor(state: GameState): Scratch {
  let s = runtime.get(state);
  if (!s) {
    s = { humans: new Map(), candidates: [], identified: [], seen: [], cueSources: new Map(), crowd: new Map(),
      point: { x: 0, z: 0 }, sight: { mode: 'sight', fromHeight: BALANCE.vision.eyeHeight }, ignoreIds: [],
      elapsed: 1 / BALANCE.vision.updateHz, crowdElapsed: 1 / BALANCE.senses.crowdScanHz,
      cursor: 0, epoch: 0, blind: false };
    runtime.set(state, s);
  }
  return s;
}
function distanceSq(a: Vec2, b: Vec2): number { return (a.x - b.x) ** 2 + (a.z - b.z) ** 2; }
function living(g: GuardAgent): boolean { return g.hp > 0 && g.state !== 'DEAD'; }

function contains(ids: readonly EntityId[], id: EntityId): boolean {
  let lo = 0, hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1, value = ids[mid];
    if (value === id) return true;
    if (value < id) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}
export function isIdentified(state: GameState, id: EntityId): boolean { return contains(state.vision.identified, id); }
export function isSeen(state: GameState, id: EntityId): boolean { return contains(state.vision.seen, id); }
export function awarenessOf(state: GameState, id: EntityId): Awareness {
  return isIdentified(state, id) ? 'identified' : isSeen(state, id) ? 'seen' : 'none';
}
export function canTarget(state: GameState, id: EntityId): boolean { return isIdentified(state, id); }
export function isWorldPositionInSight(state: GameState, p: Vec2): boolean {
  return distanceSq(state.leader.pos, p) <= profiles[state.vision.tier - 1].clearRadius ** 2;
}

function addCue(ctx: SimContext, s: Scratch, kind: SenseKind, source: Vec2, p: VisionProfile): void {
  const tuning = BALANCE.senses.kinds[kind], dist = Math.sqrt(distanceSq(ctx.state.leader.pos, source));
  // Gunshots and screams are warnings: they always cue (within hearing range), even inside clear sight, so the
  // player always gets a direction. Sirens and crowd scent stay nonvisual-only (outside clear sight).
  const warning = kind === 'gunshot' || kind === 'scream';
  if (dist > tuning.range || (!warning && dist <= p.clearRadius)) return;
  const inSight = dist <= p.clearRadius;
  const cues = ctx.state.vision.cues;
  let cue = undefined;
  // Aggregate using source estimates kept privately, so repeated fuzz cannot split one gunfight into many cues.
  for (const existing of cues) {
    const origin = s.cueSources.get(existing.id) ?? existing.pos;
    if (existing.kind === kind && distanceSq(source, origin) <= BALANCE.senses.aggregateRadius ** 2) {
      cue = existing; break;
    }
  }
  const fresh = cue === undefined;
  // In clear sight the source is visible anyway; keep fuzz proportional so the bearing stays right up close.
  const fuzz = (inSight ? dist * tuning.fuzzFrac : Math.max(tuning.fuzzMin, Math.min(tuning.fuzzMax, dist * tuning.fuzzFrac))) *
    (kind === 'siren' && p.detectReinforcements ? BALANCE.vision.reinforcementFuzzFactor : 1);
  const angle = ctx.rng.next() * Math.PI * 2;
  const x = source.x + Math.cos(angle) * fuzz, z = source.z + Math.sin(angle) * fuzz;
  const intensity = Math.max(0, Math.min(1, 1 - dist / tuning.range));
  if (cue) {
    cue.pos.x = x; cue.pos.z = z; cue.age = 0; cue.count++;
    cue.intensity = Math.max(cue.intensity, intensity);
    const origin = s.cueSources.get(cue.id)!; origin.x = source.x; origin.z = source.z;
  } else {
    cue = { id: ctx.state.vision.nextCueId++, kind, awareness: kind === 'crowd' ? 'sensed' as const : 'heard' as const,
      pos: { x, z }, intensity, age: 0, ttl: tuning.ttl, count: 1 };
    cues.push(cue); s.cueSources.set(cue.id, { x: source.x, z: source.z });
  }
  ctx.emit({ type: 'senseCue', cueId: cue.id, kind, fresh });
  if (cues.length > BALANCE.senses.maxCues) {
    // Evict the weakest cue, preferring sirens/scent over gunshot/scream warnings.
    const isWarning = (c: { kind: SenseKind }) => c.kind === 'gunshot' || c.kind === 'scream';
    let weakest = 0;
    for (let i = 1; i < cues.length; i++) {
      const a = cues[i], b = cues[weakest];
      if (isWarning(a) !== isWarning(b) ? !isWarning(a) : a.intensity < b.intensity) weakest = i;
    }
    s.cueSources.delete(cues[weakest].id); cues.splice(weakest, 1);
  }
}

function shotAtHorde(state: GameState, guard: GuardAgent, event: Extract<GameEvent, { type: 'shot' }>): boolean {
  // Misses in HumanAISystem land 0.8..1.2 m sideways. The target reference handles lethal hits in this step.
  if (guard.target?.kind === 'leader') return true;
  if (distanceSq(event.to, state.leader.pos) <= (state.leader.radius + 1.2) ** 2) return true;
  for (const z of state.zombies) {
    if ((z.state === 'follower' || z.state === 'dead' && guard.target?.kind === 'zombie' && guard.target.id === z.id) &&
        distanceSq(event.to, z.pos) <= (z.radius + 1.2) ** 2) return true;
  }
  return false;
}

function copyIds(out: EntityId[], next: EntityId[]): boolean {
  next.sort((a, b) => a - b);
  let changed = out.length !== next.length;
  for (let i = 0; i < next.length; i++) { if (out[i] !== next[i]) changed = true; out[i] = next[i]; }
  out.length = next.length;
  return changed;
}

function rebuild(ctx: SimContext, s: Scratch, p: VisionProfile, blind: boolean, dt: number): void {
  const state = ctx.state, leader = state.leader.pos;
  const clearSq = p.clearRadius ** 2, movingSq = p.movingDetectRadius ** 2;
  // Playtest (user, 2026-11-15): a human must be visible wherever the world is (a tree next to it is): every living
  // human inside the rendered vision limit is at least 'seen' (hazed silhouette, not targetable). Identification
  // (full look, targeting) still needs clear sight.
  const visibleSq = (p.hazeRadius * (1 + VISION_EDGE_BAND)) ** 2;
  s.candidates.length = 0;
  if (!blind) for (const g of state.guards) {
    if (!living(g) || g.dormant) continue;
    const d2 = distanceSq(leader, g.pos);
    const speedSq = Math.max(g.vel.x ** 2 + g.vel.z ** 2,
      distanceSq(g.pos, g.prevPos) / (dt > 0 ? dt : BALANCE.sim.fixedDt) ** 2);
    if (d2 > BALANCE.vision.alwaysRadius ** 2 &&
        (d2 <= clearSq || p.detectMovingHumans && speedSq > BALANCE.vision.movingSpeed ** 2 && d2 <= movingSq)) {
      s.candidates.push(g);
    }
  }
  const count = s.candidates.length, checks = Math.min(count, BALANCE.vision.maxLosChecksPerUpdate);
  for (let i = 0; i < checks; i++) {
    const g = s.candidates[(s.cursor + i) % count];
    s.sight.toHeight = g.elevation + (g.tower ? BALANCE.guard.eyeHeight : 1.5);
    s.ignoreIds.length = 0;
    if (g.towerColliderId !== null) s.ignoreIds.push(g.towerColliderId);
    s.sight.ignoreIds = s.ignoreIds;
    s.humans.get(g.id)!.los = !ctx.collision.segmentBlocked(leader, g.pos, s.sight);
  }
  s.cursor = count ? (s.cursor + checks) % count : 0;
  s.identified.length = 0; s.seen.length = 0;
  for (const g of state.guards) {
    if (!living(g) || g.dormant) continue;
    const m = s.humans.get(g.id)!, d2 = distanceSq(leader, g.pos);
    const engaged = m.engagedUntil > state.time && d2 <= clearSq * 4;
    if (engaged || !blind && (d2 <= BALANCE.vision.alwaysRadius ** 2 || d2 <= clearSq && m.los)) {
      s.identified.push(g.id);
    } else if (!blind) {
      const speedSq = Math.max(g.vel.x ** 2 + g.vel.z ** 2,
        distanceSq(g.pos, g.prevPos) / (dt > 0 ? dt : BALANCE.sim.fixedDt) ** 2);
      if (d2 < visibleSq ||
          p.detectMovingHumans && speedSq > BALANCE.vision.movingSpeed ** 2 && d2 <= movingSq && m.los ||
          p.detectDefenses && g.strongholdId !== null && d2 <= p.defenseRadius ** 2 ||
          p.detectReinforcements && m.reinforcement && d2 <= p.reinforcementRadius ** 2) s.seen.push(g.id);
    }
  }
  const identifiedChanged = copyIds(state.vision.identified, s.identified);
  const seenChanged = copyIds(state.vision.seen, s.seen);
  if (identifiedChanged || seenChanged) state.vision.revision++;
}

/** Call once after the simulation's combat/respawn systems, with only this step's events. */
export function updateAwareness(ctx: SimContext, dt: number, stepEvents: readonly GameEvent[]): void {
  const state = ctx.state, s = scratchFor(state);
  state.vision.tier = state.progression.visionTier;
  const p = profiles[state.vision.tier - 1];
  for (let i = state.vision.cues.length - 1; i >= 0; i--) {
    const cue = state.vision.cues[i]; cue.age += dt;
    if (cue.age >= cue.ttl) { s.cueSources.delete(cue.id); state.vision.cues.splice(i, 1); }
  }
  // Process waves before adding this step's new ids to the memory table.
  for (const ev of stepEvents) if (ev.type === 'reinforcements') {
    addCue(ctx, s, 'siren', ev.pos, p);
    for (const g of state.guards) if (living(g) && g.post === 'patrol' && !s.humans.has(g.id) && distanceSq(g.pos, ev.pos) <= 15 ** 2) {
      s.humans.set(g.id, { id: g.id, previousState: g.state, los: false, engagedUntil: -Infinity, reinforcement: true, epoch: s.epoch });
    }
  }
  s.epoch++;
  for (const g of state.guards) {
    let m = s.humans.get(g.id);
    if (!m) { m = { id: g.id, previousState: 'PATROL', los: false, engagedUntil: -Infinity, reinforcement: false, epoch: s.epoch }; s.humans.set(g.id, m); }
    m.epoch = s.epoch;
    if (living(g) && !g.dormant && g.role === 'civilian' && g.state === 'RETREAT' && m.previousState !== 'RETREAT') addCue(ctx, s, 'scream', g.pos, p);
    m.previousState = g.state;
  }
  // values() avoids allocating a Map entry tuple for every human on every fixed step.
  for (const m of s.humans.values()) if (m.epoch !== s.epoch) s.humans.delete(m.id);
  for (const ev of stepEvents) if (ev.type === 'shot') {
    const g = state.guards.find(human => human.id === ev.guardId);
    if (!g) continue;
    addCue(ctx, s, 'gunshot', g.pos, p);
    if (shotAtHorde(state, g, ev)) s.humans.get(g.id)!.engagedUntil = state.time + BALANCE.vision.engagedMemory;
  }
  s.crowdElapsed += dt;
  if (s.crowdElapsed + 1e-9 >= 1 / BALANCE.senses.crowdScanHz) {
    s.crowdElapsed %= 1 / BALANCE.senses.crowdScanHz;
    for (const cell of s.crowd.values()) { cell.x = 0; cell.z = 0; cell.count = 0; }
    for (const g of state.guards) if (living(g) && !g.dormant) {
      const key = Math.floor(g.pos.x / BALANCE.senses.crowdCellSize) + Math.floor(g.pos.z / BALANCE.senses.crowdCellSize) * 1048576;
      let cell = s.crowd.get(key);
      if (!cell) { cell = { x: 0, z: 0, count: 0 }; s.crowd.set(key, cell); }
      cell.x += g.pos.x; cell.z += g.pos.z; cell.count++;
    }
    for (const cell of s.crowd.values()) if (cell.count >= BALANCE.senses.crowdMinHumans) {
      s.point.x = cell.x / cell.count; s.point.z = cell.z / cell.count; addCue(ctx, s, 'crowd', s.point, p);
    }
  }
  const blind = !state.leader.alive || state.phase === 'respawning';
  s.elapsed += dt;
  if (s.elapsed + 1e-9 >= 1 / BALANCE.vision.updateHz || blind !== s.blind) {
    s.elapsed %= 1 / BALANCE.vision.updateHz; rebuild(ctx, s, p, blind, dt);
  }
  s.blind = blind;
}
