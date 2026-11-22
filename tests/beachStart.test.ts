// Beach start: the Alpha begins alone on the suburbs beach with no horde (base cap 0). Walking into the walk-in nest by
// the bus claims it and raises BALANCE.openWorld.firstNestHorde (10) free followers; stronghold nests then add cap only.
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput, type GameEvent, type StrongholdId, type Vec2 } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { applySave, createSave, parseSave } from '../src/persistence/saveSchema';
import { Simulation } from '../src/sim/Simulation';
import { damageGuard, killLeader } from '../src/systems/CombatSystem';
import { isNestActive, updateConquest } from '../src/systems/ConquestSystem';
import { followerCap } from '../src/systems/HordeSystem';
import { damageStructure, findStructure } from '../src/systems/StructureSystem';
import { bannerForEvent, hordeMilestone, hordeView, objectiveView } from '../src/ui/hudModel';
import { buildDistrictLayout, START_BEACH } from '../src/world/districtLayout';
import { buildLegacyDistrictLayout } from '../src/world/legacyDistrictLayout';

const layout = buildDistrictLayout();
const dt = BALANCE.sim.fixedDt;
const startNest = layout.nests.find(n => n.id === 'nest_start')!;
const busDoor = layout.structures.find(s => s.landmark === 'bus')!;
const followers = (sim: Simulation) => sim.state.zombies.filter(z => z.state === 'follower');

/** Completes every objective of a destroy/kill stronghold directly and runs one conquest tick. */
function forceCapture(sim: Simulation, id: StrongholdId): GameEvent[] {
  const def = sim.ctx.layout.strongholds.find(s => s.id === id)!;
  for (const obj of def.objectives) {
    if (obj.kind === 'destroyStructure') { const s = findStructure(sim.state, obj.structureId!)!; damageStructure(sim.ctx, s, s.hp); }
  }
  for (const g of sim.state.guards) if (g.strongholdId === id && g.role !== 'civilian' && g.hp > 0) damageGuard(sim.ctx, g, g.hp, 'other');
  sim.drainEvents();
  updateConquest(sim.ctx, dt);
  expect(sim.state.strongholds.find(s => s.id === id)!.captured).toBe(true);
  return sim.drainEvents();
}

/** Steers the Alpha straight at `goal` (camera-relative W) until within `reach` or `seconds` pass. Returns all events. */
function walkTo(sim: Simulation, goal: Vec2, reach: number, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const l = sim.state.leader, dx = goal.x - l.pos.x, dz = goal.z - l.pos.z;
    if (Math.hypot(dx, dz) <= reach) break;
    sim.step(dt, { ...emptyInput(), cameraYaw: Math.atan2(dx, dz), moveForward: 1 });
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Puts the Alpha on the nest and runs one step (claims it). */
function claim(sim: Simulation): GameEvent[] {
  const l = sim.state.leader;
  l.pos = { ...startNest.pos }; l.prevPos = { ...startNest.pos };
  sim.drainEvents();
  sim.step(dt, emptyInput());
  return sim.drainEvents();
}

describe('beach start', () => {
  it('starts the Alpha alone on walkable sand, with the unclaimed nest a short walk away by the bus', () => {
    const sim = new Simulation(layout);
    const p = sim.state.leader.pos;
    expect(p.x).toBeGreaterThan(START_BEACH.minX); expect(p.x).toBeLessThan(START_BEACH.maxX);
    expect(p.z).toBeGreaterThan(START_BEACH.minZ); expect(p.z).toBeLessThan(START_BEACH.maxZ);
    expect(layout.ground.some(g => g.kind === 'sand' && p.x >= g.rect.minX && p.x <= g.rect.maxX &&
      p.z >= g.rect.minZ && p.z <= g.rect.maxZ)).toBe(true);
    expect(sim.ctx.collision.isBlocked(p, sim.state.leader.radius)).toBe(false);
    expect(sim.ctx.navGrid.isWalkable(p)).toBe(true);

    expect(startNest.claim).toBe(true);
    expect(sim.ctx.navGrid.isWalkable(startNest.pos)).toBe(true);
    expect(sim.ctx.collision.isBlocked(startNest.pos, sim.state.leader.radius)).toBe(false);
    const b = busDoor.enclosure;
    const toBus = Math.hypot(Math.max(b.minX - startNest.pos.x, 0, startNest.pos.x - b.maxX), Math.max(b.minZ - startNest.pos.z, 0, startNest.pos.z - b.maxZ));
    expect(toBus).toBeLessThan(10);
    expect(Math.hypot(startNest.pos.x - p.x, startNest.pos.z - p.z)).toBeLessThan(50);
    expect(isNestActive(sim.ctx, startNest.id)).toBe(false);

    expect(followers(sim)).toHaveLength(0);
    expect(sim.state.followerCount).toBe(0);
    expect(followerCap(sim.ctx)).toBe(0);
    expect(hordeView(sim.state, followerCap(sim.ctx))).toMatchObject({ mode: 'none', label: 'Go to the nest', icon: 'nest' });
    expect(objectiveView(layout, sim.state)).toMatchObject({ kind: 'nest', title: 'Claim the nest', target: startNest.pos });
  });

  it('cannot recruit before the nest is claimed, even standing among ambient zombies', () => {
    const sim = new Simulation(layout);
    const l = sim.state.leader.pos;
    for (let i = 0; i < 6; i++) {
      sim.state.zombies.push(createZombie(sim.ctx.newId(), { x: l.x + 1.5 + i * 0.6, z: l.z - 1.5 },
        { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng }));
    }
    for (let i = 0; i < 120; i++) sim.step(dt, emptyInput());
    expect(sim.state.followerCount).toBe(0);
  });

  it('walking from the beach into the nest by the bus claims it and raises a horde of 10, once', () => {
    const sim = new Simulation(layout);
    const events = walkTo(sim, startNest.pos, 0.5, 30);
    const unlocked = events.filter(e => e.type === 'hordeUnlocked');
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]).toMatchObject({ count: BALANCE.openWorld.firstNestHorde, cap: BALANCE.openWorld.followersPerNest });
    expect(events.some(e => e.type === 'nestActivated' && e.nestId === startNest.id)).toBe(true);
    expect(sim.state.claimedNests).toEqual([startNest.id]);
    expect(isNestActive(sim.ctx, startNest.id)).toBe(true);
    expect(sim.state.activeNestId).toBe(startNest.id);
    expect(sim.state.followerCount).toBe(10);
    expect(followerCap(sim.ctx)).toBe(10);
    expect(sim.state.stats.recruited).toBe(0); // free nest followers, not recruitment
    expect(objectiveView(layout, sim.state).kind).not.toBe('nest');
    expect(bannerForEvent(unlocked[0], 0)).toMatchObject({ title: 'HORDE UNLOCKED!', sub: '10 zombies rise to follow you' });
    expect(hordeMilestone(10, 10, 10)).toBeNull(); // HUD raises bestFollowers on hordeUnlocked: no MAXIMUM HORDE on top

    // Walking out and back in never grants again.
    walkTo(sim, { x: startNest.pos.x, z: startNest.pos.z + 12 }, 0.5, 10);
    expect(walkTo(sim, startNest.pos, 0.5, 10).some(e => e.type === 'hordeUnlocked')).toBe(false);
  });

  it('stronghold nests only add cap; capturing one first gives no free horde', () => {
    const sim = new Simulation(layout);
    expect(forceCapture(sim, 'suburb_checkpoint').some(e => e.type === 'hordeUnlocked')).toBe(false);
    expect(sim.state.followerCount).toBe(0);
    expect(followerCap(sim.ctx)).toBe(10);
    expect(objectiveView(layout, sim.state).kind).toBe('nest'); // still told to claim the nest
    expect(claim(sim).some(e => e.type === 'hordeUnlocked')).toBe(true);
    expect(sim.state.followerCount).toBe(10);
    expect(followerCap(sim.ctx)).toBe(20);
  });

  it('dying before the nest is claimed rises again on the beach, still alone', () => {
    const sim = new Simulation(layout);
    walkTo(sim, { x: -140, z: 140 }, 1, 10);
    killLeader(sim.ctx);
    for (let t = 0; t < BALANCE.respawn.delay + 1; t += dt) sim.step(dt, emptyInput());
    expect(sim.state.phase).toBe('playing');
    expect(sim.state.leader.alive).toBe(true);
    const p = sim.state.leader.pos;
    expect(Math.hypot(p.x - layout.playerStart.x, p.z - layout.playerStart.z)).toBeLessThan(3);
    expect(sim.state.followerCount).toBe(0);
  });

  it('after claiming, death respawns at the nest by the bus', () => {
    const sim = new Simulation(layout);
    claim(sim);
    killLeader(sim.ctx);
    for (let t = 0; t < BALANCE.respawn.delay + 1; t += dt) sim.step(dt, emptyInput());
    const p = sim.state.leader.pos;
    expect(Math.hypot(p.x - startNest.pos.x, p.z - startNest.pos.z)).toBeLessThan(BALANCE.respawn.emergeOffset + 1);
  });

  it('saves the claim; an older save with a captured stronghold counts as claimed', () => {
    const src = new Simulation(layout);
    claim(src);
    const save = parseSave(JSON.parse(JSON.stringify(createSave(src.state, 7))))!;
    expect(save.player.claimedNests).toEqual([startNest.id]);
    const dst = new Simulation(layout, 7);
    applySave(dst.ctx, save);
    expect(dst.state.claimedNests).toEqual([startNest.id]);
    expect(followerCap(dst.ctx)).toBe(10);
    const p = dst.state.leader.pos;
    expect(Math.hypot(p.x - startNest.pos.x, p.z - startNest.pos.z)).toBeLessThan(BALANCE.respawn.emergeOffset + 1);

    // Unclaimed save: the leader goes back to the beach, not to the dormant nest.
    const fresh = parseSave(JSON.parse(JSON.stringify(createSave(new Simulation(layout).state, 7))))!;
    const back = new Simulation(layout, 7);
    applySave(back.ctx, fresh);
    expect(back.state.claimedNests).toEqual([]);
    expect(Math.hypot(back.state.leader.pos.x - layout.playerStart.x, back.state.leader.pos.z - layout.playerStart.z)).toBeLessThan(3);

    // v3 save written before claims existed.
    const old = createSave(new Simulation(layout).state, 7) as unknown as { player: Record<string, unknown>; strongholds: Record<string, { captured: boolean }> };
    delete old.player.claimedNests;
    old.strongholds.suburb_checkpoint.captured = true;
    const migrated = new Simulation(layout, 7);
    applySave(migrated.ctx, parseSave(JSON.parse(JSON.stringify(old)))!);
    expect(migrated.state.claimedNests).toEqual([startNest.id]);
  });

  it('the lone Alpha can still take the first checkpoint (pen + 3 police) in a scripted fight', () => {
    const sim = new Simulation(layout, 1), s = sim.state;
    const def = layout.strongholds.find(d => d.id === 'suburb_checkpoint')!;
    const pen = findStructure(s, def.objectives[0].structureId!)!;
    s.leader.pos = { x: -84, z: 100 }; s.leader.prevPos = { ...s.leader.pos }; // clear approach to the pen door
    const sh = s.strongholds.find(x => x.id === 'suburb_checkpoint')!;
    for (let t = 0; t < 60 && !sh.captured; t += dt) {
      const L = s.leader, input = emptyInput();
      expect(L.alive).toBe(true);
      let target: Vec2, reach = 1.6;
      if (!pen.destroyed) { target = { x: pen.rect.minX - 0.6, z: (pen.rect.minZ + pen.rect.maxZ) / 2 }; reach = 0.8; }
      else {
        const police = s.guards.filter(g => g.strongholdId === def.id && g.role !== 'civilian' && g.hp > 0 && g.state !== 'DEAD')
          .sort((a, b) => Math.hypot(a.pos.x - L.pos.x, a.pos.z - L.pos.z) - Math.hypot(b.pos.x - L.pos.x, b.pos.z - L.pos.z));
        target = police[0]?.pos ?? L.pos;
      }
      const dx = target.x - L.pos.x, dz = target.z - L.pos.z;
      input.cameraYaw = Math.atan2(dx, dz);
      if (Math.hypot(dx, dz) > reach) input.moveForward = 1;
      input.attack = Math.round(t / dt) % 6 === 0;
      input.aimPoint = pen.destroyed ? { ...target } : { x: pen.rect.minX, z: target.z };
      sim.step(dt, input); sim.drainEvents();
    }
    expect(sh.captured).toBe(true);
  }, 30_000);

  it('leaves the legacy district economy alone (5 start followers, always-on start nest)', () => {
    const sim = new Simulation(buildLegacyDistrictLayout());
    expect(sim.state.followerCount).toBe(BALANCE.horde.startFollowers);
    expect(isNestActive(sim.ctx, 'start')).toBe(true);
  });
});
