import { BALANCE } from '../config/balance';
import type { SegmentOptions, SimContext } from '../core/contracts';
import type { DamageSource, GuardAgent, SimInput, TargetRef, Vec2, ZombieAgent } from '../core/types';
import { killZombie } from './HordeSystem';

const guardAccess = new WeakMap<GuardAgent, SegmentOptions>();
const guardTargets = new WeakMap<GuardAgent, TargetRef>();
const moveOptions: SegmentOptions = { mode: 'move' };

function guardFor(ctx: SimContext, id: number): GuardAgent | undefined {
  for (const g of ctx.state.guards) if (g.id === id) return g;
  return undefined;
}

function guardTarget(g: GuardAgent): TargetRef {
  let target = guardTargets.get(g);
  if (!target) { target = { kind: 'guard', id: g.id }; guardTargets.set(g, target); }
  return target;
}

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
      const g = guardFor(ctx, target.id);
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

export function damageZombie(ctx: SimContext, z: ZombieAgent, amount: number): void {
  if (z.state === 'dead') return;
  z.hp -= amount; z.hitFlash = 0.15;
  if (z.anim !== 'attack') { z.anim = 'hit'; z.animTime = 0; }
  ctx.emit({ type: 'damage', target: { kind: 'zombie', id: z.id }, amount, pos: { ...z.pos } });
  if (z.hp <= 0) killZombie(ctx, z);
}

export function damageLeader(ctx: SimContext, amount: number): void {
  const l = ctx.state.leader;
  if (!l.alive || ctx.state.phase !== 'playing') return;
  l.hp -= amount; l.hitFlash = 0.2;
  ctx.emit({ type: 'damage', target: { kind: 'leader' }, amount, pos: { ...l.pos } });
  if (l.hp <= 0) {
    l.hp = 0; l.alive = false; l.vel.x = l.vel.z = 0; l.sprinting = false;
    l.anim = 'dead'; l.animTime = 0;
    ctx.emit({ type: 'leaderDied', pos: { ...l.pos } });
  }
}

export function damageGuard(ctx: SimContext, g: GuardAgent, amount: number, source: DamageSource): void {
  if (g.state === 'DEAD') return;
  g.hp -= amount; g.hitFlash = 0.15; g.lastDamageSource = source;
  if (g.anim !== 'attack') { g.anim = 'hit'; g.animTime = 0; }
  ctx.emit({ type: 'damage', target: guardTarget(g), amount, pos: { ...g.pos } });
  if (g.state === 'PATROL') {
    g.state = 'ALERT'; g.stateTime = 0; g.lostTargetTimer = 0;
    ctx.emit({ type: 'guardAlert', guardId: g.id, pos: { ...g.pos } });
  }
  if (g.hp <= 0) {
    g.state = 'DEAD'; g.hp = 0; g.deathTime = ctx.state.time;
    g.vel.x = g.vel.z = 0; g.target = null; g.path.length = 0;
    g.anim = 'dead'; g.animTime = 0; ctx.state.stats.guardsKilled++;
    ctx.emit({ type: 'guardDied', guardId: g.id, pos: { ...g.pos }, source });
    if (source === 'zombie') ctx.state.pendingConversions.push({
      guardId: g.id, pos: { ...g.pos }, facing: g.facing,
      resolveAt: ctx.state.time + BALANCE.conversion.delay,
      willConvert: ctx.rng.next() < BALANCE.conversion.chance,
    });
  }
}

export function damageGate(ctx: SimContext, amount: number): void {
  const g = ctx.state.gate;
  if (g.destroyed) return;
  g.hp -= amount; g.hitFlash = 0.15;
  ctx.emit({ type: 'damage', target: { kind: 'gate' }, amount, pos: { ...g.center } });
  if (g.hp <= 0) {
    g.hp = 0; g.destroyed = true;
    ctx.collision.setEnabled(g.colliderId, false);
    ctx.navGrid.rebuild();
    ctx.emit({ type: 'gateDestroyed', pos: { ...g.center } });
  }
}

/** Melee only crosses the target gate/tower itself, never intervening cover. */
export function canMelee(ctx: SimContext, attackerPos: Vec2, attackRange: number, target: TargetRef): boolean {
  if (target.kind === 'guard') {
    const g = guardFor(ctx, target.id);
    if (!g || g.state === 'DEAD' || g.hp <= 0) return false;
    const reach = attackRange + g.radius + (g.tower ? BALANCE.guard.towerMeleeReachBonus : 0);
    if (Math.hypot(g.pos.x - attackerPos.x, g.pos.z - attackerPos.z) > reach) return false;
    let options = guardAccess.get(g);
    if (!options) {
      options = g.towerColliderId === null ? moveOptions : { mode: 'move', ignoreIds: [g.towerColliderId] };
      guardAccess.set(g, options);
    }
    return !ctx.collision.segmentBlocked(attackerPos, g.pos, options);
  }
  if (target.kind === 'gate') {
    const gate = ctx.state.gate, r = gate.rect;
    if (gate.destroyed || gate.hp <= 0) return false;
    // End at the nearest face so the segment cannot cross the gate or another wall behind it.
    targetPos.x = Math.max(r.minX, Math.min(r.maxX, attackerPos.x));
    targetPos.z = Math.max(r.minZ, Math.min(r.maxZ, attackerPos.z));
    if (Math.hypot(attackerPos.x - targetPos.x, attackerPos.z - targetPos.z) > attackRange + 0.1 + 1e-9) return false;
    return !ctx.collision.segmentBlocked(attackerPos, targetPos,
      gateOptions(ctx));
  }
  return false;
}

const gateAccess = new WeakMap<SimContext, SegmentOptions>();
function gateOptions(ctx: SimContext): SegmentOptions {
  let options = gateAccess.get(ctx);
  if (!options) { options = { mode: 'move', ignoreIds: [ctx.state.gate.colliderId] }; gateAccess.set(ctx, options); }
  return options;
}

function melee(ctx: SimContext, target: TargetRef, amount: number): void {
  if (target.kind === 'guard') {
    const g = guardFor(ctx, target.id);
    if (g) damageGuard(ctx, g, amount, 'zombie');
  } else if (target.kind === 'gate') damageGate(ctx, amount);
}

function followerSwingTarget(ctx: SimContext, z: ZombieAgent): TargetRef | null {
  // Engagement remains the steering target. Self-defense never redirects the route.
  if (z.engageTarget && canMelee(ctx, z.pos, BALANCE.walker.attackRange, z.engageTarget)) return z.engageTarget;
  if (ctx.state.order.type !== 'attack') return null;
  let target: TargetRef | null = null;
  let nearest = Infinity;
  for (const g of ctx.state.guards) {
    if (g.state === 'DEAD' || g.hp <= 0) continue;
    const ref = guardTarget(g);
    const d = (g.pos.x - z.pos.x) ** 2 + (g.pos.z - z.pos.z) ** 2;
    if (d < nearest && canMelee(ctx, z.pos, BALANCE.walker.attackRange, ref)) {
      nearest = d; target = ref;
    }
  }
  return target;
}

export function updateCombat(ctx: SimContext, dt: number, _input: SimInput): void {
  if (ctx.state.phase !== 'playing') return;
  const leader = ctx.state.leader;
  leader.attackCooldown = Math.max(0, leader.attackCooldown - dt);
  const zombies = ctx.state.zombies;
  let write = 0;
  for (const z of zombies) {
    z.attackCooldown = Math.max(0, z.attackCooldown - dt);
    if (z.state === 'dead') {
      z.stateTime += dt;
      if (z.stateTime > BALANCE.walker.corpseFadeTime) continue;
    } else if (z.state === 'follower' && z.hp > 0 && z.attackCooldown <= 1e-9) {
      const target = followerSwingTarget(ctx, z);
      if (target) {
        melee(ctx, target, BALANCE.walker.attackDamage);
        z.attackCooldown = BALANCE.walker.attackCooldown /
          (ctx.state.abilities.rushTimeLeft > 0 ? BALANCE.rush.attackRateMultiplier : 1);
        z.anim = 'attack'; z.animTime = 0;
        ctx.emit({ type: 'melee', attacker: 'zombie', attackerId: z.id, target, pos: { ...z.pos } });
      }
    }
    zombies[write++] = z;
  }
  zombies.length = write;
  if (!leader.alive || leader.hp <= 0 || leader.sprinting || leader.attackCooldown > 1e-9) return;
  const order = ctx.state.order;
  let target: TargetRef | null = order.type === 'attack' &&
    canMelee(ctx, leader.pos, BALANCE.leader.attackRange, order.target) ? order.target : null;
  if (!target) {
    let nearest = Infinity;
    for (const g of ctx.state.guards) {
      const d = (g.pos.x - leader.pos.x) ** 2 + (g.pos.z - leader.pos.z) ** 2;
      if (d < nearest && canMelee(ctx, leader.pos, BALANCE.leader.attackRange, guardTarget(g))) {
        nearest = d; target = guardTarget(g);
      }
    }
  }
  if (target) {
    melee(ctx, target, BALANCE.leader.attackDamage);
    leader.attackCooldown = BALANCE.leader.attackCooldown; leader.anim = 'attack'; leader.animTime = 0;
    ctx.emit({ type: 'melee', attacker: 'leader', attackerId: leader.id, target, pos: { ...leader.pos } });
  }
}
