// [pure] Nest activity rules shared by the sim, saves and UI (no SimContext needed).
import { BALANCE } from '../config/balance';
import type { DistrictLayout, GameState, NestDef, Vec2 } from '../core/types';

/**
 * A nest is usable (respawn, loadout, replenish) when:
 * - `claim` (walk-in) nest: the Alpha has walked into it (`state.claimedNests`);
 * - stronghold nest: its stronghold is captured;
 * - otherwise (`strongholdId: null`, legacy start nest): always.
 */
export function isNestActiveIn(state: GameState, nest: NestDef): boolean {
  if (nest.claim) return state.claimedNests.includes(nest.id);
  if (nest.strongholdId === null) return true;
  for (const s of state.strongholds) if (s.id === nest.strongholdId) return s.captured;
  return false;
}

/** Nests that grow the horde cap: claimed walk-in nests + captured stronghold nests (an always-on start nest does not). */
export function hordeNestCount(state: GameState, layout: DistrictLayout): number {
  let n = 0;
  for (const nest of layout.nests) if ((nest.claim || nest.strongholdId !== null) && isNestActiveIn(state, nest)) n++;
  return n;
}

/** The walk-in nest still waiting to be claimed (the first objective), else null. */
export function unclaimedNest(state: GameState, layout: DistrictLayout): NestDef | null {
  for (const nest of layout.nests) if (nest.claim && !state.claimedNests.includes(nest.id)) return nest;
  return null;
}

/** Nearest active nest within `BALANCE.nest.equipRadius` of `pos`, else null. */
export function activeNestNear(state: GameState, layout: DistrictLayout, pos: Vec2): NestDef | null {
  const r2 = BALANCE.nest.equipRadius ** 2;
  let best: NestDef | null = null, bestD = Infinity;
  for (const n of layout.nests) {
    if (!isNestActiveIn(state, n)) continue;
    const d = (n.pos.x - pos.x) ** 2 + (n.pos.z - pos.z) ** 2;
    if (d <= r2 && d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Every other active nest the party can crawl out of when diving into `fromId`. */
export function nestTeleportDestinations(state: GameState, layout: DistrictLayout, fromId: string): NestDef[] {
  return layout.nests.filter(n => n.id !== fromId && isNestActiveIn(state, n));
}

/**
 * The nest the Alpha can teleport from right now (open world): it stands within equip range of an active nest,
 * another active nest exists, and it is free to act (alive, playing, not emerging, not in a vehicle, not mid-teleport).
 */
export function nestTeleportSource(state: GameState, layout: DistrictLayout): NestDef | null {
  if (layout.strongholds.length === 0 || state.phase !== 'playing' || state.nestTravel) return null;
  const l = state.leader;
  if (!l.alive || l.emergeTimer > 1e-9 || state.playerVehicle?.mounted) return null;
  const from = activeNestNear(state, layout, l.pos);
  if (!from) return null;
  return nestTeleportDestinations(state, layout, from.id).length > 0 ? from : null;
}
