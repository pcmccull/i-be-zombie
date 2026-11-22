import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GameEvent, Vec2, ZombieAgent } from '../src/core/types';
import { createZombie, evolveToBrute } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageZombie, killLeader } from '../src/systems/CombatSystem';
import { updateConquest } from '../src/systems/ConquestSystem';
import { followerCap, recruitZombie } from '../src/systems/HordeSystem';
import {
  applyAlphaDamage, computeHordeStrength, finishLastBrain, isDepleted, isHordeShielded, isLastBrain,
  lastBrainSpeedMultiplier, maxHordeStrength, resetHordeHealth, restoreStrength, strengthValueOf, updateHordeHealth,
} from '../src/systems/HordeHealthSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

const b = BALANCE.hordeHealth;
const world = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;

function fixture(openWorld = false, seed = 1234): Simulation {
  const sim = new Simulation(openWorld ? world : undefined, seed);
  sim.state.zombies.length = 0; sim.state.followerCount = 0;
  updateHordeHealth(sim.ctx, 0); sim.drainEvents();
  return sim;
}

function zombie(sim: Simulation, distance = 1, state: 'follower' | 'ambient' | 'rising' = 'follower'): ZombieAgent {
  const pos: Vec2 = { x: sim.state.leader.pos.x + distance, z: sim.state.leader.pos.z };
  const z = createZombie(sim.ctx.newId(), pos, { state, variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z);
  if (state === 'follower') sim.state.followerCount++;
  return z;
}

function tick(sim: Simulation, elapsed = 0): GameEvent[] {
  updateHordeHealth(sim.ctx, elapsed);
  return sim.drainEvents();
}

function eventsOf<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
}

function deplete(sim: Simulation): GameEvent[] {
  applyAlphaDamage(sim.ctx, 10000, 'hazard');
  return tick(sim);
}

describe('authoritative horde strength', () => {
  it('values live walkers, companions and brutes, giving companion membership precedence', () => {
    const sim = fixture();
    const walker = zombie(sim), brute = zombie(sim), companion = zombie(sim);
    evolveToBrute(brute); evolveToBrute(companion);
    sim.state.companions.push({ id: 'larry_lifeguard', zombieId: companion.id, recoverAt: 0, abilityCooldown: 0 });
    const ambient = zombie(sim, 1, 'ambient'), rising = zombie(sim, 1, 'rising');
    ambient.heldBy = 1;
    expect(strengthValueOf(sim.state, walker)).toBe(b.values.walker);
    expect(strengthValueOf(sim.state, brute)).toBe(b.values.brute);
    expect(strengthValueOf(sim.state, companion)).toBe(b.values.companion);
    expect(strengthValueOf(sim.state, ambient)).toBe(0);
    expect(strengthValueOf(sim.state, rising)).toBe(0);
    tick(sim);
    expect(sim.state.horde.followerStrength).toBe(b.values.walker + b.values.brute + b.values.companion);
    damageZombie(sim.ctx, brute, brute.hp);
    tick(sim);
    expect(strengthValueOf(sim.state, brute)).toBe(0);
    expect(sim.state.horde.activeFollowers).toBe(sim.state.followerCount);
  });

  it('returns reused calculation scratch without mutating cached strength, isolated per state', () => {
    const sim = fixture(), other = fixture();
    const cached = sim.state.horde.strength;
    const result = computeHordeStrength(sim.ctx);
    zombie(sim);
    expect(computeHordeStrength(sim.ctx)).toBe(result);
    expect(result.followerStrength).toBe(1);
    expect(result.strength).toBe(b.alphaCore + 1);
    expect(sim.state.horde.strength).toBe(cached);
    expect(computeHordeStrength(other.ctx)).not.toBe(result);
    expect(computeHordeStrength(other.ctx).followerStrength).toBe(0);
  });

  it('a lone Alpha rifle hit depletes exactly incoming × multiplier / unitHp core units', () => {
    const sim = fixture();
    const loss = 10 * b.alphaDamageMultiplier / b.unitHp;
    applyAlphaDamage(sim.ctx, 10, 'bullet');
    const events = tick(sim);
    expect(sim.state.horde.coreDamage).toBeCloseTo(loss);
    expect(sim.state.horde.strength).toBeCloseTo(b.alphaCore - loss);
    expect(sim.state.horde.alphaDamageTaken).toBe(10);
    expect(sim.state.horde.sharedDamageDealt).toBe(25);
    expect(sim.state.horde.strengthLost).toBeCloseTo(loss);
    expect(eventsOf(events, 'hordeStrengthChanged')).toMatchObject([{ delta: -loss, cause: 'alphaHit' }]);
    expect(eventsOf(events, 'sharedDamage')).toMatchObject([{ incoming: 10, shared: 25, core: loss, recipients: [] }]);
  });

  it('nonfatal follower hits leave strength unchanged; a death removes its value only once', () => {
    const sim = fixture(), z = zombie(sim);
    evolveToBrute(z); tick(sim);
    const strength = sim.state.horde.strength, losses = sim.state.horde.strengthLost;
    damageZombie(sim.ctx, z, 1);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
    expect(sim.state.horde.strength).toBe(strength);
    damageZombie(sim.ctx, z, z.hp);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: -b.values.brute, cause: 'death' }]);
    damageZombie(sim.ctx, z, 999);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
    expect(sim.state.horde.strengthLost - losses).toBe(b.values.brute);
    expect(sim.state.followerCount).toBe(0);
  });

  it('aggregates five simultaneous deaths into one delta of -5', () => {
    const sim = fixture();
    const pack = Array.from({ length: 5 }, (_, i) => zombie(sim, i + 1)); tick(sim);
    const losses = sim.state.horde.strengthLost;
    for (const z of pack) damageZombie(sim.ctx, z, z.hp);
    const events = tick(sim);
    expect(eventsOf(events, 'zombieDied')).toHaveLength(5);
    expect(eventsOf(events, 'hordeStrengthChanged')).toMatchObject([{ delta: -5, cause: 'death' }]);
    expect(sim.state.horde.strengthLost - losses).toBe(5);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
  });

  it('recruitment adds one unit and brute evolution adds two without changing follower count', () => {
    const sim = fixture(), z = zombie(sim, 1, 'ambient');
    expect(recruitZombie(sim.ctx, z, false)).toBe(true);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: 1, cause: 'recruit' }]);
    evolveToBrute(z);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: 2, cause: 'evolve' }]);
    expect(sim.state.horde.activeFollowers).toBe(1);
  });

  it('clamps weighted strength to capacity and a real nest claim raises max via followerCap', () => {
    const sim = fixture(true);
    expect(followerCap(sim.ctx)).toBe(0);
    expect(maxHordeStrength(sim.ctx)).toBe(b.alphaCore);
    const nest = world.nests.find(n => n.claim)!;
    sim.state.leader.pos = { ...nest.pos };
    updateConquest(sim.ctx, 0);
    expect(sim.state.claimedNests).toContain(nest.id);
    tick(sim);
    expect(sim.state.horde.maxStrength).toBe(b.alphaCore + BALANCE.openWorld.followersPerNest * b.capUnitsPerFollower);
    expect(sim.state.horde.maxStrength).toBe(maxHordeStrength(sim.ctx));
    for (const z of sim.state.zombies) if (z.state === 'follower') evolveToBrute(z);
    tick(sim);
    expect(sim.state.horde.followerStrength).toBeGreaterThan(followerCap(sim.ctx));
    expect(sim.state.horde.strength).toBe(sim.state.horde.maxStrength);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
  });

  it('emits a capacity event when only maximum strength changes', () => {
    const sim = fixture(true), strength = sim.state.horde.strength;
    // A captured stronghold activates a nest without granting free followers.
    sim.state.strongholds[0].captured = true;
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: 0, strength, cause: 'capacity' }]);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
  });
});

describe('Alpha shared damage routing', () => {
  it('pours nearest-first, carrying lethal HP to the next recipient without double-counting deaths', () => {
    const sim = fixture();
    const far = zombie(sim, 4), nearest = zombie(sim, 1), middle = zombie(sim, 2);
    nearest.hp = 10; tick(sim);
    const strength = sim.state.horde.strength;
    applyAlphaDamage(sim.ctx, 24, 'melee'); // 60 HP: 10 + 40 + 10.
    const events = tick(sim), shared = eventsOf(events, 'sharedDamage');
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ recipients: [nearest.id, middle.id, far.id], incoming: 24, shared: 60, core: 0 });
    expect(far.hp).toBe(30);
    expect(nearest.state).toBe('dead'); expect(middle.state).toBe('dead');
    expect(sim.state.horde.coreDamage).toBe(0);
    expect(sim.state.horde.strength).toBe(strength - 2);
    expect(eventsOf(events, 'hordeStrengthChanged')).toMatchObject([{ delta: -2, cause: 'alphaHit' }]);
    expect(sim.state.horde.sharedDamageDealt).toBe(60);
    sim.state.leader.pos.x++;
    expect(shared[0].pos.x).not.toBe(sim.state.leader.pos.x);
  });

  it('limits the nearby pass before routing residual HP into the core', () => {
    const sim = fixture();
    const pack = Array.from({ length: b.maxRecipients + 1 }, (_, i) => zombie(sim, 1 + i * 0.2)); tick(sim);
    const hp = pack[0].hp, coreHp = 20;
    applyAlphaDamage(sim.ctx, (hp * b.maxRecipients + coreHp) / b.alphaDamageMultiplier, 'explosion');
    const events = tick(sim);
    expect(eventsOf(events, 'sharedDamage')[0]).toMatchObject({ recipients: pack.slice(0, b.maxRecipients).map(z => z.id), core: coreHp / b.unitHp });
    expect(pack[b.maxRecipients].hp).toBe(hp);
    expect(sim.state.horde.coreDamage).toBe(coreHp / b.unitHp);
    expect(sim.state.followerCount).toBe(1);
  });

  it('uses the core before distant followers, then overflows globally without a recipient cap', () => {
    const sim = fixture();
    const count = b.maxRecipients + 3;
    const pack = Array.from({ length: count }, (_, i) => zombie(sim, b.shareRadius + 1 + i)); tick(sim);
    applyAlphaDamage(sim.ctx, b.alphaCore * b.unitHp / b.alphaDamageMultiplier, 'vehicle');
    expect(eventsOf(tick(sim), 'sharedDamage')[0]).toMatchObject({ core: b.alphaCore, recipients: [] });
    expect(pack.every(z => z.hp === z.maxHp)).toBe(true);
    applyAlphaDamage(sim.ctx, 10000, 'explosion');
    const events = tick(sim), shared = eventsOf(events, 'sharedDamage')[0];
    expect(shared.recipients).toEqual(pack.map(z => z.id));
    expect(shared.shared).toBe(pack.reduce((sum, z) => sum + z.maxHp, 0));
    expect(sim.state.horde.coreDamage).toBe(b.alphaCore);
    expect(sim.state.horde.strength).toBe(0);
    expect(sim.state.horde.sharedDamageDealt).toBe(b.alphaCore * b.unitHp + shared.shared);
  });

  it('overflows back to surviving near followers after the nearby cap and core are exhausted', () => {
    const sim = fixture();
    const pack = Array.from({ length: b.maxRecipients + 2 }, (_, i) => zombie(sim, 0.5 + i * 0.2)); tick(sim);
    applyAlphaDamage(sim.ctx, 10000, 'hazard');
    const shared = eventsOf(tick(sim), 'sharedDamage')[0];
    expect(shared.recipients).toEqual(pack.map(z => z.id));
    expect(shared.core).toBe(b.alphaCore);
    expect(sim.state.followerCount).toBe(0);
  });

  it('excludes ambient, held, rising, dormant and dead recipients and includes the radius boundary', () => {
    const sim = fixture();
    const ambient = zombie(sim, 0, 'ambient'), held = zombie(sim, 0, 'ambient'); held.heldBy = 2;
    const rising = zombie(sim, 0, 'rising'), dormant = zombie(sim, 0); dormant.dormant = true;
    const dead = zombie(sim, 0); damageZombie(sim.ctx, dead, dead.hp);
    const edge = zombie(sim, b.shareRadius); tick(sim);
    applyAlphaDamage(sim.ctx, 10, 'bullet');
    const shared = eventsOf(tick(sim), 'sharedDamage')[0];
    expect(shared.recipients).toEqual([edge.id]);
    expect(shared.core).toBe(0);
    for (const z of [ambient, held, rising, dormant]) expect(z.hp).toBe(z.maxHp);
  });

  it('breaks distance ties by entity ID independently of array order', () => {
    const sim = fixture();
    const first = zombie(sim, 1), second = zombie(sim, -1);
    sim.state.zombies.reverse(); tick(sim);
    applyAlphaDamage(sim.ctx, 10, 'bullet');
    expect(eventsOf(tick(sim), 'sharedDamage')[0].recipients).toEqual([first.id]);
    expect(second.hp).toBe(second.maxHp);
  });

  it('heals the core only, returns the applied units, and cannot heal followers or overfill', () => {
    const sim = fixture();
    applyAlphaDamage(sim.ctx, 32, 'bullet'); tick(sim); // 2 core units.
    const z = zombie(sim); damageZombie(sim.ctx, z, 10); tick(sim);
    expect(restoreStrength(sim.ctx, 0.75, 'heal')).toBe(0.75);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: 0.75, cause: 'heal' }]);
    expect(restoreStrength(sim.ctx, 100, 'heal')).toBe(1.25);
    tick(sim);
    expect(restoreStrength(sim.ctx, 100, 'heal')).toBe(0);
    expect(z.hp).toBe(z.maxHp - 10);
    expect(sim.state.horde.coreDamage).toBe(0);
  });

  it('chooses the largest recorded cause magnitude and clears the tally after every update', () => {
    const sim = fixture();
    applyAlphaDamage(sim.ctx, 32, 'bullet'); // -2.
    restoreStrength(sim.ctx, 0.5, 'heal');
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: -1.5, cause: 'alphaHit' }]);
    restoreStrength(sim.ctx, 1, 'heal');
    applyAlphaDamage(sim.ctx, 4, 'bullet'); // -0.25.
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: 0.75, cause: 'heal' }]);
    zombie(sim);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: 1, cause: 'recruit' }]);
    applyAlphaDamage(sim.ctx, 1, 'bullet'); // Nonfatal follower chip has no strength delta.
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
    zombie(sim);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ cause: 'recruit' }]);
  });
});

describe('Last Brain Standing and critical edges', () => {
  it('enters once with a full timer/grace and further depletion never restarts the countdown', () => {
    const sim = fixture();
    const events = deplete(sim);
    expect(eventsOf(events, 'lastBrainStart')).toMatchObject([{ duration: b.lastBrain.duration }]);
    expect(isDepleted(sim.state)).toBe(true); expect(isLastBrain(sim.state)).toBe(true);
    expect(isHordeShielded(sim.state)).toBe(true);
    expect(lastBrainSpeedMultiplier(sim.state)).toBe(b.lastBrain.speedMultiplier);
    expect(sim.state.horde.lastBrain.timeLeft).toBe(b.lastBrain.duration);
    applyAlphaDamage(sim.ctx, 100, 'hazard');
    expect(eventsOf(tick(sim, 1), 'lastBrainStart')).toEqual([]);
    expect(sim.state.horde.lastBrain.timeLeft).toBe(b.lastBrain.duration - 1);
    expect(sim.state.horde.graceLeft).toBe(0);
  });

  it('recovers by recruitment with full recovery grace, even on the final countdown tick', () => {
    const sim = fixture(); deplete(sim);
    const z = zombie(sim, 1, 'ambient');
    expect(recruitZombie(sim.ctx, z, false)).toBe(true);
    const events = tick(sim, b.lastBrain.duration);
    expect(eventsOf(events, 'lastBrainEnd')).toMatchObject([{ outcome: 'recovered' }]);
    expect(eventsOf(events, 'leaderDied')).toEqual([]);
    expect(isLastBrain(sim.state)).toBe(false);
    expect(lastBrainSpeedMultiplier(sim.state)).toBe(1);
    expect(sim.state.horde.graceLeft).toBe(b.lastBrain.recoveryGrace);
    tick(sim, b.lastBrain.recoveryGrace / 2);
    expect(isHordeShielded(sim.state)).toBe(true);
    tick(sim, b.lastBrain.recoveryGrace);
    expect(isHordeShielded(sim.state)).toBe(false);
  });

  it('also recovers when healing restores a positive core', () => {
    const sim = fixture(); deplete(sim);
    expect(restoreStrength(sim.ctx, 0.5, 'heal')).toBe(0.5);
    expect(eventsOf(tick(sim), 'lastBrainEnd')).toMatchObject([{ outcome: 'recovered' }]);
    expect(sim.state.horde.strength).toBe(0.5);
  });

  it('expires through the existing killLeader path exactly once', () => {
    const sim = fixture(); deplete(sim);
    const events = tick(sim, b.lastBrain.duration);
    expect(eventsOf(events, 'lastBrainEnd')).toMatchObject([{ outcome: 'expired' }]);
    expect(eventsOf(events, 'leaderDied')).toHaveLength(1);
    expect(sim.state.leader.alive).toBe(false);
    expect(sim.state.leader.anim).toBe('dead');
    expect(isLastBrain(sim.state)).toBe(false);
    expect(eventsOf(tick(sim, 1), 'leaderDied')).toEqual([]);
  });

  it('finishing an active countdown emits finished and leaderDied once; otherwise it is a no-op', () => {
    const sim = fixture();
    finishLastBrain(sim.ctx); expect(sim.drainEvents()).toEqual([]);
    deplete(sim); tick(sim, b.lastBrain.entryGrace);
    finishLastBrain(sim.ctx); finishLastBrain(sim.ctx);
    const events = sim.drainEvents();
    expect(eventsOf(events, 'lastBrainEnd')).toMatchObject([{ outcome: 'finished' }]);
    expect(eventsOf(events, 'leaderDied')).toHaveLength(1);
    expect(sim.state.leader.alive).toBe(false);
    expect(sim.state.horde.lastBrain).toEqual({ active: false, timeLeft: 0 });
  });

  it.each(['dead', 'respawning'] as const)('silently clears a countdown while %s', mode => {
    const sim = fixture(); deplete(sim);
    if (mode === 'dead') killLeader(sim.ctx);
    else sim.state.phase = 'respawning';
    sim.drainEvents();
    expect(eventsOf(tick(sim, 1), 'lastBrainEnd')).toEqual([]);
    expect(isLastBrain(sim.state)).toBe(false);
    expect(sim.state.horde.lastBrain.timeLeft).toBe(0);
  });

  it('does not enter Last Brain outside the playing phase', () => {
    const sim = fixture(); sim.state.phase = 'victory';
    expect(eventsOf(deplete(sim), 'lastBrainStart')).toEqual([]);
    expect(isLastBrain(sim.state)).toBe(false);
    expect(sim.state.leader.alive).toBe(true);
  });

  it('reset restores the core, clears Last Brain/grace and preserves session telemetry', () => {
    const sim = fixture(); deplete(sim);
    const taken = sim.state.horde.alphaDamageTaken, shared = sim.state.horde.sharedDamageDealt;
    resetHordeHealth(sim.state);
    expect(sim.state.horde.coreDamage).toBe(0);
    expect(sim.state.horde.strength).toBe(b.alphaCore);
    expect(isLastBrain(sim.state)).toBe(false); expect(isHordeShielded(sim.state)).toBe(false);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toMatchObject([{ delta: b.alphaCore, cause: 'respawn' }]);
    expect(sim.state.horde.alphaDamageTaken).toBe(taken);
    expect(sim.state.horde.sharedDamageDealt).toBe(shared);
    expect(eventsOf(tick(sim), 'hordeStrengthChanged')).toEqual([]);
  });

  it('warns only below the critical edge and re-arms above the hysteresis band or on reset', () => {
    const sim = fixture(true);
    const hitTo = (units: number): GameEvent[] => {
      const loss = sim.state.horde.strength - units;
      applyAlphaDamage(sim.ctx, loss * b.unitHp / b.alphaDamageMultiplier, 'bullet');
      return tick(sim);
    };
    expect(eventsOf(hitTo(1), 'hordeCritical')).toHaveLength(1);
    expect(eventsOf(hitTo(0.9), 'hordeCritical')).toEqual([]);
    restoreStrength(sim.ctx, 0.5, 'heal'); tick(sim); // 1.4 / 6, still inside hysteresis.
    expect(eventsOf(hitTo(1), 'hordeCritical')).toEqual([]);
    restoreStrength(sim.ctx, 1, 'heal'); tick(sim); // 2 / 6, re-armed.
    expect(eventsOf(hitTo(1), 'hordeCritical')).toHaveLength(1);
    resetHordeHealth(sim.state); tick(sim);
    expect(eventsOf(hitTo(1), 'hordeCritical')).toHaveLength(1);
  });
});

describe('rapid hits and numeric safety', () => {
  it('distributes every hit deterministically and aggregates strength once, bounded and finite', () => {
    const run = (): { horde: Simulation['state']['horde']; hp: number[]; events: GameEvent[] } => {
      const sim = fixture(false, 42);
      for (let i = 0; i < 12; i++) zombie(sim, 1 + i * 0.5);
      tick(sim);
      const before = sim.state.horde.strength;
      for (let i = 0; i < 20; i++) applyAlphaDamage(sim.ctx, 10, 'bullet');
      const events = tick(sim, dt);
      expect(eventsOf(events, 'sharedDamage')).toHaveLength(20);
      expect(eventsOf(events, 'hordeStrengthChanged')).toHaveLength(1);
      expect(eventsOf(events, 'hordeStrengthChanged')[0].delta).toBeCloseTo(sim.state.horde.strength - before);
      expect(sim.state.horde.alphaDamageTaken).toBe(200);
      expect(sim.state.horde.sharedDamageDealt).toBe(500);
      expect(sim.state.horde.strength).toBeGreaterThanOrEqual(0);
      expect(sim.state.horde.strength).toBeLessThanOrEqual(sim.state.horde.maxStrength);
      expect(Object.values(sim.state.horde).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
      return { horde: sim.state.horde, hp: sim.state.zombies.map(z => z.hp), events };
    };
    expect(run()).toEqual(run());
  });

  it('ignores negative, zero, NaN and infinite damage/healing without events or corrupting telemetry', () => {
    const sim = fixture(), before = structuredClone(sim.state.horde);
    for (const amount of [-10, 0, NaN, Infinity, -Infinity]) {
      applyAlphaDamage(sim.ctx, amount, 'hazard');
      expect(restoreStrength(sim.ctx, amount, 'heal')).toBe(0);
    }
    expect(tick(sim)).toEqual([]);
    expect(sim.state.horde).toEqual(before);
  });

  it('discards excess damage after every available HP is depleted and remains bounded under repeated hits', () => {
    const sim = fixture(); zombie(sim); tick(sim);
    const availableHp = b.alphaCore * b.unitHp + BALANCE.walker.maxHp;
    for (let i = 0; i < 50; i++) applyAlphaDamage(sim.ctx, 10000, 'explosion');
    tick(sim);
    expect(sim.state.horde.sharedDamageDealt).toBe(availableHp);
    expect(sim.state.horde.strength).toBe(0);
    expect(sim.state.horde.coreDamage).toBe(b.alphaCore);
    expect(sim.state.followerCount).toBe(0);
    expect(sim.state.horde.alphaDamageTaken).toBe(500000);
  });
});
