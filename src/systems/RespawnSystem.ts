// [pure] Leader death and recovery; permanent world progress is untouched. OWNER: T009.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import { isNestActive, spawnNestFollowers } from './ConquestSystem';

export function updateRespawn(ctx: SimContext, dt: number): void {
  const s = ctx.state, l = s.leader;
  if (s.phase === 'playing' && !l.alive) {
    s.phase = 'respawning'; l.respawnTimer = BALANCE.respawn.delay; s.deaths++;
    s.order = { type: 'follow' }; s.squads.length = 0;
    for (const z of s.zombies) if (z.state === 'follower') { z.squad = 0; z.engageTarget = null; }
    ctx.nav.effectiveTarget = null; ctx.nav.attackField = null; ctx.nav.squads.clear();
    ctx.emit({ type: 'orderChanged', order: s.order });
    return;
  }
  if (s.phase !== 'respawning') return;
  l.respawnTimer = Math.max(0, l.respawnTimer - (Number.isFinite(dt) ? Math.max(0, dt) : 0));
  if (l.respawnTimer > 1e-9) return;
  let nest = ctx.layout.nests.find(n => n.id === s.activeNestId && isNestActive(ctx, n.id));
  if (!nest) {
    let nearest = Infinity;
    for (const candidate of ctx.layout.nests) {
      if (!isNestActive(ctx, candidate.id)) continue;
      const dist = (candidate.pos.x - l.pos.x) ** 2 + (candidate.pos.z - l.pos.z) ** 2;
      if (dist < nearest) { nearest = dist; nest = candidate; }
    }
  }
  if (!nest) return;
  s.activeNestId = nest.id;
  l.pos.x = l.prevPos.x = nest.pos.x; l.pos.z = l.prevPos.z = nest.pos.z;
  l.vel.x = l.vel.z = 0; l.prevFacing = l.facing;
  l.hp = l.maxHp; l.stamina = BALANCE.leader.staminaMax;
  l.alive = true; l.exhausted = false; l.sprinting = false;
  l.anim = 'idle'; l.animTime = 0; l.hitFlash = 0; l.attackCooldown = 0;
  l.attackPhase = 'ready'; l.attackTimer = 0; l.comboStep = 0; l.comboWindow = 0;
  l.hitStun = 0; l.respawnTimer = 0;
  spawnNestFollowers(ctx, nest.pos, BALANCE.respawn.followers);
  s.phase = 'playing';
  ctx.emit({ type: 'leaderRespawned', nestId: nest.id, pos: { ...nest.pos } });
  ctx.emit({ type: 'autosave', reason: 'respawn' });
}
