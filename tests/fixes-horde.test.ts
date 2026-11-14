import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { ColliderDef, SimInput, Vec2 } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { canMelee } from '../src/systems/CombatSystem';
import { applyHordeCommands, killZombie, recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { dist } from '../src/utils/math';
import { buildDistrictLayout } from '../src/world/districtLayout';

const dt = BALANCE.sim.fixedDt;
function fixture(extra: ColliderDef[] = []) {
  const layout = buildDistrictLayout();
  layout.colliders = [...layout.colliders.filter(c => c.kind === 'gate'), ...extra];
  // This fixture strips landmark colliders, so it has no associated structures or held zones.
  layout.structures = [];
  for (const zone of layout.spawnZones) zone.heldBy = 0;
  const sim = new Simulation(layout, 42); sim.state.zombies = []; sim.state.followerCount = 0;
  sim.state.leader.pos = { x: -8, z: 0 };
  const guard = sim.state.guards[5]; guard.pos = { x: 3, z: 0 };
  for (const other of sim.state.guards) if (other !== guard) { other.state = 'DEAD'; other.hp = 0; }
  return { sim, guard };
}
function add(sim: Simulation, pos: Vec2, state: 'ambient' | 'rising' = 'ambient') {
  const z = createZombie(sim.ctx.newId(), pos, { state, variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  z.followOffset = { x: 0, z: 0 }; z.speedScale = 1;
  sim.state.zombies.push(z); return z;
}
function step(sim: Simulation, input: SimInput = emptyInput()) {
  applyHordeCommands(sim.ctx, dt, input);
  updateNavigation(sim.ctx, dt, input);
  updateHorde(sim.ctx, dt, input);
  sim.state.time += dt;
}
function wall(minX: number, minZ: number, maxX: number, maxZ: number): ColliderDef {
  return { minX, minZ, maxX, maxZ, kind: 'prop', height: 2, blocksMove: true, blocksSight: true };
}

describe('horde review regressions', () => {
  it('recall clears a target three meters away and regroups for the full grace period', () => {
    const { sim, guard } = fixture(); const z = add(sim, { x: 0, z: 0 }); recruitZombie(sim.ctx, z, false);
    step(sim, { ...emptyInput(), attackTarget: { kind: 'guard', id: guard.id } });
    expect(z.engageTarget).toEqual({ kind: 'guard', id: guard.id });
    const before = dist(z.pos, sim.state.leader.pos);
    step(sim, { ...emptyInput(), recall: true });
    for (let i = 0; i < 5; i++) step(sim);
    expect(z.engageTarget).toBeNull();
    for (let i = 6; i < 120; i++) step(sim);
    expect(dist(z.pos, sim.state.leader.pos)).toBeLessThan(before);
    expect(z.engageTarget).toBeNull();
    // A guard entering ordinary auto-engage range still cannot interrupt regrouping.
    guard.pos = { x: z.pos.x + 3, z: z.pos.z };
    for (let i = 0; i < 20; i++) step(sim);
    expect(z.engageTarget).toBeNull();
    guard.pos = { x: z.pos.x + 3, z: z.pos.z };
    for (let i = 0; i < 12; i++) step(sim);
    expect(z.engageTarget).toEqual({ kind: 'guard', id: guard.id });
  });

  it('permits close self-defense during recall but drops it once the guard leaves 1.8 meters', () => {
    const { sim, guard } = fixture(); const z = add(sim, { x: 0, z: 0 }); recruitZombie(sim.ctx, z, false);
    guard.pos.x = 1.8;
    step(sim, { ...emptyInput(), recall: true });
    expect(z.engageTarget).toEqual({ kind: 'guard', id: guard.id });
    guard.pos.x = 3;
    step(sim); expect(z.engageTarget).toBeNull();
  });

  it('clears a retained follow engagement when its guard moves behind a wall', () => {
    const { sim, guard } = fixture([wall(1, 1, 1.2, 8)]);
    const z = add(sim, { x: 0, z: 2 }); recruitZombie(sim.ctx, z, false);
    guard.pos = { x: 0, z: 5 }; step(sim);
    expect(z.engageTarget).toEqual({ kind: 'guard', id: guard.id });
    guard.pos = { x: 3, z: 2 };
    const before = dist(z.pos, sim.state.leader.pos);
    for (let i = 0; i < 60; i++) step(sim);
    expect(z.engageTarget).toBeNull();
    expect(dist(z.pos, sim.state.leader.pos)).toBeLessThan(before);
  });

  it.each(['missing', 'unreachable'] as const)('falls back to following when the attack field is %s', failure => {
    const { sim, guard } = fixture([wall(1, -8, 1.2, 8), wall(-4, -2, -3.8, 2)]);
    const z = add(sim, { x: 0, z: 0 }); recruitZombie(sim.ctx, z, false);
    sim.state.order = { type: 'attack', target: { kind: 'guard', id: guard.id } };
    updateNavigation(sim.ctx, dt, emptyInput());
    sim.ctx.nav.attackField = failure === 'missing' ? null : sim.ctx.navGrid.buildFlowField([]);
    const followSample = vi.spyOn(sim.ctx.nav.followField!, 'sample');
    const before = dist(z.pos, sim.state.leader.pos);
    for (let i = 0; i < 60; i++) updateHorde(sim.ctx, dt, emptyInput());
    expect(followSample).toHaveBeenCalled();
    expect(dist(z.pos, sim.state.leader.pos)).toBeLessThan(before - 1);
  });

  it('routes toward gate approaches when a thin prop blocks an otherwise in-range gate', () => {
    const { sim } = fixture([wall(82, -51.5, 84, -51.4)]);
    const z = add(sim, { x: 83, z: -50.8 }); recruitZombie(sim.ctx, z, false);
    sim.state.leader.pos = { x: 80, z: -47 };
    sim.state.order = { type: 'attack', target: { kind: 'gate' } };
    expect(canMelee(sim.ctx, z.pos, BALANCE.walker.attackRange, { kind: 'gate' })).toBe(false);
    const before = { ...z.pos };
    for (let i = 0; i < 30; i++) step(sim);
    expect(dist(before, z.pos)).toBeGreaterThan(0.3);
  });

  it.each([false, true])('counts rising reservations once per recruitment pass (rally=%s)', rally => {
    const { sim } = fixture(); sim.state.leader.pos = { x: 0, z: 0 };
    let reservationReads = 0;
    const rising = Array.from({ length: 49 }, () => add(sim, { x: 1, z: 0 }, 'rising'));
    for (const z of rising) Object.defineProperty(z, 'state', {
      configurable: true, get: () => { reservationReads++; return 'rising'; },
    });
    for (let i = 0; i < 60; i++) add(sim, { x: 0, z: 0 });
    if (rally) applyHordeCommands(sim.ctx, dt, { ...emptyInput(), rally: true });
    else updateHorde(sim.ctx, dt, emptyInput());
    expect(sim.state.followerCount).toBe(51);
    expect(reservationReads).toBeLessThanOrEqual(rising.length * 5);
    const extra = sim.state.zombies.find(z => z.state === 'ambient')!;
    expect(recruitZombie(sim.ctx, extra, false)).toBe(false);
    Object.defineProperty(rising[0], 'state', { configurable: true, writable: true, value: 'rising' });
    killZombie(sim.ctx, rising[0]);
    expect(recruitZombie(sim.ctx, extra, false)).toBe(true);
    expect(recruitZombie(sim.ctx, extra, false)).toBe(false);
    expect(sim.state.followerCount).toBe(52);
  });

});
