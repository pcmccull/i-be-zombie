// Nest teleport: at an active nest V opens the nest map (nestTravelMenu); picking another active nest sends the Alpha
// and the whole horde into the hole, and after BALANCE.nest.teleportTime everyone crawls out of the destination nest.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput, type GameEvent, type NestDef, type SimInput, type StrongholdId } from '../src/core/types';
import { Simulation } from '../src/sim/Simulation';
import { damageGuard } from '../src/systems/CombatSystem';
import { updateConquest } from '../src/systems/ConquestSystem';
import { diveProgress, diveStartTime } from '../src/systems/NestTravelSystem';
import { nestTeleportDestinations, nestTeleportSource } from '../src/systems/nests';
import { damageStructure, findStructure } from '../src/systems/StructureSystem';
import { interactPrompt } from '../src/ui/hudModel';
import { animateZombie, createAnimInput, createAnimState, EMERGE_BURIED_Y } from '../src/visuals/zombieAnimation';
import { alphaProfile } from '../src/visuals/zombieProfiles';
import { createPose, RIG } from '../src/visuals/zombieRig';
import { buildDistrictLayout } from '../src/world/districtLayout';

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;
const startNest = layout.nests.find(n => n.id === 'nest_start')!;
const followers = (sim: Simulation) => sim.state.zombies.filter(z => z.state === 'follower' && z.hp > 0);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function forceCapture(sim: Simulation, id: StrongholdId): void {
  const def = sim.ctx.layout.strongholds.find(s => s.id === id)!;
  for (const obj of def.objectives) {
    if (obj.kind === 'destroyStructure') { const s = findStructure(sim.state, obj.structureId!)!; damageStructure(sim.ctx, s, s.hp); }
  }
  for (const g of sim.state.guards) if (g.strongholdId === id && g.role !== 'civilian' && g.hp > 0) damageGuard(sim.ctx, g, g.hp, 'other');
  updateConquest(sim.ctx, dt);
  sim.drainEvents();
}

function run(sim: Simulation, seconds: number, input: Partial<SimInput> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    sim.step(dt, { ...emptyInput(), ...input });
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Claimed start nest (10 followers, crawled out) + one captured stronghold nest; the Alpha stands at the start nest. */
function setup(): { sim: Simulation; dest: NestDef } {
  const sim = new Simulation(layout);
  const l = sim.state.leader;
  l.pos = { ...startNest.pos }; l.prevPos = { ...startNest.pos };
  run(sim, dt);
  const id = layout.strongholds[0].id;
  forceCapture(sim, id);
  const dest = layout.nests.find(n => n.strongholdId === id)!;
  run(sim, BALANCE.respawn.emergeTime * (1 + BALANCE.respawn.emergeStagger) + 0.2);
  l.pos = { x: startNest.pos.x + 3, z: startNest.pos.z }; l.prevPos = { ...l.pos };
  return { sim, dest };
}

describe('nest teleport', () => {
  it('offers the teleport only at an active nest with another active nest to go to', () => {
    const sim = new Simulation(layout);
    const l = sim.state.leader;
    l.pos = { ...startNest.pos }; l.prevPos = { ...startNest.pos };
    run(sim, dt);
    expect(sim.state.claimedNests).toContain(startNest.id);
    expect(nestTeleportSource(sim.state, layout)).toBeNull(); // only one active nest
    forceCapture(sim, layout.strongholds[0].id);
    expect(nestTeleportSource(sim.state, layout)?.id).toBe(startNest.id);
    expect(interactPrompt(sim.state, layout)).toBe('Teleport to another nest');
    expect(nestTeleportDestinations(sim.state, layout, startNest.id).map(n => n.strongholdId)).toEqual([layout.strongholds[0].id]);
    l.pos = { x: startNest.pos.x + BALANCE.nest.equipRadius + 2, z: startNest.pos.z };
    expect(nestTeleportSource(sim.state, layout)).toBeNull();
  });

  it('V at the nest opens the nest map instead of doing anything else', () => {
    const { sim } = setup();
    const events = run(sim, dt, { interact: true });
    expect(events).toContainEqual({ type: 'nestTravelMenu', nestId: startNest.id });
    expect(events.some(e => e.type === 'worldInteractable')).toBe(false);
    expect(sim.state.nestTravel).toBeNull();
  });

  it('dives the Alpha and the whole horde into the nest and crawls them out of the destination', () => {
    const { sim, dest } = setup();
    const count = sim.state.followerCount;
    expect(count).toBeGreaterThan(0);
    const started = run(sim, dt, { nestTeleport: dest.id });
    expect(started.find(e => e.type === 'nestTravelStarted')).toMatchObject({ fromNestId: startNest.id, toNestId: dest.id, count });
    expect(sim.state.nestTravel).not.toBeNull();

    // Mid-dive: movement input is ignored and everyone heads for the hole; nobody fights.
    run(sim, 0.5, { moveForward: 1, attack: true });
    expect(sim.state.nestTravel).not.toBeNull();
    expect(dist(sim.state.leader.pos, startNest.pos)).toBeLessThan(BALANCE.nest.teleportHoleRadius);
    for (const z of followers(sim)) expect(z.engageTarget).toBeNull();

    // Once everyone is in the hole the party arrives after one dive, before the full teleportTime.
    const arrived: GameEvent[] = [];
    let elapsed = 0.5 + dt;
    while (sim.state.nestTravel && elapsed < BALANCE.nest.teleportTime + 0.2) { arrived.push(...run(sim, dt)); elapsed += dt; }
    expect(sim.state.nestTravel).toBeNull();
    expect(elapsed).toBeLessThan(BALANCE.nest.teleportTime);
    expect(arrived.find(e => e.type === 'nestTravelArrived')).toMatchObject({ nestId: dest.id, count });
    expect(arrived.some(e => e.type === 'leaderEmerge')).toBe(true);
    expect(sim.state.nestTravel).toBeNull();
    expect(sim.state.followerCount).toBe(count);
    expect(dist(sim.state.leader.pos, dest.pos)).toBeLessThan(BALANCE.respawn.emergeOffset + 1);
    expect(sim.state.leader.emergeTimer).toBeGreaterThan(0);
    for (const z of followers(sim)) {
      expect(dist(z.pos, dest.pos)).toBeLessThan(BALANCE.walker.followRingMax + 1);
      expect(z.emergeTimer).toBeGreaterThan(0);
    }
    // After crawling out the Alpha moves again.
    run(sim, BALANCE.respawn.emergeTime + 0.1);
    const before = { ...sim.state.leader.pos };
    run(sim, 0.5, { moveForward: 1 });
    expect(dist(sim.state.leader.pos, before)).toBeGreaterThan(0.5);
  });

  it('refuses inactive or same-nest destinations and teleports from away from a nest', () => {
    const { sim, dest } = setup();
    const inactive = layout.nests.find(n => n.strongholdId !== null && n.id !== dest.id)!;
    run(sim, dt, { nestTeleport: inactive.id });
    expect(sim.state.nestTravel).toBeNull();
    run(sim, dt, { nestTeleport: startNest.id });
    expect(sim.state.nestTravel).toBeNull();
    const l = sim.state.leader;
    l.pos = { x: startNest.pos.x + BALANCE.nest.equipRadius + 3, z: startNest.pos.z }; l.prevPos = { ...l.pos };
    run(sim, dt, { nestTeleport: dest.id });
    expect(sim.state.nestTravel).toBeNull();
  });

  it('dive timing: starts at the hole (or when time runs short) and the pose ends fully underground', () => {
    const travel = { fromNestId: 'a', toNestId: 'b', from: { x: 0, z: 0 }, to: { x: 50, z: 0 }, timer: 2, duration: 2.6 };
    expect(diveStartTime(travel, { x: 10, z: 0 }, -1, 5)).toBe(-1);
    expect(diveStartTime(travel, { x: 0.5, z: 0 }, -1, 5)).toBe(5);
    expect(diveStartTime(travel, { x: 0.5, z: 0 }, 4, 5)).toBe(4);
    expect(diveStartTime({ ...travel, timer: BALANCE.nest.teleportDiveTime }, { x: 10, z: 0 }, -1, 5)).toBe(5);
    expect(diveProgress(-1, 5)).toBe(-1);
    expect(diveProgress(5, 5 + BALANCE.nest.teleportDiveTime * 2)).toBe(1);

    const p = alphaProfile(), s = createAnimState(), inp = createAnimInput(), pose = createPose();
    inp.anim = 'run'; inp.speed = 5;
    let peak = -Infinity;
    for (let i = 0; i <= 60; i++) {
      inp.dive = i / 60;
      animateZombie(s, p, inp, pose);
      peak = Math.max(peak, pose.rootY);
    }
    expect(peak).toBeGreaterThan(0.3); // the leap
    expect(pose.rootY + RIG.hipY + 1.6).toBeLessThan(0); // whole body (incl. raised arms) below the ground
    expect(pose.rootY).toBeLessThan(EMERGE_BURIED_Y);
  });
});
