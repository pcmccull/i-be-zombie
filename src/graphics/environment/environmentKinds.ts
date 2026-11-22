// [pure] VP2 environment asset kinds (ARCHITECTURE §VP2-1). Orchestrator-owned.
// StreetFurnitureFactory / VegetationFactory (T005) build geometry for these; environmentPopulation (T007) places
// render-only instances; CityDistrict (T010) maps layout PropKinds onto them.
import type { PropKind } from '../../core/types';

export type FurnitureKind = 'streetlight' | 'busStop' | 'bench' | 'trashCan' | 'mailbox' | 'newsStand' | 'bikeRack'
  | 'hydrant' | 'bollard' | 'planter' | 'roadSign' | 'utilityBox' | 'patioTable' | 'patioUmbrella' | 'dumpster'
  | 'trashBags' | 'crates' | 'shoppingCart' | 'parkedBike' | 'constructionBarrier' | 'fenceSection' | 'gasPump'
  | 'basketballHoop' | 'trafficCone' | 'manhole' | 'stormDrain' | 'roadPatch' | 'curb' | 'curbRamp' | 'driveway'
  | 'medianHatch' | 'trafficIsland';

export type PlantKind = 'palmCoconut' | 'palmRoyal' | 'palmFan' | 'palmCluster' | 'shrubFlowering' | 'bushRound'
  | 'grassClump' | 'flowersTropical' | 'hedge' | 'planterBox' | 'vine' | 'ornamentalTree';

export type DressingKind = FurnitureKind | PlantKind;

export const FURNITURE_KINDS: readonly FurnitureKind[] = [
  'streetlight', 'busStop', 'bench', 'trashCan', 'mailbox', 'newsStand', 'bikeRack', 'hydrant', 'bollard', 'planter',
  'roadSign', 'utilityBox', 'patioTable', 'patioUmbrella', 'dumpster', 'trashBags', 'crates', 'shoppingCart',
  'parkedBike', 'constructionBarrier', 'fenceSection', 'gasPump', 'basketballHoop', 'trafficCone', 'manhole',
  'stormDrain', 'roadPatch', 'curb', 'curbRamp', 'driveway', 'medianHatch', 'trafficIsland',
];

export const PLANT_KINDS: readonly PlantKind[] = [
  'palmCoconut', 'palmRoyal', 'palmFan', 'palmCluster', 'shrubFlowering', 'bushRound', 'grassClump',
  'flowersTropical', 'hedge', 'planterBox', 'vine', 'ornamentalTree',
];

export function isPlantKind(k: DressingKind): k is PlantKind {
  return (PLANT_KINDS as readonly string[]).includes(k);
}

/** Flat kinds (top <= 0.15 m): the only render-only dressing allowed on road surfaces. */
export const FLAT_KINDS: ReadonlySet<DressingKind> = new Set<DressingKind>([
  'manhole', 'stormDrain', 'roadPatch', 'curb', 'curbRamp', 'driveway', 'medianHatch', 'trafficIsland',
]);

/** Layout PropKind -> environment asset used to draw it (CityDistrict, T010). Unlisted kinds keep bespoke geometry. */
export const PROP_TO_FURNITURE: Readonly<Partial<Record<PropKind, DressingKind>>> = {
  streetlight: 'streetlight', bench: 'bench', trashCan: 'trashCan', dumpster: 'dumpster', hydrant: 'hydrant',
  tree: 'ornamentalTree', bush: 'bushRound', palm: 'palmCoconut', sign: 'roadSign', fence: 'fenceSection',
  busStop: 'busStop', mailbox: 'mailbox', newsStand: 'newsStand', bikeRack: 'bikeRack', bollard: 'bollard',
  planter: 'planter', patioTable: 'patioTable', gasPump: 'gasPump', utilityBox: 'utilityBox', crates: 'crates',
  shoppingCart: 'shoppingCart', constructionBarrier: 'constructionBarrier', basketballHoop: 'basketballHoop',
};
