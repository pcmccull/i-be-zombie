import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { AlphaDamageSource, GameEvent, GameState, ZombieAgent } from '../core/types';
import { clamp } from '../utils/math';
import { damageZombie, killLeader } from './CombatSystem';
import { followerCap } from './HordeSystem';

type StrengthCause = Extract<GameEvent, { type: 'hordeStrengthChanged' }>['cause'];
interface StrengthResult { strength: number; maxStrength: number; followerStrength: number }
interface Scratch {
  result: StrengthResult;
  alphaHit: number;
  heal: number;
  respawn: number;
  strengthBeforeReset: number | undefined;
  criticalArmed: boolean;
}

// State-keyed scratch keeps simultaneous simulations and restarts independent.
const scratchByState = new WeakMap<GameState, Scratch>();
function scratchFor(state: GameState): Scratch {
  let scratch = scratchByState.get(state);
  if (!scratch) {
    scratch = {
      result: { strength: 0, maxStrength: 0, followerStrength: 0 },
      alphaHit: 0, heal: 0, respawn: 0, strengthBeforeReset: undefined, criticalArmed: true,
    };
    scratchByState.set(state, scratch);
  }
  return scratch;
}

export function strengthValueOf(state: GameState, z: ZombieAgent): number {
  if (z.state !== 'follower' || z.hp <= 0) return 0;
  for (const companion of state.companions) {
    if (companion.zombieId === z.id) return BALANCE.hordeHealth.values.companion;
  }
  return z.brute ? BALANCE.hordeHealth.values.brute : BALANCE.hordeHealth.values.walker;
}

export function maxHordeStrength(ctx: SimContext): number {
  const b = BALANCE.hordeHealth;
  return b.alphaCore + followerCap(ctx) * b.capUnitsPerFollower;
}

/** Returns state-local reused scratch, overwritten by the next calculation for this state. */
export function computeHordeStrength(ctx: SimContext): StrengthResult {
  const result = scratchFor(ctx.state).result;
  let followerStrength = 0;
  for (const z of ctx.state.zombies) followerStrength += strengthValueOf(ctx.state, z);
  result.followerStrength = followerStrength;
  result.maxStrength = maxHordeStrength(ctx);
  result.strength = clamp(followerStrength + (BALANCE.hordeHealth.alphaCore - ctx.state.horde.coreDamage),
    0, result.maxStrength);
  return result;
}

/** No sorting/candidate arrays: each pour selects the nearest still-living recipient. */
function nearestFollower(state: GameState, radiusSq: number): ZombieAgent | undefined {
  let nearest: ZombieAgent | undefined;
  let nearestSq = radiusSq;
  for (const z of state.zombies) {
    if (z.state !== 'follower' || z.dormant || !(z.hp > 0)) continue;
    const dx = z.pos.x - state.leader.pos.x, dz = z.pos.z - state.leader.pos.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= radiusSq && (!nearest || distanceSq < nearestSq ||
        (distanceSq === nearestSq && z.id < nearest.id))) {
      nearest = z; nearestSq = distanceSq;
    }
  }
  return nearest;
}

export function applyAlphaDamage(ctx: SimContext, incoming: number, _source: AlphaDamageSource): void {
  // Non-finite damage cannot describe a valid hit and must never poison telemetry.
  if (!(incoming > 0) || !Number.isFinite(incoming)) return;
  const state = ctx.state, horde = state.horde, b = BALANCE.hordeHealth, scratch = scratchFor(state);
  const recipients: number[] = [];
  let remaining = incoming * b.alphaDamageMultiplier;
  let absorbed = 0, strengthLost = 0;
  for (let n = 0; n < b.maxRecipients && remaining > 0; n++) {
    const z = nearestFollower(state, b.shareRadius * b.shareRadius);
    if (!z) break;
    const amount = Math.min(remaining, z.hp);
    if (amount === z.hp) strengthLost += strengthValueOf(state, z);
    damageZombie(ctx, z, amount);
    recipients.push(z.id);
    remaining -= amount; absorbed += amount;
  }

  const coreHp = Math.min(remaining, Math.max(0, b.alphaCore - horde.coreDamage) * b.unitHp);
  const core = coreHp / b.unitHp;
  horde.coreDamage = Math.min(b.alphaCore, horde.coreDamage + core);
  remaining -= coreHp; absorbed += coreHp; strengthLost += core;

  // Once the core is empty, overflow can reach the entire horde without a recipient cap.
  while (remaining > 0) {
    const z = nearestFollower(state, Infinity);
    if (!z) break;
    const amount = Math.min(remaining, z.hp);
    if (amount === z.hp) strengthLost += strengthValueOf(state, z);
    damageZombie(ctx, z, amount);
    recipients.push(z.id);
    remaining -= amount; absorbed += amount;
  }
  horde.alphaDamageTaken += incoming;
  horde.sharedDamageDealt += absorbed;
  scratch.alphaHit += strengthLost;
  ctx.emit({ type: 'sharedDamage', pos: { ...state.leader.pos }, incoming, shared: absorbed, recipients, core });
}

export function restoreStrength(ctx: SimContext, units: number, _cause: 'heal'): number {
  if (!(units > 0) || !Number.isFinite(units)) return 0;
  const horde = ctx.state.horde;
  const applied = Math.min(units, horde.coreDamage);
  horde.coreDamage -= applied;
  scratchFor(ctx.state).heal += applied;
  return applied;
}

export function resetHordeHealth(state: GameState): void {
  const horde = state.horde, scratch = scratchFor(state);
  // Reset updates the cached value immediately, but the next step still reports its gain.
  scratch.strengthBeforeReset ??= horde.strength;
  const before = horde.strength;
  horde.coreDamage = 0;
  horde.lastBrain.active = false; horde.lastBrain.timeLeft = 0; horde.graceLeft = 0;
  horde.strength = clamp(horde.followerStrength + BALANCE.hordeHealth.alphaCore, 0, horde.maxStrength);
  scratch.respawn += Math.abs(horde.strength - before);
  scratch.criticalArmed = true;
}

export function isDepleted(state: GameState): boolean { return state.horde.strength <= 0; }
export function isLastBrain(state: GameState): boolean { return state.horde.lastBrain.active; }
export function isHordeShielded(state: GameState): boolean { return state.horde.graceLeft > 0; }
export function lastBrainSpeedMultiplier(state: GameState): number {
  return isLastBrain(state) ? BALANCE.hordeHealth.lastBrain.speedMultiplier : 1;
}

function clearLastBrain(state: GameState): void {
  state.horde.lastBrain.active = false; state.horde.lastBrain.timeLeft = 0;
}

export function finishLastBrain(ctx: SimContext): void {
  if (!isLastBrain(ctx.state)) return;
  ctx.emit({ type: 'lastBrainEnd', pos: { ...ctx.state.leader.pos }, outcome: 'finished' });
  clearLastBrain(ctx.state);
  killLeader(ctx);
}

export function updateHordeHealth(ctx: SimContext, dt: number): void {
  const state = ctx.state, horde = state.horde, b = BALANCE.hordeHealth, scratch = scratchFor(state);
  const previousStrength = scratch.strengthBeforeReset ?? horde.strength;
  const previousMax = horde.maxStrength, previousFollowers = horde.activeFollowers;
  const previousFollowerStrength = horde.followerStrength;
  const result = computeHordeStrength(ctx);
  horde.strength = result.strength; horde.maxStrength = result.maxStrength;
  horde.followerStrength = result.followerStrength; horde.activeFollowers = state.followerCount;
  const delta = horde.strength - previousStrength;
  if (delta > 0) horde.strengthGained += delta;
  else if (delta < 0) horde.strengthLost -= delta;

  if (Math.abs(delta) > 1e-6 || previousMax !== horde.maxStrength) {
    let cause: StrengthCause = 'capacity';
    let magnitude = 0;
    if (scratch.alphaHit > magnitude) { cause = 'alphaHit'; magnitude = scratch.alphaHit; }
    if (scratch.heal > magnitude) { cause = 'heal'; magnitude = scratch.heal; }
    if (scratch.respawn > magnitude) { cause = 'respawn'; magnitude = scratch.respawn; }
    if (magnitude === 0) {
      if (horde.activeFollowers < previousFollowers) cause = 'death';
      else if (horde.activeFollowers > previousFollowers) cause = 'recruit';
      else if (horde.followerStrength > previousFollowerStrength) cause = 'evolve';
      else if (delta < -1e-6 && horde.followerStrength < previousFollowerStrength) cause = 'death';
    }
    ctx.emit({ type: 'hordeStrengthChanged', strength: horde.strength, maxStrength: horde.maxStrength, delta, cause });
  }
  scratch.alphaHit = scratch.heal = scratch.respawn = 0;
  scratch.strengthBeforeReset = undefined;

  if (horde.strength > (b.criticalFrac + 0.05) * horde.maxStrength) scratch.criticalArmed = true;
  if (scratch.criticalArmed && horde.strength < b.criticalFrac * horde.maxStrength) {
    scratch.criticalArmed = false;
    ctx.emit({ type: 'hordeCritical', strength: horde.strength, maxStrength: horde.maxStrength });
  }
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  horde.graceLeft = Math.max(0, horde.graceLeft - elapsed);
  if (!state.leader.alive || state.phase === 'respawning') {
    clearLastBrain(state);
    return;
  }
  if (state.phase !== 'playing') return;
  if (!horde.lastBrain.active) {
    if (isDepleted(state)) {
      horde.lastBrain.active = true; horde.lastBrain.timeLeft = b.lastBrain.duration;
      horde.graceLeft = Math.max(horde.graceLeft, b.lastBrain.entryGrace);
      ctx.emit({ type: 'lastBrainStart', pos: { ...state.leader.pos }, duration: b.lastBrain.duration });
    }
    return;
  }
  horde.lastBrain.timeLeft = Math.max(0, horde.lastBrain.timeLeft - elapsed);
  if (horde.strength > 0) {
    ctx.emit({ type: 'lastBrainEnd', pos: { ...state.leader.pos }, outcome: 'recovered' });
    clearLastBrain(state); horde.graceLeft = b.lastBrain.recoveryGrace;
  } else if (horde.lastBrain.timeLeft <= 0) {
    ctx.emit({ type: 'lastBrainEnd', pos: { ...state.leader.pos }, outcome: 'expired' });
    clearLastBrain(state); killLeader(ctx);
  }
}
