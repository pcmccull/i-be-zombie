// [pure] Stronghold meta (docs/3_open_world.md §7-8). Geometry (bounds, structure ids, points) is attached by the
// world layout, which must produce exactly one StrongholdDef per entry here with matching id/district/unlock/tier.
import type { AbilityId, DistrictId, ObjectiveKind, StrongholdId } from '../core/types';

export interface StrongholdMeta {
  id: StrongholdId;
  districtId: DistrictId;
  name: string;
  defenseTier: number;
  unlock: AbilityId | null;
  biomassReward: number;
  /** Objective ids + kinds + labels the layout must realize (in this order). */
  objectives: readonly { id: string; kind: ObjectiveKind; label: string }[];
}

export const STRONGHOLDS: readonly StrongholdMeta[] = [
  {
    id: 'suburb_checkpoint', districtId: 'suburbs', name: 'Suburb Police Checkpoint', defenseTier: 1, unlock: null, biomassReward: 15,
    objectives: [
      { id: 'break_pen', kind: 'destroyStructure', label: 'Break the holding pen' },
      { id: 'defenders', kind: 'killDefenders', label: 'Overrun the checkpoint police' },
    ],
  },
  {
    id: 'police_station', districtId: 'police', name: 'Police Station', defenseTier: 2, unlock: 'alpha_claws', biomassReward: 30,
    objectives: [
      { id: 'breach', kind: 'destroyStructure', label: 'Breach the station doors' },
      { id: 'disable_command', kind: 'holdPoint', label: 'Hold the command room' },
    ],
  },
  {
    id: 'mall_security', districtId: 'shopping', name: 'Mall Security Center', defenseTier: 1, unlock: 'horde_frenzy', biomassReward: 30,
    objectives: [
      { id: 'disable_security', kind: 'destroyStructure', label: 'Smash the security shutter' },
      { id: 'take_control', kind: 'holdPoint', label: 'Take the security office' },
    ],
  },
  {
    id: 'industrial_yard', districtId: 'industrial', name: 'Industrial Security Yard', defenseTier: 3, unlock: 'brute_evolution', biomassReward: 40,
    objectives: [
      { id: 'break_gate', kind: 'destroyGate', label: 'Break the yard gate' },
      { id: 'take_control', kind: 'holdPoint', label: 'Take the yard office' },
    ],
  },
];

export function strongholdMeta(id: StrongholdId): StrongholdMeta {
  const m = STRONGHOLDS.find(s => s.id === id);
  if (!m) throw new Error(`Unknown stronghold ${id}`);
  return m;
}
