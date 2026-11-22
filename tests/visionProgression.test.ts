import { beforeEach, describe, expect, it } from 'vitest';
import { emptyInput } from '../src/core/types';
import { applySave, createSave, parseSave } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { buyVision, updateProgression, visionCost } from '../src/systems/ProgressionSystem';

let sim: Simulation;
beforeEach(() => { sim = new Simulation(); });

function atNest(): void {
  const n = sim.ctx.layout.nests[0].pos;
  sim.state.leader.pos = { x: n.x, z: n.z };
}
function events(type: string) {
  return sim.drainEvents().filter(e => e.type === type);
}

describe('eyesight progression (EW-T006)', () => {
  it('starts at tier 1 with costs 20/60/120/null', () => {
    const p = sim.state.progression;
    expect(p.visionTier).toBe(1);
    const costs: Array<number | null> = [];
    for (const t of [1, 2, 3, 4] as const) { p.visionTier = t; costs.push(visionCost(sim.state)); }
    expect(costs).toEqual([20, 60, 120, null]);
  });

  it('denies away from the nest', () => {
    sim.state.progression.biomass = 500;
    sim.state.leader.pos = { x: 9999, z: 9999 };
    sim.drainEvents();
    expect(buyVision(sim.ctx)).toBe(false);
    expect(events('abilityDenied')).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'notAtNest' }]);
    expect(sim.state.progression.visionTier).toBe(1);
    expect(sim.state.progression.biomass).toBe(500);
  });

  it('denies without biomass and leaves biomass unchanged', () => {
    atNest();
    sim.state.progression.biomass = 19;
    sim.drainEvents();
    expect(buyVision(sim.ctx)).toBe(false);
    expect(events('abilityDenied')).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'biomass' }]);
    expect(sim.state.progression.biomass).toBe(19);
    expect(sim.state.progression.visionTier).toBe(1);
  });

  it('denies at max tier', () => {
    atNest();
    sim.state.progression.visionTier = 4;
    sim.state.progression.biomass = 999;
    sim.drainEvents();
    expect(buyVision(sim.ctx)).toBe(false);
    expect(events('abilityDenied')).toEqual([{ type: 'abilityDenied', abilityId: null, reason: 'maxVision' }]);
    expect(sim.state.progression.biomass).toBe(999);
  });

  it('is locked while respawning or dead', () => {
    atNest();
    sim.state.progression.biomass = 999;
    sim.state.phase = 'respawning';
    sim.drainEvents();
    expect(buyVision(sim.ctx)).toBe(false);
    sim.state.phase = 'playing';
    sim.state.leader.alive = false;
    expect(buyVision(sim.ctx)).toBe(false);
    const reasons = events('abilityDenied').map(e => (e as { reason: string }).reason);
    expect(reasons).toEqual(['locked', 'locked']);
    expect(sim.state.progression.visionTier).toBe(1);
    expect(sim.state.progression.biomass).toBe(999);
  });

  it('spends exactly the cost once and emits visionUpgraded + autosave', () => {
    atNest();
    sim.state.progression.biomass = 25;
    sim.drainEvents();
    const input = emptyInput();
    input.buyVision = true;
    updateProgression(sim.ctx, 1 / 60, input);
    updateProgression(sim.ctx, 1 / 60, input); // 5 left, cost 60 -> denied
    const ev = sim.drainEvents();
    expect(sim.state.progression.visionTier).toBe(2);
    expect(sim.state.progression.biomass).toBe(5);
    expect(ev.filter(e => e.type === 'visionUpgraded')).toEqual([{ type: 'visionUpgraded', tier: 2, cost: 20 }]);
    expect(ev.filter(e => e.type === 'autosave')).toEqual([{ type: 'autosave', reason: 'equip' }]);
    expect(ev.filter(e => e.type === 'abilityDenied')).toHaveLength(1);
  });

  it('two buy requests in one call chain only upgrade with enough biomass', () => {
    atNest();
    sim.state.progression.biomass = 20;
    expect(buyVision(sim.ctx)).toBe(true);
    expect(buyVision(sim.ctx)).toBe(false);
    expect(sim.state.progression.visionTier).toBe(2);
    expect(sim.state.progression.biomass).toBe(0);
  });

  it('tier persists through create -> JSON -> parse -> apply', () => {
    sim.state.progression.visionTier = 3;
    const save = parseSave(JSON.parse(JSON.stringify(createSave(sim.state, 1, 0))));
    expect(save?.player.visionTier).toBe(3);
    const other = new Simulation();
    applySave(other.ctx, save!);
    expect(other.state.progression.visionTier).toBe(3);
  });
});
