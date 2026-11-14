import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { computeMoveVector, updateLeader, updateStamina } from '../src/entities/ZombieLeader';
import { Simulation } from '../src/sim/Simulation';
import { buildLegacyDistrictLayout as buildDistrictLayout } from '../src/world/legacyDistrictLayout';

const dt = BALANCE.sim.fixedDt;
describe('leader movement', () => {
  it('normalizes diagonal input and uses the authored camera convention', () => {
    const out = { x: 0, z: 0 };
    expect(computeMoveVector(1, 0, 0, out)).toEqual({ x: 0, z: 1 });
    computeMoveVector(1, 0, Math.PI / 2, out); expect(out.x).toBeCloseTo(1); expect(out.z).toBeCloseTo(0);
    expect(computeMoveVector(0, 1, 0, out)).toEqual({ x: -1, z: 0 });
    computeMoveVector(1, 1, 0, out); expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
    computeMoveVector(0.25, 0, 0, out); expect(out.z).toBe(0.25);
    const sim = new Simulation();
    sim.state.leader.pos = { x: -85, z: 62 };
    for (let i = 0; i < 60; i++) updateLeader(sim.ctx, dt, { ...emptyInput(), moveForward: 1, moveRight: 1 });
    const diagonal = Math.hypot(sim.state.leader.pos.x + 85, sim.state.leader.pos.z - 62);
    sim.reset();
    for (let i = 0; i < 60; i++) updateLeader(sim.ctx, dt, { ...emptyInput(), moveForward: 1 });
    expect(diagonal).toBeCloseTo(sim.state.leader.pos.z - 62, 8);
  });

  it('drains 25/s, recovers 15/s, and honors the exhaustion latch while sprint is held', () => {
    const l = new Simulation().state.leader;
    for (let i = 0; i < 240; i++) expect(updateStamina(l, true, true, dt)).toBe(true);
    expect(l.stamina).toBe(0); expect(l.exhausted).toBe(true);
    for (let i = 0; i < 79; i++) expect(updateStamina(l, true, true, dt)).toBe(false);
    expect(l.stamina).toBeCloseTo(19.75); expect(l.exhausted).toBe(true);
    expect(updateStamina(l, true, true, dt)).toBe(false);
    expect(l.stamina).toBe(20); expect(l.exhausted).toBe(false);
    expect(updateStamina(l, true, true, dt)).toBe(true);
    const before = l.stamina; expect(updateStamina(l, true, false, dt)).toBe(false);
    expect(l.stamina).toBeCloseTo(before + 15 * dt);
  });

  it.each([false, true])('reaches the specified speed with acceleration (sprint=%s)', sprint => {
    const sim = new Simulation(), l = sim.state.leader;
    const input = { ...emptyInput(), moveForward: 1, sprint };
    for (let i = 0; i < 15; i++) updateLeader(sim.ctx, dt, input);
    const z = l.pos.z;
    for (let i = 0; i < 60; i++) updateLeader(sim.ctx, dt, input);
    expect(l.pos.z - z).toBeCloseTo(sprint ? 7.4 : 5, 8);
  });

  it('slides along a real building for three seconds without overlapping', () => {
    const sim = new Simulation(buildDistrictLayout());
    const l = sim.state.leader;
    // South face of the long west-center apartment, far from its corners.
    l.pos.x = -110; l.pos.z = 19;
    let touched = false;
    for (let i = 0; i < 180; i++) {
      updateLeader(sim.ctx, dt, { ...emptyInput(), moveForward: -1, moveRight: -0.2 });
      expect(sim.ctx.collision.isBlocked(l.pos, l.radius)).toBe(false);
      if (l.pos.z < 17.46) touched = true;
    }
    expect(touched).toBe(true); expect(l.pos.x).toBeGreaterThan(-108);
    expect(l.pos.z).toBeGreaterThanOrEqual(17 + l.radius - 1e-8);
  });

  it('slows an already sprinting leader to 40 percent speed during windup', () => {
    const sim = new Simulation(), l = sim.state.leader;
    l.vel.z = BALANCE.leader.sprintSpeed;
    const z = l.pos.z, interval = BALANCE.alpha.biteWindup / 2;
    updateLeader(sim.ctx, interval, { ...emptyInput(), moveForward: 1, sprint: true, attack: true });
    expect(l.attackPhase).toBe('windup');
    expect(l.pos.z - z).toBeCloseTo(BALANCE.leader.sprintSpeed * 0.4 * interval);
    expect(Math.hypot(l.vel.x, l.vel.z)).toBeCloseTo(BALANCE.leader.sprintSpeed * 0.4);
  });

  it('preserves short attack/hit clips, resets clips only on change, and stops a dead leader', () => {
    const sim = new Simulation(), l = sim.state.leader;
    l.anim = 'attack'; l.animTime = 0.2;
    updateLeader(sim.ctx, dt, emptyInput()); expect(l.anim).toBe('attack'); expect(l.animTime).toBe(0.2);
    l.animTime = 0.4; updateLeader(sim.ctx, dt, emptyInput()); expect(l.anim).toBe('idle'); expect(l.animTime).toBe(0);
    l.animTime = 1; updateLeader(sim.ctx, dt, emptyInput()); expect(l.animTime).toBe(1);
    l.alive = false; l.vel.x = 2; updateLeader(sim.ctx, dt, { ...emptyInput(), moveForward: 1 });
    expect(l.anim).toBe('dead'); expect(l.vel).toEqual({ x: 0, z: 0 });
  });
});
