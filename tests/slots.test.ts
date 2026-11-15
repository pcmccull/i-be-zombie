import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { WorldSave } from '../src/core/types';
import { applySave, createSave, MIGRATIONS, parseSave } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import {
  buySlot, canActivate, equipAbility, nextSlotCost, ownedSlotCount, unlockAbility, updateProgression,
} from '../src/systems/ProgressionSystem';

type Raw = Record<string, unknown> & { player: Record<string, unknown> };

let sim: Simulation;
beforeEach(() => { sim = new Simulation(); });

function atNest(): void {
  const n = sim.ctx.layout.nests[0].pos;
  sim.state.leader.pos = { x: n.x, z: n.z };
}
function denials() {
  return sim.drainEvents().filter(e => e.type === 'abilityDenied');
}
function rawV1(state: Simulation['state']): Raw {
  const v1 = JSON.parse(JSON.stringify(createSave(state, 1, 0))) as Raw;
  v1.version = 1;
  delete v1.player.slotsOwned;
  return v1;
}

describe('ability slot ownership (todos #9)', () => {
  it('starts with no slots and no next cost', () => {
    expect(sim.state.progression.slotsOwned).toBe(0);
    expect(ownedSlotCount(sim.state)).toBe(0);
    expect(nextSlotCost(sim.state)).toBeNull();
  });

  it('first slot unlock grants slot 0 and equips there', () => {
    expect(unlockAbility(sim.ctx, 'alpha_claws')).toBe(true);
    expect(sim.state.progression.slotsOwned).toBe(1);
    expect(sim.state.progression.equipped).toEqual(['alpha_claws', null, null, null]);
    expect(sim.drainEvents()).toContainEqual({ type: 'abilityUnlocked', abilityId: 'alpha_claws', slot: 0 });
    expect(nextSlotCost(sim.state)).toBe(BALANCE.progression.slotCosts[1]);
  });

  it('a second unlock with one slot is unlocked but not equipped (slot null)', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    sim.drainEvents();
    expect(unlockAbility(sim.ctx, 'horde_frenzy')).toBe(true);
    expect(sim.state.progression.unlocked).toContain('horde_frenzy');
    expect(sim.state.progression.equipped).toEqual(['alpha_claws', null, null, null]);
    expect(sim.drainEvents()).toContainEqual({ type: 'abilityUnlocked', abilityId: 'horde_frenzy', slot: null });
    expect(sim.state.progression.slotsOwned).toBe(1);
  });

  it('buySlot denials: locked (0 slots / dead), notAtNest, biomass, maxSlots', () => {
    atNest();
    sim.state.progression.biomass = 1000;
    expect(buySlot(sim.ctx)).toBe(false);
    expect(denials()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'locked' }]);
    unlockAbility(sim.ctx, 'alpha_claws');
    sim.drainEvents();
    sim.state.leader.pos = { x: sim.state.leader.pos.x + 80, z: sim.state.leader.pos.z + 80 };
    expect(buySlot(sim.ctx)).toBe(false);
    expect(denials()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'notAtNest' }]);
    atNest();
    sim.state.progression.biomass = BALANCE.progression.slotCosts[1] - 1;
    expect(buySlot(sim.ctx)).toBe(false);
    expect(denials()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'biomass' }]);
    expect(sim.state.progression.biomass).toBe(BALANCE.progression.slotCosts[1] - 1);
    sim.state.progression.slotsOwned = BALANCE.progression.slots;
    expect(buySlot(sim.ctx)).toBe(false);
    expect(denials()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'maxSlots' }]);
    sim.state.leader.alive = false;
    sim.state.progression.slotsOwned = 1;
    expect(buySlot(sim.ctx)).toBe(false);
    expect(denials()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'locked' }]);
  });

  it('buySlot spends exactly the cost, emits once, and walks all escalating costs', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    atNest();
    const p = sim.state.progression;
    p.biomass = 500;
    sim.drainEvents();
    let expected = 500;
    for (let slot = 1; slot < BALANCE.progression.slots; slot++) {
      const cost = BALANCE.progression.slotCosts[slot];
      expect(nextSlotCost(sim.state)).toBe(cost);
      updateProgression(sim.ctx, 0, { ...emptyInput(), buySlot: true });
      expected -= cost;
      expect(p.biomass).toBe(expected);
      expect(p.slotsOwned).toBe(slot + 1);
      const ev = sim.drainEvents();
      expect(ev.filter(e => e.type === 'slotPurchased')).toEqual([{ type: 'slotPurchased', slot, cost }]);
      expect(ev.filter(e => e.type === 'autosave')).toEqual([{ type: 'autosave', reason: 'equip' }]);
    }
    expect(nextSlotCost(sim.state)).toBeNull();
  });

  it('exact-cost purchase leaves biomass at zero, never negative', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    atNest();
    sim.state.progression.biomass = BALANCE.progression.slotCosts[1];
    expect(buySlot(sim.ctx)).toBe(true);
    expect(sim.state.progression.biomass).toBe(0);
  });

  it('slots >= slotsOwned cannot be equipped or activated', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    unlockAbility(sim.ctx, 'horde_frenzy');
    atNest();
    sim.drainEvents();
    expect(equipAbility(sim.ctx, 1, 'horde_frenzy')).toBe(false);
    expect(equipAbility(sim.ctx, 1, null)).toBe(false);
    expect(denials()).toEqual([
      { type: 'abilityDenied', abilityId: 'horde_frenzy', reason: 'locked' },
      { type: 'abilityDenied', abilityId: null, reason: 'locked' },
    ]);
    // A stray equip in an unowned slot (e.g. hand-edited state) is not activatable.
    sim.state.progression.equipped[2] = 'horde_frenzy';
    expect(canActivate(sim.state, 'horde_frenzy')).toBe('locked');
    updateProgression(sim.ctx, 0, { ...emptyInput(), abilitySlot: 2 });
    expect(denials()).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'empty' }]);
    expect(sim.state.progression.frenzyTimeLeft).toBe(0);
    // After buying, the slot works.
    sim.state.progression.equipped[2] = null;
    sim.state.progression.biomass = 500;
    expect(buySlot(sim.ctx)).toBe(true);
    expect(equipAbility(sim.ctx, 1, 'horde_frenzy')).toBe(true);
  });
});

describe('slot persistence', () => {
  it('round-trips slotsOwned through createSave / parseSave / applySave', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    sim.state.progression.slotsOwned = 3;
    const save = createSave(sim.state, 1, 0);
    expect(save.player.slotsOwned).toBe(3);
    const parsed = parseSave(JSON.parse(JSON.stringify(save)))!;
    expect(parsed.player.slotsOwned).toBe(3);
    const other = new Simulation();
    applySave(other.ctx, parsed);
    expect(other.state.progression.slotsOwned).toBe(3);
    expect(other.state.progression.equipped).toEqual(['alpha_claws', null, null, null]);
  });

  it('a fresh save keeps slotsOwned 0; out-of-range values clamp', () => {
    const save = createSave(sim.state, 1, 0);
    expect(save.player.slotsOwned).toBe(0);
    const big = parseSave({ ...save, player: { ...save.player, slotsOwned: 99 } })!;
    expect(big.player.slotsOwned).toBe(BALANCE.progression.slots);
    const neg = parseSave({ ...save, player: { ...save.player, slotsOwned: -3 } })!;
    expect(neg.player.slotsOwned).toBe(0);
  });

  it('applySave never wipes a valid loadout: a low slotsOwned is raised to cover it (TD-V2 P2-3)', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    const save = JSON.parse(JSON.stringify(createSave(sim.state, 1, 0))) as WorldSave;
    save.player.equippedAbilities = [null, null, 'alpha_claws', null];
    save.player.slotsOwned = 0;
    const loaded = new Simulation();
    applySave(loaded.ctx, save);
    expect(loaded.state.progression.slotsOwned).toBe(3);
    expect(loaded.state.progression.equipped).toEqual([null, null, 'alpha_claws', null]);
  });

  it('a v2 save missing slotsOwned keeps its loadout through parseSave + applySave (TD-V2 P2-3)', () => {
    sim.state.progression.slotsOwned = 4;
    for (const id of ['rush', 'alpha_claws', 'horde_frenzy'] as const) unlockAbility(sim.ctx, id);
    const save = JSON.parse(JSON.stringify(createSave(sim.state, 1, 0))) as WorldSave;
    delete (save.player as { slotsOwned?: number }).slotsOwned;
    const parsed = parseSave(save)!;
    expect(parsed.player.slotsOwned).toBe(3);
    expect(parsed.player.equippedAbilities).toEqual(['rush', 'alpha_claws', 'horde_frenzy', null]);
    const loaded = new Simulation();
    applySave(loaded.ctx, parsed);
    expect(loaded.state.progression.slotsOwned).toBe(3);
    expect(loaded.state.progression.equipped).toEqual(['rush', 'alpha_claws', 'horde_frenzy', null]);
  });

  it('v1 migration does not count garbage or innate equipped ids as slots (TD-V2 P3-1)', () => {
    const v1 = rawV1(new Simulation().state);
    v1.player.equippedAbilities = [null, null, null, 'not_an_ability'];
    const migrated = MIGRATIONS[1](v1) as { player: { slotsOwned: number } };
    expect(migrated.player.slotsOwned).toBe(0);
    v1.player.equippedAbilities = [null, 'bite', null, null];
    expect((MIGRATIONS[1](v1) as { player: { slotsOwned: number } }).player.slotsOwned).toBe(0);
  });

  it('migrates a v1 save with 3 equipped abilities to slotsOwned 3 with the same loadout', () => {
    sim.state.progression.slotsOwned = 4;
    for (const id of ['alpha_claws', 'horde_frenzy', 'brute_evolution'] as const) unlockAbility(sim.ctx, id);
    const v1 = rawV1(sim.state);
    expect(MIGRATIONS[1]).toBeDefined();
    const parsed = parseSave(v1)!;
    expect(parsed).not.toBeNull();
    expect(parsed.version).toBe(BALANCE.save.version);
    expect(parsed.player.slotsOwned).toBe(3);
    expect(parsed.player.equippedAbilities).toEqual(['alpha_claws', 'horde_frenzy', 'brute_evolution', null]);
    const loaded = new Simulation();
    applySave(loaded.ctx, parsed);
    expect(loaded.state.progression.slotsOwned).toBe(3);
    expect(loaded.state.progression.equipped).toEqual(['alpha_claws', 'horde_frenzy', 'brute_evolution', null]);
  });

  it('migrates a v1 save with an unlocked slot ability but nothing equipped to 1; an empty v1 save to 0', () => {
    unlockAbility(sim.ctx, 'alpha_claws');
    const v1 = rawV1(sim.state);
    v1.player.equippedAbilities = [null, null, null, null];
    expect(parseSave(v1)!.player.slotsOwned).toBe(1);
    expect(parseSave(rawV1(new Simulation().state))!.player.slotsOwned).toBe(0);
  });
});
