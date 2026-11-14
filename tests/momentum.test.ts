import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { SimContext } from '../src/core/contracts';
import type { GameEvent, MomentumReason } from '../src/core/types';
import {
  addMomentum, createMomentum, momentumTier, recruitRadiusMultiplier, speedMultiplier, updateMomentum,
} from '../src/systems/MomentumSystem';

const M = BALANCE.momentum;
const dt = BALANCE.sim.fixedDt;

function fakeCtx() {
  const events: GameEvent[] = [];
  const ctx = { state: { momentum: createMomentum() }, emit: (e: GameEvent) => events.push(e) } as unknown as SimContext;
  return { ctx, events, m: ctx.state.momentum };
}

describe('momentum', () => {
  it('awards the configured gain per event reason', () => {
    const cases: [MomentumReason, number][] = [
      ['recruit', M.gainRecruit], ['convert', M.gainConvert], ['armedKill', M.gainArmedKill], ['structure', M.gainStructure],
    ];
    for (const [reason, gain] of cases) {
      const { ctx, events, m } = fakeCtx();
      addMomentum(ctx, reason);
      expect(m.value).toBe(gain);
      expect(events[0]).toEqual({ type: 'momentumGain', amount: gain, value: gain, reason });
    }
    expect([M.gainRecruit, M.gainConvert, M.gainArmedKill, M.gainStructure]).toEqual([1, 3, 5, 10]);
  });

  it('clamps at max and reports the actual amount gained', () => {
    const { ctx, events, m } = fakeCtx();
    m.value = 95;
    addMomentum(ctx, 'structure');
    expect(m.value).toBe(M.max);
    expect(events.find(e => e.type === 'momentumGain')).toMatchObject({ amount: 5, value: 100 });
    const before = events.length;
    m.idleTime = 3;
    addMomentum(ctx, 'recruit');
    expect(m.value).toBe(M.max);
    expect(events.length).toBe(before); // no zero-amount gain event at full
    expect(m.idleTime).toBe(0); // but activity still resets the grace window
  });

  it('holds during the grace period, then decays to zero without going negative', () => {
    const { ctx, m } = fakeCtx();
    for (let i = 0; i < 20; i++) addMomentum(ctx, 'recruit');
    const steps = Math.floor(M.graceTime / dt) - 1;
    for (let i = 0; i < steps; i++) updateMomentum(ctx, dt);
    expect(m.value).toBe(20);
    for (let i = 0; i < 60; i++) updateMomentum(ctx, dt); // ~1 s past grace
    expect(m.value).toBeLessThan(20);
    expect(m.value).toBeGreaterThan(20 - M.decayPerSecond * 1.1);
    for (let i = 0; i < 60 * 30; i++) updateMomentum(ctx, dt);
    expect(m.value).toBe(0);
  });

  it('a gain resets the grace window', () => {
    const { ctx, m } = fakeCtx();
    addMomentum(ctx, 'convert');
    for (let i = 0; i < 60 * (M.graceTime + 2); i++) updateMomentum(ctx, dt);
    const decayed = m.value;
    expect(decayed).toBeLessThan(M.gainConvert);
    addMomentum(ctx, 'recruit');
    expect(m.idleTime).toBe(0);
    for (let i = 0; i < 60; i++) updateMomentum(ctx, dt);
    expect(m.value).toBeCloseTo(decayed + M.gainRecruit, 6);
  });

  it('emits tier events in both directions with spec thresholds', () => {
    expect(momentumTier(0)).toBe('dormant');
    expect(momentumTier(29.9)).toBe('dormant');
    expect(momentumTier(30)).toBe('growing');
    expect(momentumTier(69.9)).toBe('growing');
    expect(momentumTier(70)).toBe('full');
    const { ctx, events, m } = fakeCtx();
    for (let i = 0; i < 7; i++) addMomentum(ctx, 'structure');
    const tiers = () => events.filter(e => e.type === 'momentumTier').map(e => (e as { tier: string }).tier);
    expect(tiers()).toEqual(['growing', 'full']);
    expect(m.tier).toBe('full');
    for (let i = 0; i < 60 * 60; i++) updateMomentum(ctx, dt);
    expect(tiers()).toEqual(['growing', 'full', 'growing', 'dormant']);
    expect(m.tier).toBe('dormant');
  });

  it('gain flash is set on gain and ticks down', () => {
    const { ctx, m } = fakeCtx();
    addMomentum(ctx, 'recruit');
    expect(m.gainFlash).toBe(M.gainFlashTime);
    for (let i = 0; i < 60; i++) updateMomentum(ctx, dt);
    expect(m.gainFlash).toBe(0);
  });

  it('multipliers follow the spec formulas', () => {
    for (const [value, radius, speed] of [[0, 1, 1], [50, 1.25, 1.1], [100, 1.5, 1.2]]) {
      const state = { momentum: { ...createMomentum(), value } };
      expect(recruitRadiusMultiplier(state)).toBeCloseTo(radius, 10);
      expect(speedMultiplier(state)).toBeCloseTo(speed, 10);
    }
  });
});
