// [pure] District meta. The layout supplies rects, budgets and spawn points.
import type { DistrictId, StrongholdId } from '../core/types';

export interface DistrictMeta {
  id: DistrictId;
  name: string;
  strongholdId: StrongholdId;
  landmark: string;
  /** Status at a new game (suburbs starts 'human' and discovered around the start nest). */
}

export const DISTRICTS: readonly DistrictMeta[] = [
  { id: 'suburbs', name: 'Maple Heights', strongholdId: 'suburb_checkpoint', landmark: 'Quiet homes, a park and the start nest' },
  { id: 'police', name: 'Civic Center', strongholdId: 'police_station', landmark: 'The fortified police station' },
  { id: 'shopping', name: 'Galleria District', strongholdId: 'mall_security', landmark: 'The mall and its huge parking lot' },
  { id: 'industrial', name: 'Dockside Works', strongholdId: 'industrial_yard', landmark: 'Warehouses and the gated security yard' },
];
