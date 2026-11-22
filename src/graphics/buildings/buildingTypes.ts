// [pure] VP2 building plan contract (docs/12_visual_polish2.md §5, ARCHITECTURE §VP2-1). Orchestrator-owned.
// Plans are data: a list of reusable components in a building-local frame. buildingPlan.ts (T003) produces them,
// BuildingFactory.ts (T004) turns them into merged geometry.
import type { AABB, BuildingArchetype, CityLandmarkKind, Facing4 } from '../../core/types';
import type { SignageStyle } from '../../content/districtStyles';

export type ComponentKind =
  // structure
  | 'foundation' | 'wallPanel' | 'cornerColumn' | 'roundedCorner' | 'floorBand' | 'parapet'
  | 'flatRoof' | 'hipRoof' | 'gableRoof' | 'tileRoof' | 'steppedRoof'
  | 'column' | 'balcony' | 'stair' | 'exteriorCorridor' | 'overhang' | 'canopy' | 'awning' | 'terrace' | 'porch'
  // facade
  | 'window' | 'storefront' | 'door' | 'garageDoor' | 'loadingBay' | 'decoPanel' | 'verticalFin' | 'railing'
  | 'shutter' | 'sign' | 'neonSign' | 'wallLamp' | 'acUnit' | 'drainpipe'
  // roof kit
  | 'roofVent' | 'mechanicalBox' | 'waterTank' | 'satelliteDish' | 'solarPanel' | 'rooftopPatio' | 'chimney'
  // lot extras
  | 'pool' | 'gardenWall' | 'rampDeck' | 'guardrail' | 'pumpIsland'
  // landmark set pieces (geometry delegated to LandmarkComponents.landmarkPartGeometry)
  | 'landmarkPart';

export const COMPONENT_KINDS: readonly ComponentKind[] = [
  'foundation', 'wallPanel', 'cornerColumn', 'roundedCorner', 'floorBand', 'parapet',
  'flatRoof', 'hipRoof', 'gableRoof', 'tileRoof', 'steppedRoof',
  'column', 'balcony', 'stair', 'exteriorCorridor', 'overhang', 'canopy', 'awning', 'terrace', 'porch',
  'window', 'storefront', 'door', 'garageDoor', 'loadingBay', 'decoPanel', 'verticalFin', 'railing',
  'shutter', 'sign', 'neonSign', 'wallLamp', 'acUnit', 'drainpipe',
  'roofVent', 'mechanicalBox', 'waterTank', 'satelliteDish', 'solarPanel', 'rooftopPatio', 'chimney',
  'pool', 'gardenWall', 'rampDeck', 'guardrail', 'pumpIsland',
  'landmarkPart',
];

export type MaterialSlot = 'wall' | 'wallAccent' | 'trim' | 'roof' | 'roofTile' | 'glass' | 'glassDark' | 'metal' | 'wood'
  | 'concrete' | 'awningA' | 'awningB' | 'sign' | 'neon' | 'foliage' | 'water';

export interface BuildingPalette {
  wall: number; wallAccent: number; trim: number; roof: number;
  awningA: number; awningB: number; sign: number; neon: number;
}

export type RoofStyle = 'flat' | 'parapet' | 'hip' | 'gable' | 'tile' | 'stepped' | 'sawtooth';
export type FacadeStyle = 'stucco' | 'deco' | 'glass' | 'brick' | 'metal' | 'siding' | 'concrete';
export type WindowPattern = 'grid' | 'ribbon' | 'paired' | 'punched' | 'storefront' | 'none';
export type EntranceStyle = 'porch' | 'canopy' | 'arch' | 'recessed' | 'glassDoors' | 'rollup' | 'grand';

export interface BuildingConfig {
  archetype: BuildingArchetype;
  landmark?: CityLandmarkKind;
  /** Local X extent (along the frontage) and local Z extent (front-to-back), meters. */
  width: number;
  depth: number;
  /** Collider height (truth); the main mass must stay within ±0.5 m of it. */
  height: number;
  floors: number;
  floorHeight: number;
  roofStyle: RoofStyle;
  facadeStyle: FacadeStyle;
  palette: BuildingPalette;
  windowPattern: WindowPattern;
  /** 0..1 share of eligible upper-floor bays with balconies. */
  balconyFrequency: number;
  entranceStyle: EntranceStyle;
  signage: SignageStyle;
  /** Building-local sides that touch a neighbour ('south' = front +Z, 'north' = back -Z; see the frame comment below). */
  sharedWalls: Facing4[];
  /** Lot margins around the footprint (m, building-local): front = +Z side. 0 when no lot. */
  lotExtent: { front: number; back: number; left: number; right: number };
  /** Building-local rects of blocking props (pumps, patio tables) the plan may build over (canopies). */
  lotBlockers: AABB[];
  seed: number;
}

/**
 * Building-local frame (right-handed, +Y up): origin = footprint centre at ground (y = 0); +Z points out of the front
 * facade toward the street. The factory maps local +Z onto the world direction of `BuildingDef.frontage`.
 * Components are boxes in that frame: centre (x, y, z), size (w along X, h along Y, d along Z), rotated by rotY about
 * their centre. Side names in `sharedWalls` are building-local: 'south' = front (+Z), 'north' = back (-Z),
 * 'east' = +X, 'west' = -X (buildingPlan converts world sides with the frontage rotation).
 */
export interface ComponentInstance {
  kind: ComponentKind;
  x: number; y: number; z: number;
  rotY: number;
  w: number; h: number; d: number;
  material: MaterialSlot;
  variant: number;
  /** 0 = LOD0 only (detail); 1 = also kept in LOD1 (mass, roof, big shapes). */
  lod: 0 | 1;
}

export interface BuildingPlan {
  config: BuildingConfig;
  components: ComponentInstance[];
}

/** Heights below this are "ground level" for the VP2-0 footprint rule. */
export const GROUND_LEVEL_HEIGHT = 2.4;
/** Max overhang beyond the footprint above ground level (awnings, balconies, canopies). */
export const MAX_OVERHANG = 2.5;
/** Max gas-station canopy reach over its pump props. */
export const MAX_CANOPY_REACH = 9;
/** Kinds that may sit outside the footprint at ground level because they are flat (top <= 0.3 m). */
export const FLAT_COMPONENT_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>(['pool', 'terrace', 'rampDeck']);
