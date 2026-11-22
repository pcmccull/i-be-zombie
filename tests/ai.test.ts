import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { GameEvent, StrongholdId, Vec2 } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { createGuard } from '../src/entities/HumanGuard';
import { Simulation } from '../src/sim/Simulation';
import { damageGate, damageGuard, damageZombie } from '../src/systems/CombatSystem';
import { recruitZombie } from '../src/systems/HordeSystem';
import { updateHumanAI } from '../src/systems/HumanAISystem';
import { flatSimulation, zombie } from './r2-fixtures';
import { buildDistrictLayout } from '../src/world/districtLayout';

const dt = BALANCE.sim.fixedDt, input = emptyInput();
function add(sim: Simulation, pos: Vec2, follower = true, rising = false) {
  const z = createZombie(sim.ctx.newId(), pos, { state: rising ? 'rising' : 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z); if (follower && !rising) recruitZombie(sim.ctx, z, false); return z;
}
function fixture(index = 5) {
  const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
  sim.state.leader.pos = { x: -45, z: 30 };
  const g = sim.state.guards[index];
  for (const other of sim.state.guards) if (other !== g) damageGuard(sim.ctx, other, 50, 'other');
  sim.ctx.rng = { next: () => 0.99 }; sim.drainEvents();
  return { sim, g };
}
// Direct AI stepping holds the targets fixed, isolating perception/LOS from horde steering.
function run(sim: Simulation, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.ctx.zombieHash.clear();
    for (const z of sim.state.zombies) if (z.state !== 'dead') sim.ctx.zombieHash.insert(z.id, z.pos.x, z.pos.z);
    updateHumanAI(sim.ctx, dt, input); sim.state.time += dt;
    for (const g of sim.state.guards) { g.animTime += dt; g.hitFlash = Math.max(0, g.hitFlash - dt); }
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('guard perception and LOS: design §15.9', () => {
  it.each([0, 5])('guard %i cannot shoot through a real building for five seconds, even with an existing combat target', index => {
    const { sim, g } = fixture(index);
    g.pos = { x: -21, z: 0 }; g.state = 'COMBAT';
    const z = add(sim, { x: -34, z: 0 }); g.target = { kind: 'zombie', id: z.id };
    expect(sim.ctx.collision.segmentBlocked(g.pos, z.pos, { mode: 'sight' })).toBe(true);
    expect(run(sim, 5).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(z.hp).toBe(40);
  });

  it('ground guards see through the gate gap only after destruction', () => {
    const { sim, g } = fixture(2); g.waypoints = [{ ...g.pos }];
    const z = add(sim, { x: 83, z: -48 });
    expect(run(sim, 5).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(g.target).toBeNull();
    damageGate(sim.ctx, BALANCE.gate.maxHp); g.facing = 0; sim.drainEvents();
    const shots = run(sim, 2).filter(e => e.type === 'shot');
    expect(shots.length).toBeGreaterThan(0); expect(g.target).toEqual({ kind: 'zombie', id: z.id });
  });

  it('tower guards fire over the compound wall while holding their elevated position', () => {
    const { sim, g } = fixture(0), pos = { ...g.pos };
    const z = add(sim, { x: 70, z: -43 });
    expect(sim.ctx.collision.segmentBlocked(g.pos, z.pos, { mode: 'sight', fromHeight: 1.5, toHeight: 1.1 })).toBe(true);
    const shots = run(sim, 2).filter(e => e.type === 'shot');
    expect(shots.length).toBeGreaterThan(0); expect(g.pos).toEqual(pos);
    for (const shot of shots) if (shot.type === 'shot') {
      expect(shot.from.y).toBeCloseTo(g.elevation + BALANCE.guard.eyeHeight - 0.1);
      expect(shot.to.y).toBe(1.1); expect(shot.hit).toBe(false);
      expect(Math.hypot(shot.to.x - z.pos.x, shot.to.z - z.pos.z)).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('checks LOS at fire time between staggered perception ticks', () => {
    const { sim, g } = fixture(); g.pos = { x: -21, z: 0 }; g.state = 'COMBAT';
    const z = add(sim, { x: -21, z: 4 });
    g.target = { kind: 'zombie', id: z.id }; run(sim, 0.2);
    g.attackCooldown = 0; g.perceptionTimer = 1;
    z.pos = { x: -34, z: 0 }; sim.drainEvents();
    expect(run(sim, dt).filter(e => e.type === 'shot')).toHaveLength(0);
  });

  it('uses a PATROL cone, ignores distant ambient/rising/dead zombies, and sees all around when alert', () => {
    const { sim, g } = fixture(); g.pos = { x: -80, z: 60 }; g.waypoints = [{ ...g.pos }]; g.facing = 0;
    const behind = add(sim, { x: -80, z: 50 });
    add(sim, { x: -80, z: 70 }, false); add(sim, { x: -80, z: 65 }, false, true);
    const dead = add(sim, { x: -80, z: 63 }); damageZombie(sim.ctx, dead, 40); sim.drainEvents();
    run(sim, 0.15); expect(g.target).toBeNull(); expect(g.state).toBe('PATROL');
    g.state = 'ALERT'; g.stateTime = 0;
    run(sim, 0.7); expect(g.target).toEqual({ kind: 'zombie', id: behind.id }); expect(g.state).toBe('COMBAT');
    const near = add(sim, { x: -80, z: 62 });
    damageZombie(sim.ctx, behind, 40);
    run(sim, 0.2); expect(g.target).toEqual({ kind: 'zombie', id: near.id });
  });

  it('detects nearby ambient zombies and close targets outside the patrol cone', () => {
    const { sim, g } = fixture(); g.pos = { x: -80, z: 60 }; g.facing = 0;
    const z = add(sim, { x: -80, z: 55 }, false);
    run(sim, 0.2); expect(g.state).toBe('ALERT'); expect(g.target).toEqual({ kind: 'zombie', id: z.id });
  });

  it('keeps the nearest visible threat without random leader preference', () => {
    const { sim, g } = fixture(); g.pos = { x: -80, z: 60 }; g.state = 'ALERT';
    sim.state.leader.pos = { x: -80, z: 70 };
    const z = add(sim, { x: -78, z: 67 });
    const rng = vi.fn(() => 0.9); sim.ctx.rng = { next: rng };
    run(sim, 0.2); expect(g.target).toEqual({ kind: 'zombie', id: z.id });
    rng.mockReturnValue(0); const rolls = rng.mock.calls.length;
    run(sim, 0.2); expect(rng).toHaveBeenCalledTimes(rolls);
    expect(g.target).toEqual({ kind: 'zombie', id: z.id });
    const next = add(sim, { x: -76, z: 68 });
    damageZombie(sim.ctx, z, 40); run(sim, 0.2);
    expect(g.target).toEqual({ kind: 'zombie', id: next.id });
  });

  it('stays unaware of player-start zombies for ten seconds and alerts only local guards on first approach', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    // This is checkpoint awareness; street civilians deliberately encounter the player immediately.
    sim.state.guards = sim.state.guards.filter(g => g.post === 'checkpoint');
    const z = add(sim, { ...sim.state.leader.pos });
    expect(run(sim, 10).filter(e => e.type === 'guardAlert')).toHaveLength(0);
    expect(sim.state.guards.every(g => g.state === 'PATROL')).toBe(true);
    z.pos = { x: 63, z: -40 };
    let alerts: GameEvent[] = [];
    for (let i = 0; i < 12 && !alerts.length; i++) alerts = run(sim, dt).filter(e => e.type === 'guardAlert');
    expect(alerts.length).toBeGreaterThan(0); expect(alerts.length).toBeLessThan(8);
    expect(sim.state.guards.some(g => g.state === 'PATROL')).toBe(true);
  });

  it('staggers perception and limits each guard to ten candidate queries per second', () => {
    const sim = new Simulation(); sim.state.zombies = []; sim.state.followerCount = 0;
    const query = vi.spyOn(sim.ctx.zombieHash, 'query');
    run(sim, dt);
    expect(query.mock.calls.length).toBeGreaterThan(0); expect(query.mock.calls.length).toBeLessThan(sim.state.guards.length);
    run(sim, 1 - dt); expect(query).toHaveBeenCalledTimes(sim.state.guards.length * BALANCE.sim.aiTickHz);
  });
});

describe('guard movement, firing and lifecycle', () => {
  it('patrols on a cached collision-safe route, idles, and looks around at arrival', () => {
    const { sim, g } = fixture(); g.pos = { x: -80, z: 60 }; g.waypoints = [{ x: -76, z: 60 }, { x: -80, z: 60 }];
    const path = vi.spyOn(sim.ctx.navGrid, 'findPath');
    run(sim, 0.8); expect(g.pos.x).toBeCloseTo(-77.6); expect(g.anim).toBe('walk');
    expect(path).toHaveBeenCalledTimes(1);
    run(sim, 0.7); expect(g.idleTimer).toBeGreaterThan(0); const facing = g.facing;
    run(sim, 0.2); expect(g.facing).not.toBe(facing); expect(path).toHaveBeenCalledTimes(1);
    expect(sim.ctx.collision.isBlocked(g.pos, g.radius)).toBe(false);
  });

  it('fires at guard cadence, damages the leader, steps back from close zombies and skips DEAD guards', () => {
    const { sim, g } = fixture(); g.pos = { x: -80, z: 60 }; g.state = 'COMBAT';
    sim.state.leader.pos = { x: -80, z: 70 }; sim.ctx.rng = { next: () => 0 };
    g.target = { kind: 'leader' };
    const events = run(sim, 1.6);
    expect(events.filter(e => e.type === 'shot')).toHaveLength(2); expect(sim.state.horde.alphaDamageTaken).toBe(20);
    const z = add(sim, { x: -79, z: 60 }); g.target = { kind: 'zombie', id: z.id };
    run(sim, 0.2); expect(g.pos.x).toBeLessThan(-80); expect(g.vel.x).toBeLessThan(0);
    damageGuard(sim.ctx, g, 50, 'other'); sim.drainEvents(); const pos = { ...g.pos }, cooldown = g.attackCooldown;
    expect(run(sim, 5).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(g.pos).toEqual(pos); expect(g.attackCooldown).toBe(cooldown);
  });

  it('loses occluded targets, returns to alert, then resumes patrol', () => {
    const { sim, g } = fixture(); g.pos = { x: -21, z: 0 }; g.waypoints = [{ ...g.pos }]; g.state = 'COMBAT';
    const z = add(sim, { x: -21, z: 4 }); g.target = { kind: 'zombie', id: z.id }; run(sim, 0.2);
    z.pos = { x: -34, z: 0 };
    run(sim, 4.2); expect(g.state).toBe('ALERT');
    run(sim, 4.2); expect(g.state).toBe('PATROL'); expect(g.target).toBeNull();
  });

  it('retreats only to reachable points, shoots while retreating, and returns to combat within three seconds', () => {
    const { sim, g } = fixture(2); g.pos = { x: 83, z: -61 }; g.hp = 10; g.state = 'COMBAT';
    for (let i = 0; i < 3; i++) add(sim, { x: 82 + i, z: -57 });
    const path = vi.spyOn(sim.ctx.navGrid, 'findPath');
    run(sim, 0.2); expect(g.state).toBe('RETREAT'); expect(path).toHaveBeenCalled();
    const goal = g.path[g.path.length - 1];
    expect(sim.ctx.navGrid.findPath(g.pos, goal)).not.toBeNull();
    expect(goal.z).toBeLessThan(-61); expect(goal.z).toBeGreaterThan(-84);
    expect(run(sim, 3.2).filter(e => e.type === 'shot').length).toBeGreaterThan(0);
    expect(g.state).toBe('COMBAT'); expect(sim.ctx.collision.isBlocked(g.pos, g.radius)).toBe(false);
    const unreachable = fixture(); unreachable.g.pos = { x: -80, z: 60 }; unreachable.g.state = 'COMBAT'; unreachable.g.hp = 10;
    for (let i = 0; i < 3; i++) add(unreachable.sim, { x: -81 + i, z: 64 });
    vi.spyOn(unreachable.sim.ctx.navGrid, 'findPath').mockReturnValue(null);
    run(unreachable.sim, 0.2); expect(unreachable.g.state).toBe('COMBAT');
  });
});

describe('civilian and barricade humans', () => {
  it('civilians flee the nearest visible threat, stay in homeArea, calm down, and never shoot', () => {
    const { sim, g } = fixture(8);
    g.pos = { x: -80, z: 60 }; g.waypoints = [{ ...g.pos }];
    g.homeArea = { minX: -90, maxX: -60, minZ: 45, maxZ: 75 };
    sim.state.leader.pos = { x: -85, z: 60 };
    const before = Math.hypot(g.pos.x - sim.state.leader.pos.x, g.pos.z - sim.state.leader.pos.z);
    const events = run(sim, 0.8);
    expect(g.state).toBe('RETREAT');
    expect(Math.hypot(g.pos.x - sim.state.leader.pos.x, g.pos.z - sim.state.leader.pos.z)).toBeGreaterThan(before);
    events.push(...run(sim, 6));
    expect(g.pos.x).toBeLessThanOrEqual(g.homeArea.maxX - g.radius);
    expect(g.pos.x).toBeGreaterThanOrEqual(g.homeArea.minX + g.radius);
    expect(g.pos.z).toBeLessThanOrEqual(g.homeArea.maxZ - g.radius);
    expect(g.pos.z).toBeGreaterThanOrEqual(g.homeArea.minZ + g.radius);
    expect(events.filter(e => e.type === 'shot')).toHaveLength(0);
    expect(events.filter(e => e.type === 'guardAlert')).toMatchObject([{ role: 'civilian' }]);
    sim.state.leader.pos = { x: -45, z: 30 }; run(sim, BALANCE.civilian.calmTime + 0.2);
    expect(g.state).toBe('PATROL');
  });

  it('civilians ignore held zombies, patrol at civilian speed, and cower inside the store', () => {
    const { sim, g } = fixture(8); g.pos = { x: -80, z: 60 }; g.homeArea = null;
    g.waypoints = [{ x: -76, z: 60 }];
    const held = add(sim, { x: -80, z: 62 }, false); held.heldBy = 1;
    const x = g.pos.x; const events = run(sim, 0.8);
    expect(g.state).toBe('PATROL'); expect(g.pos.x - x).toBeCloseTo(BALANCE.civilian.walkSpeed * 0.8);
    expect(events.filter(e => e.type === 'guardAlert' || e.type === 'shot')).toHaveLength(0);
    const store = fixture(12); store.sim.state.leader.pos = { x: 52, z: 45 };
    const out = run(store.sim, 4);
    expect(store.g.state).toBe('RETREAT'); expect(out.filter(e => e.type === 'shot')).toHaveLength(0);
    const home = store.g.homeArea!;
    expect(store.g.pos.x).toBeGreaterThanOrEqual(home.minX + store.g.radius);
    expect(store.g.pos.x).toBeLessThanOrEqual(home.maxX - store.g.radius);
    expect(store.g.pos.z).toBeGreaterThanOrEqual(home.minZ + store.g.radius);
    expect(store.g.pos.z).toBeLessThanOrEqual(home.maxZ - store.g.radius);
  });

  it('barricade soldiers use the shorter range and cannot alert distant checkpoint soldiers', () => {
    const { sim, g } = fixture(10); g.pos = { x: -80, z: 60 }; g.waypoints = [{ ...g.pos }]; g.facing = 0;
    const z = add(sim, { x: -80, z: 78 });
    expect(run(sim, 2).filter(e => e.type === 'shot')).toHaveLength(0); expect(g.state).toBe('PATROL');
    z.pos.z = 75;
    expect(run(sim, 2).filter(e => e.type === 'shot').length).toBeGreaterThan(0);
    const world = new Simulation(); world.state.zombies = []; world.state.followerCount = 0;
    world.state.leader.pos = { x: 15, z: 27 };
    const events = run(world, 1);
    expect(events.filter(e => e.type === 'guardAlert').every(e => e.role !== undefined)).toBe(true);
    expect(world.state.guards.filter(g => g.post === 'checkpoint').every(g => g.state === 'PATROL')).toBe(true);
  });
});

describe('open-world human roles and posts', () => {
  function policeFixture() {
    const sim = flatSimulation();
    const g = createGuard(sim.ctx.newId(), { role: 'police', post: 'patrol', pos: { x: 0, z: 0 },
      facing: 0, tower: null, waypoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }] }, sim.ctx.collision);
    sim.state.guards = [g]; sim.state.leader.pos = { x: 0, z: 10 };
    g.state = 'COMBAT'; sim.ctx.rng = { next: () => 0 };
    return { sim, g };
  }

  it('creates police with pistol health, waits to aim, and uses pistol damage and cadence', () => {
    const { sim, g } = policeFixture();
    expect(g.hp).toBe(BALANCE.police.maxHp); expect(g.maxHp).toBe(BALANCE.police.maxHp);
    expect(run(sim, BALANCE.police.aimDelay - 0.05).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(run(sim, 0.2).filter(e => e.type === 'shot')).toHaveLength(1);
    expect(sim.state.horde.alphaDamageTaken).toBe(BALANCE.police.damage);
    const remaining = g.attackCooldown;
    expect(remaining).toBeGreaterThan(0);
    expect(run(sim, remaining - dt).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(run(sim, 2 * dt).filter(e => e.type === 'shot')).toHaveLength(1);
  });

  it('uses police accuracy and range, and re-aims after acquiring a different target', () => {
    const { sim, g } = policeFixture(); sim.ctx.rng = { next: () => 0.6 };
    expect(run(sim, 0.7).filter(e => e.type === 'shot')).toMatchObject([{ hit: false }]);
    expect(sim.state.horde.alphaDamageTaken).toBe(0);
    sim.state.leader.pos.z = BALANCE.police.range + 0.5;
    g.attackCooldown = 0;
    expect(run(sim, 1).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(g.target).toBeNull();
    const z = add(sim, { x: 0, z: 10 });
    expect(run(sim, BALANCE.police.aimDelay - 0.1).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(run(sim, 0.3).filter(e => e.type === 'shot')).toHaveLength(1);
    expect(g.target).toEqual({ kind: 'zombie', id: z.id });
  });

  it('freezes all dormant human state and consumes stagger without movement, perception, or shots', () => {
    const { sim, g } = policeFixture(); g.vel.x = 1;
    g.dormant = true; const before = structuredClone(g);
    expect(run(sim, 1).filter(e => e.type === 'shot' || e.type === 'guardAlert')).toHaveLength(0);
    // The test runner advances only render timers outside the AI.
    expect({ ...g, animTime: before.animTime }).toEqual(before);
    g.dormant = false; g.staggerTime = BALANCE.alpha.staggerTime;
    const pos = { ...g.pos }, perception = g.perceptionTimer;
    expect(run(sim, BALANCE.alpha.staggerTime).filter(e => e.type === 'shot')).toHaveLength(0);
    expect(g.pos).toEqual(pos); expect(g.vel).toEqual({ x: 0, z: 0 });
    expect(g.perceptionTimer).toBe(perception); expect(g.staggerTime).toBeCloseTo(0);
    expect(run(sim, 0.8).filter(e => e.type === 'shot')).toHaveLength(1);
  });

  it('alerts only same-stronghold defenders and nearby armed patrols, skipping dormant allies', () => {
    const { sim, g } = policeFixture();
    g.post = 'stronghold'; g.strongholdId = 'police_station'; g.state = 'PATROL'; g.perceptionTimer = -1;
    const ally = (post: 'stronghold' | 'patrol', strongholdId: StrongholdId | null) => {
      const a = createGuard(sim.ctx.newId(), { role: 'police', post, strongholdId, pos: { x: 2, z: 0 },
        facing: Math.PI, tower: null, waypoints: [] }, sim.ctx.collision);
      a.perceptionTimer = 10; sim.state.guards.push(a); return a;
    };
    const same = ally('stronghold', 'police_station'), other = ally('stronghold', 'mall_security');
    const patrol = ally('patrol', null), reinforcement = ally('patrol', 'police_station');
    const distant = ally('patrol', null); distant.pos.x = BALANCE.guard.alertAssistRadius + 1;
    const dormant = ally('stronghold', 'police_station'); dormant.dormant = true;
    run(sim, dt);
    for (const a of [g, same, patrol, reinforcement]) expect(a.state).toBe('ALERT');
    for (const a of [other, distant, dormant]) expect(a.state).toBe('PATROL');
  });

  it('routes reinforcement patrols toward the stronghold and resumes the waypoint after losing contact', () => {
    const { sim, g } = policeFixture(); sim.state.leader.pos = { x: -50, z: 0 };
    g.state = 'PATROL'; g.waypoints = [{ x: 0, z: 0 }, { x: 20, z: 0 }];
    g.strongholdId = 'police_station';
    run(sim, BALANCE.guard.patrolIdleTime + 1);
    expect(g.pos.x).toBeGreaterThan(1); expect(g.waypointIndex).toBe(1);
    sim.state.leader.pos = { x: g.pos.x, z: 10 }; g.state = 'COMBAT';
    run(sim, 0.2); expect(g.target).toEqual({ kind: 'leader' });
    sim.state.leader.pos = { x: -50, z: 0 };
    run(sim, BALANCE.guard.loseTargetTime + 0.2);
    expect(g.state).toBe('PATROL'); expect(g.target).toBeNull();
    const x = g.pos.x; run(sim, 0.5); expect(g.pos.x).toBeGreaterThan(x);
  });

  it('keeps low-health stronghold retreats and their complete route inside that stronghold', () => {
    const { sim, g } = policeFixture(); sim.state.leader.pos = { x: -50, z: 0 };
    g.post = 'stronghold'; g.strongholdId = 'police_station'; g.hp = 10;
    const bounds = { minX: -12, maxX: 12, minZ: -10, maxZ: 10 };
    sim.ctx.layout.strongholds = [{ id: 'police_station', districtId: 'police', name: 'Station', bounds,
      center: { x: 0, z: 0 }, defenseTier: 2, unlock: null, biomassReward: 0, objectives: [],
      nestId: 'test', reinforcementPoints: [] }];
    for (let i = 0; i < 3; i++) zombie(sim, i - 1, 4, { state: 'follower' });
    run(sim, 0.2); expect(g.state).toBe('RETREAT'); expect(g.path.length).toBeGreaterThan(0);
    for (const p of g.path) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX + g.radius);
      expect(p.x).toBeLessThanOrEqual(bounds.maxX - g.radius);
      expect(p.z).toBeGreaterThanOrEqual(bounds.minZ + g.radius);
      expect(p.z).toBeLessThanOrEqual(bounds.maxZ - g.radius);
    }
    run(sim, 3); expect(g.pos.z).toBeGreaterThanOrEqual(bounds.minZ + g.radius);
    expect(g.pos.z).toBeLessThanOrEqual(bounds.maxZ - g.radius);
  });

  it('continues engaging followers while the Alpha is respawning', () => {
    const { sim, g } = policeFixture();
    sim.state.phase = 'respawning'; sim.state.leader.alive = false;
    const z = add(sim, { x: 0, z: 10 });
    expect(run(sim, 0.8).filter(e => e.type === 'shot')).toHaveLength(1);
    expect(g.target).toEqual({ kind: 'zombie', id: z.id });
  });
});

describe('open-world layout humans', () => {
  function world() {
    const sim = new Simulation(buildDistrictLayout());
    sim.state.guards = []; sim.state.zombies = []; sim.state.followerCount = 0;
    return sim;
  }
  function runReal(sim: Simulation, seconds: number): GameEvent[] {
    const events: GameEvent[] = [];
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      sim.ctx.zombieHash.clear();
      for (const z of sim.state.zombies) if (z.state !== 'dead') sim.ctx.zombieHash.insert(z.id, z.pos.x, z.pos.z);
      updateHumanAI(sim.ctx, dt, input); sim.state.time += dt;
      events.push(...sim.drainEvents());
    }
    return events;
  }

  it('reinforcement squads leave their spawn immediately and path to the stronghold center', () => {
    const sim = world(), def = sim.ctx.layout.strongholds[0];
    const point = def.reinforcementPoints[0];
    sim.state.leader.pos = { x: point.x, z: point.z + 300 };
    const g = createGuard(sim.ctx.newId(), { role: 'police', post: 'patrol', strongholdId: def.id, pos: point,
      facing: 0, tower: null, waypoints: [point, def.center] }, sim.ctx.collision);
    sim.state.guards.push(g);
    expect(g.waypointIndex).toBe(1);
    const start = Math.hypot(g.pos.x - def.center.x, g.pos.z - def.center.z);
    runReal(sim, 10);
    // The compound is sealed until breached, so the squad approaches as close as the street network allows.
    expect(Math.hypot(g.pos.x - point.x, g.pos.z - point.z)).toBeGreaterThan(5);
    expect(g.path.length).toBeGreaterThan(0);
    const last = g.path[g.path.length - 1];
    expect(Math.hypot(last.x - def.center.x, last.z - def.center.z)).toBeLessThan(start);
    expect(Math.hypot(last.x - def.center.x, last.z - def.center.z)).toBeLessThanOrEqual(32.1);
  });

  it('reinforcement squads engage the Alpha on the way', () => {
    const sim = world(), def = sim.ctx.layout.strongholds[0];
    const point = def.reinforcementPoints[0];
    const g = createGuard(sim.ctx.newId(), { role: 'police', post: 'patrol', strongholdId: def.id, pos: point,
      facing: 0, tower: null, waypoints: [point, def.center] }, sim.ctx.collision);
    sim.state.guards.push(g);
    sim.state.leader.pos = { x: point.x + 0.01, z: point.z + 0.01 };
    const events = runReal(sim, 4);
    expect(events.some(e => e.type === 'guardAlert' && e.guardId === g.id)).toBe(true);
    expect(events.some(e => e.type === 'shot' && e.guardId === g.id)).toBe(true);
  });

  it('stronghold defenders keep retreat routes inside the stronghold bounds', () => {
    for (const def of buildDistrictLayout().strongholds) {
      const sim = world(), b = def.bounds;
      const g = createGuard(sim.ctx.newId(), { role: 'police', post: 'stronghold', strongholdId: def.id,
        pos: def.center, facing: 0, tower: null, waypoints: [] }, sim.ctx.collision);
      g.hp = 10; g.state = 'COMBAT'; sim.state.guards.push(g);
      sim.state.leader.pos = { x: def.center.x + 200, z: def.center.z };
      for (let i = 0; i < 3; i++) {
        const z = createZombie(sim.ctx.newId(), { x: def.center.x + 2 + i * 0.3, z: def.center.z + 1 }, { state: 'follower',
          variant: 0, spawnZone: -1, isConverted: true, rng: sim.ctx.rng });
        sim.state.zombies.push(z);
      }
      runReal(sim, 0.3);
      for (const p of g.path) {
        expect(p.x).toBeGreaterThanOrEqual(b.minX); expect(p.x).toBeLessThanOrEqual(b.maxX);
        expect(p.z).toBeGreaterThanOrEqual(b.minZ); expect(p.z).toBeLessThanOrEqual(b.maxZ);
      }
      runReal(sim, 3);
      expect(g.pos.x).toBeGreaterThanOrEqual(b.minX); expect(g.pos.x).toBeLessThanOrEqual(b.maxX);
      expect(g.pos.z).toBeGreaterThanOrEqual(b.minZ); expect(g.pos.z).toBeLessThanOrEqual(b.maxZ);
    }
  });

  it('fleeing street civilians may leave their home area', () => {
    const sim = world();
    const sp = sim.ctx.layout.districts[0].spawnPoints[0];
    const area = { minX: sp.x - 3, maxX: sp.x + 3, minZ: sp.z - 3, maxZ: sp.z + 3 };
    const g = createGuard(sim.ctx.newId(), { role: 'civilian', post: 'street', pos: sp, facing: 0, tower: null,
      homeArea: area, waypoints: [sp] }, sim.ctx.collision);
    sim.state.guards.push(g);
    sim.state.leader.pos = { x: sp.x + 2, z: sp.z };
    runReal(sim, 3);
    expect(g.state).toBe('RETREAT');
    expect(g.pos.x).toBeLessThan(area.minX);
  });
});
