// HH-T007: end-to-end Horde Strength invariants (docs/13_hode_health.md §12/§13) through Simulation.step.
// Agents are placed by hand; hostile guards / ambient zombies / traffic are cleared each step so only the scenario acts.
// Events emitted by direct calls before a step (damageLeader etc.) are drained by that step's returned list.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { HIDEOUTS } from '../src/content/rewards';
import { emptyInput, type GameEvent, type SimInput, type Vec2, type ZombieAgent } from '../src/core/types';
import { createZombie, evolveToBrute } from '../src/entities/Zombie';
import { applySave, createSave, parseSave } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { damageLeader, damageZombie } from '../src/systems/CombatSystem';
import { applyAlphaDamage, computeHordeStrength } from '../src/systems/HordeHealthSystem';
import { followerCap, recruitZombie } from '../src/systems/HordeSystem';
import { grantReward } from '../src/systems/RewardSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const b = BALANCE.hordeHealth;
const dt = BALANCE.sim.fixedDt;
const world = buildDistrictLayout();
const ALONE_UNIT = 10 * b.alphaDamageMultiplier / b.unitHp; // strength lost by a lone-Alpha rifle hit (10 dmg)

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;
const of = <T extends GameEvent['type']>(events: GameEvent[], type: T): Ev<T>[] =>
  events.filter((e): e is Ev<T> => e.type === type);

/** One step with the scenario isolated: no guards, vehicles or non-follower zombies. */
function step(sim: Simulation, input: Partial<SimInput> = {}): GameEvent[] {
  const s = sim.state;
  s.guards.length = 0; s.vehicles.length = 0;
  for (let i = s.zombies.length - 1; i >= 0; i--) if (s.zombies[i].state === 'ambient') s.zombies.splice(i, 1);
  sim.step(dt, { ...emptyInput(), ...input });
  return sim.drainEvents();
}
function run(sim: Simulation, seconds: number, input: Partial<SimInput> = {}): GameEvent[] {
  const out: GameEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) out.push(...step(sim, input));
  return out;
}

function addFollower(sim: Simulation, distance: number, brute = false): ZombieAgent {
  const l = sim.state.leader;
  const angle = sim.state.zombies.length * 1.3;
  const pos: Vec2 = { x: l.pos.x + Math.sin(angle) * distance, z: l.pos.z + Math.cos(angle) * distance };
  const z = createZombie(sim.ctx.newId(), pos, { state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  if (brute) evolveToBrute(z);
  sim.state.zombies.push(z); sim.state.followerCount++;
  return z;
}

function fresh(followerCount = 0, seed = 7): Simulation {
  const sim = new Simulation(world, seed);
  sim.state.zombies.length = 0; sim.state.followerCount = 0;
  for (let i = 0; i < followerCount; i++) addFollower(sim, 1 + i * 0.5);
  step(sim); // settle: recompute strength, drop start-up events
  return sim;
}

const followers = (sim: Simulation) => sim.state.zombies.filter(z => z.state === 'follower' && z.hp > 0);
function invariants(sim: Simulation): void {
  expect(followers(sim).length).toBe(sim.state.followerCount);
  const h = sim.state.horde;
  expect(Number.isFinite(h.strength) && Number.isFinite(h.coreDamage)).toBe(true);
  expect(h.strength).toBeGreaterThanOrEqual(0);
  expect(h.strength).toBeLessThanOrEqual(h.maxStrength + 1e-9);
  expect(h.coreDamage).toBeGreaterThanOrEqual(0);
  expect(h.coreDamage).toBeLessThanOrEqual(b.alphaCore + 1e-9);
}
/** Strength as the single derived formula says it must be. */
const expected = (sim: Simulation) => Math.min(sim.state.horde.maxStrength,
  sim.state.horde.followerStrength + b.alphaCore - sim.state.horde.coreDamage);

describe('hordeStrength: damage', () => {
  it('rifle hit on a lone Alpha costs incoming x multiplier / unitHp core units, nothing else', () => {
    const sim = fresh();
    const before = sim.state.horde.strength;
    expect(before).toBe(b.alphaCore);
    damageLeader(sim.ctx, 10, 'bullet');
    const ev = step(sim);
    expect(sim.state.horde.coreDamage).toBeCloseTo(ALONE_UNIT, 9);
    expect(sim.state.horde.strength).toBeCloseTo(before - ALONE_UNIT, 9);
    const changed = of(ev, 'hordeStrengthChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0].cause).toBe('alphaHit');
    expect(changed[0].delta).toBeCloseTo(-ALONE_UNIT, 9);
    invariants(sim);
  });

  it('with followers nearby the nearest follower absorbs incoming x 2.5 and strength is unchanged', () => {
    const sim = fresh(3);
    const l = sim.state.leader;
    const [a, c, d] = followers(sim).sort((p, q) => Math.hypot(p.pos.x - l.pos.x, p.pos.z - l.pos.z) -
      Math.hypot(q.pos.x - l.pos.x, q.pos.z - l.pos.z));
    const hp = [a.hp, c.hp, d.hp], before = sim.state.horde.strength;
    damageLeader(sim.ctx, 10, 'bullet');
    expect(a.hp).toBeCloseTo(hp[0] - 10 * b.alphaDamageMultiplier, 9);
    expect(c.hp).toBe(hp[1]); expect(d.hp).toBe(hp[2]);
    expect(sim.state.horde.coreDamage).toBe(0);
    const ev = step(sim);
    expect(sim.state.horde.strength).toBe(before);
    expect(of(ev, 'hordeStrengthChanged')).toHaveLength(0);
    const shared = of(ev, 'sharedDamage');
    expect(shared).toHaveLength(1);
    expect(shared[0].recipients).toEqual([a.id]);
    expect(shared[0].core).toBe(0);
    invariants(sim);
  });

  it('a non-fatal follower hit leaves strength unchanged', () => {
    const sim = fresh(2);
    const [z] = followers(sim), before = sim.state.horde.strength;
    damageZombie(sim.ctx, z, z.hp - 1);
    const ev = step(sim);
    expect(z.hp).toBeGreaterThan(0);
    expect(sim.state.horde.strength).toBe(before);
    expect(of(ev, 'hordeStrengthChanged')).toHaveLength(0);
    invariants(sim);
  });

  it('a follower death is -1 exactly once', () => {
    const sim = fresh(3);
    const before = sim.state.horde.strength;
    const [z] = followers(sim);
    damageZombie(sim.ctx, z, z.hp + 5);
    const ev = [...step(sim), ...run(sim, 1)];
    expect(sim.state.horde.strength).toBe(before - b.values.walker);
    const changed = of(ev, 'hordeStrengthChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ delta: -1, cause: 'death' });
    expect(sim.state.horde.strengthLost).toBeCloseTo(1, 9);
    invariants(sim);
  });

  it('five simultaneous follower deaths emit one hordeStrengthChanged with delta -5', () => {
    const sim = fresh(8);
    const before = sim.state.horde.strength;
    for (const z of followers(sim).slice(0, 5)) damageZombie(sim.ctx, z, z.hp + 1);
    const ev = step(sim);
    const changed = of(ev, 'hordeStrengthChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0].delta).toBe(-5);
    expect(sim.state.horde.strength).toBe(before - 5);
    invariants(sim);
  });

  it('an explosion on the Alpha is shared once', () => {
    const sim = fresh(3);
    damageLeader(sim.ctx, 20, 'explosion');
    const ev = step(sim);
    expect(of(ev, 'sharedDamage')).toHaveLength(1);
    expect(sim.state.horde.alphaDamageTaken).toBe(20);
    expect(sim.state.horde.sharedDamageDealt).toBeCloseTo(20 * b.alphaDamageMultiplier, 9);
    invariants(sim);
  });

  it('explosion on Alpha + followers: follower HP lost = own splash + Alpha share, no duplication', () => {
    const sim = fresh(4);
    const fs = followers(sim);
    const hp0 = fs.map(z => z.hp);
    const own = [20, 30, 0, 0];
    // As the tank does: each follower takes its own splash first, then the Alpha takes its splash exactly once.
    fs.forEach((z, i) => { if (own[i] > 0) damageZombie(sim.ctx, z, own[i]); });
    const shareHp = 30 * b.alphaDamageMultiplier;
    damageLeader(sim.ctx, 30, 'explosion');
    const lost = fs.reduce((sum, z, i) => sum + (hp0[i] - Math.max(0, z.hp)), 0);
    expect(sim.state.horde.sharedDamageDealt).toBeCloseTo(shareHp, 9);
    expect(sim.state.horde.coreDamage).toBe(0); // 4 x 40 hp absorbs 50 + 75
    expect(lost).toBeCloseTo(own[0] + own[1] + shareHp, 9);
    const ev = step(sim);
    expect(of(ev, 'sharedDamage')).toHaveLength(1);
    expect(sim.state.horde.strength).toBeCloseTo(expected(sim), 9);
    expect(sim.state.horde.followerStrength).toBe(followers(sim).length);
    invariants(sim);
  });
});

describe('hordeStrength: growth and capacity', () => {
  it('a recruit is +1', () => {
    const sim = fresh(2);
    const before = sim.state.horde.strength;
    const l = sim.state.leader;
    const z = createZombie(sim.ctx.newId(), { x: l.pos.x + 2, z: l.pos.z + 2 },
      { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
    sim.state.zombies.push(z);
    expect(recruitZombie(sim.ctx, z, false)).toBe(true);
    const ev = run(sim, 3); // 'rising' contributes nothing until it stands up as a follower
    expect(z.state).toBe('follower');
    expect(sim.state.horde.strength).toBe(before + 1);
    expect(of(ev, 'hordeStrengthChanged').map(e => e.cause)).toEqual(['recruit']);
    invariants(sim);
  });

  it('never exceeds maxStrength even when brutes push raw strength above it', () => {
    const sim = fresh();
    const cap = followerCap(sim.ctx);
    for (let i = 0; i < cap; i++) addFollower(sim, 1 + (i % 5), true);
    const ev = step(sim);
    expect(computeHordeStrength(sim.ctx).followerStrength).toBeGreaterThan(cap);
    expect(sim.state.horde.strength).toBe(sim.state.horde.maxStrength);
    expect(sim.state.horde.maxStrength).toBe(b.alphaCore + cap);
    expect(of(ev, 'hordeStrengthChanged').length).toBeLessThanOrEqual(1);
    invariants(sim);
  });

  it('claiming a nest raises maxStrength by followersPerNest', () => {
    const sim = fresh();
    const nest = world.nests.find(n => n.claim)!;
    sim.state.claimedNests = [];
    const l = sim.state.leader;
    l.pos.x = l.prevPos.x = nest.pos.x - 60; l.pos.z = l.prevPos.z = nest.pos.z;
    step(sim);
    const before = sim.state.horde.maxStrength;
    l.pos.x = l.prevPos.x = nest.pos.x; l.pos.z = l.prevPos.z = nest.pos.z;
    const ev = [...step(sim), ...step(sim)];
    expect(sim.state.claimedNests).toContain(nest.id);
    expect(sim.state.horde.maxStrength).toBe(before + BALANCE.openWorld.followersPerNest);
    expect(of(ev, 'hordeStrengthChanged').some(e => e.cause === 'capacity')).toBe(true);
    invariants(sim);
  });
});

describe('hordeStrength: Last Brain', () => {
  /** Drain the core (no followers): the same step enters Last Brain. */
  function depleted(): { sim: Simulation; ev: GameEvent[] } {
    const sim = fresh();
    damageLeader(sim.ctx, 1000, 'bullet');
    return { sim, ev: step(sim) };
  }

  it('depletion enters Last Brain exactly once; further depletion never restarts the timer', () => {
    const { sim, ev } = depleted();
    expect(of(ev, 'lastBrainStart')).toHaveLength(1);
    expect(sim.state.horde.lastBrain.active).toBe(true);
    expect(sim.state.leader.alive).toBe(true);
    const all: GameEvent[] = [];
    let last = sim.state.horde.lastBrain.timeLeft;
    for (let i = 0; i < 60; i++) {
      applyAlphaDamage(sim.ctx, 500, 'hazard'); // keeps it depleted, bypasses the shield
      all.push(...step(sim));
      expect(sim.state.horde.lastBrain.timeLeft).toBeLessThanOrEqual(last);
      last = sim.state.horde.lastBrain.timeLeft;
    }
    expect(of(all, 'lastBrainStart')).toHaveLength(0);
    expect(last).toBeLessThan(b.lastBrain.duration - 0.9);
    invariants(sim);
  });

  it('a recruit during the countdown recovers and grants a recovery grace that ignores hits', () => {
    const { sim } = depleted();
    run(sim, b.lastBrain.entryGrace + 0.2);
    const f = addFollower(sim, 1.5);
    const ev = step(sim);
    expect(of(ev, 'lastBrainEnd').map(e => e.outcome)).toEqual(['recovered']);
    expect(sim.state.horde.lastBrain.active).toBe(false);
    expect(sim.state.horde.graceLeft).toBeGreaterThan(b.lastBrain.recoveryGrace - 0.1);
    const hp = f.hp, core = sim.state.horde.coreDamage;
    damageLeader(sim.ctx, 50, 'bullet');
    const ev2 = step(sim);
    expect(of(ev2, 'sharedDamage')).toHaveLength(0);
    expect(f.hp).toBe(hp);
    expect(sim.state.horde.coreDamage).toBe(core);
    expect(sim.state.leader.alive).toBe(true);
    run(sim, b.lastBrain.recoveryGrace + 0.1); // after the grace a hit lands again
    damageLeader(sim.ctx, 5, 'bullet');
    expect(of(step(sim), 'sharedDamage')).toHaveLength(1);
    invariants(sim);
  });

  it('a hit after the entry grace during the countdown is the death blow', () => {
    const { sim } = depleted();
    damageLeader(sim.ctx, 50, 'bullet'); // inside the entry grace: ignored
    expect(sim.state.leader.alive).toBe(true);
    run(sim, b.lastBrain.entryGrace + 0.1);
    damageLeader(sim.ctx, 1, 'bullet');
    const ev = step(sim);
    expect(of(ev, 'lastBrainEnd').map(e => e.outcome)).toEqual(['finished']);
    expect(of(ev, 'leaderDied')).toHaveLength(1);
    expect(sim.state.leader.alive).toBe(false);
    expect(sim.state.phase).toBe('respawning');
  });

  it('countdown expiry is death; respawn restores a full core', () => {
    const { sim } = depleted();
    const ev = run(sim, b.lastBrain.duration + 0.3);
    expect(of(ev, 'lastBrainEnd').map(e => e.outcome)).toEqual(['expired']);
    expect(of(ev, 'leaderDied')).toHaveLength(1);
    expect(sim.state.phase).toBe('respawning');
    run(sim, BALANCE.respawn.delay + BALANCE.respawn.emergeTime * 3);
    expect(sim.state.phase).toBe('playing');
    expect(sim.state.leader.alive).toBe(true);
    expect(sim.state.horde.coreDamage).toBe(0);
    expect(sim.state.horde.lastBrain.active).toBe(false);
    expect(sim.state.horde.strength).toBeCloseTo(expected(sim), 9);
    expect(sim.state.horde.strength).toBeGreaterThanOrEqual(b.alphaCore);
    invariants(sim);
  });
});

describe('hordeStrength: persistence and travel', () => {
  it('hideout fast travel keeps strength and coreDamage', () => {
    const sim = fresh(12);
    sim.state.horde.coreDamage = 2.5;
    const hideout = HIDEOUTS[1];
    grantReward(sim.ctx, hideout.rewardId);
    step(sim);
    const before = { s: sim.state.horde.strength, c: sim.state.horde.coreDamage, n: followers(sim).length };
    expect(before.c).toBe(2.5);
    const ev = step(sim, { fastTravelHideout: hideout.id });
    expect(of(ev, 'fastTraveled')).toHaveLength(1);
    expect(Math.hypot(sim.state.leader.pos.x - hideout.pos.x, sim.state.leader.pos.z - hideout.pos.z)).toBeLessThan(3);
    expect(sim.state.horde.coreDamage).toBe(before.c);
    expect(followers(sim).length).toBe(before.n);
    expect(sim.state.horde.strength).toBeCloseTo(before.s, 9);
    expect(of(ev, 'hordeStrengthChanged')).toHaveLength(0);
    invariants(sim);
  });

  it('nest fast travel keeps strength and coreDamage', () => {
    const sim = fresh(12);
    const start = world.nests.find(n => n.claim)!;
    const strongholdId = world.strongholds[0].id;
    const dest = world.nests.find(n => n.strongholdId === strongholdId)!;
    sim.state.strongholds.find(s => s.id === strongholdId)!.captured = true;
    const l = sim.state.leader;
    l.pos.x = l.prevPos.x = start.pos.x + 3; l.pos.z = l.prevPos.z = start.pos.z;
    for (const z of followers(sim)) { z.pos.x = z.prevPos.x = start.pos.x + 4; z.pos.z = z.prevPos.z = start.pos.z + 2; }
    sim.state.horde.coreDamage = 2;
    run(sim, 0.2);
    const before = { s: sim.state.horde.strength, c: sim.state.horde.coreDamage, n: followers(sim).length };
    const all: GameEvent[] = step(sim, { nestTeleport: dest.id });
    expect(of(all, 'nestTravelStarted')).toHaveLength(1);
    for (let t = 0; sim.state.nestTravel && t < 8; t += dt) all.push(...step(sim));
    all.push(...run(sim, 1));
    expect(of(all, 'nestTravelArrived')).toHaveLength(1);
    expect(sim.state.horde.coreDamage).toBe(before.c);
    expect(followers(sim).length).toBe(before.n);
    expect(sim.state.horde.strength).toBeCloseTo(before.s, 9);
    expect(of(all, 'hordeStrengthChanged')).toHaveLength(0);
    invariants(sim);
  });

  it('save -> load keeps coreDamage and recomputes the strength from the core', () => {
    const sim = fresh(6);
    sim.state.horde.coreDamage = 3.25;
    step(sim);
    const save = parseSave(JSON.parse(JSON.stringify(createSave(sim.state, 7, 1000))))!;
    expect(save).not.toBeNull();
    const restored = new Simulation(world, 7, save);
    expect(restored.state.horde.coreDamage).toBeCloseTo(3.25, 9);
    restored.state.zombies.length = 0; restored.state.followerCount = 0; // followers are transient
    step(restored);
    expect(restored.state.horde.coreDamage).toBeCloseTo(3.25, 9);
    expect(restored.state.horde.strength).toBeCloseTo(b.alphaCore - 3.25, 9);
    sim.state.horde.coreDamage = 0;
    applySave(sim.ctx, save);
    expect(sim.state.horde.coreDamage).toBeCloseTo(3.25, 9);
    invariants(restored);
  });
});

describe('hordeStrength: quiet world, rapid hits, drinks', () => {
  it('with every enemy gone strength never changes over 10 s', () => {
    const sim = fresh(10);
    sim.state.horde.coreDamage = 1.5;
    step(sim);
    const before = sim.state.horde.strength;
    const ev = run(sim, 10);
    expect(sim.state.horde.strength).toBe(before);
    expect(of(ev, 'hordeStrengthChanged')).toHaveLength(0);
    expect(of(ev, 'sharedDamage')).toHaveLength(0);
    invariants(sim);
  });

  function barrage(seed: number, hits: number): { sim: Simulation; ev: GameEvent[] } {
    const sim = fresh(3, seed);
    for (let i = 0; i < hits; i++) damageLeader(sim.ctx, 10, 'bullet');
    return { sim, ev: step(sim) };
  }

  it('N hits in one step are N distributions and one strength event', () => {
    const { sim, ev } = barrage(11, 8);
    expect(of(ev, 'sharedDamage')).toHaveLength(8);
    expect(of(ev, 'hordeStrengthChanged').length).toBeLessThanOrEqual(1);
    expect(sim.state.horde.sharedDamageDealt).toBeCloseTo(8 * 10 * b.alphaDamageMultiplier, 9);
    expect(sim.state.horde.strength).toBeCloseTo(expected(sim), 9);
    invariants(sim);
  });

  it('is deterministic per seed and stays finite and in range under heavy barrages', () => {
    for (const seed of [1, 2, 3, 99]) {
      const a = barrage(seed, 100), c = barrage(seed, 100);
      const snap = (s: Simulation) => JSON.stringify([s.state.horde, s.state.zombies.map(z => [z.id, z.state, z.hp])]);
      expect(snap(a.sim)).toBe(snap(c.sim));
      invariants(a.sim);
      expect(Number.isNaN(a.sim.state.horde.sharedDamageDealt)).toBe(false);
    }
  });

  it('a drink restores the core and is refused at full core', () => {
    const sim = fresh();
    const l = sim.state.leader;
    const drink = (): void => { sim.state.pickups.push({ id: sim.ctx.newId(), kind: 'drink', shopId: 9999, pos: { x: l.pos.x, z: l.pos.z } }); };
    drink();
    step(sim);
    expect(sim.state.pickups).toHaveLength(1); // full core: refused, not consumed
    sim.state.horde.coreDamage = 4;
    const ev = step(sim);
    const heal = BALANCE.shops.drinkHeal * b.alphaDamageMultiplier / b.unitHp;
    expect(sim.state.pickups).toHaveLength(0);
    expect(sim.state.horde.coreDamage).toBeCloseTo(4 - heal, 9);
    expect(of(ev, 'pickup')[0].heal).toBeCloseTo(heal, 9);
    // Heals are picked up by the next step's updateHordeHealth (derived strength): one 'heal' event, never a duplicate.
    const next = step(sim);
    expect(of([...ev, ...next], 'hordeStrengthChanged').filter(e => e.cause === 'heal')).toHaveLength(1);
    sim.state.horde.coreDamage = 0.5; drink(); step(sim); // never above full
    expect(sim.state.horde.coreDamage).toBe(0);
    invariants(sim);
  });
});

describe('hordeStrength: HH-F1', () => {
  it('a save taken with an empty core never loads straight into Last Brain Standing', () => {
    const sim = fresh(0);
    sim.state.horde.coreDamage = b.alphaCore;
    const save = parseSave(JSON.parse(JSON.stringify(createSave(sim.state, 7, 1000))))!;
    expect(save.player.alphaCoreDamage).toBe(b.alphaCore);
    const restored = new Simulation(world, 7, save);
    restored.state.zombies.length = 0; restored.state.followerCount = 0; // followers are transient
    const events = step(restored);
    expect(restored.state.horde.coreDamage).toBe(b.alphaCore - 1);
    expect(restored.state.horde.strength).toBeGreaterThan(0);
    expect(of(events, 'lastBrainStart')).toHaveLength(0);
  });
});
