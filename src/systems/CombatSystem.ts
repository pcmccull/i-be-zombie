import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { SimInput, TargetRef, Vec2 } from '../core/types';

export function resolveTargetPos(ctx: SimContext, target: TargetRef, out: Vec2): boolean {
  const s = ctx.state;
  let pos: Vec2;
  switch (target.kind) {
    case 'leader':
      if (!s.leader.alive || s.leader.hp <= 0) return false;
      pos = s.leader.pos; break;
    case 'gate':
      if (s.gate.destroyed || s.gate.hp <= 0) return false;
      pos = s.gate.center; break;
    case 'guard': {
      const g = s.guards.find(g => g.id === target.id);
      if (!g || g.state === 'DEAD' || g.hp <= 0) return false;
      pos = g.pos; break;
    }
    case 'zombie': {
      const z = s.zombies.find(z => z.id === target.id);
      if (!z || z.state === 'dead' || z.hp <= 0) return false;
      pos = z.pos; break;
    }
  }
  out.x = pos.x; out.z = pos.z;
  return true;
}

const targetPos: Vec2 = { x: 0, z: 0 };
export function isTargetAlive(ctx: SimContext, target: TargetRef): boolean {
  return resolveTargetPos(ctx, target, targetPos);
}

// P2C: replace with melee resolution; keep cooldown and corpse lifecycle behavior.
export function updateCombat(ctx: SimContext, dt: number, _input: SimInput): void {
  const zombies = ctx.state.zombies;
  let write = 0;
  for (const z of zombies) {
    z.attackCooldown = Math.max(0, z.attackCooldown - dt);
    if (z.state === 'dead') {
      z.stateTime += dt;
      if (z.stateTime >= BALANCE.walker.corpseFadeTime) continue;
    }
    zombies[write++] = z;
  }
  zombies.length = write;
}
