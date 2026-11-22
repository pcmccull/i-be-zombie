// [pure] Whole-world data; rendering and simulation choose active chunks/actors.
// EW: 4 x 4 districts. The original four keep their coordinates (bottom-middle 2 x 2); the twelve others are built by
// expansion builders (EW-T002). The world edge lives in the boundary band (buildWorldBoundaries, EW-T003).
import { BALANCE } from '../config/balance';
import { DISTRICTS } from '../content/districts';
import type { DistrictLayout } from '../core/types';
import { mulberry32 } from '../utils/rng';
import { rect, type WorldDraft } from './layout/common';
import { buildExpansionRoads, buildRoads } from './layout/roads';
import { buildRingRoad } from './layout/ringRoad';
import { buildSuburbs } from './layout/suburbs';
import { buildPolice } from './layout/police';
import { buildShopping } from './layout/shopping';
import { buildIndustrial } from './layout/industrial';
import { buildWorldBoundaries } from './boundaryLayout';
import { buildExpansion } from './layout/expansion';
import { districtCellRect } from './layout/grid';
import { moveStreetSpawnsToSidewalks } from './layout/sidewalks';
import { placeShops } from './layout/shops';
import { assignBuildings } from './layout/buildingAssign';
import { placeStreetFurniture } from './layout/streetFurniture';
import { placeUrbanInfill } from './layout/urbanInfill';
export { districtCellRect } from './layout/grid';

/** Start beach: the south strip of the suburbs park, between the boardwalk line (x -200) and the boulevard sidewalk. */
export const START_BEACH = { minX: -200, minZ: 150, maxX: -108, maxZ: 160 } as const;

/** todos #10a/#10b passes; tests can switch them off to check the base builders are unchanged. */
export interface LayoutPasses {
  sidewalkSpawns?: boolean; shops?: boolean;
  /** VP2 append-only passes (default on; implemented in VP2-T006). All false ⇒ the pre-VP2 world. */
  buildingArchetypes?: boolean; urbanInfill?: boolean; streetFurniture?: boolean;
}

export function buildDistrictLayout(seed: number = BALANCE.sim.seed, passes: LayoutPasses = {}): DistrictLayout {
  const ow = BALANCE.openWorld;
  const world: WorldDraft = {
    bounds: { minX: ow.minX, minZ: ow.minZ, maxX: ow.maxX, maxZ: ow.maxZ },
    playArea: { ...ow.play },
    ground: [], markings: [], buildings: [], props: [], colliders: [],
    // The Alpha washes up alone on the suburbs beach (START_BEACH), facing the walk-in start nest beside the bus.
    playerStart: { x: -150, z: 156 }, playerStartFacing: Math.atan2(26, -31),
    startFollowerArea: rect(-155, 152, -145, 157), spawnZones: [], guards: [], structures: [],
    districts: [], strongholds: [], nests: [
      // Walk-in nest beside the bus (first objective): walking into it raises the first horde.
      { id: 'nest_start', districtId: 'suburbs', pos: { x: -124, z: 125 }, strongholdId: null, claim: true },
    ],
    boundaries: [], backdrop: [],
  };
  const rng = mulberry32(seed);
  buildRoads(world);
  buildSuburbs(world, rng);
  buildPolice(world, rng);
  buildShopping(world, rng);
  const checkpoint = buildIndustrial(world, rng);
  buildExpansionRoads(world);
  buildExpansion(world, seed);
  // Districts tile bounds exactly (outer districts include the boundary band).
  for (const d of world.districts) {
    const meta = DISTRICTS.find(m => m.id === d.id)!;
    d.rect = districtCellRect(meta.cell.col, meta.cell.row);
  }
  world.districts.sort((a, b) => DISTRICTS.findIndex(m => m.id === a.id) - DISTRICTS.findIndex(m => m.id === b.id));
  buildWorldBoundaries(world, seed);
  // todos #10a/#10b: append-only passes (existing ids, colliders and the RNG stream are untouched).
  if (passes.sidewalkSpawns !== false) moveStreetSpawnsToSidewalks(world);
  if (passes.shops !== false) placeShops(world);
  // VP2 append-only passes (docs/12_visual_polish2.md): sidewalk furniture, empty-lot infill, then archetype assignment last
  // so infill buildings are covered. They reserve the start beach, the checkpoint and the ring-road corridor (appended below).
  const reserved = { startBeach: { ...START_BEACH }, checkpoint: checkpoint.bounds };
  if (passes.streetFurniture !== false) placeStreetFurniture(world, seed, reserved);
  if (passes.urbanInfill !== false) placeUrbanInfill(world, seed, reserved);
  if (passes.buildingArchetypes !== false) assignBuildings(world, seed, reserved);
  // Walkable sand along the suburbs' south shore where the Alpha starts (appended last: covers the park edge).
  world.ground.push({ kind: 'sand', rect: { ...START_BEACH } });
  // Perimeter ring road (N/W/E) so traffic reaching the world edge turns instead of vanishing (appended last).
  buildRingRoad(world);
  return { ...world, checkpoint };
}

