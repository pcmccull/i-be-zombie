// [pure] Stronghold meta (docs/3_open_world.md §7-8). Geometry (bounds, structure ids, points) is attached by the
// world layout, which must produce exactly one StrongholdDef per entry here with matching id/district/unlock/tier.
import { BALANCE } from '../config/balance';
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
    // First stronghold (~70 m from the start). Civilians outrun the horde until then; capturing it grants Rush to run them down.
    id: 'suburb_checkpoint', districtId: 'suburbs', name: 'Suburb Police Checkpoint', defenseTier: 1, unlock: 'rush', biomassReward: 15,
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
  // ---- EW expansion (ARCHITECTURE §EW-1): unlock null, reward = BALANCE.expansion.rewardByTier[tier] ----
  ew('park_ranger_post', 'palm_park', 'Park Ranger Post', 1, 'Break the ranger post door', 'Overrun the rangers'),
  ew('boardwalk_patrol', 'sunny_boardwalk', 'Boardwalk Patrol HQ', 1, 'Smash the lifeguard HQ shutter', 'Overrun the beach patrol'),
  ew('arts_barricade', 'arts_district', 'Gallery Barricade', 1, 'Tear down the gallery barricade', 'Overrun the armed group'),
  ew('neon_security', 'neon_nights', 'Club Security Office', 2, 'Break the club back door', 'Overrun the bouncers and police'),
  ew('hotel_security', 'oceanfront_hotels', 'Hotel Security Desk', 2, 'Smash the lobby shutter', 'Overrun the hotel guards'),
  ew('marina_crews', 'luxury_marina', 'Marina Harbor Office', 2, 'Break the harbor office gate', 'Overrun the marina crews'),
  ew('golf_gatehouse', 'golf_estates', 'Estates Gatehouse', 3, 'Break the gatehouse barrier', 'Overrun the estate patrols', 'Hold the gatehouse'),
  ew('medical_quarantine', 'medical_center', 'Quarantine Command', 4, 'Breach the quarantine fence', 'Overrun the containment team', 'Hold the triage tent'),
  ew('campus_security', 'university', 'Campus Security Center', 4, 'Breach the security center', 'Overrun the tactical team', 'Hold the camera room'),
  ew('financial_tower', 'financial_core', 'Bank Tower Plaza', 5, 'Breach the bank plaza doors', 'Overrun the tower defenders', 'Hold the vault lobby'),
  ew('airport_terminal', 'airport', 'Airport Terminal', 5, 'Breach the terminal blast doors', 'Overrun the airport troops', 'Hold the control tower base'),
  ew('military_hq', 'military_base', 'Base Command', 5, 'Breach the base gate', 'Overrun the garrison', 'Hold the command bunker'),
];

/** EW stronghold: objective 'breach' (destroyStructure), 'defenders' (killDefenders), tier >= 3 adds 'take_control' (holdPoint). */
function ew(id: StrongholdId, districtId: DistrictId, name: string, tier: number, breach: string, defenders: string,
  hold?: string): StrongholdMeta {
  const objectives: { id: string; kind: ObjectiveKind; label: string }[] = [
    { id: 'breach', kind: 'destroyStructure', label: breach },
    { id: 'defenders', kind: 'killDefenders', label: defenders },
  ];
  if (hold) objectives.push({ id: 'take_control', kind: 'holdPoint', label: hold });
  return { id, districtId, name, defenseTier: tier, unlock: null, biomassReward: BALANCE.expansion.rewardByTier[tier], objectives };
}


export function strongholdMeta(id: StrongholdId): StrongholdMeta {
  const m = STRONGHOLDS.find(s => s.id === id);
  if (!m) throw new Error(`Unknown stronghold ${id}`);
  return m;
}
