// [pure] Named collectible zombie companions: discovery, active slots, recovery, and light comic perks.
// Spec: docs/11_cityupgrade.md §4.1.B.
import { BALANCE } from '../config/balance';
import { COMPANIONS } from '../content/rewards';
import type { SimContext } from '../core/contracts';
import type { CompanionAgentState, CompanionId, SimInput, ZombieAgent } from '../core/types';
import { createZombie } from '../entities/Zombie';
import { damageGuard } from './CombatSystem';
import { followerCap, recruitZombie } from './HordeSystem';
import { grantReward } from './RewardSystem';

export function toggleCompanionSlot(ctx: SimContext, id: CompanionId): boolean {
  const r = ctx.state.rewards;
  if (!r.unlockedCompanionIds.includes(id)) return false;
  const idx = r.activeCompanionIds.indexOf(id);
  if (idx >= 0) {
    r.activeCompanionIds.splice(idx, 1);
    despawnCompanionZombie(ctx, id);
    ctx.emit({ type: 'autosave', reason: 'equip' });
    return true;
  }
  if (r.activeCompanionIds.length >= BALANCE.city.maxActiveCompanions) {
    const removed = r.activeCompanionIds.shift();
    if (removed) despawnCompanionZombie(ctx, removed);
  }
  r.activeCompanionIds.push(id);
  ctx.emit({ type: 'autosave', reason: 'equip' });
  return true;
}

function despawnCompanionZombie(ctx: SimContext, id: CompanionId): void {
  const entry = ctx.state.companions.find(c => c.id === id);
  if (entry && entry.zombieId !== null) {
    const idx = ctx.state.zombies.findIndex(z => z.id === entry.zombieId);
    if (idx >= 0) {
      if (ctx.state.zombies[idx].state === 'follower') ctx.state.followerCount = Math.max(0, ctx.state.followerCount - 1);
      ctx.state.zombies.splice(idx, 1);
    }
    entry.zombieId = null;
  }
}

function ensureCompanionEntry(ctx: SimContext, id: CompanionId): CompanionAgentState {
  let entry = ctx.state.companions.find(c => c.id === id);
  if (!entry) {
    entry = { id, zombieId: null, recoverAt: 0, abilityCooldown: 0 };
    ctx.state.companions.push(entry);
  }
  return entry;
}

export function updateCompanions(ctx: SimContext, dt: number, input: SimInput): void {
  if (ctx.layout.strongholds.length === 0) return;
  const state = ctx.state;

  if (input.toggleCompanion) {
    toggleCompanionSlot(ctx, input.toggleCompanion);
  }

  // 1. Proximity discovery of named companions in the world
  if (state.leader.alive && state.phase === 'playing') {
    const lp = state.leader.pos;
    for (const def of COMPANIONS) {
      if (state.rewards.unlockedCompanionIds.includes(def.id)) continue;
      const dx = lp.x - def.unlockPos.x;
      const dz = lp.z - def.unlockPos.z;
      if (dx * dx + dz * dz <= 5.5 * 5.5) {
        grantReward(ctx, def.rewardId);
        if (state.rewards.activeCompanionIds.length < BALANCE.city.maxActiveCompanions) {
          state.rewards.activeCompanionIds.push(def.id);
        }
        ctx.emit({ type: 'companionRecruited', companionId: def.id, name: def.name, pos: { ...def.unlockPos } });
      }
    }
  }

  // 2. Maintain active companions (spawn / recover / comic perks)
  if (!state.leader.alive || state.phase !== 'playing' || state.rewards.activeCompanionIds.length === 0) return;

  for (const id of state.rewards.activeCompanionIds) {
    const entry = ensureCompanionEntry(ctx, id);
    const z = entry.zombieId !== null ? state.zombies.find(zz => zz.id === entry.zombieId) : undefined;
    if (!z || z.hp <= 0 || z.state === 'dead') {
      if (entry.zombieId !== null) {
        entry.zombieId = null;
        entry.recoverAt = state.time + BALANCE.city.companionRecoverTime;
      }
      if (state.time >= entry.recoverAt && state.followerCount < followerCap(ctx) + BALANCE.city.maxActiveCompanions) {
        const angle = ctx.rng.next() * Math.PI * 2;
        const pos = {
          x: state.leader.pos.x + Math.cos(angle) * 2.0,
          z: state.leader.pos.z + Math.sin(angle) * 2.0,
        };
        const cz = createZombie(ctx.newId(), pos, {
          state: 'follower',
          variant: id === 'larry_lifeguard' ? 1 : id === 'chef_brainsley' ? 2 : 3,
          spawnZone: -1,
          isConverted: false,
          rng: ctx.rng,
        });
        cz.speedScale = id === 'larry_lifeguard' ? 1.15 : 1.05;
        cz.hp = cz.maxHp = 75;
        state.zombies.push(cz);
        state.followerCount++;
        entry.zombieId = cz.id;
      }
      continue;
    }

    // Light comic utility perk on cooldown (fires only when it has something to do; retries each second otherwise)
    entry.abilityCooldown = Math.max(0, entry.abilityCooldown - dt);
    if (entry.abilityCooldown <= 0) {
      const label = companionPerk(ctx, id, z);
      entry.abilityCooldown = label ? BALANCE.city.companionSkillCooldown : 1;
      if (label) ctx.emit({ type: 'companionPerk', companionId: id, pos: { x: z.pos.x, z: z.pos.z }, label });
    }
  }
}

/**
 * One perk use; returns its label, or null when there was nothing to do (no cooldown spent).
 * Larry: whistle pulls nearby stray zombies into the horde. Chef: pan clang freezes nearby civilians.
 * Grandma: handbag wallop staggers and hurts humans in reach. Balanced as small assists, never stacking buffs.
 */
function companionPerk(ctx: SimContext, id: CompanionId, z: ZombieAgent): string | null {
  const state = ctx.state;
  const c = BALANCE.city;
  if (id === 'larry_lifeguard') {
    const r2 = c.larryWhistleRadius ** 2;
    let n = 0;
    for (const other of state.zombies) {
      if (n >= c.larryWhistleRecruits) break;
      if (other.state !== 'ambient' || other.heldBy !== 0 || other.hp <= 0 || other.dormant) continue;
      const dx = other.pos.x - z.pos.x, dz = other.pos.z - z.pos.z;
      if (dx * dx + dz * dz > r2) continue;
      if (recruitZombie(ctx, other, true)) n++;
    }
    return n > 0 ? 'Larry blows his whistle!' : null;
  }
  if (id === 'chef_brainsley') {
    let n = 0;
    for (const g of state.guards) {
      if (g.dormant || g.hp <= 0 || g.role !== 'civilian' || g.state === 'DEAD') continue;
      const dx = g.pos.x - z.pos.x, dz = g.pos.z - z.pos.z;
      if (dx * dx + dz * dz <= 12 * 12) { g.staggerTime = Math.max(g.staggerTime, 0.8); n++; }
    }
    return n > 0 ? 'Chef Brainsley bangs his pans!' : null;
  }
  // grandma_rot
  const r2 = c.grandmaReach ** 2;
  let n = 0;
  for (const g of state.guards) {
    if (g.dormant || g.hp <= 0 || g.state === 'DEAD') continue;
    const dx = g.pos.x - z.pos.x, dz = g.pos.z - z.pos.z;
    if (dx * dx + dz * dz > r2) continue;
    g.staggerTime = Math.max(g.staggerTime, c.grandmaStagger);
    damageGuard(ctx, g, c.grandmaDamage, 'zombie');
    n++;
  }
  return n > 0 ? 'Grandma Rot swings her handbag!' : null;
}
