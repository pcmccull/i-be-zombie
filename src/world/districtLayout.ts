// [pure] Whole-world data; rendering and simulation choose active chunks/actors.
import { BALANCE } from '../config/balance';
import type { DistrictLayout } from '../core/types';
import { mulberry32 } from '../utils/rng';
import { rect, type WorldDraft } from './layout/common';
import { buildRoads } from './layout/roads';
import { buildSuburbs } from './layout/suburbs';
import { buildPolice } from './layout/police';
import { buildShopping } from './layout/shopping';
import { buildIndustrial } from './layout/industrial';

export function buildDistrictLayout(seed: number = BALANCE.sim.seed): DistrictLayout {
  const world: WorldDraft = {
    bounds: { minX: BALANCE.openWorld.minX, minZ: BALANCE.openWorld.minZ, maxX: BALANCE.openWorld.maxX, maxZ: BALANCE.openWorld.maxZ },
    ground: [], markings: [], buildings: [], props: [], colliders: [],
    playerStart: { x: -150, z: 115 }, playerStartFacing: Math.atan2(74, -14),
    startFollowerArea: rect(-155, 110, -145, 120), spawnZones: [], guards: [], structures: [],
    districts: [], strongholds: [], nests: [
      { id: 'nest_start', districtId: 'suburbs', pos: { x: -156, z: 119 }, strongholdId: null },
    ],
  };
  const rng = mulberry32(seed);
  buildRoads(world);
  buildSuburbs(world, rng);
  buildPolice(world, rng);
  buildShopping(world, rng);
  const checkpoint = buildIndustrial(world, rng);
  return { ...world, checkpoint };
}
