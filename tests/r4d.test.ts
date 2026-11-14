// R4d regression tests for findings from the R4a adversarial review.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { updateCombat } from '../src/systems/CombatSystem';
import { recruitZombie, updateHorde } from '../src/systems/HordeSystem';
import { updateNavigation } from '../src/systems/NavigationSystem';
import { findStructure } from '../src/systems/StructureSystem';
import { dt, flatSimulation, zombie } from './r2-fixtures';

describe('R4d regressions', () => {
  it('a slowest-rolled straggler still closes on a leader walking continuously (catch-up beats walk speed)', () => {
    const sim = flatSimulation();
    sim.state.leader.pos = { x: -40, z: 0 }; sim.state.leader.facing = Math.PI / 2;
    const z = zombie(sim, -58, 0, { state: 'follower', speedScale: 1 - BALANCE.walker.speedVariance, followOffset: { x: 0, z: -2 } });
    const walk = BALANCE.leader.walkSpeed;
    let firstGap = 0, lastGap = 0;
    for (let i = 0; i < 60 * 12; i++) {
      sim.state.leader.pos.x += walk * dt; // leader walks east without stopping
      if (i % 12 === 0) updateNavigation(sim.ctx, dt, emptyInput());
      updateHorde(sim.ctx, dt, emptyInput());
      const gap = Math.hypot(sim.state.leader.pos.x - z.pos.x, sim.state.leader.pos.z - z.pos.z);
      if (i === 60) firstGap = gap;
      lastGap = gap;
    }
    expect(firstGap).toBeGreaterThan(BALANCE.walker.catchUpDistance);
    // It must end inside the catch-up band (gap shrinks until catch-up switches off), not keep drifting away.
    expect(lastGap).toBeLessThanOrEqual(BALANCE.walker.catchUpDistance + 1);
  });

  it('many simultaneous hits (leader + followers in one combat step) destroy a structure exactly once', () => {
    const sim = new Simulation();
    const s = findStructure(sim.state, 1)!; // bus door
    const def = sim.ctx.layout.structures.find(d => d.id === 1)!;
    s.hp = 1;
    sim.state.zombies = sim.state.zombies.filter(z => z.heldBy === 1); // keep only the bus occupants
    sim.state.followerCount = 0;
    const target = { kind: 'structure' as const, id: 1 };
    sim.state.order = { type: 'attack', target };
    for (const p of def.approachOutside) {
      const z = zombie(sim, p.x, p.z);
      recruitZombie(sim.ctx, z, false);
      z.engageTarget = target; z.attackCooldown = 0;
    }
    const a = def.approachOutside[0];
    sim.state.leader.pos = { x: a.x, z: a.z };
    sim.state.leader.facing = def.facing + Math.PI; sim.state.leader.attackCooldown = 0;
    updateCombat(sim.ctx, dt, emptyInput());
    const events = sim.drainEvents();
    expect(s.destroyed).toBe(true);
    expect(events.filter(e => e.type === 'structureDestroyed')).toHaveLength(1);
    expect(events.filter(e => e.type === 'released')).toHaveLength(1);
    expect(sim.state.stats.structuresDestroyed).toBe(1);
    expect(sim.ctx.collision.colliders[s.colliderId].enabled).toBe(false);
  });
});
