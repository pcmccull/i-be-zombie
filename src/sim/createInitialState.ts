import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { DistrictLayout, GameState, Rng, ZombieAgent } from '../core/types';
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
  if (zombies.length !== BALANCE.horde.initialAmbient) throw new Error('Ambient spawn counts must match balance');
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
  return {
    time: 0, phase: 'playing', nextEntityId: id, leader, zombies, guards, gate: createGate(collision),
    structures: createStructures(layout, collision), momentum: { value: 0, idleTime: 0, tier: 'dormant', gainFlash: 0 },
    order: { type: 'follow' }, squads: [], abilities: { rallyCooldown: 0, rushCooldown: 0, rushTimeLeft: 0 },
    pendingConversions: [], stats: { recruited: 0, conversions: 0, losses: 0, guardsKilled: 0, cascadeRecruits: 0, structuresDestroyed: 0 },
    followerCount: BALANCE.horde.startFollowers, capReachedFlash: 0,
  };
}
