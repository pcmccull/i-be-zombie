import { BALANCE } from '../config/balance';
import type { SegmentOptions, SimContext } from '../core/contracts';
import type { AABB, GuardAgent, SimInput, TargetRef, Vec2, ZombieAgent } from '../core/types';
import { wrapAngle } from '../utils/math';
import { damageLeader, damageZombie } from './CombatSystem';

interface GuardMemory {
  sight: SegmentOptions;
  alertPos: Vec2;
  visible: boolean;
  pathVersion: number;
  retryAt: number;
  retreated: boolean;
  retreatRetryAt: number;
  aimTarget: TargetRef | null;
  aimTime: number;
}
interface Scratch {
  zombies: Map<number, ZombieAgent>;
  targets: Map<number, TargetRef>;
  candidates: number[];
  guards: WeakMap<GuardAgent, GuardMemory>;
}
const memories = new WeakMap<SimContext, Scratch>();
const leaderTarget: TargetRef = { kind: 'leader' };

function armedRange(g: GuardAgent): number {
  return g.post === 'barricade' ? BALANCE.outposts.barricadeRange
    : g.role === 'police' ? BALANCE.police.range : g.tower ? BALANCE.guard.towerRange : BALANCE.guard.range;
}

function scratch(ctx: SimContext): Scratch {
  let s = memories.get(ctx);
  if (!s) {
    s = { zombies: new Map(), targets: new Map(), candidates: [], guards: new WeakMap() };
    memories.set(ctx, s);
  }
  s.zombies.clear();
  for (const z of ctx.state.zombies) {
    s.zombies.set(z.id, z);
    if (!s.targets.has(z.id)) s.targets.set(z.id, { kind: 'zombie', id: z.id });
  }
  // Bound the reference cache when corpses have faded.
  for (const id of s.targets.keys()) if (!s.zombies.has(id)) s.targets.delete(id);
  return s;
}

function memory(ctx: SimContext, s: Scratch, g: GuardAgent, index: number): GuardMemory {
  let m = s.guards.get(g);
  if (!m) {
    m = {
      sight: { mode: 'sight', fromHeight: g.tower ? BALANCE.guard.towerEyeHeight : BALANCE.guard.eyeHeight,
        toHeight: BALANCE.targetHeights.zombieTorso,
        ignoreIds: g.towerColliderId === null ? undefined : [g.towerColliderId] },
      alertPos: { ...g.pos }, visible: false, pathVersion: ctx.navGrid.version, retryAt: 0, retreated: false, retreatRetryAt: 0,
      aimTarget: null, aimTime: 0,
    };
    s.guards.set(g, m);
    if (g.perceptionTimer === 0) g.perceptionTimer = (index + 1) / ctx.state.guards.length / BALANCE.sim.aiTickHz;
  }
  return m;
}

function targetEntity(ctx: SimContext, s: Scratch, target: TargetRef | null) {
  if (target?.kind === 'leader') return ctx.state.leader.alive && ctx.state.leader.hp > 0 ? ctx.state.leader : null;
  if (target?.kind !== 'zombie') return null;
  const z = s.zombies.get(target.id);
  return z && !z.dormant && z.hp > 0 && z.heldBy === 0 && (z.state === 'follower' || z.state === 'ambient') ? z : null;
}

function visible(ctx: SimContext, g: GuardAgent, m: GuardMemory, pos: Vec2, ambient = false): boolean {
  const dx = pos.x - g.pos.x, dz = pos.z - g.pos.z, d2 = dx * dx + dz * dz;
  const range = armedRange(g);
  if (d2 > range * range || (ambient && d2 > 8 * 8)) return false;
  if (g.state === 'PATROL' && d2 > BALANCE.guard.closeDetectRange ** 2 &&
      dx * Math.sin(g.facing) + dz * Math.cos(g.facing) <
        Math.sqrt(d2) * Math.cos(BALANCE.guard.detectionFovDeg * Math.PI / 360)) return false;
  return !ctx.collision.segmentBlocked(g.pos, pos, m.sight);
}

function alert(ctx: SimContext, g: GuardAgent, m: GuardMemory, pos: Vec2): void {
  g.state = 'ALERT'; g.stateTime = 0; g.lostTargetTimer = 0;
  m.alertPos.x = pos.x; m.alertPos.z = pos.z;
  ctx.emit({ type: 'guardAlert', guardId: g.id, pos: { ...g.pos }, role: g.role });
}

function perceive(ctx: SimContext, s: Scratch, g: GuardAgent, m: GuardMemory): void {
  const current = targetEntity(ctx, s, g.target);
  if (current && visible(ctx, g, m, current.pos, 'state' in current && current.state === 'ambient')) {
    m.visible = true;
  } else {
    g.target = null; m.visible = false;
    const range = armedRange(g);
    s.candidates.length = 0;
    ctx.zombieHash.query(g.pos.x, g.pos.z, range, s.candidates);
    let nearest = Infinity;
    for (const id of s.candidates) {
      const z = s.zombies.get(id);
      if (!z || z.dormant || z.hp <= 0 || z.heldBy !== 0 || (z.state !== 'follower' && z.state !== 'ambient')) continue;
      const d = (z.pos.x - g.pos.x) ** 2 + (z.pos.z - g.pos.z) ** 2;
      if (d < nearest && visible(ctx, g, m, z.pos, z.state === 'ambient')) {
        nearest = d; g.target = s.targets.get(id)!;
      }
    }
    const leader = ctx.state.leader;
    if (leader.alive && leader.hp > 0 && visible(ctx, g, m, leader.pos) &&
        (!g.target || ctx.rng.next() < BALANCE.guard.leaderTargetChance)) g.target = leaderTarget;
    m.visible = g.target !== null;
  }
  const target = targetEntity(ctx, s, g.target);
  if (!target || !m.visible) return;
  m.alertPos.x = target.pos.x; m.alertPos.z = target.pos.z;
  if (g.state !== 'PATROL') return;
  alert(ctx, g, m, target.pos);
  for (let i = 0; i < ctx.state.guards.length; i++) {
    const other = ctx.state.guards[i];
    if (other.role === 'civilian' || other.dormant || other.staggerTime > 0 || other.state !== 'PATROL' || other.hp <= 0 ||
        !canAssist(g, other) ||
        Math.hypot(other.pos.x - g.pos.x, other.pos.z - g.pos.z) > BALANCE.guard.alertAssistRadius) continue;
    const om = memory(ctx, s, other, i);
    alert(ctx, other, om, target.pos);
    other.facing = Math.atan2(target.pos.x - other.pos.x, target.pos.z - other.pos.z);
  }
}

function canAssist(g: GuardAgent, other: GuardAgent): boolean {
  if (g.post === 'stronghold') return other.post === 'patrol' &&
    (other.strongholdId === null || other.strongholdId === g.strongholdId) ||
    other.post === 'stronghold' && other.strongholdId === g.strongholdId;
  if (other.post === 'stronghold') return g.post === 'patrol' &&
    (g.strongholdId === null || g.strongholdId === other.strongholdId);
  return true;
}

function defenseBounds(ctx: SimContext, g: GuardAgent): AABB | undefined {
  return g.post === 'stronghold' ? ctx.layout.strongholds.find(s => s.id === g.strongholdId)?.bounds : undefined;
}

function inside(p: Vec2, b: AABB, radius: number): boolean {
  return p.x >= b.minX + radius && p.x <= b.maxX - radius &&
    p.z >= b.minZ + radius && p.z <= b.maxZ - radius;
}

function move(ctx: SimContext, g: GuardAgent, dx: number, dz: number): void {
  const bounds = defenseBounds(ctx, g);
  if (bounds && inside(g.pos, bounds, g.radius)) {
    dx = Math.max(bounds.minX + g.radius, Math.min(bounds.maxX - g.radius, g.pos.x + dx)) - g.pos.x;
    dz = Math.max(bounds.minZ + g.radius, Math.min(bounds.maxZ - g.radius, g.pos.z + dz)) - g.pos.z;
  }
  ctx.collision.moveCircle(g.pos, dx, dz, g.radius);
}

function face(g: GuardAgent, p: Vec2, dt: number): void {
  const turn = wrapAngle(Math.atan2(p.x - g.pos.x, p.z - g.pos.z) - g.facing);
  g.facing = wrapAngle(g.facing + Math.max(-BALANCE.leader.turnRate * dt, Math.min(BALANCE.leader.turnRate * dt, turn)));
}

function walkPath(ctx: SimContext, g: GuardAgent, speed: number, dt: number): boolean {
  while (g.pathIndex < g.path.length) {
    const p = g.path[g.pathIndex], dx = p.x - g.pos.x, dz = p.z - g.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) { g.pathIndex++; continue; }
    const step = Math.min(d, speed * dt);
    move(ctx, g, dx / d * step, dz / d * step);
    face(g, p, dt);
    return false;
  }
  return true;
}

/** A sealed destination (e.g. a closed compound) is approached as close as the street network allows. */
function approachPath(ctx: SimContext, g: GuardAgent, wp: Vec2): Vec2[] | null {
  for (const radius of [4, 8, 14, 22, 32]) for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const p = { x: wp.x + Math.sin(a) * radius, z: wp.z + Math.cos(a) * radius };
    if (!ctx.navGrid.isWalkable(p) || ctx.collision.isBlocked(p, g.radius)) continue;
    const path = ctx.navGrid.findPath(g.pos, p);
    if (path) return path;
  }
  return null;
}

function patrol(ctx: SimContext, g: GuardAgent, m: GuardMemory, dt: number): void {
  if (g.tower) return;
  if (g.idleTimer > 0) {
    g.idleTimer = Math.max(0, g.idleTimer - dt); g.facing = wrapAngle(g.facing + dt * 0.6);
    return;
  }
  if (!g.waypoints.length || ctx.state.time < m.retryAt) return;
  if (m.pathVersion !== ctx.navGrid.version) { g.path.length = 0; m.pathVersion = ctx.navGrid.version; }
  if (!g.path.length) {
    const wp = g.waypoints[g.waypointIndex];
    const path = ctx.navGrid.findPath(g.pos, wp) ?? (g.post === 'patrol' ? approachPath(ctx, g, wp) : null);
    if (!path) { m.retryAt = ctx.state.time + BALANCE.guard.patrolIdleTime; return; }
    g.path = path; g.pathIndex = 0;
  }
  const x = g.pos.x, z = g.pos.z;
  if (walkPath(ctx, g, g.role === 'civilian' ? BALANCE.civilian.walkSpeed : BALANCE.guard.speed, dt)) {
    g.path.length = 0; g.pathIndex = 0;
    g.waypointIndex = (g.waypointIndex + 1) % g.waypoints.length;
    g.idleTimer = BALANCE.guard.patrolIdleTime;
  } else if (dt > 0 && g.pos.x === x && g.pos.z === z) {
    g.path.length = 0; m.retryAt = ctx.state.time + 1 / BALANCE.sim.aiTickHz;
  }
}

function tryRetreat(ctx: SimContext, s: Scratch, g: GuardAgent, m: GuardMemory): void {
  if (g.tower || m.retreated || ctx.state.time < m.retreatRetryAt ||
      g.hp >= BALANCE.guard.retreatHpFraction * g.maxHp) return;
  m.retreatRetryAt = ctx.state.time + 1 / BALANCE.sim.aiTickHz;
  s.candidates.length = 0; ctx.zombieHash.query(g.pos.x, g.pos.z, 6, s.candidates);
  let count = 0, x = 0, z = 0;
  for (const id of s.candidates) {
    const zombie = s.zombies.get(id);
    if (zombie?.state !== 'follower' || zombie.dormant || zombie.hp <= 0 ||
        Math.hypot(zombie.pos.x - g.pos.x, zombie.pos.z - g.pos.z) > 6) continue;
    count++; x += zombie.pos.x; z += zombie.pos.z;
  }
  if (count < 3) return;
  const angle = Math.atan2(g.pos.x - x / count, g.pos.z - z / count);
  const strongholdBounds = defenseBounds(ctx, g);
  const bounds = strongholdBounds ?? ctx.layout.checkpoint.bounds;
  // First try inside the compound; every candidate must have an actual route.
  for (let pass = 0; pass < 2; pass++) for (const offset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const p = { x: g.pos.x + Math.sin(angle + offset) * 8, z: g.pos.z + Math.cos(angle + offset) * 8 };
    const inBounds = inside(p, bounds, g.radius);
    if ((pass === 0) !== inBounds || strongholdBounds && !inBounds ||
        ctx.collision.isBlocked(p, g.radius) || !ctx.navGrid.isWalkable(p)) continue;
    const path = ctx.navGrid.findPath(g.pos, p);
    if (!path || strongholdBounds && path.some(point => !inside(point, bounds, g.radius))) continue;
    g.path = path; g.pathIndex = 0; g.state = 'RETREAT'; g.stateTime = 0; m.retreated = true;
    return;
  }
}

function fire(ctx: SimContext, s: Scratch, g: GuardAgent, m: GuardMemory): void {
  if (g.role === 'civilian' || g.role === 'police' && m.aimTime + 1e-9 < BALANCE.police.aimDelay) return;
  const target = targetEntity(ctx, s, g.target);
  if (!target || !m.visible || g.attackCooldown > 1e-9) return;
  // Visibility is cached at 10 Hz, but geometry and target life are authoritative at fire time.
  if (!visible(ctx, g, m, target.pos, 'state' in target && target.state === 'ambient')) {
    m.aimTarget = null; m.aimTime = 0;
    return;
  }
  const barricade = g.post === 'barricade';
  const weapon = g.role === 'police' ? BALANCE.police : BALANCE.guard;
  const hit = ctx.rng.next() < (barricade ? BALANCE.outposts.barricadeHitChance : weapon.hitChance);
  const damage = barricade ? BALANCE.outposts.barricadeDamage : weapon.damage;
  const to = { x: target.pos.x, y: BALANCE.targetHeights.zombieTorso, z: target.pos.z };
  if (hit) {
    if (g.target?.kind === 'leader') damageLeader(ctx, damage);
    else damageZombie(ctx, target as ZombieAgent, damage);
  } else {
    const dx = target.pos.x - g.pos.x, dz = target.pos.z - g.pos.z, d = Math.hypot(dx, dz) || 1;
    const offset = (ctx.rng.next() < 0.5 ? -1 : 1) * (0.8 + ctx.rng.next() * 0.4);
    to.x += dz / d * offset; to.z -= dx / d * offset;
  }
  ctx.emit({ type: 'shot', guardId: g.id,
    from: { x: g.pos.x, y: g.elevation + BALANCE.guard.eyeHeight - 0.1, z: g.pos.z }, to, hit });
  g.attackCooldown = weapon.fireCooldown; g.anim = 'attack'; g.animTime = 0;
}

function outsideBy(r: AABB, p: Vec2): number {
  return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
}

function updateCivilian(ctx: SimContext, s: Scratch, g: GuardAgent, m: GuardMemory, dt: number): void {
  if (g.perceptionTimer <= 1e-9) {
    g.perceptionTimer = 1 / BALANCE.sim.aiTickHz;
    g.target = null; m.visible = false;
    let nearest = BALANCE.civilian.panicRadius ** 2;
    const leader = ctx.state.leader;
    if (leader.alive && leader.hp > 0) {
      const d = (leader.pos.x - g.pos.x) ** 2 + (leader.pos.z - g.pos.z) ** 2;
      if (d <= nearest && !ctx.collision.segmentBlocked(g.pos, leader.pos, m.sight)) {
        nearest = d; g.target = leaderTarget;
      }
    }
    s.candidates.length = 0;
    ctx.zombieHash.query(g.pos.x, g.pos.z, BALANCE.civilian.panicRadius, s.candidates);
    for (const id of s.candidates) {
      const z = s.zombies.get(id);
      if (!z || z.dormant || z.hp <= 0 || z.heldBy !== 0 || (z.state !== 'ambient' && z.state !== 'follower')) continue;
      const d = (z.pos.x - g.pos.x) ** 2 + (z.pos.z - g.pos.z) ** 2;
      if (d <= nearest && !ctx.collision.segmentBlocked(g.pos, z.pos, m.sight)) {
        nearest = d; g.target = s.targets.get(id)!;
      }
    }
    m.visible = g.target !== null;
  }
  const threat = targetEntity(ctx, s, g.target);
  if (!threat) { g.target = null; m.visible = false; }
  g.lostTargetTimer = m.visible ? 0 : g.lostTargetTimer + dt;
  if (m.visible && g.state !== 'RETREAT') {
    g.state = 'RETREAT'; g.stateTime = 0; g.path.length = 0;
    ctx.emit({ type: 'guardAlert', guardId: g.id, pos: { ...g.pos }, role: g.role });
  }
  if (g.state === 'RETREAT') {
    if (threat && m.visible) {
      const dx = g.pos.x - threat.pos.x, dz = g.pos.z - threat.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-9) {
        ctx.collision.moveCircle(g.pos, dx / d * BALANCE.civilian.fleeSpeed * dt,
          dz / d * BALANCE.civilian.fleeSpeed * dt, g.radius);
        g.facing = Math.atan2(dx, dz);
      }
    } else if (g.lostTargetTimer >= BALANCE.civilian.calmTime) {
      g.state = 'PATROL'; g.stateTime = 0; g.path.length = 0;
    }
  } else if (g.state === 'PATROL') patrol(ctx, g, m, dt);
  // Fleeing street civilians may run out of their home area; calm ones walk back via their waypoints.
  if (g.homeArea && !(g.post === 'street' && (g.state === 'RETREAT' || outsideBy(g.homeArea, g.pos) > 1.5))) {
    const r = g.homeArea;
    g.pos.x = Math.max(r.minX + g.radius, Math.min(r.maxX - g.radius, g.pos.x));
    g.pos.z = Math.max(r.minZ + g.radius, Math.min(r.maxZ - g.radius, g.pos.z));
  }
}

export function updateHumanAI(ctx: SimContext, dt: number, _input: SimInput): void {
  if (ctx.state.phase !== 'playing' && ctx.state.phase !== 'respawning') return;
  const s = scratch(ctx);
  for (let index = 0; index < ctx.state.guards.length; index++) {
    const g = ctx.state.guards[index];
    if (g.dormant || g.state === 'DEAD' || g.hp <= 0) continue;
    if (g.staggerTime > 0) {
      g.staggerTime = Math.max(0, g.staggerTime - dt);
      g.vel.x = g.vel.z = 0;
      continue;
    }
    const m = memory(ctx, s, g, index);
    const x = g.pos.x, z = g.pos.z;
    g.vel.x = g.vel.z = 0; g.stateTime += dt;
    g.attackCooldown = Math.max(0, g.attackCooldown - dt);
    g.perceptionTimer -= dt;
    if (g.role === 'civilian') {
      updateCivilian(ctx, s, g, m, dt);
      g.vel.x = dt > 0 ? (g.pos.x - x) / dt : 0; g.vel.z = dt > 0 ? (g.pos.z - z) / dt : 0;
      if (!(g.anim === 'hit' && g.animTime < 0.35)) {
        const anim = Math.hypot(g.vel.x, g.vel.z) > 0.05 ? (g.state === 'RETREAT' ? 'run' : 'walk') : 'idle';
        if (g.anim !== anim) { g.anim = anim; g.animTime = 0; }
      }
      continue;
    }
    if (g.perceptionTimer <= 1e-9) {
      g.perceptionTimer += 1 / BALANCE.sim.aiTickHz;
      if (g.perceptionTimer <= 0) g.perceptionTimer = 1 / BALANCE.sim.aiTickHz;
      perceive(ctx, s, g, m);
    }
    const target = targetEntity(ctx, s, g.target);
    if (!target) { g.target = null; m.visible = false; }
    if (m.visible && g.target) {
      m.aimTime = m.aimTarget === g.target ? m.aimTime + dt : 0;
      m.aimTarget = g.target;
    } else { m.aimTarget = null; m.aimTime = 0; }
    g.lostTargetTimer = m.visible ? 0 : g.lostTargetTimer + dt;
    if (g.state === 'PATROL') patrol(ctx, g, m, dt);
    else if (g.state === 'ALERT') {
      face(g, target?.pos ?? m.alertPos, dt);
      if (m.visible && g.stateTime >= BALANCE.guard.alertToCombatTime) { g.state = 'COMBAT'; g.stateTime = 0; }
      else if (g.lostTargetTimer >= BALANCE.guard.loseTargetTime) {
        g.state = 'PATROL'; g.stateTime = 0; g.path.length = 0; m.retreated = false;
      }
    }
    if (g.state === 'COMBAT' || g.state === 'RETREAT') {
      if (g.state === 'COMBAT') tryRetreat(ctx, s, g, m);
      if (g.state === 'RETREAT') {
        if (g.stateTime >= 3 || walkPath(ctx, g, BALANCE.guard.speed, dt)) {
          g.state = 'COMBAT'; g.stateTime = 0; g.path.length = 0;
        }
      } else if (!g.tower) {
        s.candidates.length = 0; ctx.zombieHash.query(g.pos.x, g.pos.z, 2.5, s.candidates);
        let nearest: ZombieAgent | null = null, distance = 2.5;
        for (const id of s.candidates) {
          const zombie = s.zombies.get(id);
          if (!zombie || zombie.dormant || zombie.heldBy !== 0 || zombie.hp <= 0 ||
              (zombie.state !== 'follower' && zombie.state !== 'ambient')) continue;
          const d = Math.hypot(g.pos.x - zombie.pos.x, g.pos.z - zombie.pos.z);
          if (d < distance) { distance = d; nearest = zombie; }
        }
        if (nearest && distance > 1e-9) move(ctx, g,
          (g.pos.x - nearest.pos.x) / distance * BALANCE.guard.speed * 0.6 * dt,
          (g.pos.z - nearest.pos.z) / distance * BALANCE.guard.speed * 0.6 * dt);
      }
      if (target) face(g, target.pos, dt);
      fire(ctx, s, g, m);
      if (g.lostTargetTimer >= BALANCE.guard.loseTargetTime) {
        g.state = g.post === 'patrol' ? 'PATROL' : 'ALERT';
        g.stateTime = 0; g.lostTargetTimer = 0; g.path.length = 0; m.retreated = false;
      }
    }
    g.vel.x = dt > 0 ? (g.pos.x - x) / dt : 0; g.vel.z = dt > 0 ? (g.pos.z - z) / dt : 0;
    if (!((g.anim === 'attack' || g.anim === 'hit') && g.animTime < 0.35)) {
      const anim = Math.hypot(g.vel.x, g.vel.z) > 0.05 ? 'walk' : 'idle';
      if (g.anim !== anim) { g.anim = anim; g.animTime = 0; }
    }
  }
}
