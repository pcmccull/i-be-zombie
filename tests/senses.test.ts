import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { GameEvent, GuardAgent, Vec2, VisionTier } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { Simulation } from '../src/sim/Simulation';
import { awarenessOf, canTarget, updateAwareness } from '../src/systems/AwarenessSystem';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';

function fixture(tier: VisionTier = 1) {
  const sim = new Simulation(buildLegacyDistrictLayout(), 765);
  sim.state.guards = []; sim.state.zombies = []; sim.state.followerCount = 0;
  sim.state.leader.pos = { x: 0, z: 0 }; sim.state.progression.visionTier = tier;
  sim.ctx.collision = new CollisionWorld({ minX: -250, maxX: 250, minZ: -250, maxZ: 250 }, []);
  return sim;
}
function human(sim: Simulation, x: number, z = 0, options: Partial<GuardAgent> = {}) {
  const g = createGuard(sim.ctx.newId(), { pos: { x, z }, facing: 0, tower: null, waypoints: [], post: 'street' }, sim.ctx.collision);
  Object.assign(g, options); sim.state.guards.push(g); return g;
}
function tick(sim: Simulation, events: readonly GameEvent[] = [], dt = BALANCE.sim.fixedDt) {
  sim.state.time += dt; updateAwareness(sim.ctx, dt, events);
}
function shot(g: GuardAgent): GameEvent {
  return { type: 'shot', guardId: g.id, from: { ...g.pos, y: 1.5 }, to: { x: 200, z: 200, y: 1.1 }, hit: false };
}
function wave(pos: Vec2): GameEvent {
  return { type: 'reinforcements', strongholdId: null, districtId: 'suburbs', count: 3, pos };
}
function distance(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.z - b.z); }

describe('nonvisual gunshot cues', () => {
  it('creates a fuzzed, attenuated cue outside clear sight without identifying the shooter', () => {
    const sim = fixture(), g = human(sim, 50); tick(sim, [shot(g)]);
    const cue = sim.state.vision.cues[0];
    expect(sim.state.vision.cues).toHaveLength(1);
    expect(cue).toMatchObject({ kind: 'gunshot', awareness: 'heard', age: 0, ttl: BALANCE.senses.kinds.gunshot.ttl, count: 1 });
    expect(cue.pos).not.toEqual(g.pos);
    expect(distance(cue.pos, g.pos)).toBeCloseTo(50 * BALANCE.senses.kinds.gunshot.fuzzFrac);
    expect(distance(cue.pos, g.pos)).toBeLessThanOrEqual(BALANCE.senses.kinds.gunshot.fuzzMax);
    expect(cue.intensity).toBeCloseTo(1 - 50 / BALANCE.senses.kinds.gunshot.range);
    expect(canTarget(sim.state, g.id)).toBe(false); expect(awarenessOf(sim.state, g.id)).not.toBe('identified');
    expect(sim.drainEvents()).toContainEqual({ type: 'senseCue', kind: 'gunshot', cueId: cue.id, fresh: true });
  });

  it('always warns about gunshots inside clear sight (true bearing), never beyond hearing range', () => {
    const sim = fixture();
    const near = human(sim, 0, -10); tick(sim, [shot(near)]);
    expect(sim.state.vision.cues).toHaveLength(1);
    const cue = sim.state.vision.cues[0];
    expect(cue.kind).toBe('gunshot');
    expect(distance(cue.pos, near.pos)).toBeCloseTo(10 * BALANCE.senses.kinds.gunshot.fuzzFrac);
    expect(Math.abs(Math.atan2(cue.pos.x, -cue.pos.z))).toBeLessThan(0.25); // still points north

    const sim2 = fixture();
    tick(sim2, [shot(human(sim2, 141))]); expect(sim2.state.vision.cues).toEqual([]);
    const boundary = human(sim2, BALANCE.senses.kinds.gunshot.range); tick(sim2, [shot(boundary)]);
    expect(sim2.state.vision.cues[0].intensity).toBe(0);
  });

  it('aggregates 50 shots at maximum fuzz, refreshes lifetime and keeps maximum intensity', () => {
    const sim = fixture(), g = human(sim, 135);
    let n = 0; sim.ctx.rng = { next: () => (++n % 2) * 0.5 };
    tick(sim, Array.from({ length: 50 }, () => shot(g)));
    expect(sim.state.vision.cues).toHaveLength(1);
    const cue = sim.state.vision.cues[0]; expect(cue.count).toBe(50);
    const events = sim.drainEvents().filter(e => e.type === 'senseCue');
    expect(events.filter(e => e.fresh)).toHaveLength(1); expect(events.filter(e => !e.fresh)).toHaveLength(49);
    tick(sim, [], 1); expect(cue.age).toBe(1);
    g.pos.x = 115; tick(sim, [shot(g)]);
    expect(cue.age).toBe(0); expect(cue.count).toBe(51);
    const strongIntensity = cue.intensity;
    g.pos.x = 130; tick(sim, [shot(g)]); expect(cue.intensity).toBe(strongIntensity);
    tick(sim, [], cue.ttl); expect(sim.state.vision.cues).toEqual([]);
    tick(sim, [shot(g)]); expect(sim.state.vision.cues[0].id).toBeGreaterThan(cue.id);
  });

  it('keeps cue coordinates fixed between events while bearing changes with leader movement', () => {
    const sim = fixture(), g = human(sim, 50); tick(sim, [shot(g)]);
    const cue = sim.state.vision.cues[0], pos = { ...cue.pos };
    const bearing = Math.atan2(cue.pos.x, cue.pos.z);
    g.pos.x = 90; sim.state.leader.pos.z = 20; tick(sim);
    expect(cue.pos).toEqual(pos);
    expect(Math.atan2(cue.pos.x - sim.state.leader.pos.x, cue.pos.z - sim.state.leader.pos.z)).not.toBe(bearing);
    expect(sim.state.vision.identified).toEqual([]);
  });

  it('caps cues and removes the weakest regardless of insertion order', () => {
    const sim = fixture();
    const weak = human(sim, 139); tick(sim, [shot(weak)]);
    const weakId = sim.state.vision.cues[0].id;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const g = human(sim, Math.cos(angle) * 80, Math.sin(angle) * 80); tick(sim, [shot(g)]);
      expect(sim.state.vision.cues.length).toBeLessThanOrEqual(BALANCE.senses.maxCues);
    }
    expect(sim.state.vision.cues).toHaveLength(BALANCE.senses.maxCues);
    expect(sim.state.vision.cues.some(c => c.id === weakId)).toBe(false);
    const survivorIds = sim.state.vision.cues.map(c => c.id);
    const farther = human(sim, 0, 139); tick(sim, [shot(farther)]);
    expect(sim.state.vision.cues.map(c => c.id)).toEqual(survivorIds);
  });

  it('does not change identified/seen arrays or their revision just because a cue is emitted', () => {
    const sim = fixture(), g = human(sim, 80); tick(sim);
    const identified = [...sim.state.vision.identified], seen = [...sim.state.vision.seen], revision = sim.state.vision.revision;
    tick(sim, [shot(g)], 0.001);
    expect(sim.state.vision.cues).toHaveLength(1);
    expect(sim.state.vision.identified).toEqual(identified); expect(sim.state.vision.seen).toEqual(seen);
    expect(sim.state.vision.revision).toBe(revision);
  });
});

describe('screams, sirens and crowds', () => {
  it('emits a scream once on entering RETREAT, allows later transitions, skips soldiers/dead/dormant civilians', () => {
    const sim = fixture(), civ = human(sim, 45, 0, { role: 'civilian' });
    const soldier = human(sim, -45); tick(sim);
    civ.state = 'RETREAT'; soldier.state = 'RETREAT';
    human(sim, 50, 0, { role: 'civilian', state: 'RETREAT', hp: 0 });
    human(sim, 50, 0, { role: 'civilian', state: 'RETREAT', dormant: true });
    tick(sim); expect(sim.state.vision.cues).toHaveLength(1);
    const cue = sim.state.vision.cues[0]; expect(cue.kind).toBe('scream');
    tick(sim); expect(cue.count).toBe(1);
    civ.state = 'PATROL'; tick(sim); civ.state = 'RETREAT'; tick(sim); expect(cue.count).toBe(2);
    expect(canTarget(sim.state, civ.id)).toBe(false);
  });

  it('emits sirens from reinforcement events, with more precise fuzz at tier 4', () => {
    const a = fixture(1), b = fixture(4), source = { x: 150, z: 0 };
    a.ctx.rng = b.ctx.rng = { next: () => 0.25 };
    tick(a, [wave(source)]); tick(b, [wave(source)]);
    const normal = a.state.vision.cues[0], apex = b.state.vision.cues[0];
    expect(normal.kind).toBe('siren'); expect(apex.kind).toBe('siren');
    expect(distance(apex.pos, source)).toBeCloseTo(distance(normal.pos, source) * BALANCE.vision.reinforcementFuzzFactor);
    expect(normal.awareness).toBe('heard'); expect(apex.pos).not.toEqual(source);
    tick(a, [], normal.ttl); expect(a.state.vision.cues).toEqual([]);
  });

  it('senses living active crowds at crowdScanHz without adding targetable humans', () => {
    const sim = fixture();
    for (let i = 0; i < BALANCE.senses.crowdMinHumans - 1; i++) human(sim, 62 + i, 5);
    human(sim, 65, 5, { hp: 0 }); human(sim, 65, 5, { state: 'DEAD' }); human(sim, 65, 5, { dormant: true });
    tick(sim, [], 0); expect(sim.state.vision.cues).toHaveLength(0);
    human(sim, 66, 5); tick(sim, [], 0.5); expect(sim.state.vision.cues).toHaveLength(0);
    tick(sim, [], 0.5);
    expect(sim.state.vision.cues).toHaveLength(1);
    const cue = sim.state.vision.cues[0]; expect(cue).toMatchObject({ kind: 'crowd', awareness: 'sensed', count: 1 });
    expect(sim.state.vision.identified).toEqual([]); expect(sim.state.vision.seen).toEqual([]);
    tick(sim, [], 1); expect(cue.count).toBe(2);
    for (const g of sim.state.guards) g.hp = 0;
    tick(sim, [], cue.ttl); expect(sim.state.vision.cues).toEqual([]);
  });

  it('evicts siren/scent cues before gunshot warnings when the cap is reached', () => {
    const sim = fixture();
    tick(sim, [wave({ x: 0, z: 30 })]);
    const sirenId = sim.state.vision.cues[0].id;
    for (let i = 0; i < BALANCE.senses.maxCues; i++) {
      const angle = i * Math.PI * 2 / BALANCE.senses.maxCues;
      tick(sim, [shot(human(sim, Math.cos(angle) * 130, Math.sin(angle) * 130))]);
    }
    expect(sim.state.vision.cues).toHaveLength(BALANCE.senses.maxCues);
    expect(sim.state.vision.cues.some(c => c.id === sirenId)).toBe(false);
    expect(sim.state.vision.cues.every(c => c.kind === 'gunshot')).toBe(true);
  });

  it('keeps separate crowd cells below threshold and rejects crowds within sight or beyond range', () => {
    const sim = fixture();
    for (const x of [5, 35, 65, 125]) for (let i = 0; i < 5; i++) human(sim, x + i, 2);
    tick(sim); expect(sim.state.vision.cues).toEqual([]);
    human(sim, 8, 2); human(sim, 127, 2);
    tick(sim, [], 1); expect(sim.state.vision.cues).toEqual([]);
  });

  it('produces deterministic cues for the same seed and event stream', () => {
    const a = fixture(), b = fixture();
    for (const sim of [a, b]) {
      const g = human(sim, 60), civ = human(sim, -50, 0, { role: 'civilian' }); tick(sim);
      civ.state = 'RETREAT'; tick(sim, [shot(g), wave({ x: 150, z: 0 })]);
    }
    expect(a.state.vision).toEqual(b.state.vision); expect(a.drainEvents()).toEqual(b.drainEvents());
  });
});
