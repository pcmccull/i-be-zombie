// EW-T010: AwarenessSystem wired into the real open-world Simulation (pure, no WebGL).
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { SimInput, Vec2 } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createSave } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { isIdentified, isWorldPositionInSight, visionProfile } from '../src/systems/AwarenessSystem';
import { buildDistrictLayout } from '../src/world/districtLayout';

const SEED = 4242;
const dt = BALANCE.sim.fixedDt;
const layout = buildDistrictLayout();
const yieldLoop = () => new Promise<void>(r => setTimeout(r, 0));

function place(sim: Simulation, p: Vec2): void {
  const l = sim.state.leader;
  l.pos.x = l.prevPos.x = p.x; l.pos.z = l.prevPos.z = p.z; l.vel.x = l.vel.z = 0;
}

describe('awareness wired into the open-world Simulation', () => {
  it('updates identified/seen during real steps (always-radius humans are identified, far ones are not)', () => {
    const sim = new Simulation(layout, SEED);
    const s = sim.state;
    const g = s.guards.find(x => x.state !== 'DEAD' && x.strongholdId === null) ?? s.guards[0];
    place(sim, { x: g.pos.x + 2, z: g.pos.z });
    for (let i = 0; i < 30; i++) sim.step(dt, emptyInput());
    expect(isIdentified(s, g.id)).toBe(true);
    expect(s.vision.revision).toBeGreaterThan(0);
    const far = s.guards.filter(x => Math.hypot(x.pos.x - s.leader.pos.x, x.pos.z - s.leader.pos.z) > 120);
    expect(far.length).toBeGreaterThan(0);
    for (const f of far) expect(isIdentified(s, f.id)).toBe(false);
    expect(s.vision.identified).toEqual([...s.vision.identified].sort((a, b) => a - b));
  }, 60_000);

  it('is independent of any camera value', () => {
    expect(Object.keys(emptyInput()).filter(k => /zoom|camera/i.test(k))).toEqual(['cameraYaw']);
    const run = (yaw: number) => {
      const sim = new Simulation(layout, SEED);
      place(sim, { x: sim.state.guards[0].pos.x + 8, z: sim.state.guards[0].pos.z });
      for (let i = 0; i < 180; i++) sim.step(dt, { ...emptyInput(), cameraYaw: yaw });
      return sim.state.vision;
    };
    const a = run(0), b = run(2.4);
    expect(a.identified).toEqual(b.identified);
    expect(a.seen).toEqual(b.seen);
    expect(a.revision).toBe(b.revision);
    expect(a.identified.length).toBeGreaterThan(0);
  }, 60_000);

  it('buyVision at a nest raises the tier and the clear radius grows', () => {
    const sim = new Simulation(layout, SEED);
    const s = sim.state, nest = layout.nests.find(n => n.id === 'nest_start')!;
    place(sim, nest.pos);
    s.progression.biomass = 100;
    const p = { x: nest.pos.x + 22, z: nest.pos.z };
    sim.step(dt, emptyInput());
    expect(s.vision.tier).toBe(1);
    const before = visionProfile(1).clearRadius;
    expect(Math.hypot(p.x - s.leader.pos.x, p.z - s.leader.pos.z)).toBeGreaterThan(before);
    expect(isWorldPositionInSight(s, p)).toBe(false);
    const buy: SimInput = { ...emptyInput(), buyVision: true };
    sim.step(dt, buy);
    expect(s.progression.visionTier).toBe(2);
    sim.step(dt, emptyInput());
    expect(s.vision.tier).toBe(2);
    expect(visionProfile(2).clearRadius).toBeGreaterThan(before);
    expect(isWorldPositionInSight(s, p)).toBe(true);
    expect(s.progression.biomass).toBe(100 - BALANCE.vision.tierCosts[1]);
  }, 60_000);

  it('keeps the tier across save -> load', () => {
    const a = new Simulation(layout, SEED);
    a.state.progression.visionTier = 3;
    for (let i = 0; i < 10; i++) a.step(dt, emptyInput());
    const save = createSave(a.state, SEED);
    const b = new Simulation(layout, SEED, JSON.parse(JSON.stringify(save)));
    expect(b.state.progression.visionTier).toBe(3);
    b.step(dt, emptyInput());
    expect(b.state.vision.tier).toBe(3);
  }, 60_000);

  it('two sim-minutes of roaming keep revision, cues and step time bounded', async () => {
    const sim = new Simulation(layout, SEED);
    const s = sim.state;
    const steps = 2 * 60 * 60;
    let worst = 0, total = 0, maxCues = 0;
    for (let i = 0; i < steps; i++) {
      const input = emptyInput();
      input.cameraYaw = 0; input.moveForward = Math.cos(i / 300) ; input.moveRight = Math.sin(i / 300);
      const t0 = performance.now();
      sim.step(dt, input);
      const ms = performance.now() - t0;
      total += ms; worst = Math.max(worst, ms);
      maxCues = Math.max(maxCues, s.vision.cues.length);
      s.horde.coreDamage = 0; s.horde.lastBrain.active = false;
      if (i % 600 === 599) await yieldLoop();
    }
    expect(maxCues).toBeLessThanOrEqual(BALANCE.senses.maxCues);
    // Revision only changes with contents: at most a few changes per 5 Hz scan.
    expect(s.vision.revision).toBeLessThanOrEqual(steps / 12 * 3);
    expect(s.vision.identified.length + s.vision.seen.length).toBeLessThan(s.guards.length);
    expect(total / steps).toBeLessThan(15);
    // The average is the real budget; the single worst step only guards against runaway spikes (a GC pause or the
    // scheduler under the parallel suite with other sessions running can stall one step for ~1 s).
    expect(worst).toBeLessThan(2000);
  }, 120_000);
});
