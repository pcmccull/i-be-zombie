// [pure] Strongholds, territory, alert/reinforcements, nests, discovery (docs/3_open_world.md §4D, §7). OWNER: T009.
// T001 stub.
import type { SimContext } from '../core/contracts';
import type { DistrictId, DistrictLayout, GameState, StrongholdId, Vec2 } from '../core/types';

export interface ObjectiveStatus { id: string; label: string; done: boolean; progress: number }

export function updateConquest(_ctx: SimContext, _dt: number): void { /* T009 */ }
export function objectiveStatus(_ctx: SimContext, _id: StrongholdId): ObjectiveStatus[] { return []; }
export function isNestActive(ctx: SimContext, nestId: string): boolean {
  const nest = ctx.layout.nests.find(n => n.id === nestId);
  if (!nest) return false;
  if (nest.strongholdId === null) return true;
  return ctx.state.strongholds.some(s => s.id === nest.strongholdId && s.captured);
}
export function revealAround(_state: GameState, _layout: DistrictLayout, _p: Vec2, _radius: number): DistrictId[] { return []; }
