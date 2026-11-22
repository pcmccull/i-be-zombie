// [pure] District meta. The layout supplies rects, budgets and spawn points.
// EW (docs/5_expand_world.md, ARCHITECTURE §EW-1): 16 districts on a 4 x 4 grid. The original four keep their place
// (bottom-middle 2 x 2). The numbering of the spec's table is NOT a completion order: tiers are mixed on purpose.
import type { DistrictArchetype, DistrictId, StrongholdId, ThreatTier } from '../core/types';

export interface DistrictMeta {
  id: DistrictId;
  name: string;
  strongholdId: StrongholdId;
  landmark: string;
  /** 1..5 danger shown before entering (defense composition, not distance from spawn). */
  threatTier: ThreatTier;
  archetype: DistrictArchetype;
  /** Grid cell: col 0 = west (x -420..-200) .. 3 = east; row 0 = north (z -500..-320) .. 3 = south (z 0..180). */
  cell: { col: number; row: number };
  /** Defining threat (map/banner text). */
  threat: string;
}

/** Grid order (row-major from the north-west), same order as DISTRICT_IDS. */
export const DISTRICTS: readonly DistrictMeta[] = [
  // row 0 (north: highway collapse / quarantine perimeter)
  { id: 'airport', name: 'International Airport', strongholdId: 'airport_terminal', threatTier: 5, archetype: 'airport', cell: { col: 0, row: 0 },
    landmark: 'Runways, hangars and the locked-down terminal', threat: 'Military forces and armored patrols' },
  { id: 'golf_estates', name: 'Golf Estates', strongholdId: 'golf_gatehouse', threatTier: 3, archetype: 'estates', cell: { col: 1, row: 0 },
    landmark: 'Fairways and walled mansions', threat: 'Gated communities and mobile patrols' },
  { id: 'university', name: 'University Campus', strongholdId: 'campus_security', threatTier: 4, archetype: 'campus', cell: { col: 2, row: 0 },
    landmark: 'Lecture halls around a central quad', threat: 'Surveillance and tactical defenses' },
  { id: 'luxury_marina', name: 'Luxury Marina', strongholdId: 'marina_crews', threatTier: 2, archetype: 'marina', cell: { col: 3, row: 0 },
    landmark: 'Yacht piers on the bay', threat: 'Armed crews and marina security' },
  // row 1
  { id: 'palm_park', name: 'Palm Park', strongholdId: 'park_ranger_post', threatTier: 1, archetype: 'park', cell: { col: 0, row: 1 },
    landmark: 'Palm groves, ponds and picnic lawns', threat: 'Park rangers and scattered security' },
  { id: 'financial_core', name: 'Financial Core', strongholdId: 'financial_tower', threatTier: 5, archetype: 'downtown', cell: { col: 1, row: 1 },
    landmark: 'Glass towers and the fortified bank plaza', threat: 'Heavy coordinated resistance' },
  { id: 'neon_nights', name: 'Neon Nights', strongholdId: 'neon_security', threatTier: 2, archetype: 'nightlife', cell: { col: 2, row: 1 },
    landmark: 'Clubs, bars and neon strips', threat: 'Private security and police' },
  { id: 'medical_center', name: 'Medical Center', strongholdId: 'medical_quarantine', threatTier: 4, archetype: 'medical', cell: { col: 3, row: 1 },
    landmark: 'The hospital and its quarantine tents', threat: 'Quarantine and containment teams' },
  // row 2
  { id: 'military_base', name: 'Military Stronghold', strongholdId: 'military_hq', threatTier: 5, archetype: 'military', cell: { col: 0, row: 2 },
    landmark: 'Walls, watchtowers and a vehicle depot', threat: 'Fortified military defenses' },
  { id: 'police', name: 'Civic Center', strongholdId: 'police_station', threatTier: 2, archetype: 'civic', cell: { col: 1, row: 2 },
    landmark: 'The fortified police station', threat: 'Police and checkpoints' },
  { id: 'industrial', name: 'Dockside Works', strongholdId: 'industrial_yard', threatTier: 3, archetype: 'industrial', cell: { col: 2, row: 2 },
    landmark: 'Warehouses and the gated security yard', threat: 'Tower guards and a fortified gate' },
  { id: 'arts_district', name: 'Arts District', strongholdId: 'arts_barricade', threatTier: 1, archetype: 'arts', cell: { col: 3, row: 2 },
    landmark: 'Murals, galleries and studio lofts', threat: 'Barricades and small armed groups' },
  // row 3 (south: ocean beach)
  { id: 'sunny_boardwalk', name: 'Sunny Boardwalk', strongholdId: 'boardwalk_patrol', threatTier: 1, archetype: 'boardwalk', cell: { col: 0, row: 3 },
    landmark: 'Beach shacks along the boardwalk', threat: 'Beach patrols' },
  { id: 'suburbs', name: 'Maple Heights', strongholdId: 'suburb_checkpoint', threatTier: 1, archetype: 'suburban', cell: { col: 1, row: 3 },
    landmark: 'Quiet homes, a park and the start nest', threat: 'A small police checkpoint' },
  { id: 'shopping', name: 'Galleria District', strongholdId: 'mall_security', threatTier: 1, archetype: 'retail', cell: { col: 2, row: 3 },
    landmark: 'The mall and its huge parking lot', threat: 'Mall security' },
  { id: 'oceanfront_hotels', name: 'Oceanfront Hotels', strongholdId: 'hotel_security', threatTier: 2, archetype: 'resort', cell: { col: 3, row: 3 },
    landmark: 'Beachfront hotel towers', threat: 'Hotel security and elevated defenders' },
];

export function districtMeta(id: DistrictId): DistrictMeta {
  const m = DISTRICTS.find(d => d.id === id);
  if (!m) throw new Error(`Unknown district ${id}`);
  return m;
}
