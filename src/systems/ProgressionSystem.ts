// [pure] Mutations, biomass and ability loadout (docs/3_open_world.md §4E). OWNER: T005.
// T001 stub: signatures are the contract (see src/core/contracts.ts); bodies are minimal placeholders.
import type { AbilityDenyReason, SimContext } from '../core/contracts';
import type { AbilityId, GameEvent, GameState, SimInput } from '../core/types';

type BiomassReason = Extract<GameEvent, { type: 'biomassGain' }>['reason'];

export function addBiomass(ctx: SimContext, amount: number, reason: BiomassReason): void {
  if (!(amount > 0)) return;
  const p = ctx.state.progression;
  p.biomass += amount;
  ctx.emit({ type: 'biomassGain', amount, total: p.biomass, reason });
}

export function isUnlocked(state: GameState, id: AbilityId): boolean { return state.progression.unlocked.includes(id); }
export function isEquipped(state: GameState, id: AbilityId): boolean { return state.progression.equipped.includes(id); }

export function canActivate(_state: GameState, _id: AbilityId): AbilityDenyReason | null { return 'locked'; }
export function activateAbility(_ctx: SimContext, _id: AbilityId): boolean { return false; }
export function unlockAbility(_ctx: SimContext, _id: AbilityId): boolean { return false; }
export function equipAbility(_ctx: SimContext, _slot: number, _id: AbilityId | null): boolean { return false; }
export function updateProgression(_ctx: SimContext, _dt: number, _input: SimInput): void { /* T005 */ }
export function isFrenzyActive(state: GameState): boolean { return state.progression.frenzyTimeLeft > 0; }
export function hordeSpeedMultiplier(_state: GameState): number { return 1; }
export function hordeAttackRateMultiplier(_state: GameState): number { return 1; }
