import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput, type CivilianWeapon, type VehicleAgent } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import * as combat from '../src/systems/CombatSystem';
import { findShotInterceptor, updateHumanAI } from '../src/systems/HumanAISystem';
import { civilianWeaponFor } from '../src/systems/ResistanceSystem';
import { updateTraffic } from '../src/systems/TrafficSystem';
import { flatSimulation, zombie } from './r2-fixtures';

const dt = BALANCE.sim.fixedDt, input = emptyInput();
afterEach(() => vi.restoreAllMocks());

function hash(sim: ReturnType<typeof flatSimulation>): void {
  sim.ctx.zombieHash.clear();
  for (const z of sim.state.zombies) sim.ctx.zombieHash.insert(z.id, z.pos.x, z.pos.z);
}

function fixture(kind: 'rifle' | 'tower' | 'barricade' | 'police' | 'mg' | 'coax' | 'cannon' | CivilianWeapon = 'rifle') {
  const sim = flatSimulation();
  sim.ctx.rng = { next: () => 0 };
  const civilian = kind === 'pistol' || kind === 'shotgun' || kind === 'bat';
  let id = sim.ctx.newId();
  if (civilian) {
    sim.state.resistance.level = 4;
    for (id = 500_000; civilianWeaponFor(4, id) !== kind; id++) { /* deterministic weapon id */ }
  }
  const g = createGuard(id, {
    role: civilian ? 'civilian' : kind === 'police' ? 'police' : 'soldier',
    post: kind === 'barricade' ? 'barricade' : 'checkpoint', pos: { x: 0, z: 0 },
    facing: 0, tower: kind === 'tower' ? 'W' : null, waypoints: [],
    ...(kind === 'mg' ? { heavy: 'mg' as const } : {}),
    ...(kind === 'coax' || kind === 'cannon' ? { heavy: 'tank' as const } : {}),
  }, sim.ctx.collision);
  sim.state.guards.push(g);
  sim.state.leader.pos = { x: 0, z: kind === 'cannon' || kind === 'coax' ? 25 : kind === 'bat' ? 1 : 8 };
  g.state = 'COMBAT'; g.perceptionTimer = -1; g.attackCooldown = 100;
  updateHumanAI(sim.ctx, 0, input);
  // Acquire and finish aiming before a follower steps into the cached shot line.
  updateHumanAI(sim.ctx, 2, input);
  g.attackCooldown = 0; g.perceptionTimer = 1;
  if (kind === 'coax') {
    sim.state.leader.pos.z = 8;
    g.attackCooldown = 100; // acquire outside coax range, then isolate its first round without a cannon shot
  }
  sim.drainEvents();
  return { sim, g };
}

function shoot(sim: ReturnType<typeof flatSimulation>) {
  hash(sim);
  updateHumanAI(sim.ctx, dt, input);
  return sim.drainEvents();
}

describe('physical horde shielding', () => {
  it.each(['rifle', 'barricade', 'police', 'mg', 'coax', 'pistol', 'shotgun'] as const)(
    '%s bullets hit the first follower and end the tracer there, sparing the Alpha', kind => {
      const { sim } = fixture(kind);
      const farther = zombie(sim, 0, 6, { state: 'follower' });
      const first = zombie(sim, 0, 4, { state: 'follower' });
      const leaderDamage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
      const events = shoot(sim);
      const shots = events.filter(e => e.type === 'shot');
      expect(shots).toHaveLength(1);
      expect(shots[0]).toMatchObject({ hit: true, to: { x: first.pos.x, z: first.pos.z } });
      expect(first.hp).toBeLessThan(first.maxHp);
      expect(farther.hp).toBe(farther.maxHp);
      expect(leaderDamage).not.toHaveBeenCalled();
      expect(events.filter(e => e.type === 'damage' && e.target.kind === 'leader')).toHaveLength(0);
    });

  it.each(['rifle', 'barricade', 'police', 'mg', 'coax', 'pistol', 'shotgun'] as const)(
    '%s clear-line hits damage the Alpha once with the bullet source', kind => {
      const { sim } = fixture(kind);
      const damage = vi.spyOn(combat, 'damageLeader');
      const events = shoot(sim);
      expect(damage).toHaveBeenCalledTimes(1);
      expect(damage).toHaveBeenCalledWith(sim.ctx, expect.any(Number), 'bullet');
      expect(events.filter(e => e.type === 'damage' && e.target.kind === 'leader')).toHaveLength(1);
    });

  it.each([
    { state: 'follower' as const, dormant: true },
    { state: 'dead' as const, hp: 40 },
    { state: 'follower' as const, hp: 0 },
    { state: 'ambient' as const },
    { state: 'rising' as const },
  ])('ineligible bodies never intercept: %o', opts => {
    const { sim } = fixture();
    const z = zombie(sim, 0, 4, opts), hp = z.hp;
    const damage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    shoot(sim);
    expect(z.hp).toBe(hp);
    expect(damage).toHaveBeenCalledWith(sim.ctx, BALANCE.guard.damage, 'bullet');
  });

  it('does not intercept with a follower beside the line or beyond the Alpha', () => {
    const { sim } = fixture();
    const beside = zombie(sim, 1, 4, { state: 'follower' });
    const beyond = zombie(sim, 0, 10, { state: 'follower' });
    const damage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    shoot(sim);
    expect(beside.hp).toBe(beside.maxHp); expect(beyond.hp).toBe(beyond.maxHp);
    expect(damage).toHaveBeenCalledTimes(1);
  });

  it('uses circle entry distance, including tangency, and excludes the shot endpoint', () => {
    const { sim, g } = fixture();
    const far = zombie(sim, 0, 5, { state: 'follower' });
    const near = zombie(sim, 0, 4.8, { state: 'follower', radius: 0.1 });
    far.radius = 1;
    expect(findShotInterceptor(sim.ctx, g.pos, 1.5, sim.state.leader.pos, 1.2)).toBe(far);
    far.pos.x = 2; near.pos.x = near.radius;
    expect(findShotInterceptor(sim.ctx, g.pos, 1.5, sim.state.leader.pos, 1.2)).toBe(near);
    near.pos = { x: 0, z: sim.state.leader.pos.z + near.radius };
    expect(findShotInterceptor(sim.ctx, g.pos, 1.5, sim.state.leader.pos, 1.2)).toBeNull();
    expect(findShotInterceptor(sim.ctx, g.pos, 1.5, g.pos, 1.2)).toBeNull();
  });

  it.each(['rifle', 'tower', 'mg', 'coax'] as const)('%s elevated shooters fire over a follower near themselves', kind => {
    const { sim, g } = fixture(kind);
    g.elevation = 4;
    const z = zombie(sim, 0, 3, { state: 'follower' });
    const damage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    shoot(sim);
    expect(z.hp).toBe(z.maxHp);
    expect(damage).toHaveBeenCalledTimes(1);
  });

  it('an elevated shot is intercepted once it descends below follower height', () => {
    const { sim, g } = fixture();
    g.elevation = 4;
    const nearShooter = zombie(sim, 0, 2, { state: 'follower' });
    const nearAlpha = zombie(sim, 0, 7.5, { state: 'follower', radius: 0.1 }); // in front of the Alpha, not overlapping him
    const damage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    shoot(sim);
    expect(nearShooter.hp).toBe(nearShooter.maxHp);
    expect(nearAlpha.hp).toBe(nearAlpha.maxHp - BALANCE.guard.damage);
    expect(damage).not.toHaveBeenCalled();
  });
});

describe('nearest visible threat preference', () => {
  it.each(['rifle', 'police', 'mg', 'coax', 'pistol'] as const)(
    '%s switches from the Alpha to the nearest visible follower', kind => {
      const { sim, g } = fixture(kind);
      const farther = zombie(sim, 3, 5, { state: 'follower' });
      const closest = zombie(sim, -2, 4, { state: 'follower' });
      zombie(sim, 0, 1, { state: 'follower', dormant: true });
      g.perceptionTimer = -1;
      shoot(sim);
      expect(g.target).toEqual({ kind: 'zombie', id: closest.id });
      // Re-evaluate a still-visible follower when the Alpha becomes the closest threat.
      sim.state.leader.pos.z = 2.5; g.perceptionTimer = -1; // clearly nearer than the follower (switch margin)
      shoot(sim);
      expect(g.target).toEqual({ kind: 'leader' });
      expect(farther.hp).toBe(farther.maxHp);
    });

  it('skips a nearer follower hidden by LOS', () => {
    const { sim, g } = fixture();
    const hidden = zombie(sim, 2, 3, { state: 'follower' });
    const original = sim.ctx.collision.segmentBlocked.bind(sim.ctx.collision);
    vi.spyOn(sim.ctx.collision, 'segmentBlocked').mockImplementation((from, to, opts) =>
      to === hidden.pos || original(from, to, opts));
    g.perceptionTimer = -1;
    shoot(sim);
    expect(g.target).toEqual({ kind: 'leader' });
  });
});

describe('non-bullet source routing', () => {
  it('tank splash damages three followers once each, then the Alpha once as an explosion', () => {
    const { sim } = fixture('cannon');
    sim.ctx.rng = { next: () => 0.99 }; // cannon lands at the cached Alpha position, outside coax range
    const followers = [zombie(sim, 0, 25, { state: 'follower' }),
      zombie(sim, 0, 26, { state: 'follower' }), zombie(sim, 0, 27, { state: 'follower' })];
    const outside = zombie(sim, 0, 30, { state: 'follower' });
    // Isolate each body's own splash from HH-T003's separate Alpha shared-damage distribution.
    const leaderDamage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    const followerDamage = vi.spyOn(combat, 'damageZombie');
    const events = shoot(sim);
    const damages = events.filter(e => e.type === 'damage');
    expect(damages).toHaveLength(3);
    for (let i = 0; i < followers.length; i++) {
      const z = followers[i], expected = BALANCE.heavy.tank.splashDamage * (1 - 0.65 * i / BALANCE.heavy.tank.splashRadius);
      expect(damages.filter(e => e.target.kind === 'zombie' && e.target.id === z.id)).toHaveLength(1);
      expect(z.hp).toBeCloseTo(Math.max(0, z.maxHp - expected));
    }
    expect(outside.hp).toBe(outside.maxHp);
    expect(leaderDamage).toHaveBeenCalledTimes(1);
    expect(leaderDamage).toHaveBeenCalledWith(sim.ctx, BALANCE.heavy.tank.splashLeaderDamage, 'explosion');
    expect(followerDamage).toHaveBeenCalledTimes(3);
    for (const order of followerDamage.mock.invocationCallOrder) {
      expect(order).toBeLessThan(leaderDamage.mock.invocationCallOrder[0]);
    }
    expect(events.filter(e => e.type === 'shellBlast')).toHaveLength(1);
  });

  it('bat attacks pass the melee source and are not intercepted', () => {
    const { sim, g } = fixture('bat');
    zombie(sim, 0, 0.5, { state: 'follower' });
    const damage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    // The warm-up may have moved the bat carrier; keep the final attack in reach.
    g.pos = { x: 0, z: 0 };
    shoot(sim);
    expect(damage).toHaveBeenCalledWith(sim.ctx, BALANCE.armedCivilian.batLeaderDamage, 'melee');
  });

  it('rammers tag Alpha impacts as vehicle damage', () => {
    const sim = flatSimulation();
    sim.state.leader.pos = { x: 0, z: 1.5 };
    const v: VehicleAgent = { id: sim.ctx.newId(), kind: 'rammer', mode: 'ram',
      pos: { x: 0, z: 0 }, prevPos: { x: 0, z: 0 }, facing: 0, prevFacing: 0,
      speed: 8, lane: -1, modeTime: 0, passes: 0, variant: 0, hitFlash: 0, stuckTime: 0,
      hp: BALANCE.traffic.carHp, bogTime: 0 };
    sim.state.vehicles.push(v);
    const damage = vi.spyOn(combat, 'damageLeader').mockImplementation(() => {});
    updateTraffic(sim.ctx, dt);
    expect(damage).toHaveBeenCalledTimes(1);
    expect(damage).toHaveBeenCalledWith(sim.ctx, expect.any(Number), 'vehicle');
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'vehicleHit', target: 'leader' }));
  });
});

describe('HH-F1: interception endpoint and target hysteresis', () => {
  it('a follower touching the Alpha from behind or beside never intercepts', () => {
    const { sim, g } = fixture();
    const L = sim.state.leader.pos;
    zombie(sim, 0, L.z + 0.3, { state: 'follower' });
    zombie(sim, 0.5, L.z, { state: 'follower' });
    expect(findShotInterceptor(sim.ctx, g.pos, 1.5, L, 1.2)).toBeNull();
    const front = zombie(sim, 0, L.z - 0.9, { state: 'follower' });
    expect(findShotInterceptor(sim.ctx, g.pos, 1.5, L, 1.2)).toBe(front);
  });

  it('keeps a visible target until another threat is clearly nearer (no aim-timer thrash)', () => {
    const { sim, g } = fixture('mg');
    sim.state.leader.pos = { x: 40, z: 40 };
    const a = zombie(sim, -2, 8, { state: 'follower' });
    const perceive = () => { g.perceptionTimer = -1; hash(sim); updateHumanAI(sim.ctx, dt, input); };
    perceive();
    expect(g.target).toEqual({ kind: 'zombie', id: a.id });
    const b = zombie(sim, 2, 7.6, { state: 'follower' }); // a little nearer: below the switch margin
    perceive();
    expect(g.target).toEqual({ kind: 'zombie', id: a.id });
    b.pos.z = 5; // now clearly nearer
    perceive();
    expect(g.target).toEqual({ kind: 'zombie', id: b.id });
  });
});
