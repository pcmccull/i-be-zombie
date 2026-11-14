import type { SimContext } from '../core/contracts';
import type { SimInput } from '../core/types';
import type { ZombieAgent } from '../core/types';
import { BALANCE } from '../config/balance';
import { createZombie } from '../entities/Zombie';
import { scheduleRecruitPulse } from './HordeSystem';
import { addMomentum } from './MomentumSystem';

// A rising zombie's originating guard is visual/event metadata, not a model contract field.
const origins = new WeakMap<ZombieAgent, number>();

export function updateConversion(ctx: SimContext, dt: number, _input: SimInput): void {
  const s = ctx.state;
  if (s.phase !== 'playing') return;
  let rising = 0;
  for (const z of s.zombies) {
    if (z.state !== 'rising') continue;
    z.stateTime += dt; z.anim = 'rise';
    if (z.stateTime + 1e-9 >= BALANCE.conversion.riseDuration) {
      z.state = 'follower'; z.stateTime = 0; z.anim = 'idle'; z.animTime = 0;
      s.followerCount++; s.stats.conversions++;
      scheduleRecruitPulse(ctx, z);
      ctx.emit({ type: 'converted', guardId: origins.get(z) ?? -1, zombieId: z.id, pos: { ...z.pos } });
      addMomentum(ctx, 'convert');
      origins.delete(z);
    } else rising++;
  }
  let write = 0;
  for (const pending of s.pendingConversions) {
    if (s.time < pending.resolveAt) { s.pendingConversions[write++] = pending; continue; }
    if (!pending.willConvert || s.followerCount + rising >= BALANCE.horde.maxFollowers) continue;
    const z = createZombie(ctx.newId(), pending.pos, {
      state: 'rising', variant: Math.floor(ctx.rng.next() * 6), spawnZone: -1, isConverted: true, rng: ctx.rng,
    });
    z.facing = z.prevFacing = pending.facing;
    s.zombies.push(z); origins.set(z, pending.guardId); rising++;
    ctx.emit({ type: 'conversionStart', guardId: pending.guardId, zombieId: z.id, pos: { ...z.pos } });
  }
  s.pendingConversions.length = write;
}
