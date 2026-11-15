// Rush: the first unlock (Suburb Police Checkpoint). Before it, civilians outrun the horde; after it, slot Q gives a
// brief horde speed/attack burst to run them down.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { GameEvent } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { applySave, createSave } from '../src/persistence/saveSchema';
import { strongholdMeta } from '../src/content/strongholds';
import { unlockAbility } from '../src/systems/ProgressionSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;

function step(sim: Simulation, input = emptyInput()): GameEvent[] {
  sim.step(dt, input);
  return sim.drainEvents();
}

describe('Rush (first unlock)', () => {
  it('is not available at the start; the suburb checkpoint is the stronghold that grants it', () => {
    const sim = new Simulation(layout, 7);
    expect(sim.state.progression.unlocked).not.toContain('rush');
    expect(sim.state.progression.equipped).toEqual([null, null, null, null]);
    expect(strongholdMeta('suburb_checkpoint').unlock).toBe('rush');
    expect(layout.strongholds.find(s => s.id === 'suburb_checkpoint')!.unlock).toBe('rush');
    const denied = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(denied.some(e => e.type === 'rushStart')).toBe(false);
  });

  it('once unlocked it auto-equips on Q, bursts once per cooldown, ends after its duration and is ready again', () => {
    const sim = new Simulation(layout, 7);
    const s = sim.state;
    expect(unlockAbility(sim.ctx, 'rush')).toBe(true);
    expect(s.progression.equipped[0]).toBe('rush');
    sim.drainEvents();
    const first = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(first.some(e => e.type === 'rushStart')).toBe(true);
    expect(first.some(e => e.type === 'abilityUsed' && e.abilityId === 'rush')).toBe(true);
    expect(s.abilities.rushTimeLeft).toBeGreaterThan(BALANCE.rush.duration - 2 * dt);
    expect(s.progression.biomass).toBe(0); // free

    const again = step(sim, { ...emptyInput(), abilitySlot: 0 });
    expect(again.some(e => e.type === 'abilityDenied' && e.abilityId === 'rush' && e.reason === 'cooldown')).toBe(true);

    let ended = 0;
    for (let t = 0; t < BALANCE.rush.duration + 0.5; t += dt) ended += step(sim).filter(e => e.type === 'rushEnd').length;
    expect(ended).toBe(1);
    for (let t = 0; t < BALANCE.rush.cooldown; t += dt) step(sim);
    expect(step(sim, { ...emptyInput(), abilitySlot: 0 }).some(e => e.type === 'rushStart')).toBe(true);
  });

  it('boosts follower speed while active', () => {
    const sim = new Simulation(layout, 7);
    const s = sim.state;
    unlockAbility(sim.ctx, 'rush');
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
    unlockAbility(sim.ctx, 'rush');
    sim.state.leader.alive = false;
    sim.state.leader.hp = 0;
    expect(step(sim, { ...emptyInput(), abilitySlot: 0 }).some(e => e.type === 'rushStart')).toBe(false);
    expect(sim.state.abilities.rushTimeLeft).toBe(0);
  });

  it('a save that captured the suburb checkpoint before Rush existed gets Rush on load (first empty slot)', () => {
    const src = new Simulation(layout, 7);
    src.state.strongholds.find(s => s.id === 'suburb_checkpoint')!.captured = true;
    src.state.progression.slotsOwned = 4;
    src.state.progression.unlocked.push('horde_frenzy');
    src.state.progression.equipped = ['horde_frenzy', null, null, null];
    const old = JSON.parse(JSON.stringify(createSave(src.state, 7)));
    expect(old.player.unlockedAbilities).not.toContain('rush');
    const loaded = new Simulation(layout, 7);
    applySave(loaded.ctx, old);
    expect(loaded.state.progression.unlocked).toContain('rush');
    expect(loaded.state.progression.equipped).toEqual(['horde_frenzy', 'rush', null, null]);
    // Applying again changes nothing (no duplicate unlock / slot).
    applySave(loaded.ctx, old);
    expect(loaded.state.progression.unlocked.filter(id => id === 'rush')).toHaveLength(1);
    expect(loaded.state.progression.equipped.filter(id => id === 'rush')).toHaveLength(1);
  });
});
