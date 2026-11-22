// [pure] Unified reward grant, Brains currency, cosmetics equip, achievements, and secrets (docs/11_cityupgrade.md §4).
import { ACHIEVEMENTS, HIDEOUTS, REWARD_BY_ID, SECRETS } from '../content/rewards';
import type { SimContext } from '../core/contracts';
import type { CosmeticSlot, GameEvent, SimInput, Vec2 } from '../core/types';
import { followerCap } from './HordeSystem';

export function addBrains(ctx: SimContext, amount: number, reason: string, pos?: Vec2): void {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  const r = ctx.state.rewards;
  const gain = Math.round(amount);
  r.brains += gain;
  ctx.emit({ type: 'brainsGain', amount: gain, total: r.brains, reason, pos: pos ? { ...pos } : undefined });
}

export function grantReward(ctx: SimContext, rewardId: string): boolean {
  const def = REWARD_BY_ID[rewardId];
  if (!def) return false;
  const r = ctx.state.rewards;
  if (def.unique && r.unlockedRewardIds.includes(rewardId)) return false;
  r.unlockedRewardIds.push(rewardId);

  if (def.type === 'companion' && def.companionId && !r.unlockedCompanionIds.includes(def.companionId)) {
    r.unlockedCompanionIds.push(def.companionId);
  }
  if (def.type === 'vehicle' && def.vehicleKind && !r.unlockedVehicleIds.includes(def.vehicleKind)) {
    r.unlockedVehicleIds.push(def.vehicleKind);
    if (!r.activeVehicleId) r.activeVehicleId = def.vehicleKind;
  }
  if (def.type === 'hideout' && def.hideoutId && !r.unlockedHideoutIds.includes(def.hideoutId)) {
    r.unlockedHideoutIds.push(def.hideoutId);
  }

  ctx.emit({ type: 'rewardGranted', rewardId: def.id, rewardType: def.type, displayName: def.displayName });
  ctx.emit({ type: 'autosave', reason: 'unlock' });
  return true;
}

export function buyReward(ctx: SimContext, rewardId: string): boolean {
  const def = REWARD_BY_ID[rewardId];
  if (!def || def.costBrains === undefined) return false;
  const r = ctx.state.rewards;
  if (def.unique && r.unlockedRewardIds.includes(rewardId)) return false;
  if (r.brains < def.costBrains) return false;
  r.brains -= def.costBrains;
  grantReward(ctx, rewardId);
  ctx.emit({ type: 'autosave', reason: 'equip' });
  return true;
}

export function equipCosmetic(ctx: SimContext, slot: CosmeticSlot, rewardId: string | null): boolean {
  const r = ctx.state.rewards;
  if (rewardId !== null) {
    const def = REWARD_BY_ID[rewardId];
    if (!def || def.type !== 'cosmetic' || def.slot !== slot) return false;
    if (!r.unlockedRewardIds.includes(rewardId)) return false;
  }
  if (r.equippedCosmeticIdsBySlot[slot] === rewardId) return true;
  r.equippedCosmeticIdsBySlot[slot] = rewardId;
  ctx.emit({ type: 'cosmeticEquipped', slot, rewardId });
  ctx.emit({ type: 'autosave', reason: 'equip' });
  return true;
}

export function recordAchievementProgress(
  ctx: SimContext,
  statKey: string,
  value: number,
  mode: 'add' | 'max' = 'add',
): void {
  const progress = ctx.state.rewards.achievementProgress;
  const prev = progress[statKey] ?? 0;
  const next = mode === 'max' ? Math.max(prev, value) : prev + value;
  progress[statKey] = next;

  for (const ach of ACHIEVEMENTS) {
    if (ach.statKey !== statKey) continue;
    const doneKey = `done:${ach.id}`;
    if (progress[doneKey]) continue;
    if (next >= ach.threshold) {
      progress[doneKey] = 1;
      grantReward(ctx, ach.rewardId);
      if (ach.brainsBonus > 0) addBrains(ctx, ach.brainsBonus, `achievement:${ach.id}`);
    }
  }
}

export function updateRewards(ctx: SimContext, input: SimInput, stepEvents: readonly GameEvent[]): void {
  if (input.buyReward) buyReward(ctx, input.buyReward);
  if (input.equipCosmetic) equipCosmetic(ctx, input.equipCosmetic.slot, input.equipCosmetic.rewardId);

  for (const ev of stepEvents) {
    switch (ev.type) {
      case 'converted':
        addBrains(ctx, 2, 'convert', ev.pos);
        recordAchievementProgress(ctx, 'civiliansInfected', 1, 'add');
        recordAchievementProgress(ctx, 'crowdsInterrupted', 1, 'add');
        break;
      case 'guardDied':
        if (ev.role === 'civilian') {
          addBrains(ctx, 1, 'infect', ev.pos);
          recordAchievementProgress(ctx, 'civiliansInfected', 1, 'add');
        } else {
          addBrains(ctx, 3, 'defender', ev.pos);
        }
        break;
      case 'recruited':
        recordAchievementProgress(ctx, 'totalRecruited', 1, 'add');
        break;
      case 'vehicleCrash':
      case 'driverBailed':
        addBrains(ctx, 2, 'traffic', ev.pos);
        recordAchievementProgress(ctx, 'trafficIncidents', 1, 'add');
        break;
      case 'structureDestroyed':
        addBrains(ctx, 4, 'structure', ev.pos);
        recordAchievementProgress(ctx, 'structuresBroken', 1, 'add');
        break;
      case 'worldInteractable':
        addBrains(ctx, 2, 'interactable', ev.pos);
        recordAchievementProgress(ctx, 'interactablesUsed', 1, 'add');
        break;
      case 'cityEventResolved':
        if (ev.outcome === 'completed') {
          recordAchievementProgress(ctx, 'eventsDisrupted', 1, 'add');
        }
        break;
      case 'hordeUnlocked': {
        addBrains(ctx, 10, 'first_nest', ev.pos);
        const startHideout = HIDEOUTS.find(h => h.strongholdId === null);
        if (startHideout && grantReward(ctx, startHideout.rewardId)) {
          ctx.emit({ type: 'hideoutUnlocked', hideoutId: startHideout.id, name: startHideout.name, pos: startHideout.pos });
        }
        break;
      }
      case 'strongholdCaptured': {
        addBrains(ctx, 15, 'stronghold', ctx.state.leader.pos);
        for (const h of HIDEOUTS) {
          if (h.strongholdId === ev.strongholdId && grantReward(ctx, h.rewardId)) {
            ctx.emit({ type: 'hideoutUnlocked', hideoutId: h.id, name: h.name, pos: h.pos });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  recordAchievementProgress(ctx, 'maxHordeSize', Math.min(ctx.state.followerCount, followerCap(ctx)), 'max');

  // Secret proximity discovery (open world)
  if (ctx.layout.strongholds.length > 0 && ctx.state.leader.alive && ctx.state.phase === 'playing') {
    const lp = ctx.state.leader.pos;
    const discovered = ctx.state.rewards.discoveredSecretIds;
    for (const secret of SECRETS) {
      if (discovered.includes(secret.id)) continue;
      const dx = lp.x - secret.pos.x;
      const dz = lp.z - secret.pos.z;
      if (dx * dx + dz * dz <= secret.radius * secret.radius) {
        discovered.push(secret.id);
        addBrains(ctx, secret.brainsReward, `secret:${secret.id}`, secret.pos);
        if (secret.rewardId) grantReward(ctx, secret.rewardId);
        ctx.emit({ type: 'secretDiscovered', secretId: secret.id, title: secret.title, pos: { ...secret.pos } });
        ctx.emit({ type: 'autosave', reason: 'discover' });
      }
    }
  }
}
