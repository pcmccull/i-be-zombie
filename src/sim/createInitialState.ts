import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { DistrictId, DistrictLayout, DistrictState, DiscoveryState, GameState, Rng, StrongholdState, ZombieAgent } from '../core/types';
import { DISTRICT_IDS } from '../core/types';
import { INNATE_ABILITIES } from '../content/abilities';
import { createLeader } from '../entities/ZombieLeader';
import { createZombie } from '../entities/Zombie';
import { createGuard } from '../entities/HumanGuard';
import { createGate, createStructures } from '../entities/Structure';

export function createInitialState(layout: DistrictLayout, collision: ICollisionWorld, rng: Rng): GameState {
  let id = 1;
  const leader = createLeader(id++, layout);
  const zombies: ZombieAgent[] = [];
  for (let zone = 0; zone < layout.spawnZones.length; zone++) {
    const { rect, count, heldBy } = layout.spawnZones[zone];
    for (let i = 0; i < count; i++) {
      const p = { x: 0, z: 0 };
      let tries = 0;
      do {
        p.x = rect.minX + rng.next() * (rect.maxX - rect.minX);
        p.z = rect.minZ + rng.next() * (rect.maxZ - rect.minZ);
        if (++tries > 10000) throw new Error('Spawn zone has no sampled walkable point');
      } while (collision.isBlocked(p, 0.45));
      zombies.push(createZombie(id++, p, { state: 'ambient', variant: i % 6, spawnZone: zone, isConverted: false, heldBy, rng }));
    }
  }
  const area = layout.startFollowerArea;
  for (let i = 0; i < BALANCE.horde.startFollowers; i++) {
    const p = { x: 0, z: 0 };
    let tries = 0;
    do {
      p.x = area.minX + rng.next() * (area.maxX - area.minX);
      p.z = area.minZ + rng.next() * (area.maxZ - area.minZ);
      if (++tries > 10000) throw new Error('Start follower area has no distinct sampled walkable point');
    } while (collision.isBlocked(p, BALANCE.world.navAgentRadius) ||
      Math.hypot(p.x - leader.pos.x, p.z - leader.pos.z) < leader.radius + BALANCE.walker.radius ||
      zombies.some(z => z.state === 'follower' && Math.hypot(p.x - z.pos.x, p.z - z.pos.z) < 2 * BALANCE.walker.radius));
    zombies.push(createZombie(id++, p, { state: 'follower', variant: i % 6, spawnZone: -1, isConverted: false, rng }));
  }
  const guards = layout.guards.map(spawn => {
    const guard = createGuard(id++, spawn, collision);
    if (spawn.tower) guard.elevation = layout.checkpoint.towers.find(t => t.id === spawn.tower)?.platformHeight ?? 4;
    return guard;
  });
  const state: GameState = {
    time: 0, phase: 'playing', nextEntityId: id, leader, zombies, guards, gate: createGate(collision),
    structures: createStructures(layout, collision), momentum: { value: 0, idleTime: 0, tier: 'dormant', gainFlash: 0 },
    order: { type: 'follow' }, squads: [], abilities: { rallyCooldown: 0, rushCooldown: 0, rushTimeLeft: 0 },
    pendingConversions: [], stats: { recruited: 0, conversions: 0, losses: 0, guardsKilled: 0, cascadeRecruits: 0, structuresDestroyed: 0 },
    followerCount: BALANCE.horde.startFollowers, capReachedFlash: 0,
    districts: createDistrictStates(), strongholds: createStrongholdStates(layout),
    progression: {
      biomass: BALANCE.progression.startBiomass, unlocked: [...INNATE_ABILITIES],
      equipped: new Array<null>(BALANCE.progression.slots).fill(null), cooldowns: {}, frenzyTimeLeft: 0,
    },
    discovery: createDiscovery(layout),
    activeNestId: layout.nests.find(n => n.strongholdId === null)?.id ?? '', deaths: 0,
  };
  // NOTE: no t=0 fog reveal here: tests/discovery + persistence assume a blank fog before the first step. The first
  // updateConquest step (revealTimer starts at 0) reveals around the start, so the start district reads human at t=dt.
  return state;
}

export function createDistrictStates(): Record<DistrictId, DistrictState> {
  const out = {} as Record<DistrictId, DistrictState>;
  for (const id of DISTRICT_IDS) {
    out[id] = { id, status: 'unknown', discovered: false, infection: 0, humanStrength: 1, alertLevel: 0, strongholdCaptured: false };
  }
  return out;
}

export function createStrongholdStates(layout: DistrictLayout): StrongholdState[] {
  return layout.strongholds.map(def => ({
    id: def.id, captured: false, contested: false, defenderStrength: 1, objectivesDone: [], holdProgress: 0,
    reinforcementsSpent: 0, lastReinforcementAt: -Infinity,
  }));
}

export function createDiscovery(layout: DistrictLayout): DiscoveryState {
  const cellSize = BALANCE.discovery.cellSize, b = layout.bounds;
  const cols = Math.ceil((b.maxX - b.minX) / cellSize), rows = Math.ceil((b.maxZ - b.minZ) / cellSize);
  return { cellSize, cols, rows, bits: new Uint8Array(cols * rows), revealed: 0 };
}
