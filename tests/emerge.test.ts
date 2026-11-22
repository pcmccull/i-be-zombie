import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import { beginLeaderEmerge, updateLeader } from '../src/entities/ZombieLeader';
import { Simulation } from '../src/sim/Simulation';
import { killLeader } from '../src/systems/CombatSystem';
import { updateRespawn } from '../src/systems/RespawnSystem';
import { animateZombie, createAnimInput, createAnimState, EMERGE_BURIED_Y } from '../src/visuals/zombieAnimation';
import { alphaProfile } from '../src/visuals/zombieProfiles';
import { createPose, RIG } from '../src/visuals/zombieRig';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const DT = BALANCE.sim.fixedDt;

describe('Alpha climbs out of the ground at its nest', () => {
  it('locks movement and attacks for emergeTime, then hands control back', () => {
    const sim = new Simulation(buildDistrictLayout());
    const l = sim.state.leader, start = { ...l.pos };
    sim.drainEvents();
    beginLeaderEmerge(sim.ctx);
    expect(sim.drainEvents()).toEqual([{ type: 'leaderEmerge', pos: start }]);
    expect(l.emergeTimer).toBe(BALANCE.respawn.emergeTime);
    const input = { ...emptyInput(), moveForward: 1, sprint: true, attack: true };
    const steps = Math.round(BALANCE.respawn.emergeTime / DT) - 1;
    for (let i = 0; i < steps; i++) updateLeader(sim.ctx, DT, input);
    expect(l.pos).toEqual(start);
    expect(l.attackPhase).toBe('ready');
    expect(l.anim).toBe('rise');
    for (let i = 0; i < 3; i++) updateLeader(sim.ctx, DT, { ...input, attack: false });
    expect(l.emergeTimer).toBe(0);
    for (let i = 0; i < 30; i++) updateLeader(sim.ctx, DT, { ...input, attack: false });
    expect(Math.hypot(l.pos.x - start.x, l.pos.z - start.z)).toBeGreaterThan(0.5);
  });

  it('respawning at a nest starts the climb out', () => {
    const sim = new Simulation(buildDistrictLayout());
    killLeader(sim.ctx);
    updateRespawn(sim.ctx, DT);
    updateRespawn(sim.ctx, BALANCE.respawn.delay);
    const events = sim.drainEvents();
    const respawned = events.find(e => e.type === 'leaderRespawned');
    expect(respawned).toBeDefined();
    const emerge = events.find(e => e.type === 'leaderEmerge');
    expect(emerge).toMatchObject({ pos: sim.state.leader.pos });
    const nest = respawned && 'pos' in respawned ? respawned.pos : { x: NaN, z: NaN };
    const d = Math.hypot(sim.state.leader.pos.x - nest.x, sim.state.leader.pos.z - nest.z);
    expect(d).toBeGreaterThan(2); // beside the mound, not inside it
    expect(d).toBeLessThanOrEqual(BALANCE.respawn.emergeOffset + 1e-6);
    expect(sim.state.leader.emergeTimer).toBe(BALANCE.respawn.emergeTime);
  });

  it('nest-spawned followers crawl out (staggered), stay put meanwhile, then follow', () => {
    const sim = new Simulation(buildDistrictLayout());
    const nextId = sim.state.nextEntityId;
    killLeader(sim.ctx);
    updateRespawn(sim.ctx, DT);
    updateRespawn(sim.ctx, BALANCE.respawn.delay);
    const added = sim.state.zombies.filter(z => z.id >= nextId);
    expect(added).toHaveLength(BALANCE.respawn.followers);
    const maxT = BALANCE.respawn.emergeTime * (1 + BALANCE.respawn.emergeStagger);
    for (const z of added) {
      expect(z.state).toBe('follower');
      expect(z.emergeTimer).toBeGreaterThanOrEqual(BALANCE.respawn.emergeTime);
      expect(z.emergeTimer).toBeLessThanOrEqual(maxT);
    }
    expect(new Set(added.map(z => z.emergeTimer)).size).toBeGreaterThan(1);
    const start = added.map(z => ({ ...z.pos }));
    const steps = Math.floor(BALANCE.respawn.emergeTime / DT) - 2;
    for (let i = 0; i < steps; i++) sim.step(DT, emptyInput());
    added.forEach((z, i) => { expect(z.pos).toEqual(start[i]); expect(z.engageTarget).toBeNull(); });
    sim.state.leader.pos.x += 12; // walk away once free: followers must come along
    for (let i = 0; i < Math.ceil((maxT + 2) / DT); i++) sim.step(DT, emptyInput());
    expect(added.every(z => z.emergeTimer === 0)).toBe(true);
    expect(added.some((z, i) => Math.hypot(z.pos.x - start[i].x, z.pos.z - start[i].z) > 0.5)).toBe(true);
  });

  it('a dead or unspawned leader does not emerge', () => {
    const sim = new Simulation(buildDistrictLayout());
    sim.state.leader.alive = false;
    sim.drainEvents();
    beginLeaderEmerge(sim.ctx);
    expect(sim.state.leader.emergeTimer).toBe(0);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('pose starts fully buried, rises monotonically and ends standing without a pop', () => {
    const p = alphaProfile(), s = createAnimState(), inp = createAnimInput(), pose = createPose();
    inp.anim = 'rise'; inp.emerge = true;
    const head = RIG.hipY + 1.2; // well under the head top
    let prevY = -Infinity, prev = createPose();
    const n = 156;
    for (let i = 0; i <= n; i++) {
      inp.riseT = i / n;
      animateZombie(s, p, inp, pose);
      if (i === 0) {
        expect(pose.rootY).toBeCloseTo(EMERGE_BURIED_Y, 3);
        expect(pose.rootY + head).toBeLessThan(0);
      }
      expect(pose.rootY).toBeGreaterThanOrEqual(prevY - 1e-9);
      prevY = pose.rootY;
      if (i > 0) expect(Math.abs(pose.rootY - prev.rootY)).toBeLessThan(0.08);
      Object.assign(prev, pose);
    }
    expect(Math.abs(pose.rootY)).toBeLessThan(1e-6);
    // Hand-over to idle: next frame in idle stays close.
    inp.anim = 'idle'; inp.emerge = false; inp.riseT = 0;
    animateZombie(s, p, inp, pose);
    expect(Math.abs(pose.rootY - prev.rootY)).toBeLessThan(0.05);
  });
});
