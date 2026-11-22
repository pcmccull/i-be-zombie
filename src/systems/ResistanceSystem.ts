// [pure] todos #12: the city fights back as the Alpha takes it. The level is derived from strongholds captured
// (BALANCE.resistance.levelAtCaptures); each civilian's weapon is a deterministic per-id roll against the current
// level's shares, so nothing about it is stored on the agent (or in saves) and every system agrees.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { CivilianWeapon, GameState } from '../core/types';

export const MAX_RESISTANCE_LEVEL = BALANCE.resistance.levelAtCaptures.length;

export function resistanceLevelFor(captured: number): number {
  let level = 0;
  for (const need of BALANCE.resistance.levelAtCaptures) if (captured >= need) level++;
  return level;
}

export function capturedCount(state: GameState): number {
  let n = 0;
  for (const s of state.strongholds) if (s.captured) n++;
  return n;
}

/** Stable [0,1) roll per human id (integer hash; no RNG stream consumed). */
export function weaponRoll(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Weapon a civilian with this id carries at `level`. Guns are the rarest; the roll bands are cumulative. */
export function civilianWeaponFor(level: number, id: number): CivilianWeapon {
  const r = BALANCE.resistance, l = Math.max(0, Math.min(MAX_RESISTANCE_LEVEL, level));
  const u = weaponRoll(id);
  if (u < r.shotgun[l]) return 'shotgun';
  if (u < r.shotgun[l] + r.pistol[l]) return 'pistol';
  if (u < r.shotgun[l] + r.pistol[l] + r.bat[l]) return 'bat';
  return 'none';
}

export function civilianWeapon(state: GameState, g: { id: number; role: string }): CivilianWeapon {
  return g.role === 'civilian' ? civilianWeaponFor(state.resistance.level, g.id) : 'none';
}

/** Only writer of state.resistance. Emits resistanceRaised once per change (a loaded save reports its level once). */
export function updateResistance(ctx: SimContext): void {
  const state = ctx.state;
  const level = resistanceLevelFor(capturedCount(state));
  if (level === state.resistance.level) return;
  const raised = level > state.resistance.level;
  state.resistance.level = level;
  if (raised) ctx.emit({ type: 'resistanceRaised', level, label: BALANCE.resistance.labels[level] ?? '' });
}
