// [pure] Mutations, biomass and ability loadout (docs/3_open_world.md §4E). OWNER: T005.
import { BALANCE } from '../config/balance';
import { ABILITIES } from '../content/abilities';
import type { AbilityDenyReason, SimContext } from '../core/contracts';
import type { AbilityDef, AbilityId, GameEvent, GameState, SimInput, ZombieAgent } from '../core/types';
import { evolveToBrute } from '../entities/Zombie';
import { isNestActive } from './ConquestSystem';

type BiomassReason = Extract<GameEvent, { type: 'biomassGain' }>['reason'];

export function addBiomass(ctx: SimContext, amount: number, reason: BiomassReason): void {
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  const p = ctx.state.progression;
  p.biomass += amount;
  ctx.emit({ type: 'biomassGain', amount, total: p.biomass, reason });
}

function abilityDef(id: AbilityId): AbilityDef | undefined {
  return Object.hasOwn(ABILITIES, id) ? ABILITIES[id] : undefined;
}

export function isUnlocked(state: GameState, id: AbilityId): boolean {
  const def = abilityDef(id);
  return def !== undefined && (def.slotBehavior === 'innate' || state.progression.unlocked.includes(id));
}
export function ownedSlotCount(state: GameState): number {
  const n = state.progression.slotsOwned;
  return Number.isFinite(n) ? Math.max(0, Math.min(BALANCE.progression.slots, Math.floor(n))) : 0;
}
export function nextSlotCost(state: GameState): number | null {
  const owned = ownedSlotCount(state);
  if (owned === 0 || owned >= BALANCE.progression.slots) return null;
  return BALANCE.progression.slotCosts[owned] ?? null;
}
/** Equipped only counts in owned slots (a stray entry in an unowned slot is ignored). */
export function isEquipped(state: GameState, id: AbilityId): boolean {
  return state.progression.equipped.indexOf(id) >= 0 && state.progression.equipped.indexOf(id) < ownedSlotCount(state);
}

function leaderAtActiveNest(ctx: SimContext): boolean {
  const leader = ctx.state.leader;
  return leader.alive && leader.hp > 0 && ctx.layout.nests.some(n =>
    (leader.pos.x - n.pos.x) ** 2 + (leader.pos.z - n.pos.z) ** 2 <= BALANCE.nest.equipRadius ** 2 &&
    isNestActive(ctx, n.id));
}

function eligibleForBrute(z: ZombieAgent): boolean {
  return z.state === 'follower' && z.hp > 0 && !z.dormant && !z.brute;
}

function livingBrutes(state: GameState): number {
  let count = 0;
  for (const z of state.zombies) if (z.brute && z.state !== 'dead' && z.hp > 0) count++;
  return count;
}

export function canActivate(state: GameState, id: AbilityId): AbilityDenyReason | null {
  const def = abilityDef(id);
  if (!def) return 'empty';
  if (!state.leader.alive || state.leader.hp <= 0 || state.phase !== 'playing') return 'locked';
  if (!isUnlocked(state, id) || !isEquipped(state, id)) return 'locked';
  // Pounce is registry data only in this milestone; never spend for an absent effect.
  if (!def.activatable || (id !== 'rush' && id !== 'horde_frenzy' && id !== 'brute_evolution')) return 'locked';
  if ((state.progression.cooldowns[id] ?? 0) > 0) return 'cooldown';
  const cost = id === 'brute_evolution' ? BALANCE.brute.costPerBrute : def.biomassCost;
  if (state.progression.biomass < cost) return 'biomass';
  if (id === 'brute_evolution' && (livingBrutes(state) >= BALANCE.brute.maxBrutes ||
    !state.zombies.some(eligibleForBrute))) return 'noTarget';
  return null;
}

export function activateAbility(ctx: SimContext, id: AbilityId): boolean {
  const reason = canActivate(ctx.state, id);
  if (reason !== null) {
    ctx.emit({ type: 'abilityDenied', abilityId: id, reason });
    return false;
  }
  const { state } = ctx, p = state.progression, def = ABILITIES[id];
  if (id === 'brute_evolution') {
    const origin = state.leader.pos;
    const distanceSq = (z: ZombieAgent): number => (z.pos.x - origin.x) ** 2 + (z.pos.z - origin.z) ** 2;
    const targets = state.zombies.filter(eligibleForBrute).sort((a, b) => distanceSq(a) - distanceSq(b) || a.id - b.id);
    const count = Math.min(targets.length, BALANCE.brute.maxPerActivation,
      BALANCE.brute.maxBrutes - livingBrutes(state), Math.floor(p.biomass / BALANCE.brute.costPerBrute));
    p.biomass -= count * BALANCE.brute.costPerBrute;
    p.cooldowns[id] = def.cooldown;
    for (let i = 0; i < count; i++) evolveToBrute(targets[i]);
    for (let i = 0; i < count; i++) {
      const z = targets[i];
      ctx.emit({ type: 'bruteEvolved', zombieId: z.id, pos: { ...z.pos } });
    }
  } else if (id === 'rush') {
    // Reuses the horde Rush timers: HordeSystem ticks rushTimeLeft (emits rushEnd), applies the speed boost and the
    // civilian chase rule; CombatSystem applies the attack-rate boost.
    p.biomass -= def.biomassCost;
    p.cooldowns[id] = def.cooldown;
    state.abilities.rushTimeLeft = BALANCE.rush.duration;
    state.abilities.rushCooldown = BALANCE.rush.cooldown;
    ctx.emit({ type: 'rushStart' });
  } else {
    p.biomass -= def.biomassCost;
    p.cooldowns[id] = def.cooldown;
    p.frenzyTimeLeft = BALANCE.frenzy.duration;
    ctx.emit({ type: 'frenzyStart', pos: { ...state.leader.pos }, radius: BALANCE.frenzy.radius });
  }
  ctx.emit({ type: 'abilityUsed', abilityId: id, pos: { ...state.leader.pos } });
  return true;
}

export function unlockAbility(ctx: SimContext, id: AbilityId): boolean {
  const def = abilityDef(id);
  if (!def || isUnlocked(ctx.state, id)) return false;
  const p = ctx.state.progression;
  p.unlocked.push(id);
  if (def.slotBehavior === 'slot' && p.slotsOwned === 0) p.slotsOwned = 1;
  const emptySlot = p.equipped.indexOf(null);
  const slot = def.slotBehavior === 'slot' && emptySlot >= 0 && emptySlot < ownedSlotCount(ctx.state) ? emptySlot : null;
  if (slot !== null) p.equipped[slot] = id;
  ctx.emit({ type: 'abilityUnlocked', abilityId: id, slot });
  return true;
}

export function equipAbility(ctx: SimContext, slot: number, id: AbilityId | null): boolean {
  const def = id === null ? undefined : abilityDef(id);
  if (!Number.isInteger(slot) || slot < 0 || slot >= ownedSlotCount(ctx.state) ||
    (id !== null && (!def || def.slotBehavior !== 'slot' || !isUnlocked(ctx.state, id)))) {
    ctx.emit({ type: 'abilityDenied', abilityId: id, reason: 'locked' });
    return false;
  }
  if (ctx.state.phase !== 'playing') {
    ctx.emit({ type: 'abilityDenied', abilityId: id, reason: 'locked' });
    return false;
  }
  if (!leaderAtActiveNest(ctx)) {
    ctx.emit({ type: 'abilityDenied', abilityId: id, reason: 'notAtNest' });
    return false;
  }
  const equipped = ctx.state.progression.equipped;
  if (id !== null) {
    for (let i = 0; i < equipped.length; i++) if (equipped[i] === id) equipped[i] = null;
  }
  equipped[slot] = id;
  ctx.emit({ type: 'abilityEquipped', abilityId: id, slot });
  return true;
}

export function buySlot(ctx: SimContext): boolean {
  const { state } = ctx, p = state.progression;
  const deny = (reason: AbilityDenyReason): false => {
    ctx.emit({ type: 'abilityDenied', abilityId: null, reason });
    return false;
  };
  if (state.phase !== 'playing' || !state.leader.alive || state.leader.hp <= 0) return deny('locked');
  const owned = ownedSlotCount(state);
  if (owned < 1) return deny('locked');
  if (owned >= BALANCE.progression.slots) return deny('maxSlots');
  if (!leaderAtActiveNest(ctx)) return deny('notAtNest');
  const cost = nextSlotCost(state);
  if (cost === null) return deny('maxSlots');
  if (p.biomass < cost) return deny('biomass');
  p.biomass = Math.max(0, p.biomass - cost);
  p.slotsOwned = owned + 1;
  ctx.emit({ type: 'slotPurchased', slot: owned, cost });
  ctx.emit({ type: 'autosave', reason: 'equip' });
  return true;
}

export function updateProgression(ctx: SimContext, dt: number, input: SimInput): void {
  const p = ctx.state.progression;
  for (const id of Object.keys(p.cooldowns) as AbilityId[]) {
    p.cooldowns[id] = Math.max(0, (p.cooldowns[id] ?? 0) - dt);
  }
  // Advance existing effects before input so a new activation gets its full duration.
  if (p.frenzyTimeLeft > 0) {
    p.frenzyTimeLeft = Math.max(0, p.frenzyTimeLeft - dt);
    if (p.frenzyTimeLeft === 0) ctx.emit({ type: 'frenzyEnd' });
  }
  if (input.abilitySlot !== null) {
    const slot = input.abilitySlot;
    const id = Number.isInteger(slot) && slot >= 0 && slot < ownedSlotCount(ctx.state) ? p.equipped[slot] : null;
    if (!id) ctx.emit({ type: 'abilityDenied', abilityId: null, reason: 'empty' });
    else if (abilityDef(id)?.activatable !== false) activateAbility(ctx, id);
  }
  if (input.equip) equipAbility(ctx, input.equip.slot, input.equip.ability);
  if (input.buySlot) buySlot(ctx);
}
export function isFrenzyActive(state: GameState): boolean { return state.progression.frenzyTimeLeft > 0; }
export function hordeSpeedMultiplier(state: GameState): number { return isFrenzyActive(state) ? BALANCE.frenzy.speedMultiplier : 1; }
export function hordeAttackRateMultiplier(state: GameState): number { return isFrenzyActive(state) ? BALANCE.frenzy.attackRateMultiplier : 1; }
