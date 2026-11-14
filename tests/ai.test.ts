import { describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { emptyInput } from '../src/core/types';
import type { GameEvent, Vec2 } from '../src/core/types';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageGate, damageGuard, damageZombie } from '../src/systems/CombatSystem';
import { recruitZombie } from '../src/systems/HordeSystem';
import { updateHumanAI } from '../src/systems/HumanAISystem';

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

  it('keeps a visible current target instead of rolling leader targeting every perception tick', () => {
    const { sim, g } = fixture(); g.pos = { x: -80, z: 60 }; g.state = 'ALERT';
    sim.state.leader.pos = { x: -80, z: 70 };
    const z = add(sim, { x: -78, z: 67 });
    const rng = vi.fn(() => 0.9); sim.ctx.rng = { next: rng };
    run(sim, 0.2); expect(g.target).toEqual({ kind: 'zombie', id: z.id });
    rng.mockReturnValue(0); const rolls = rng.mock.calls.length;
    run(sim, 0.2); expect(rng).toHaveBeenCalledTimes(rolls);
    expect(g.target).toEqual({ kind: 'zombie', id: z.id });
    add(sim, { x: -76, z: 68 });
    damageZombie(sim.ctx, z, 40); run(sim, 0.2);
    expect(g.target).toEqual({ kind: 'leader' });
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
    expect(events.filter(e => e.type === 'shot')).toHaveLength(2); expect(sim.state.leader.hp).toBe(80);
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
