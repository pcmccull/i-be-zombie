// docs/todos.md #5: civilians outrun zombies unless the horde is Rushing.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { updateHorde } from '../src/systems/HordeSystem';
import { addMomentum } from '../src/systems/MomentumSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { dt, flatSimulation, zombie } from './r2-fixtures';

function chase(rush: boolean): { start: number; end: number } {
  const sim = flatSimulation();
  // Worst case for the civilian: full momentum and a fresh-recruit boost on the chaser.
  for (let i = 0; i < 10; i++) addMomentum(sim.ctx, 'structure');
  sim.state.leader.pos = { x: -55, z: 0 };
  const civ = createGuard(sim.ctx.newId(), { role: 'civilian', post: 'street', pos: { x: -20, z: 0 }, facing: 0, tower: null,
    waypoints: [{ x: -20, z: 0 }] }, sim.ctx.collision);
  civ.state = 'RETREAT';
  sim.state.guards = [civ];
  const target = { kind: 'guard' as const, id: civ.id };
  sim.state.order = { type: 'attack', target };
  const z = zombie(sim, -26, 0, { state: 'follower', speedScale: 1 + BALANCE.walker.speedVariance,
    recruitFlash: BALANCE.horde.recruitBoostTime, engageTarget: target });
  // Start already at speed toward the civilian so the comparison isn't dominated by acceleration.
  z.vel = { x: 5, z: 0 };
  if (rush) sim.state.abilities.rushTimeLeft = BALANCE.rush.duration;
  const start = civ.pos.x - z.pos.x;
  for (let i = 0; i < 120; i++) {
    civ.pos.x += BALANCE.civilian.fleeSpeed * dt; // flees east in a straight line
    if (i % 12 === 0) updateNavigation(sim.ctx, dt, emptyInput());
    updateHorde(sim.ctx, dt, emptyInput());
    sim.state.time += dt;
  }
  return { start, end: civ.pos.x - z.pos.x };
}

describe('civilian flight (todos #5)', () => {
  it('flee speed beats the leader walk even at full momentum, but not a sprint', () => {
    expect(BALANCE.civilian.fleeSpeed).toBeGreaterThan(BALANCE.leader.walkSpeed * (1 + 100 * BALANCE.momentum.speedPerPoint));
    expect(BALANCE.civilian.fleeSpeed).toBeLessThan(BALANCE.leader.sprintSpeed);
  });

  it('a fully boosted follower cannot close on a fleeing civilian without Rush', () => {
    const { start, end } = chase(false);
    expect(end).toBeGreaterThan(start + 0.5);
  });

  it('Rush lets the horde run a fleeing civilian down', () => {
    const { start, end } = chase(true);
    expect(end).toBeLessThan(start - 1);
  });
});
