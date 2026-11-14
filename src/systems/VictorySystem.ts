import type { SimContext } from '../core/contracts';

export function checkVictory(ctx: SimContext): void {
  const s = ctx.state;
  if (s.phase !== 'playing') return;
  if (!s.leader.alive || s.leader.hp <= 0) {
    s.phase = 'defeat';
    // The damage system owns leaderDied; this system emits only the phase event.
    ctx.emit({ type: 'defeat' });
  } else if (s.gate.destroyed && s.guards.every(g => g.state === 'DEAD')) {
    s.phase = 'victory'; ctx.emit({ type: 'victory' });
  }
}
