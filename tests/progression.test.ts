import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { ABILITIES, INNATE_ABILITIES } from '../src/content/abilities';
import { emptyInput } from '../src/core/types';
import type { AbilityId, ZombieAgent } from '../src/core/types';
import { createZombie, evolveToBrute } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import {
  activateAbility, addBiomass, canActivate, equipAbility, hordeAttackRateMultiplier, hordeSpeedMultiplier,
  isEquipped, isFrenzyActive, isUnlocked, unlockAbility, updateProgression,
} from '../src/systems/ProgressionSystem';

let sim: Simulation;
beforeEach(() => { sim = new Simulation(); sim.state.progression.slotsOwned = BALANCE.progression.slots; });

function followers(): ZombieAgent[] {
  return sim.state.zombies.filter(z => z.state === 'follower');
}

function readyBrutes(biomass = BALANCE.brute.costPerBrute * 10): ZombieAgent[] {
  unlockAbility(sim.ctx, 'brute_evolution');
  sim.state.progression.biomass = biomass;
  const group = followers();
  group.forEach((z, i) => {
    z.pos = { x: sim.state.leader.pos.x + 10 - i, z: sim.state.leader.pos.z };
  });
  sim.drainEvents();
  return group;
}

describe('biomass and unlocks', () => {
  it('starts with innate actions, no slotted abilities, and finite nonnegative biomass', () => {
    expect(sim.state.progression.equipped).toEqual(new Array(BALANCE.progression.slots).fill(null));
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.startBiomass);
    sim.state.progression.unlocked = [];
    for (const id of INNATE_ABILITIES) {
      expect(isUnlocked(sim.state, id)).toBe(true);
      expect(isEquipped(sim.state, id)).toBe(false);
      expect(unlockAbility(sim.ctx, id)).toBe(false);
      expect(canActivate(sim.state, id)).toBe('locked');
    }
    expect(sim.drainEvents()).toEqual([]);
  });

  it('awards biomass with its reason and ignores negative, zero, and nonfinite gains', () => {
    const start = sim.state.progression.biomass;
    addBiomass(sim.ctx, 7, 'infect');
    addBiomass(sim.ctx, 12, 'capture');
    for (const invalid of [-10, 0, NaN, Infinity, -Infinity]) addBiomass(sim.ctx, invalid, 'kill');
    expect(sim.state.progression.biomass).toBe(start + 19);
    expect(sim.drainEvents()).toEqual([
      { type: 'biomassGain', amount: 7, total: start + 7, reason: 'infect' },
      { type: 'biomassGain', amount: 12, total: start + 19, reason: 'capture' },
    ]);
  });

  it('unlocks each reward once, fills the first empty slot, and preserves a full loadout', () => {
    const ids: AbilityId[] = ['alpha_claws', 'horde_frenzy', 'brute_evolution', 'pounce'];
    for (const [slot, id] of ids.entries()) {
      expect(unlockAbility(sim.ctx, id)).toBe(true);
      expect(unlockAbility(sim.ctx, id)).toBe(false);
      expect(sim.state.progression.unlocked.filter(value => value === id)).toHaveLength(1);
      expect(sim.drainEvents()).toEqual([{ type: 'abilityUnlocked', abilityId: id, slot }]);
    }
    expect(sim.state.progression.equipped).toEqual(ids);
    expect(sim.state.progression.equipped).toHaveLength(BALANCE.progression.slots);
    // The next unlock fills a hole rather than shifting the other equipped abilities.
    sim.reset();
    sim.state.progression.slotsOwned = BALANCE.progression.slots;
    unlockAbility(sim.ctx, 'alpha_claws');
    unlockAbility(sim.ctx, 'horde_frenzy');
    equipAbility(sim.ctx, 0, null);
    unlockAbility(sim.ctx, 'brute_evolution');
    expect(sim.state.progression.equipped).toEqual(['brute_evolution', 'horde_frenzy', null, null]);
  });

  it('handles unknown registry ids without changing progression', () => {
    const before = structuredClone(sim.state.progression);
    for (const id of ['missing', 'toString', '__proto__', null] as unknown as AbilityId[]) {
      expect(canActivate(sim.state, id)).toBe('empty');
      expect(isUnlocked(sim.state, id)).toBe(false);
      expect(unlockAbility(sim.ctx, id)).toBe(false);
      expect(activateAbility(sim.ctx, id)).toBe(false);
    }
    expect(sim.state.progression).toEqual(before);
    expect(sim.drainEvents().every(e => e.type === 'abilityDenied' && e.reason === 'empty')).toBe(true);
  });
});

describe('loadout at nests', () => {
  it('moves abilities between slots without duplicates, replaces occupants, and can clear a slot', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    unlockAbility(sim.ctx, 'horde_frenzy');
    sim.drainEvents();
    expect(equipAbility(sim.ctx, 1, 'alpha_claws')).toBe(true);
    expect(sim.state.progression.equipped).toEqual([null, 'alpha_claws', null, null]);
    expect(equipAbility(sim.ctx, 3, 'horde_frenzy')).toBe(true);
    expect(equipAbility(sim.ctx, 1, 'alpha_claws')).toBe(true);
    expect(equipAbility(sim.ctx, 1, null)).toBe(true);
    expect(sim.state.progression.equipped).toEqual([null, null, null, 'horde_frenzy']);
    expect(sim.drainEvents()).toEqual([
      { type: 'abilityEquipped', abilityId: 'alpha_claws', slot: 1 },
      { type: 'abilityEquipped', abilityId: 'horde_frenzy', slot: 3 },
      { type: 'abilityEquipped', abilityId: 'alpha_claws', slot: 1 },
      { type: 'abilityEquipped', abilityId: null, slot: 1 },
    ]);
  });

  it('rejects invalid slots, locked abilities, and innate actions without resizing the loadout', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    const before = [...sim.state.progression.equipped];
    for (const slot of [-1, BALANCE.progression.slots, 1.5, NaN, Infinity]) {
      expect(equipAbility(sim.ctx, slot, 'alpha_claws')).toBe(false);
      expect(equipAbility(sim.ctx, slot, null)).toBe(false);
    }
    for (const id of ['bite', 'infect', 'horde_frenzy', 'missing'] as AbilityId[]) {
      expect(equipAbility(sim.ctx, 0, id)).toBe(false);
    }
    expect(sim.state.progression.equipped).toEqual(before);
    expect(sim.state.progression.equipped).toHaveLength(BALANCE.progression.slots);
    expect(sim.drainEvents().filter(e => e.type === 'abilityDenied').every(e => e.reason === 'locked')).toBe(true);
  });

  it('requires a living leader in range of an active nest, including for clearing slots', () => {
    unlockAbility(sim.ctx, 'horde_frenzy');
    const start = sim.ctx.layout.nests[0].pos;
    sim.state.leader.pos = { x: start.x + BALANCE.nest.equipRadius, z: start.z };
    expect(equipAbility(sim.ctx, 2, 'horde_frenzy')).toBe(true);
    sim.state.leader.pos.x += 0.01;
    expect(equipAbility(sim.ctx, 2, null)).toBe(false);
    expect(equipAbility(sim.ctx, 0, 'horde_frenzy')).toBe(false);
    sim.state.leader.pos = { ...start };
    sim.state.leader.alive = false;
    expect(equipAbility(sim.ctx, 0, 'horde_frenzy')).toBe(false);
    expect(sim.state.progression.equipped).toEqual([null, null, 'horde_frenzy', null]);
    expect(sim.drainEvents().filter(e => e.type === 'abilityDenied')).toEqual([
      { type: 'abilityDenied', abilityId: null, reason: 'notAtNest' },
      { type: 'abilityDenied', abilityId: 'horde_frenzy', reason: 'notAtNest' },
      { type: 'abilityDenied', abilityId: 'horde_frenzy', reason: 'notAtNest' },
    ]);
  });

  it('allows any captured nest, without depending on the selected respawn nest', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    const pos = { x: 0, z: 0 };
    sim.ctx.layout.nests.push({ id: 'test-mall', districtId: 'shopping', pos, strongholdId: 'mall_security' });
    sim.state.strongholds.push({ id: 'mall_security', captured: false, contested: false, defenderStrength: 1,
      objectivesDone: [], holdProgress: 0, reinforcementsSpent: 0, lastReinforcementAt: -Infinity });
    sim.state.leader.pos = { ...pos };
    expect(equipAbility(sim.ctx, 3, 'alpha_claws')).toBe(false);
    sim.state.strongholds[0].captured = true;
    expect(sim.state.activeNestId).toBe('start');
    expect(equipAbility(sim.ctx, 3, 'alpha_claws')).toBe(true);
  });
});

describe('activation eligibility and Frenzy', () => {
  it('checks unlock/equip, active effect support, cooldown, biomass, then targets in that order', () => {
    const p = sim.state.progression;
    p.cooldowns.brute_evolution = 1;
    expect(canActivate(sim.state, 'brute_evolution')).toBe('locked');
    unlockAbility(sim.ctx, 'brute_evolution');
    equipAbility(sim.ctx, 0, null);
    expect(canActivate(sim.state, 'brute_evolution')).toBe('locked');
    equipAbility(sim.ctx, 0, 'brute_evolution');
    expect(canActivate(sim.state, 'brute_evolution')).toBe('cooldown');
    p.cooldowns.brute_evolution = 0;
    sim.state.zombies = [];
    sim.state.followerCount = 0;
    expect(canActivate(sim.state, 'brute_evolution')).toBe('biomass');
    p.biomass = BALANCE.brute.costPerBrute;
    expect(canActivate(sim.state, 'brute_evolution')).toBe('noTarget');
    for (const id of ['alpha_claws', 'pounce'] as const) {
      unlockAbility(sim.ctx, id);
      expect(canActivate(sim.state, id)).toBe('locked');
      expect(activateAbility(sim.ctx, id)).toBe(false);
    }
    expect(p.biomass).toBe(BALANCE.brute.costPerBrute);
  });

  it('activates Frenzy once, publishes snapshots, and prevents cooldown bypass by moving slots', () => {
    unlockAbility(sim.ctx, 'horde_frenzy');
    sim.drainEvents();
    const pos = { ...sim.state.leader.pos };
    expect(activateAbility(sim.ctx, 'horde_frenzy')).toBe(true);
    expect(isFrenzyActive(sim.state)).toBe(true);
    expect(hordeSpeedMultiplier(sim.state)).toBe(BALANCE.frenzy.speedMultiplier);
    expect(hordeAttackRateMultiplier(sim.state)).toBe(BALANCE.frenzy.attackRateMultiplier);
    expect(sim.state.progression.frenzyTimeLeft).toBe(BALANCE.frenzy.duration);
    expect(sim.state.progression.cooldowns.horde_frenzy).toBe(ABILITIES.horde_frenzy.cooldown);
    const events = sim.drainEvents();
    sim.state.leader.pos.x += 1;
    expect(events).toEqual([
      { type: 'frenzyStart', pos, radius: BALANCE.frenzy.radius },
      { type: 'abilityUsed', abilityId: 'horde_frenzy', pos },
    ]);
    expect(equipAbility(sim.ctx, 3, 'horde_frenzy')).toBe(true);
    expect(activateAbility(sim.ctx, 'horde_frenzy')).toBe(false);
    updateProgression(sim.ctx, 0, { ...emptyInput(), abilitySlot: 3 });
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.startBiomass);
    expect(sim.drainEvents().filter(e => e.type === 'abilityDenied')).toEqual([
      { type: 'abilityDenied', abilityId: 'horde_frenzy', reason: 'cooldown' },
      { type: 'abilityDenied', abilityId: 'horde_frenzy', reason: 'cooldown' },
    ]);
  });

  it('expires Frenzy once, clamps timers to zero, and allows reactivation only after cooldown', () => {
    unlockAbility(sim.ctx, 'horde_frenzy');
    activateAbility(sim.ctx, 'horde_frenzy');
    sim.drainEvents();
    updateProgression(sim.ctx, BALANCE.frenzy.duration - 0.25, emptyInput());
    expect(isFrenzyActive(sim.state)).toBe(true);
    updateProgression(sim.ctx, 0.5, emptyInput());
    expect(isFrenzyActive(sim.state)).toBe(false);
    expect(hordeSpeedMultiplier(sim.state)).toBe(1);
    expect(hordeAttackRateMultiplier(sim.state)).toBe(1);
    expect(canActivate(sim.state, 'horde_frenzy')).toBe('cooldown');
    updateProgression(sim.ctx, BALANCE.frenzy.cooldown * 2, emptyInput());
    expect(sim.state.progression.cooldowns.horde_frenzy).toBe(0);
    expect(sim.state.progression.frenzyTimeLeft).toBe(0);
    expect(sim.drainEvents()).toEqual([{ type: 'frenzyEnd' }]);
    expect(activateAbility(sim.ctx, 'horde_frenzy')).toBe(true);
  });

  it('routes slot/equip inputs, treats empty slots as denied, and leaves passive slot keys quiet', () => {
    updateProgression(sim.ctx, BALANCE.sim.fixedDt, { ...emptyInput(), abilitySlot: 0 });
    expect(sim.drainEvents()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'empty' }]);
    unlockAbility(sim.ctx, 'alpha_claws');
    sim.drainEvents();
    updateProgression(sim.ctx, BALANCE.sim.fixedDt, { ...emptyInput(), abilitySlot: 0 });
    expect(sim.drainEvents()).toEqual([]);
    unlockAbility(sim.ctx, 'horde_frenzy');
    updateProgression(sim.ctx, BALANCE.sim.fixedDt, { ...emptyInput(), equip: { slot: 3, ability: 'horde_frenzy' } });
    expect(sim.state.progression.equipped[3]).toBe('horde_frenzy');
    updateProgression(sim.ctx, BALANCE.sim.fixedDt, { ...emptyInput(), abilitySlot: 3 });
    expect(sim.state.progression.frenzyTimeLeft).toBe(BALANCE.frenzy.duration);
    expect(sim.state.progression.cooldowns.horde_frenzy).toBe(BALANCE.frenzy.cooldown);
  });
});

describe('Brute Evolution', () => {
  it('mutates the nearest followers up to the activation limit and keeps follower totals unchanged', () => {
    const group = readyBrutes();
    const speedScales = group.map(z => z.speedScale);
    const initialBiomass = sim.state.progression.biomass;
    const initialCount = sim.state.followerCount;
    const targets = group.slice().reverse().slice(0, BALANCE.brute.maxPerActivation);
    targets[0].hp = 1;
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(true);
    expect(group.filter(z => z.brute).map(z => z.id).sort()).toEqual(targets.map(z => z.id).sort());
    for (const z of targets) {
      expect(z.hp).toBe(BALANCE.brute.maxHp);
      expect(z.maxHp).toBe(BALANCE.brute.maxHp);
      expect(z.radius).toBe(BALANCE.brute.radius);
      expect(z.speedScale).toBeCloseTo(speedScales[group.indexOf(z)] * BALANCE.brute.speedMultiplier);
      expect(z.state).toBe('follower');
    }
    expect(sim.state.progression.biomass).toBe(initialBiomass - targets.length * BALANCE.brute.costPerBrute);
    expect(sim.state.followerCount).toBe(initialCount);
    const events = sim.drainEvents();
    for (const z of targets) {
      expect(events).toContainEqual({ type: 'bruteEvolved', zombieId: z.id, pos: { ...z.pos } });
    }
    expect(events.filter(e => e.type === 'bruteEvolved')).toHaveLength(targets.length);
    expect(events.filter(e => e.type === 'abilityUsed')).toEqual([
      { type: 'abilityUsed', abilityId: 'brute_evolution', pos: { ...sim.state.leader.pos } },
    ]);
  });

  it.each([BALANCE.brute.costPerBrute, BALANCE.brute.costPerBrute * 2 - 1])(
    'converts only one follower when partially affordable with %i biomass, without double spending', biomass => {
      const group = readyBrutes(biomass);
      expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(true);
      expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(false);
      updateProgression(sim.ctx, 0, { ...emptyInput(), abilitySlot: 0 });
      expect(group.filter(z => z.brute)).toHaveLength(1);
      expect(sim.state.progression.biomass).toBe(biomass - BALANCE.brute.costPerBrute);
      expect(sim.state.progression.cooldowns.brute_evolution).toBe(BALANCE.brute.cooldown);
      const events = sim.drainEvents();
      expect(events.filter(e => e.type === 'abilityUsed')).toHaveLength(1);
      expect(events.filter(e => e.type === 'abilityDenied')).toHaveLength(2);
    },
  );

  it('denies unaffordable evolution without mutation, cooldown, or spend', () => {
    const group = readyBrutes(BALANCE.brute.costPerBrute - 1);
    const before = structuredClone(sim.state.progression);
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(false);
    expect(sim.state.progression).toEqual(before);
    expect(group.every(z => !z.brute)).toBe(true);
    expect(sim.drainEvents()).toEqual([{ type: 'abilityDenied', abilityId: 'brute_evolution', reason: 'biomass' }]);
  });

  it('skips existing brutes, corpses, zero-hp followers, dormant followers, ambient zombies, and rising zombies', () => {
    const group = readyBrutes();
    evolveToBrute(group[0]);
    group[1].state = 'dead';
    group[2].hp = 0;
    group[3].dormant = true;
    group[4].state = 'rising';
    sim.state.followerCount = group.filter(z => z.state === 'follower').length;
    expect(canActivate(sim.state, 'brute_evolution')).toBe('noTarget');
    const before = structuredClone(sim.state.progression);
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(false);
    expect(sim.state.progression).toEqual(before);
    expect(sim.state.zombies.filter(z => z.brute)).toEqual([group[0]]);
    group[3].dormant = false;
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(true);
    expect(sim.state.zombies.filter(z => z.brute)).toEqual([group[0], group[3]]);
  });

  it('limits living brutes, charges only for free capacity, and reuses capacity after a brute dies', () => {
    const group = readyBrutes();
    for (let i = 0; i < BALANCE.brute.maxBrutes - 1; i++) {
      const z = createZombie(sim.ctx.newId(), { ...sim.state.leader.pos }, {
        state: 'follower', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng,
      });
      evolveToBrute(z);
      sim.state.zombies.push(z);
      sim.state.followerCount++;
    }
    const biomass = sim.state.progression.biomass;
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(true);
    expect(sim.state.progression.biomass).toBe(biomass - BALANCE.brute.costPerBrute);
    updateProgression(sim.ctx, BALANCE.brute.cooldown, emptyInput());
    expect(canActivate(sim.state, 'brute_evolution')).toBe('noTarget');
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(false);
    const dead = sim.state.zombies.find(z => z.brute)!;
    dead.state = 'dead'; dead.hp = 0;
    sim.state.followerCount--;
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(true);
    expect(group.filter(z => z.brute)).toHaveLength(2);
    expect(sim.state.zombies.filter(z => z.brute && z.state !== 'dead' && z.hp > 0)).toHaveLength(BALANCE.brute.maxBrutes);
    expect(sim.state.progression.biomass).toBe(biomass - 2 * BALANCE.brute.costPerBrute);
  });

  it('uses entity ids to deterministically break distance ties', () => {
    const group = readyBrutes();
    for (const z of group) z.pos = { ...sim.state.leader.pos };
    sim.state.zombies.reverse();
    expect(activateAbility(sim.ctx, 'brute_evolution')).toBe(true);
    expect(group.filter(z => z.brute).map(z => z.id)).toEqual(group.map(z => z.id).sort((a, b) => a - b).slice(0, BALANCE.brute.maxPerActivation));
  });

  it('does not compound a mutation or heal an existing brute, and resets without leaked state', () => {
    const z = readyBrutes()[0];
    evolveToBrute(z);
    const speedScale = z.speedScale;
    z.hp = 50;
    evolveToBrute(z);
    expect(z.hp).toBe(50);
    expect(z.speedScale).toBe(speedScale);
    sim.reset();
    expect(sim.state.zombies.every(agent => !agent.brute)).toBe(true);
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.startBiomass);
    expect(sim.state.progression.cooldowns).toEqual({});
    expect(sim.state.progression.equipped).toEqual(new Array(BALANCE.progression.slots).fill(null));
    expect(sim.drainEvents()).toEqual([]);
  });
});
