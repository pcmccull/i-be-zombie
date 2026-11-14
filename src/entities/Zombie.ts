import { BALANCE } from '../config/balance';
import type { Rng, Vec2, ZombieAgent } from '../core/types';

export function createZombie(id: number, pos: Vec2, opts: {
  state: 'ambient' | 'rising'; variant: number; spawnZone: number; isConverted: boolean; rng: Rng;
}): ZombieAgent {
  const { rng } = opts;
  const speedScale = 1 + (rng.next() * 2 - 1) * BALANCE.walker.speedVariance;
  const radius = Math.sqrt(rng.next()) * BALANCE.walker.followRingMax;
  // Local +Z is forward; a broad rear-biased disc still leaves room to flank.
  const angle = Math.PI + (rng.next() * 2 - 1) * Math.PI * 0.8;
  const facing = rng.next() * Math.PI * 2;
  return {
    id, pos: { ...pos }, prevPos: { ...pos }, vel: { x: 0, z: 0 }, facing, prevFacing: facing,
    radius: BALANCE.walker.radius, hp: BALANCE.walker.maxHp, maxHp: BALANCE.walker.maxHp,
    attackCooldown: 0, anim: opts.state === 'rising' ? 'rise' : 'idle', animTime: 0, hitFlash: 0,
    state: opts.state, variant: opts.variant, speedScale,
    followOffset: { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius }, engageTarget: null,
    spawnZone: opts.spawnZone, wanderTarget: null, wanderTimer: 1 + rng.next() * 3,
    stateTime: 0, stuckTimer: 0, isConverted: opts.isConverted,
  };
}
