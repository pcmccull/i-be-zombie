// Headless versions of docs/3_open_world.md §10 integration tests (open-world Simulation, scripted SimInput).
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { GameEvent, GuardAgent, SimInput, StrongholdId, Vec2 } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { createSave, parseSave } from '../src/persistence/saveSchema';
import { killLeader } from '../src/systems/CombatSystem';
import { unlockAbility } from '../src/systems/ProgressionSystem';
import { getDistrictAt } from '../src/world/worldQueries';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const dt = BALANCE.sim.fixedDt;
const SEED = 4242;
const layout = buildDistrictLayout();

// ---------------------------------------------------------------- helpers
interface Walker { path: Vec2[]; goalX: number; goalZ: number; age: number }
function newWalker(): Walker { return { path: [], goalX: NaN, goalZ: NaN, age: 1e9 }; }
function dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.z - b.z); }

/** Writes camera-relative move axes (cameraYaw 0: forward=+Z, right=-X) that steer the leader along navGrid paths. */
function steer(sim: Simulation, input: SimInput, goal: Vec2, w: Walker): void {
  const l = sim.state.leader;
  if (w.goalX !== goal.x || w.goalZ !== goal.z || w.age > 20) {
    w.path = sim.ctx.navGrid.findPath(l.pos, goal) ?? [goal]; w.goalX = goal.x; w.goalZ = goal.z; w.age = 0;
  }
  w.age++;
  while (w.path.length > 1 && dist(w.path[0], l.pos) < 1.2) w.path.shift();
  const t = w.path[0] ?? goal, dx = t.x - l.pos.x, dz = t.z - l.pos.z, len = Math.hypot(dx, dz);
  input.cameraYaw = 0;
  if (len > 0.3) { input.moveForward = dz / len; input.moveRight = -dx / len; }
}

class Monitor {
  counts = new Map<string, number>();
  captured: string[] = []; unlocked: string[] = []; minBiomass = Infinity; maxFollowers = 0; maxGuards = 0; maxZombies = 0;
  events: GameEvent[] = [];
  constructor(private readonly sim: Simulation, private readonly keep = false) {}
  sample(): void {
    for (const e of this.sim.drainEvents()) {
      this.counts.set(e.type, (this.counts.get(e.type) ?? 0) + 1);
      if (e.type === 'strongholdCaptured') this.captured.push(e.strongholdId);
      if (e.type === 'abilityUnlocked') this.unlocked.push(e.abilityId);
      if (this.keep) this.events.push(e);
    }
    const s = this.sim.state;
    this.minBiomass = Math.min(this.minBiomass, s.progression.biomass);
    this.maxFollowers = Math.max(this.maxFollowers, s.followerCount);
    this.maxGuards = Math.max(this.maxGuards, s.guards.length);
    this.maxZombies = Math.max(this.maxZombies, s.zombies.length);
  }
  n(type: string): number { return this.counts.get(type) ?? 0; }
}

function runSteps(sim: Simulation, mon: Monitor, steps: number, make: (i: number) => SimInput = () => emptyInput()): void {
  for (let i = 0; i < steps; i++) { sim.step(dt, make(i)); mon.sample(); }
}

function walkablePointNear(sim: Simulation, c: Vec2, minR = 1.5, maxR = 6): Vec2 {
  for (let r = minR; r <= maxR + 20; r += 1) {
    for (let k = 0; k < 16; k++) {
      const p = { x: c.x + Math.cos(k * 0.39) * r, z: c.z + Math.sin(k * 0.39) * r };
      if (!sim.ctx.collision.isBlocked(p, 0.6) && sim.ctx.navGrid.isWalkable(p)) return p;
    }
  }
  throw new Error('no walkable point near ' + JSON.stringify(c));
}

/** Test helper: adds recruited followers around `c` (capped), keeping followerCount in sync. */
function addFollowers(sim: Simulation, n: number, c: Vec2): number {
  let added = 0;
  const s = sim.state;
  for (let i = 0; i < n && s.followerCount < BALANCE.openWorld.maxFollowers; i++) {
    const p = walkablePointNear(sim, { x: c.x + (i % 7) * 0.2, z: c.z + (i % 5) * 0.2 }, 1 + (i % 4), 6);
    const z = createZombie(sim.ctx.newId(), p, { state: 'follower', variant: i % 6, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
    s.zombies.push(z); s.followerCount++; added++;
  }
  return added;
}

function place(sim: Simulation, p: Vec2): void {
  const l = sim.state.leader;
  l.pos.x = l.prevPos.x = p.x; l.pos.z = l.prevPos.z = p.z; l.vel.x = l.vel.z = 0;
}

function livingDefenders(sim: Simulation, id: StrongholdId): GuardAgent[] {
  return sim.state.guards.filter(g => g.strongholdId === id && g.role !== 'civilian' && g.state !== 'DEAD' && g.hp > 0);
}

/**
 * Scripted conquest: god-mode Alpha (test state only) + topped-up horde follow the real systems:
 * attack the breach structure, kill defenders by attack orders, then hold the objective point.
 */
const yieldLoop = (): Promise<void> => new Promise(r => setTimeout(r, 0)); // keeps vitest's worker RPC alive during long sims
/** The Alpha can only order attacks on identified humans (EW vision gate); scripted runs stand in for the player seeing the target. */
function identify(sim: Simulation, id: number): void {
  const ids = sim.state.vision.identified;
  if (ids.includes(id)) return;
  ids.push(id); ids.sort((a, b) => a - b);
}

/** God-mode: the Alpha's survival is state.horde (core + followers); keep the core full and cancel Last Brain. */
function god(sim: Simulation): void {
  const h = sim.state.horde; h.coreDamage = 0; h.lastBrain.active = false; h.lastBrain.timeLeft = 0;
}

async function capture(sim: Simulation, mon: Monitor, id: StrongholdId, maxSeconds = 240): Promise<number> {
  const def = layout.strongholds.find(s => s.id === id)!, st = sim.state.strongholds.find(s => s.id === id)!;
  const nest = layout.nests.find(n => n.strongholdId === id)!;
  const door = def.objectives.find(o => o.kind === 'destroyStructure')?.structureId;
  const hold = def.objectives.find(o => o.kind === 'holdPoint');
  const gateObjective = def.objectives.some(o => o.kind === 'destroyGate');
  place(sim, nest.pos);
  let lastKey = '';
  for (let i = 0; i < maxSeconds * 60 && !st.captured; i++) {
    const input = emptyInput(), l = sim.state.leader;
    if (l.alive) god(sim);
    if (i % 90 === 0) addFollowers(sim, 40, l.pos);
    if (i % 30 === 0) {
      const breached = gateObjective ? sim.state.gate.destroyed
        : door === undefined || sim.state.structures.find(s => s.id === door)?.destroyed === true;
      const defenders = livingDefenders(sim, id);
      let key: string, cmd: SimInput['hordeCommand'];
      if (!breached) {
        key = 'door';
        cmd = { type: 'attack', target: gateObjective ? { kind: 'gate' } : { kind: 'structure', id: door! }, additive: false };
      } else if (defenders.length > 0 && !st.objectivesDone.includes(hold?.id ?? '')) {
        defenders.sort((a, b) => dist(a.pos, l.pos) - dist(b.pos, l.pos));
        identify(sim, defenders[0].id);
        key = 'g' + defenders[0].id; cmd = { type: 'attack', target: { kind: 'guard', id: defenders[0].id }, additive: false };
        if (dist(defenders[0].pos, l.pos) > 25 && hold) place(sim, hold.point!);
      } else if (hold) {
        key = 'hold'; cmd = { type: 'move', point: hold.point! };
        if (dist(l.pos, hold.point!) > 3) place(sim, hold.point!);
      } else { key = 'none'; cmd = null; }
      if (key !== lastKey || i % 300 === 0) { input.hordeCommand = cmd; lastKey = key; }
    }
    sim.step(dt, input); mon.sample();
    if (i % 600 === 599) await yieldLoop();
    if (sim.state.phase !== 'playing') break;
    if (st.captured) return i * dt;
  }
  return st.captured ? sim.state.time : -1;
}

// Shared (lazily computed) mall capture used by items 8 and 9.
let mallRun: { sim: Simulation; mon: Monitor; seconds: number } | null = null;
async function mallCaptured(): Promise<{ sim: Simulation; mon: Monitor; seconds: number }> {
  if (!mallRun) {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim);
    const seconds = await capture(sim, mon, 'mall_security');
    mallRun = { sim, mon, seconds };
  }
  return mallRun;
}

// ---------------------------------------------------------------- tests
describe('open-world integration (spec §10)', () => {
  it('item 1: seamless city - walks from the suburbs to every stronghold area in one continuous simulation', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim);
    expect(sim.state.phase).toBe('playing');
    const ctxBefore = sim.ctx, stateBefore = sim.state;
    const visited: string[] = [];
    const w = newWalker();
    const targets = ['nest_suburb_checkpoint', 'nest_police_station', 'nest_mall_security', 'nest_industrial_yard'];
    let seconds = 0;
    for (const nestId of targets) {
      const goal = layout.nests.find(n => n.id === nestId)!.pos;
      let guard = 0;
      while (dist(sim.state.leader.pos, goal) > 4 && guard++ < 150 * 60) {
        const input = emptyInput(); input.sprint = true;
        god(sim); // god-mode: this test is about continuity, not survival
        steer(sim, input, goal, w);
        sim.step(dt, input); mon.sample();
      }
      expect(dist(sim.state.leader.pos, goal), `reach ${nestId}`).toBeLessThanOrEqual(4);
      visited.push(getDistrictAt(layout, sim.state.leader.pos));
      seconds += guard * dt;
    }
    expect(visited).toEqual(['suburbs', 'police', 'shopping', 'industrial']);
    expect(sim.ctx).toBe(ctxBefore); expect(sim.state).toBe(stateBefore); // no scene/state swap
    expect(sim.state.phase).toBe('playing'); expect(seconds).toBeLessThan(400);
    expect(sim.state.time).toBeCloseTo(seconds, 0);
  }, 240_000);

  it('item 2: fog reveal does not conquer territory', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim, true);
    runSteps(sim, mon, 10);
    const d = sim.state.districts;
    expect(d.suburbs.discovered).toBe(true); expect(d.suburbs.status).toBe('human');
    expect(d.industrial.discovered).toBe(false); expect(d.industrial.status).toBe('unknown');
    const revealed = sim.state.discovery.revealed;
    place(sim, { x: 120, z: -90 }); // industrial approach
    runSteps(sim, mon, 30);
    expect(sim.state.discovery.revealed).toBeGreaterThan(revealed);
    expect(d.industrial.discovered).toBe(true);
    expect(d.industrial.status).toBe('human'); // discovered != infected
    expect(d.industrial.strongholdCaptured).toBe(false);
    expect(sim.state.strongholds.every(s => !s.captured)).toBe(true);
    expect(mon.events.some(e => e.type === 'districtDiscovered' && e.districtId === 'industrial')).toBe(true);
    expect(mon.n('strongholdCaptured')).toBe(0);
  });

  it('item 3: an Alpha-killed civilian rises and joins the horde as a follower', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim);
    const s = sim.state, l = s.leader;
    const civ = s.guards.filter(g => g.role === 'civilian').sort((a, b) => dist(a.pos, l.pos) - dist(b.pos, l.pos))[0];
    const before = s.followerCount, conversions = s.stats.conversions;
    place(sim, walkablePointNear(sim, civ.pos, 1.2, 4));
    let rose = false;
    for (let i = 0; i < 40 * 60 && !rose; i++) {
      const input = emptyInput();
      if (civ.state !== 'DEAD') { input.attack = true; input.aimPoint = { ...civ.pos }; steer(sim, input, civ.pos, newWalker()); input.sprint = true; }
      sim.step(dt, input); mon.sample();
      rose = s.zombies.some(z => z.isConverted && z.state === 'follower');
    }
    expect(civ.state).toBe('DEAD'); expect(civ.killedByAlpha).toBe(true);
    expect(rose).toBe(true);
    expect(s.followerCount).toBeGreaterThan(before - 1); expect(s.stats.conversions).toBeGreaterThan(conversions);
    expect(s.followerCount).toBe(s.zombies.filter(z => z.state === 'follower').length);
    expect(mon.n('conversionStart')).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('item 4: Alpha LMB kills a police officer while taking damage', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim, true);
    const s = sim.state, l = s.leader;
    // A patrol officer with an open sight line to a spot 12 m away (so he can shoot while the Alpha closes in).
    let cop: GuardAgent | undefined, start: Vec2 | undefined;
    for (const g of s.guards) {
      if (g.role !== 'police' || g.post !== 'patrol' || cop) continue;
      for (let k = 0; k < 16 && !cop; k++) {
        const p = { x: g.pos.x + Math.cos(k * 0.39) * 12, z: g.pos.z + Math.sin(k * 0.39) * 12 };
        if (sim.ctx.navGrid.isWalkable(p) && !sim.ctx.collision.segmentBlocked(p, g.pos, { mode: 'sight' })) { cop = g; start = p; }
      }
    }
    expect(cop && start).toBeTruthy();
    s.zombies = []; s.followerCount = 0; // pure 1v1 (no passive recruits to help)
    place(sim, start!);
    cop = cop!;
    
    for (let i = 0; i < 40 * 60 && cop.state !== 'DEAD' && l.alive; i++) {
      const input = emptyInput();
      if (dist(l.pos, cop.pos) < 2.4) { input.attack = true; }
      input.aimPoint = { ...cop.pos };
      steer(sim, input, cop.pos, newWalker());
      sim.step(dt, input); mon.sample();
      if (cop.hp <= 0) break;
    }
    expect(cop.hp).toBeLessThanOrEqual(0); expect(cop.state).toBe('DEAD');
    expect(s.horde.alphaDamageTaken).toBeGreaterThan(0); // took damage on the way in
    expect(mon.n('attackSwing')).toBeGreaterThanOrEqual(1); expect(cop.killedByAlpha).toBe(true);
    expect(mon.events.some(e => e.type === 'guardDied')).toBe(true);
  }, 60_000);

  it('item 5: an attack order sends followers to engage the target', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim);
    const s = sim.state, l = s.leader;
    const cop = s.guards.find(g => g.role === 'police' && g.post === 'patrol')!;
    place(sim, walkablePointNear(sim, { x: cop.pos.x - 22, z: cop.pos.z }, 0, 5));
    s.zombies = s.zombies.filter(z => z.state !== 'follower'); s.followerCount = 0;
    addFollowers(sim, 12, l.pos);
    const startHp = cop.hp, startDist = dist(s.zombies.find(z => z.state === 'follower')!.pos, cop.pos);
    let engaged = false, closer = false;
    for (let i = 0; i < 30 * 60 && cop.state !== 'DEAD'; i++) {
      const input = emptyInput();
      if (i === 5) { identify(sim, cop.id); input.hordeCommand = { type: 'attack', target: { kind: 'guard', id: cop.id }, additive: false }; }
      god(sim);
      sim.step(dt, input); mon.sample();
      if (i === 6) expect(s.order).toEqual({ type: 'attack', target: { kind: 'guard', id: cop.id } });
      for (const z of s.zombies) {
        if (z.state !== 'follower') continue;
        if (z.engageTarget?.kind === 'guard' && z.engageTarget.id === cop.id) engaged = true;
        if (dist(z.pos, cop.pos) < startDist - 8) closer = true;
      }
    }
    expect(engaged).toBe(true); expect(closer).toBe(true);
    expect(cop.hp < startHp || cop.state === 'DEAD').toBe(true);
  }, 60_000);

  it('item 6: capturing the police station completes objectives once and unlocks Alpha Claws exactly once', async () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim, true);
    expect(sim.state.progression.unlocked).not.toContain('alpha_claws');
    const seconds = await capture(sim, mon, 'police_station');
    expect(seconds, 'captured within the time budget').toBeGreaterThan(0);
    const st = sim.state.strongholds.find(x => x.id === 'police_station')!;
    expect(st.captured).toBe(true);
    expect(st.objectivesDone).toEqual(expect.arrayContaining(['breach', 'disable_command']));
    expect(sim.state.districts.police.status).toBe('infected');
    expect(sim.state.districts.police.strongholdCaptured).toBe(true);
    const biomassAtCapture = sim.state.progression.biomass;
    runSteps(sim, mon, 600);
    expect(mon.captured.filter(x => x === 'police_station')).toHaveLength(1);
    expect(mon.unlocked.filter(x => x === 'alpha_claws')).toHaveLength(1);
    expect(sim.state.progression.unlocked.filter(x => x === 'alpha_claws')).toHaveLength(1);
    expect(sim.state.progression.biomass).toBeGreaterThanOrEqual(biomassAtCapture);
    expect(mon.minBiomass).toBeGreaterThanOrEqual(0);
    // Other territory untouched.
    expect(sim.state.strongholds.filter(x => x.captured).map(x => x.id)).toEqual(['police_station']);
    expect(sim.state.districts.shopping.status).not.toBe('infected');
  }, 300_000);

  it('item 7: equips at a nest, uses Claws, Horde Frenzy buffs the horde, Brute Evolution spends biomass for a siege unit', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim, true);
    const s = sim.state, l = s.leader, nest = layout.nests.find(n => n.id === s.activeNestId)!;
    s.progression.slotsOwned = BALANCE.progression.slots; // all four slots owned (slot purchase is covered in slots.test.ts)
    // Rewards only come from capture, so use the unlock helper (the same function ConquestSystem calls).
    for (const id of ['alpha_claws', 'horde_frenzy', 'brute_evolution'] as const) expect(unlockAbility(sim.ctx, id)).toBe(true);
    expect(unlockAbility(sim.ctx, 'alpha_claws')).toBe(false); // idempotent
    place(sim, nest.pos);
    addFollowers(sim, 10, l.pos);
    // Unlocking auto-equips into free slots; far from an active nest the loadout cannot change.
    expect(s.progression.equipped.slice(0, 3)).toEqual(['alpha_claws', 'horde_frenzy', 'brute_evolution']);
    const home = { ...l.pos }; place(sim, { x: nest.pos.x + 60, z: nest.pos.z - 60 });
    sim.step(dt, { ...emptyInput(), equip: { slot: 0, ability: null } }); mon.sample();
    expect(s.progression.equipped[0]).toBe('alpha_claws'); expect(mon.n('abilityDenied')).toBe(1);
    place(sim, home);
    sim.step(dt, { ...emptyInput(), equip: { slot: 3, ability: 'alpha_claws' } }); mon.sample();
    expect(s.progression.equipped).toEqual([null, 'horde_frenzy', 'brute_evolution', 'alpha_claws']);
    expect(mon.n('abilityEquipped')).toBe(1);
    // Claws: LMB presses chain into the 3-hit combo.
    const cop = s.guards.find(g => g.role === 'police' && g.post === 'patrol')!;
    place(sim, walkablePointNear(sim, cop.pos, 1.0, 3)); cop.hp = cop.maxHp = 400;
    let maxCombo = 0;
    for (let i = 0; i < 6 * 60 && cop.state !== 'DEAD'; i++) {
      const input = emptyInput(); input.attack = true; input.aimPoint = { ...cop.pos }; god(sim);
      place(sim, walkablePointNear(sim, cop.pos, 1.0, 1.4));
      sim.step(dt, input); mon.sample(); maxCombo = Math.max(maxCombo, l.comboStep);
    }
    expect(maxCombo).toBe(3);
    // Frenzy.
    place(sim, nest.pos);
    for (const z of s.zombies) z.dormant = z.state === 'follower' ? false : z.dormant;
    sim.step(dt, { ...emptyInput(), abilitySlot: 1 }); mon.sample();
    expect(s.progression.frenzyTimeLeft).toBeGreaterThan(BALANCE.frenzy.duration - 0.5);
    expect(mon.n('frenzyStart')).toBe(1);
    sim.step(dt, { ...emptyInput(), abilitySlot: 1 }); mon.sample(); // on cooldown / already active
    expect(mon.n('frenzyStart')).toBe(1);
    runSteps(sim, mon, Math.ceil((BALANCE.frenzy.duration + 0.5) / dt));
    expect(s.progression.frenzyTimeLeft).toBe(0); expect(mon.n('frenzyEnd')).toBe(1);
    // Brute Evolution: no biomass => denied; with biomass => siege units, biomass spent.
    sim.step(dt, { ...emptyInput(), abilitySlot: 2 }); mon.sample();
    expect(s.zombies.some(z => z.brute)).toBe(false); expect(mon.n('abilityDenied')).toBeGreaterThanOrEqual(2);
    s.progression.biomass = 40;
    const followers = s.followerCount;
    sim.step(dt, { ...emptyInput(), abilitySlot: 2 }); mon.sample();
    const brutes = s.zombies.filter(z => z.brute && z.state === 'follower');
    expect(brutes.length).toBeGreaterThan(0); expect(brutes.length).toBeLessThanOrEqual(BALANCE.brute.maxPerActivation);
    expect(s.progression.biomass).toBe(40 - brutes.length * BALANCE.brute.costPerBrute);
    expect(s.followerCount).toBe(followers); expect(brutes[0].hp).toBeGreaterThan(BALANCE.walker.maxHp);
    expect(mon.minBiomass).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('item 8: the mall can be captured before the police station with coherent rewards and flags', async () => {
    const { sim, mon, seconds } = await mallCaptured();
    expect(seconds).toBeGreaterThan(0);
    const s = sim.state;
    expect(s.strongholds.find(x => x.id === 'mall_security')!.captured).toBe(true);
    expect(s.strongholds.find(x => x.id === 'police_station')!.captured).toBe(false);
    expect(s.progression.unlocked).toContain('horde_frenzy');
    expect(s.progression.unlocked).not.toContain('alpha_claws');
    expect(s.districts.shopping.status).toBe('infected'); expect(s.districts.police.status).not.toBe('infected');
    expect(mon.captured).toEqual(['mall_security']); expect(mon.unlocked).toEqual(['horde_frenzy']);
    expect(s.activeNestId.length).toBeGreaterThan(0);
    expect(mon.minBiomass).toBeGreaterThanOrEqual(0);
  }, 300_000);

  it('industrial yard: breaking the gate and holding the office captures it once (brute_evolution + biomass once)', async () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim, true);
    const biomass0 = sim.state.progression.biomass;
    expect(sim.state.progression.unlocked).not.toContain('brute_evolution');
    const seconds = await capture(sim, mon, 'industrial_yard');
    expect(seconds, 'yard captured within the time budget (no softlock)').toBeGreaterThan(0);
    const st = sim.state.strongholds.find(x => x.id === 'industrial_yard')!;
    expect(st.captured).toBe(true);
    expect(sim.state.gate.destroyed).toBe(true);
    expect(st.objectivesDone).toEqual(expect.arrayContaining(['break_gate', 'take_control']));
    expect(sim.state.districts.industrial.status).toBe('infected');
    const bio = sim.state.progression.biomass;
    runSteps(sim, mon, 600);
    expect(mon.captured.filter(x => x === 'industrial_yard')).toHaveLength(1);
    expect(mon.unlocked.filter(x => x === 'brute_evolution')).toHaveLength(1);
    expect(sim.state.progression.unlocked.filter(x => x === 'brute_evolution')).toHaveLength(1);
    const rewards = mon.events.filter(e => e.type === 'biomassGain' && e.reason === 'capture');
    expect(rewards).toHaveLength(1);
    expect(sim.state.progression.biomass).toBeGreaterThanOrEqual(Math.min(bio, biomass0 + 40));
    // Tower guards that stood down no longer float on the platforms.
    for (const g of sim.state.guards.filter(x => x.strongholdId === 'industrial_yard' && x.role === 'civilian')) {
      expect(g.tower).toBeNull(); expect(g.elevation).toBe(0);
    }
  }, 300_000);

  it('item 9: save -> JSON -> parse -> new Simulation restores discovery, captures, mutations, biomass and nest', async () => {
    const { sim } = await mallCaptured();
    const s = sim.state;
    s.progression.biomass += 7; s.activeNestId = 'nest_mall_security';
    const save = parseSave(JSON.parse(JSON.stringify(createSave(s, SEED, 123))));
    expect(save).not.toBeNull();
    const loaded = new Simulation(layout, SEED, save);
    const t = loaded.state;
    expect(t.progression.biomass).toBe(s.progression.biomass);
    expect(t.progression.unlocked).toEqual(s.progression.unlocked);
    expect(t.progression.equipped).toEqual(s.progression.equipped);
    expect(t.activeNestId).toBe('nest_mall_security');
    expect(t.strongholds.map(x => [x.id, x.captured])).toEqual(s.strongholds.map(x => [x.id, x.captured]));
    expect(t.districts.shopping.status).toBe('infected');
    expect(t.districts.police.status).toBe(s.districts.police.status);
    expect(t.discovery.revealed).toBe(s.discovery.revealed);
    expect(Array.from(t.discovery.bits)).toEqual(Array.from(s.discovery.bits));
    expect(t.structures.find(x => x.id === 6)!.destroyed).toBe(true);
    expect(livingDefenders(loaded, 'mall_security')).toHaveLength(0);
    // Not blank, playable, and the captured base does not reset or pay again.
    expect(t.guards.length).toBeGreaterThan(10); expect(t.zombies.length).toBeGreaterThan(10);
    const mon = new Monitor(loaded);
    runSteps(loaded, mon, 300);
    expect(mon.n('strongholdCaptured')).toBe(0); expect(mon.n('abilityUnlocked')).toBe(0);
    expect(t.strongholds.find(x => x.id === 'mall_security')!.captured).toBe(true);
    expect(loaded.state.phase).toBe('playing');
    // A corrupt save never produces a loaded world: parse yields null, a fresh start is used.
    expect(parseSave({ version: 'x' })).toBeNull();
    expect(new Simulation(layout, SEED, parseSave('garbage')).state.strongholds.every(x => !x.captured)).toBe(true);
    // reset(seed, save) also restores.
    loaded.reset(SEED, null);
    expect(loaded.state.strongholds.every(x => !x.captured)).toBe(true);
    loaded.reset(SEED, save);
    expect(loaded.state.progression.unlocked).toEqual(s.progression.unlocked);
  }, 300_000);

  it('item 10: death respawns at the active nest, keeps progression and the world keeps simulating', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim, true);
    const s = sim.state, l = s.leader;
    unlockAbility(sim.ctx, 'alpha_claws'); s.progression.biomass = 25;
    runSteps(sim, mon, 120);
    const followersBefore = s.followerCount, nest = layout.nests.find(n => n.id === s.activeNestId)!;
    place(sim, { x: nest.pos.x + 20, z: nest.pos.z - 20 });
    killLeader(sim.ctx);
    const t0 = s.time;
    sim.step(dt, emptyInput()); mon.sample();
    expect(s.phase).toBe('respawning'); expect(s.deaths).toBe(1); expect(l.alive).toBe(false);
    runSteps(sim, mon, 60, () => ({ ...emptyInput(), moveForward: 1, attack: true }));
    expect(s.time).toBeGreaterThan(t0 + 0.9); // world kept simulating
    expect(s.phase).toBe('respawning');
    runSteps(sim, mon, Math.ceil(BALANCE.respawn.delay / dt));
    expect(s.phase).toBe('playing'); expect(l.alive).toBe(true); expect(s.horde.coreDamage).toBe(0);
    expect(dist(l.pos, nest.pos)).toBeLessThan(BALANCE.respawn.emergeOffset + 0.5);
    expect(s.progression.biomass).toBe(25); expect(s.progression.unlocked).toContain('alpha_claws');
    expect(s.followerCount).toBeGreaterThanOrEqual(Math.min(followersBefore, BALANCE.respawn.followers));
    expect(s.followerCount).toBe(s.zombies.filter(z => z.state === 'follower').length);
    expect(mon.n('leaderRespawned')).toBe(1); expect(mon.n('victory') + mon.n('defeat')).toBe(0);
    // Can rebuild the horde quickly: standing at the nest tops up toward replenishTarget.
    runSteps(sim, mon, 60 * (BALANCE.nest.replenishInterval * 6));
    expect(s.followerCount).toBeGreaterThanOrEqual(Math.min(BALANCE.nest.replenishTarget, BALANCE.respawn.followers + 2));
  }, 60_000);

  it('opening pacing: a simple scripted opening reaches >= 10 followers within 30 s', () => {
    const sim = new Simulation(layout, SEED), s = sim.state, l = s.leader;
    expect(s.followerCount).toBe(BALANCE.horde.startFollowers);
    const w = newWalker();
    let goal: Vec2 | null = null, replan = 0;
    let at30 = -1;
    for (let i = 0; i < 31 * 60; i++) {
      if (i % 120 === 0 || !goal) {
        replan++;
        const cands: Vec2[] = [];
        for (const g of s.guards) if (g.role === 'civilian' && g.state !== 'DEAD') cands.push(g.pos);
        for (const z of s.zombies) if (z.state === 'ambient' && z.heldBy === 0) cands.push(z.pos);
        cands.sort((a, b) => dist(a, l.pos) - dist(b, l.pos));
        goal = cands.find(c => sim.ctx.navGrid.findPath(l.pos, c) !== null) ?? null;
      }
      const input = emptyInput(); input.sprint = true;
      if (goal) { steer(sim, input, goal, w); input.aimPoint = { ...goal }; input.attack = dist(goal, l.pos) < 2.6; }
      god(sim);
      sim.step(dt, input);
      if (i + 1 === 30 * 60) at30 = s.followerCount;
    }
    // eslint-disable-next-line no-console
    console.log(`[T012] opening followers at 30 s: ${at30} (replans ${replan})`);
    expect(at30).toBeGreaterThanOrEqual(10);
  }, 120_000);

  it('item 11: 10 sim-minutes of roaming keeps guards, zombies and followers bounded', async () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim);
    const s = sim.state, l = s.leader;
    const route = layout.nests.map(n => n.pos);
    const w = newWalker();
    let leg = 0;
    const initialGuards = s.guards.length, initialZombies = s.zombies.length;
    const t = performance.now();
    for (let i = 0; i < 10 * 60 * 60; i++) {
      const goal = route[leg % route.length];
      if (dist(l.pos, goal) < 5) leg++;
      const input = emptyInput(); input.sprint = i % 400 < 300; input.attack = true; input.aimPoint = null;
      if (l.alive) steer(sim, input, route[leg % route.length], w);
      sim.step(dt, input); if (i % 30 === 0) mon.sample(); else sim.drainEvents();
      if (i % 1800 === 1799) await yieldLoop();
    }
    // eslint-disable-next-line no-console
    console.log(`[T012] roam: ${(performance.now() - t).toFixed(0)} ms, guards<=${mon.maxGuards} zombies<=${mon.maxZombies} followers<=${mon.maxFollowers} legs=${leg} deaths=${s.deaths}`);
    // The (pre-claimed) walk-in start nest adds followersPerNest on top of the base cap; this route captures nothing.
    // Recruiting stops at the cap; converted humans may join past it.
    expect(mon.maxFollowers).toBeLessThanOrEqual(BALANCE.openWorld.maxFollowers + BALANCE.openWorld.followersPerNest + s.stats.conversions);
    expect(mon.maxGuards).toBeLessThanOrEqual(BALANCE.population.maxHumans);
    // + the living-city director's own hard-capped humans (docs/11_cityupgrade.md; tests/cityEvents.test.ts).
    expect(mon.maxGuards).toBeLessThanOrEqual(initialGuards + 20 + BALANCE.city.eventMaxHumans);
    expect(mon.maxZombies).toBeLessThanOrEqual(initialZombies + BALANCE.openWorld.maxFollowers + 60);
    expect(s.zombies.filter(z => z.state === 'ambient').length).toBeLessThanOrEqual(BALANCE.population.maxAmbient);
    expect(s.followerCount).toBe(s.zombies.filter(z => z.state === 'follower').length);
    expect(s.guards.length).toBeGreaterThan(0); expect(s.zombies.length).toBeGreaterThan(0); // never a blank world
    expect(mon.minBiomass).toBeGreaterThanOrEqual(0);
    expect(s.time).toBeCloseTo(600, 0);
    expect(leg).toBeGreaterThan(1);
  }, 600_000);

  it('item 12: no duplicate rewards, negative biomass, or victory/defeat phases in the open world', () => {
    const sim = new Simulation(layout, SEED), mon = new Monitor(sim);
    const s = sim.state;
    // Destroying the industrial gate and killing every checkpoint human must NOT end the open-world game.
    s.gate.hp = 0; s.gate.destroyed = true;
    for (const g of s.guards) { g.hp = 0; g.state = 'DEAD'; }
    runSteps(sim, mon, 120);
    expect(s.phase).toBe('playing'); expect(mon.n('victory') + mon.n('defeat')).toBe(0);
    // Biomass can never go negative and unlocks are one-shot.
    expect(unlockAbility(sim.ctx, 'horde_frenzy')).toBe(true);
    expect(unlockAbility(sim.ctx, 'horde_frenzy')).toBe(false);
    expect(s.progression.unlocked.filter(x => x === 'horde_frenzy')).toHaveLength(1);
    s.progression.equipped[0] = 'brute_evolution';
    sim.step(dt, { ...emptyInput(), abilitySlot: 0 });
    expect(s.progression.biomass).toBeGreaterThanOrEqual(0);
  });
});
