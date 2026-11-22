// todos #10a sidewalk spawns, #10b shop drinks, #11/#12 traffic + citizen resistance (pure, no WebGL).
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import type { AABB, GameEvent, GuardAgent, VehicleAgent, Vec2, ZombieAgent } from '../src/core/types';
import { emptyInput } from '../src/core/types';
import { createGuard } from '../src/entities/HumanGuard';
import { createZombie } from '../src/entities/Zombie';
import { Simulation } from '../src/sim/Simulation';
import { damageStructure } from '../src/systems/StructureSystem';
import { civilianWeaponFor, resistanceLevelFor } from '../src/systems/ResistanceSystem';
import { setTrafficEnabled, vehicleOverlap } from '../src/systems/TrafficSystem';
import { CollisionWorld } from '../src/world/CollisionWorld';
import { buildDistrictLayout } from '../src/world/districtLayout';
import { NavigationGrid } from '../src/world/NavigationGrid';
import { SHOP_ID_BASE } from '../src/world/layout/shops';
import { recallHint, toastForEvent } from '../src/ui/uiHelpers';
import { usePreBeachEconomy } from './support/preBeachEconomy';

usePreBeachEconomy();

const dt = BALANCE.sim.fixedDt;
const layout = buildDistrictLayout();
const roads = layout.ground.filter(g => g.kind === 'road').map(g => g.rect);
const inside = (r: AABB, p: Vec2) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
const onRoad = (p: Vec2) => roads.some(r => inside(r, p));

/** An open-world sim with nothing in it but the Alpha at `leaderAt` (traffic spawning off). */
function emptyWorld(leaderAt: Vec2): Simulation {
  const sim = new Simulation(layout, 7);
  const s = sim.state;
  s.zombies.length = 0; s.followerCount = 0; s.guards.length = 0;
  setTrafficEnabled(sim.ctx, false);
  const l = s.leader;
  l.pos.x = l.prevPos.x = leaderAt.x; l.pos.z = l.prevPos.z = leaderAt.z;
  return sim;
}

function car(sim: Simulation, pos: Vec2, facing: number, extra: Partial<VehicleAgent> = {}): VehicleAgent {
  const v: VehicleAgent = { id: sim.ctx.newId(), kind: 'traffic', mode: 'cruise', pos: { ...pos }, prevPos: { ...pos },
    facing, prevFacing: facing, speed: BALANCE.traffic.cruiseSpeed, lane: -1, modeTime: 0, passes: 0, variant: 0,
    hitFlash: 0, stuckTime: 0, hp: BALANCE.traffic.carHp, bogTime: 0, ...extra };
  sim.state.vehicles.push(v);
  return v;
}

function ambient(sim: Simulation, pos: Vec2): ZombieAgent {
  const z = createZombie(sim.ctx.newId(), { ...pos }, { state: 'ambient', variant: 0, spawnZone: -1, isConverted: false, rng: sim.ctx.rng });
  sim.state.zombies.push(z);
  return z;
}

function civilian(sim: Simulation, pos: Vec2, id = sim.ctx.newId()): GuardAgent {
  const g = createGuard(id, { role: 'civilian', post: 'street', pos: { ...pos }, facing: 0, tower: null, waypoints: [{ ...pos }] },
    sim.ctx.collision);
  sim.state.guards.push(g);
  return g;
}

function run(sim: Simulation, seconds: number, events: GameEvent[] = []): GameEvent[] {
  for (let i = 0; i < Math.round(seconds / dt); i++) { sim.step(dt, emptyInput()); events.push(...sim.drainEvents()); }
  return events;
}

function idWith(level: number, weapon: string, from = 500_000): number {
  for (let id = from; ; id++) if (civilianWeaponFor(level, id) === weapon) return id;
}

// The z = 80 east-west avenue (carriageway z 75..85); lanes at z 77.5 (westbound) and 82.5 (eastbound).
const LANE_Z = 82.5;

describe('todos #10a: street spawns are on the sidewalks', () => {
  it('moves free spawn zones, respawn points and street civilians off the carriageway', () => {
    for (const zone of layout.spawnZones.filter(z => !z.heldBy)) {
      for (const r of roads) {
        const overlap = zone.rect.minX < r.maxX && zone.rect.maxX > r.minX && zone.rect.minZ < r.maxZ && zone.rect.maxZ > r.minZ;
        expect(overlap, zone.name).toBe(false);
      }
    }
    for (const d of layout.districts) for (const p of d.spawnPoints) expect(onRoad(p), d.id).toBe(false);
    for (const g of layout.guards.filter(g => g.role === 'civilian' && g.post === 'street')) {
      expect(onRoad(g.pos)).toBe(false);
      for (const wp of g.waypoints) expect(onRoad(wp)).toBe(false);
    }
    const sim = new Simulation(layout, 3);
    const free = sim.state.zombies.filter(z => z.state === 'ambient' && z.heldBy === 0);
    expect(free.length).toBeGreaterThan(200);
    expect(free.filter(z => onRoad(z.pos))).toHaveLength(0);
  });

  it('keeps every moved spawn on walkable ground', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    for (const d of layout.districts) for (const p of d.spawnPoints) expect(collision.isBlocked(p, 0.45), d.id).toBe(false);
  });
});

describe('todos #10b: corner shops with healing drinks', () => {
  const shops = layout.structures.filter(s => s.kind === 'shopDoor');

  it('places a sealed walk-in shop in most districts', () => {
    expect(shops.length).toBeGreaterThanOrEqual(12);
    expect(shops.every(s => s.landmark === 'shop' && s.id >= SHOP_ID_BASE)).toBe(true);
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const nav = new NavigationGrid(collision);
    for (const s of shops) {
      expect(collision.findByTag(s.tag)?.kind).toBe('breakable');
      const inner = { x: (s.enclosure.minX + s.enclosure.maxX) / 2, z: (s.enclosure.minZ + s.enclosure.maxZ) / 2 };
      expect(nav.findPath(layout.playerStart, inner), s.tag).toBeNull();
    }
  });

  it('breaking in exposes drinks; the hurt Alpha drinks to heal; empty shelves restock', () => {
    const shop = shops[0];
    const sim = emptyWorld(shop.approachOutside[0]);
    const s = sim.state;
    const door = s.structures.find(x => x.id === shop.id)!;
    damageStructure(sim.ctx, door, door.maxHp);
    const events = run(sim, 0.1);
    expect(events.some(e => e.type === 'shopLooted' && e.shopId === shop.id)).toBe(true);
    expect(s.pickups).toHaveLength(BALANCE.shops.drinks);
    for (const p of s.pickups) expect(inside(shop.enclosure, p.pos)).toBe(true);
    // Full health: walking over a drink leaves it.
    const l = s.leader;
    l.pos.x = l.prevPos.x = s.pickups[0].pos.x; l.pos.z = l.prevPos.z = s.pickups[0].pos.z;
    run(sim, 0.1);
    expect(s.pickups).toHaveLength(BALANCE.shops.drinks);
    const units = BALANCE.shops.drinkHeal * BALANCE.hordeHealth.alphaDamageMultiplier / BALANCE.hordeHealth.unitHp;
    s.horde.coreDamage = 4;
    const healed = run(sim, 0.1);
    expect(s.horde.coreDamage).toBeCloseTo(4 - units, 6);
    expect(healed.some(e => e.type === 'pickup' && e.heal !== undefined && Math.abs(e.heal - units) < 1e-9)).toBe(true);
    expect(s.pickups).toHaveLength(BALANCE.shops.drinks - 1);
    // Drink the rest, then the shelf refills after restockTime.
    for (const p of [...s.pickups]) { s.horde.coreDamage = BALANCE.hordeHealth.alphaCore; l.pos.x = l.prevPos.x = p.pos.x; l.pos.z = l.prevPos.z = p.pos.z; run(sim, 0.05); }
    expect(s.pickups).toHaveLength(0);
    s.horde.coreDamage = 0; // (still standing on a drink spot)
    s.time += BALANCE.shops.restockTime + 1;
    run(sim, 0.05);
    expect(s.pickups).toHaveLength(BALANCE.shops.drinks);
  }, 30_000);
});

describe('todos #11/#12: simulated traffic', () => {
  it('a moving car throws and hurts the zombie it hits', () => {
    const sim = emptyWorld({ x: 40, z: 100 });
    const z = ambient(sim, { x: 40, z: LANE_Z });
    car(sim, { x: 22, z: LANE_Z }, Math.PI / 2);
    const events: GameEvent[] = [];
    let airborne = 0;
    for (let i = 0; i < 180; i++) { run(sim, dt, events); airborne = Math.max(airborne, z.elevation); }
    const hit = events.find(e => e.type === 'vehicleHit');
    expect(hit && hit.type === 'vehicleHit' && hit.target).toBe('zombie');
    expect(z.hp).toBeLessThan(BALANCE.walker.maxHp);
    expect(z.pos.x).toBeGreaterThan(42); // thrown forward
    expect(airborne).toBeGreaterThan(0.3);
  });

  it('a stopped car is solid: bodies are shoved out, never left inside it', () => {
    const sim = emptyWorld({ x: 40, z: 100 });
    const v = car(sim, { x: 40, z: LANE_Z }, Math.PI / 2, { mode: 'stalled', speed: 0 });
    const z = ambient(sim, { x: 40.5, z: LANE_Z + 0.4 });
    run(sim, 0.1);
    expect(vehicleOverlap(v, z.pos, z.radius - 0.02)).toBe(false);
    expect(z.hp).toBe(BALANCE.walker.maxHp);
  });

  it('ambient traffic brakes for a human in its lane', () => {
    const sim = emptyWorld({ x: -60, z: 100 });
    const g = civilian(sim, { x: 45, z: LANE_Z });
    const v = car(sim, { x: 15, z: LANE_Z }, Math.PI / 2);
    run(sim, 4);
    expect(v.speed).toBeLessThan(0.5);
    expect(v.pos.x + BALANCE.traffic.carLength / 2).toBeLessThan(g.pos.x - g.radius);
    expect(g.hp).toBe(g.maxHp);
  });

  it('spawns traffic around the Alpha in the open world, never inside buildings; none in the legacy district', () => {
    const sim = new Simulation(layout, 11);
    let seen = 0;
    for (let i = 0; i < 10 / dt; i++) {
      sim.step(dt, emptyInput()); sim.drainEvents();
      seen = Math.max(seen, sim.state.vehicles.length);
      if (i % 60 === 0) for (const v of sim.state.vehicles) {
        expect(sim.ctx.collision.isBlocked(v.pos, 0.5), JSON.stringify(v.pos)).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
    const legacy = new Simulation();
    for (let i = 0; i < 120; i++) legacy.step(dt, emptyInput());
    expect(legacy.state.vehicles).toHaveLength(0);
  }, 60_000);

  it('no car stays jammed: far from the Alpha it despawns, so traffic keeps flowing', () => {
    const sim = new Simulation(layout, 21);
    const l = sim.state.leader;
    // Near the south end of the x = 0 avenue: lanes run into the world edge here.
    l.pos.x = l.prevPos.x = 12; l.pos.z = l.prevPos.z = 140;
    const stoppedSince = new Map<number, number>();
    let worst = 0;
    for (let i = 0; i < 40 / dt; i++) {
      sim.step(dt, emptyInput()); sim.drainEvents();
      sim.state.horde.coreDamage = 0; sim.state.horde.lastBrain.active = false;
      for (const v of sim.state.vehicles) {
        if (v.mode === 'stalled' || Math.abs(v.speed) > 0.5) { stoppedSince.delete(v.id); continue; }
        const since = stoppedSince.get(v.id) ?? sim.state.time;
        stoppedSince.set(v.id, since);
        worst = Math.max(worst, sim.state.time - since);
      }
    }
    // Waiting out a full red phase (green + 2 x (yellow + all-red) = 17 s) is legitimate; a jam lasts the whole run.
    const sig = BALANCE.traffic.signals, red = sig.green + 2 * (sig.yellow + sig.allRed);
    expect(worst).toBeLessThan(Math.max(BALANCE.traffic.stallTime * 4, red + BALANCE.traffic.stallTime));
  }, 60_000);

  it('hostile drivers (level 2) ram the Alpha, then make more passes', () => {
    const sim = emptyWorld({ x: 60, z: 80 });
    const s = sim.state;
    s.strongholds[0].captured = true; s.strongholds[1].captured = true;
    const v = car(sim, { x: 32, z: 80 }, Math.PI / 2, { kind: 'rammer' });
    const events = run(sim, 4);
    expect(s.resistance.level).toBe(2);
    expect(events.some(e => e.type === 'vehicleRam' && e.vehicleId === v.id)).toBe(true);
    expect(events.some(e => e.type === 'vehicleHit' && e.target === 'leader')).toBe(true);
    expect(s.horde.alphaDamageTaken).toBeGreaterThan(0);
    expect(v.passes).toBeGreaterThanOrEqual(1);
  });

  it('a car blocked for good stalls and its driver bails out as a civilian', () => {
    const collision = new CollisionWorld(layout.bounds, layout.colliders);
    const wall = layout.colliders.find(c => c.kind === 'building' && c.minX > -180 && c.maxX < 180 && c.maxZ < 150 && c.minZ > -150 &&
      !collision.isBlocked({ x: c.minX - 3.2, z: (c.minZ + c.maxZ) / 2 }, 1.6))!;
    const at = { x: wall.minX - 3.2, z: (wall.minZ + wall.maxZ) / 2 };
    const sim = emptyWorld({ x: at.x - 30, z: at.z });
    const v = car(sim, at, Math.PI / 2, { speed: 0 });
    const events = run(sim, BALANCE.traffic.stallTime + 1);
    expect(v.mode).toBe('stalled');
    const bailed = events.find(e => e.type === 'driverBailed');
    expect(bailed).toBeDefined();
    expect(sim.state.guards.some(g => bailed?.type === 'driverBailed' && g.id === bailed.guardId && g.role === 'civilian')).toBe(true);
  });
});

describe('todos #12: citizens fight back as strongholds fall', () => {
  it('derives the level from captures and arms civilians by stable per-id rolls', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 16].map(resistanceLevelFor)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    const share = (level: number, w: string) => {
      let n = 0;
      for (let id = 1; id <= 4000; id++) if (civilianWeaponFor(level, id) === w) n++;
      return n / 4000;
    };
    expect(share(0, 'none')).toBe(1);
    expect(share(1, 'bat')).toBeCloseTo(BALANCE.resistance.bat[1], 1);
    expect(share(1, 'pistol') + share(1, 'shotgun')).toBe(0);
    expect(share(3, 'pistol')).toBeCloseTo(BALANCE.resistance.pistol[3], 1);
    expect(share(4, 'shotgun')).toBeCloseTo(BALANCE.resistance.shotgun[4], 1);
    expect(civilianWeaponFor(4, 1234)).toBe(civilianWeaponFor(4, 1234));
  });

  it('emits resistanceRaised once when a capture raises the level', () => {
    const sim = emptyWorld({ x: 60, z: 100 });
    sim.state.strongholds[0].captured = true;
    const events = run(sim, 0.2);
    expect(events.filter(e => e.type === 'resistanceRaised')).toEqual([{ type: 'resistanceRaised', level: 1, label: BALANCE.resistance.labels[1] }]);
  });

  it('a civilian with a bat stands and swings instead of fleeing; an unarmed one flees', () => {
    const sim = emptyWorld({ x: 75, z: 110 });
    sim.state.strongholds[0].captured = true; // level 1: bats
    const batter = civilian(sim, { x: 60, z: 87 }, idWith(1, 'bat'));
    const runner = civilian(sim, { x: 90, z: 87 }, idWith(1, 'none'));
    const z1 = ambient(sim, { x: 61.6, z: 87 });
    ambient(sim, { x: 91.6, z: 87 });
    const events = run(sim, 2.5);
    expect(events.some(e => e.type === 'humanMelee' && e.guardId === batter.id)).toBe(true);
    expect(z1.hp).toBeLessThan(BALANCE.walker.maxHp);
    expect(batter.state).toBe('COMBAT');
    expect(runner.state).toBe('RETREAT');
  });

  it('armed citizens (level 3) shoot at zombies in range', () => {
    const sim = emptyWorld({ x: 40, z: 110 });
    for (const i of [0, 1, 2, 3]) sim.state.strongholds[i].captured = true;
    const shooter = civilian(sim, { x: 60, z: 87 }, idWith(3, 'pistol'));
    ambient(sim, { x: 68, z: 87 });
    const events = run(sim, 3);
    expect(sim.state.resistance.level).toBe(3);
    expect(events.some(e => e.type === 'shot' && e.guardId === shooter.id)).toBe(true);
  });
});

describe('todos #10c: recall hint', () => {
  it('shows only while the horde is away on an order, with keys (or the touch button)', () => {
    const sim = new Simulation(layout, 1);
    const s = sim.state;
    expect(recallHint(s, false)).toBeNull();
    s.order = { type: 'move', point: { x: 0, z: 0 }, expiresAt: 99 };
    expect(recallHint(s, false)).toMatch(/SPACE recall/);
    expect(recallHint(s, true)).toMatch(/FOLLOW/);
    s.order = { type: 'follow' };
    s.squads.push({ id: 9, target: { kind: 'gate' } });
    expect(recallHint(s, false)).not.toBeNull();
    s.squads.length = 0; s.followerCount = 0;
    s.order = { type: 'attack', target: { kind: 'gate' } };
    expect(recallHint(s, false)).toBeNull();
  });

  it('toasts the new events', () => {
    expect(toastForEvent({ type: 'resistanceRaised', level: 1, label: 'Citizens grab bats' })?.kind).toBe('warn');
    expect(toastForEvent({ type: 'pickup', kind: 'drink', pos: { x: 0, z: 0 }, heal: 35, hp: 80 })?.text).toBe('Drink: +35 HP');
    expect(toastForEvent({ type: 'shopLooted', shopId: 200, pos: { x: 0, z: 0 }, drinks: 3 })?.kind).toBe('good');
  });
});
