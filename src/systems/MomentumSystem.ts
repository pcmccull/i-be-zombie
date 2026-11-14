// Outbreak Momentum (docs/2_intial_recruitment_design.md §5). Pure: no three.js.
// Only this module mutates `state.momentum`. Multipliers are read live by other systems.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { GameState, MomentumReason, MomentumState, MomentumTier } from '../core/types';

const M = BALANCE.momentum;

const GAIN: Record<MomentumReason, number> = {
  recruit: M.gainRecruit,
  convert: M.gainConvert,
  armedKill: M.gainArmedKill,
  structure: M.gainStructure,
};

export function momentumTier(value: number): MomentumTier {
  if (value >= M.tierFull) return 'full';
  if (value >= M.tierGrowing) return 'growing';
  return 'dormant';
}

export function createMomentum(): MomentumState {
  return { value: 0, idleTime: 0, tier: 'dormant', gainFlash: 0 };
}

/** 1 + value * recruitRadiusPerPoint (×1.5 at 100). Scales leader, rally and pulse radii. */
export function recruitRadiusMultiplier(state: Pick<GameState, 'momentum'>): number {
  return 1 + state.momentum.value * M.recruitRadiusPerPoint;
}

/** 1 + value * speedPerPoint (×1.2 at 100). Scales leader walk/sprint and follower speed. */
export function speedMultiplier(state: Pick<GameState, 'momentum'>): number {
  return 1 + state.momentum.value * M.speedPerPoint;
}

function syncTier(ctx: SimContext, m: MomentumState): void {
  const tier = momentumTier(m.value);
  if (tier !== m.tier) {
    m.tier = tier;
    ctx.emit({ type: 'momentumTier', tier, value: m.value });
  }
}

/** Award the gain for one gameplay event. Each event must call this exactly once. */
export function addMomentum(ctx: SimContext, reason: MomentumReason): void {
  const m = ctx.state.momentum;
  const before = m.value;
  m.value = Math.min(M.max, m.value + GAIN[reason]);
  // Activity always resets the grace window, even when already full.
  m.idleTime = 0;
  const amount = m.value - before;
  if (amount <= 0) return; // already full: activity extends the grace window but there is no gain to report
  m.gainFlash = M.gainFlashTime;
  ctx.emit({ type: 'momentumGain', amount, value: m.value, reason });
  syncTier(ctx, m);
}

/** Decay after the inactivity grace period; tick HUD flash. Call once per playing step. */
export function updateMomentum(ctx: SimContext, dt: number): void {
  const m = ctx.state.momentum;
  m.idleTime += dt;
  m.gainFlash = Math.max(0, m.gainFlash - dt);
  if (m.value > 0 && m.idleTime > M.graceTime) {
    // Only the part of this step past the grace boundary decays (exact regardless of dt).
    const decayTime = Math.min(dt, m.idleTime - M.graceTime);
    m.value = Math.max(0, m.value - M.decayPerSecond * decayTime);
    syncTier(ctx, m);
  }
}
