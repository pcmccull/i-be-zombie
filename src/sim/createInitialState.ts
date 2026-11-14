import { BALANCE } from '../config/balance';
import type { ICollisionWorld } from '../core/contracts';
import type { DistrictLayout, GameState, Rng, ZombieAgent } from '../core/types';
import { createLeader } from '../entities/ZombieLeader';
import { createZombie } from '../entities/Zombie';
import { createGuard } from '../entities/HumanGuard';
import { createGate } from '../entities/Structure';

export function createInitialState(layout: DistrictLayout, collision: ICollisionWorld, rng: Rng): GameState {
  let id = 1;
  const leader = createLeader(id++, layout);
  const zombies: ZombieAgent[] = [];
  for (let zone = 0; zone < layout.spawnZones.length; zone++) {
    const { rect, count } = layout.spawnZones[zone];
    for (let i = 0; i < count; i++) {
      const p = { x: 0, z: 0 };
      let tries = 0;
      do {
        p.x = rect.minX + rng.next() * (rect.maxX - rect.minX);
        p.z = rect.minZ + rng.next() * (rect.maxZ - rect.minZ);
        if (++tries > 10000) throw new Error('Spawn zone has no sampled walkable point');
      } while (collision.isBlocked(p, 0.45));
      zombies.push(createZombie(id++, p, { state: 'ambient', variant: i % 6, spawnZone: zone, isConverted: false, rng }));
    }
  }
  if (zombies.length !== BALANCE.horde.initialAmbient) throw new Error('Ambient spawn counts must match balance');
  const guards = layout.guards.map(spawn => {
    const guard = createGuard(id++, spawn, collision);
    if (spawn.tower) guard.elevation = layout.checkpoint.towers.find(t => t.id === spawn.tower)?.platformHeight ?? 4;
    return guard;
  });
  return {
    time: 0, phase: 'playing', nextEntityId: id, leader, zombies, guards, gate: createGate(collision),
    order: { type: 'follow' }, abilities: { rallyCooldown: 0, rushCooldown: 0, rushTimeLeft: 0 },
    pendingConversions: [], stats: { recruited: 0, conversions: 0, losses: 0, guardsKilled: 0 },
    followerCount: 0, capReachedFlash: 0,
  };
}
