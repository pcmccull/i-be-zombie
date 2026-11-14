// Rush as an open-world starter ability (slot Q): brief horde speed/attack burst to run down fleeing civilians.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { GameEvent } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { applySave, createSave } from '../src/persistence/saveSchema';
import { buildDistrictLayout } from '../src/world/districtLayout';

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;

function step(sim: Simulation, input = emptyInput()): GameEvent[] {
  sim.step(dt, input);
  return sim.drainEvents();
}

describe('Rush starter ability (open world)', () => {
  it('starts unlocked and equipped in slot Q in the open world; the legacy district keeps an empty loadout', () => {
    const sim = new Simulation(layout, 7);
    expect(sim.state.progression.unlocked).toContain('rush');
    expect(sim.state.progression.equipped).toEqual(['rush', null, null, null]);
    const legacy = new Simulation();
    expect(legacy.state.progression.unlocked).not.toContain('rush');
    expect(legacy.state.progression.equipped).toEqual([null, null, null, null]);
  });

  it('Q activates a Rush burst once per cooldown, ends after its duration, and is ready again after the cooldown', () => {
    const sim = new Simulation(layout, 7);
    const s = sim.state;
    const first = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(first.some(e => e.type === 'rushStart')).toBe(true);
    expect(first.some(e => e.type === 'abilityUsed' && e.abilityId === 'rush')).toBe(true);
    expect(s.abilities.rushTimeLeft).toBeGreaterThan(BALANCE.rush.duration - 2 * dt);
    expect(s.progression.cooldowns.rush).toBeGreaterThan(0);
    expect(s.progression.biomass).toBe(0); // free

    const again = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(again.some(e => e.type === 'abilityDenied' && e.abilityId === 'rush' && e.reason === 'cooldown')).toBe(true);
    expect(again.some(e => e.type === 'rushStart')).toBe(false);

    let ended = 0;
    for (let t = 0; t < BALANCE.rush.duration + 0.5; t += dt) ended += step(sim).filter(e => e.type === 'rushEnd').length;
    expect(ended).toBe(1);
    expect(s.abilities.rushTimeLeft).toBe(0);

    for (let t = 0; t < BALANCE.rush.cooldown; t += dt) step(sim);
    const ready = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(ready.some(e => e.type === 'rushStart')).toBe(true);
  });

  it('boosts follower speed while active', () => {
    const sim = new Simulation(layout, 7);
    const s = sim.state;
    // Walk the leader away so followers have to move, then compare the fastest follower speed with and without Rush.
    const fastest = (): number => Math.max(...s.zombies.filter(z => z.state === 'follower').map(z => Math.hypot(z.vel.x, z.vel.z)));
    const walk = { ...emptyInput(), moveForward: 1 };
    let base = 0;
    for (let i = 0; i < 90; i++) { step(sim, walk); base = Math.max(base, fastest()); }
    step(sim, { ...walk, abilitySlot: 0 });
    let rushed = 0;
    for (let i = 0; i < 90; i++) { step(sim, walk); rushed = Math.max(rushed, fastest()); }
    expect(rushed).toBeGreaterThan(base * 1.2);
  });

  it('cannot be used while the Alpha is dead / respawning', () => {
    const sim = new Simulation(layout, 7);
    sim.state.leader.alive = false;
    sim.state.leader.hp = 0;
    const events = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(events.some(e => e.type === 'rushStart')).toBe(false);
    expect(sim.state.abilities.rushTimeLeft).toBe(0);
  });

  it('a pre-Rush save gets Rush unlocked and dropped into the first empty slot; a save that has it keeps its loadout', () => {
    const src = new Simulation(layout, 7);
    src.state.progression.unlocked.push('horde_frenzy');
    src.state.progression.equipped = [null, 'horde_frenzy', null, null];
    const old = JSON.parse(JSON.stringify(createSave(src.state, 7)));
    old.player.unlockedAbilities = old.player.unlockedAbilities.filter((id: string) => id !== 'rush');
    old.acquiredUpgrades = old.acquiredUpgrades.filter((id: string) => id !== 'rush');
    const migrated = new Simulation(layout, 7);
    applySave(migrated.ctx, old);
    expect(migrated.state.progression.unlocked).toContain('rush');
    expect(migrated.state.progression.equipped).toEqual(['rush', 'horde_frenzy', null, null]);

    const current = createSave(src.state, 7); // has rush unlocked but deliberately unequipped
    const kept = new Simulation(layout, 7);
    applySave(kept.ctx, current);
    expect(kept.state.progression.equipped).toEqual([null, 'horde_frenzy', null, null]);
  });
});
