// [pure] VP2 district style configurations (docs/12_visual_polish2.md §7, ARCHITECTURE §VP2-1). Orchestrator-owned.
// Render/layout-dressing data only: archetype mix, palettes, signage, vegetation, furniture, landmarks per district.
// Read by the buildingAssign / urbanInfill / streetFurniture layout passes (T006), buildingPlan (T003) and
// environmentPopulation (T007). Changing these never changes colliders of the base world (VP2 passes are flag-gated).
import type { BuildingArchetype, BuildingStyle, CityLandmarkKind, DistrictId } from '../core/types';
import type { FurnitureKind, PlantKind } from '../graphics/environment/environmentKinds';

export type SignageStyle = 'none' | 'painted' | 'neon' | 'corporate' | 'industrial' | 'civic';
export type SidewalkStyle = 'plain' | 'pavers' | 'boardwalk' | 'tile' | 'brick';
export type DistrictTheme = 'beachfront' | 'residential' | 'downtown' | 'industrial' | 'entertainment' | 'civic'
  | 'campus' | 'resort' | 'military' | 'airport' | 'park';

export interface DistrictStyle {
  id: DistrictId;
  theme: DistrictTheme;
  /** Relative weights; filtered by STYLE_ARCHETYPES[building.style] and ARCHETYPE_MIN_FOOTPRINT before picking. */
  archetypeWeights: Partial<Record<BuildingArchetype, number>>;
  /** Visual floor-count bias only (collider height stays the truth). */
  heightScale: number;
  /** 0..1 target share of empty frontage lots that receive an infill building / purposeful lot. */
  infillDensity: number;
  wallPalette: number[];
  accentPalette: number[];
  roofPalette: number[];
  signage: SignageStyle;
  sidewalk: SidewalkStyle;
  /** 0..1 vegetation density. */
  vegetation: number;
  palms: PlantKind[];
  /** Street furniture weights (sidewalk strip). */
  furniture: Partial<Record<FurnitureKind, number>>;
  /** Context clutter weights (alleys, service yards, patios). */
  clutter: Partial<Record<FurnitureKind, number>>;
  /** 1–2 landmarks placed by urbanInfill (T006). */
  landmarks: CityLandmarkKind[];
}

/** BuildingStyle (gameplay layout) -> archetypes that may draw it. */
export const STYLE_ARCHETYPES: Readonly<Record<BuildingStyle, readonly BuildingArchetype[]>> = {
  house: ['bungalow', 'villa'],
  storefront: ['convenienceStore', 'restaurant', 'beachShop'],
  apartment: ['apartment', 'artDecoHotel'],
  office: ['office', 'municipal'],
  warehouse: ['warehouse'],
  garage: ['parkingGarage', 'gasStation'],
  mall: ['municipal', 'office'],
  civic: ['municipal'],
};

/** Minimum footprint (w = shorter side, d = longer side) and collider height for an archetype to be chosen. */
export const ARCHETYPE_MIN_FOOTPRINT: Readonly<Record<BuildingArchetype, { w: number; d: number; h: number }>> = {
  bungalow: { w: 6, d: 7, h: 3 },
  villa: { w: 10, d: 12, h: 4 },
  artDecoHotel: { w: 12, d: 14, h: 9 },
  apartment: { w: 10, d: 12, h: 7 },
  convenienceStore: { w: 8, d: 9, h: 3.5 },
  restaurant: { w: 8, d: 9, h: 3.5 },
  beachShop: { w: 5, d: 6, h: 3 },
  office: { w: 12, d: 12, h: 9 },
  municipal: { w: 16, d: 16, h: 6 },
  warehouse: { w: 12, d: 16, h: 5 },
  parkingGarage: { w: 16, d: 20, h: 6 },
  gasStation: { w: 6, d: 7, h: 3 },
  landmark: { w: 4, d: 4, h: 3 },
};

// Shared palettes (Miami pastels from the VP art bible + district accents).
const PASTEL = [0xf2b5a7, 0x9fd8cf, 0xf6e3a1, 0xb9c8f0, 0xf4f0e6, 0xf7c6d9, 0xc8e6a0];
const DECO = [0xf4f0e6, 0xf7c6d9, 0x9fd8cf, 0xf6e3a1, 0xb9e3f0];
const WARM_RES = [0xf2d3a2, 0xe9c9b1, 0xf4f0e6, 0xd9e4c4, 0xf2b5a7, 0xc9d8e8];
const CORPORATE = [0xc9cfd6, 0xa9b4bf, 0xe2e4e6, 0x8fa1b3, 0xd8d2c4];
const INDUSTRIAL = [0xb8b2a4, 0x9aa3a8, 0xc9b99a, 0x8a8f86, 0xb07a52];
const NEON_WALLS = [0x3b3355, 0x2f4858, 0x5a3d5c, 0x1f3a4a, 0xf2b5a7, 0x9fd8cf];
const CIVIC = [0xe8dcc4, 0xd8cdb5, 0xf4f0e6, 0xc9b99a];
const MILITARY = [0x8a8f6a, 0x6f7550, 0xb5ae8f, 0x9aa3a8];
const ACCENT_TROPIC = [0x2e8b84, 0xe0574f, 0xf2c14e, 0x2fd3c0, 0xff8fb1];
const ACCENT_CORP = [0x2c3e66, 0x4a5260, 0x5b7fa6];
const ACCENT_NEON = [0xff3ea5, 0x2fe6ff, 0xb46bff, 0xffe14d, 0x5effb8];
const ROOF_TILE = [0xc0603a, 0xb5532f, 0xd0794a, 0x9a4a2a];
const ROOF_FLAT = [0xb8b2a4, 0xa3a39b, 0x8f949a];

export const DISTRICT_STYLES: Readonly<Record<DistrictId, DistrictStyle>> = {
  // ---- r0 (north) ----
  airport: {
    id: 'airport', theme: 'airport',
    archetypeWeights: { warehouse: 5, office: 2, municipal: 2, parkingGarage: 3, gasStation: 2, convenienceStore: 1 },
    heightScale: 0.9, infillDensity: 0.55, wallPalette: [...CORPORATE, 0xe2e4e6], accentPalette: ACCENT_CORP, roofPalette: ROOF_FLAT,
    signage: 'corporate', sidewalk: 'plain', vegetation: 0.25, palms: ['palmRoyal'],
    furniture: { streetlight: 3, bollard: 3, roadSign: 2, busStop: 1, trashCan: 1 },
    clutter: { constructionBarrier: 2, trafficCone: 3, crates: 2, utilityBox: 2 },
    landmarks: ['controlTower', 'hangar'],
  },
  golf_estates: {
    id: 'golf_estates', theme: 'resort',
    archetypeWeights: { villa: 6, bungalow: 2, restaurant: 1, municipal: 1 },
    heightScale: 0.9, infillDensity: 0.45, wallPalette: [0xf4f0e6, 0xf2d3a2, 0xe8dcc4, 0xf7c6d9], accentPalette: ACCENT_TROPIC, roofPalette: ROOF_TILE,
    signage: 'painted', sidewalk: 'pavers', vegetation: 0.9, palms: ['palmRoyal', 'palmCoconut', 'palmCluster'],
    furniture: { streetlight: 2, mailbox: 3, planter: 2, bench: 1 },
    clutter: { fenceSection: 2, planter: 1 },
    landmarks: ['clockTower'],
  },
  university: {
    id: 'university', theme: 'campus',
    archetypeWeights: { municipal: 5, office: 3, apartment: 3, restaurant: 2, convenienceStore: 1, parkingGarage: 1 },
    heightScale: 1, infillDensity: 0.6, wallPalette: [0xd9b38c, 0xc98f6a, 0xe8dcc4, 0xf4f0e6], accentPalette: [0x8c2f39, 0x2c3e66, 0xf2c14e], roofPalette: ROOF_TILE,
    signage: 'civic', sidewalk: 'brick', vegetation: 0.7, palms: ['palmRoyal', 'palmFan'],
    furniture: { bench: 3, bikeRack: 3, streetlight: 2, trashCan: 2, newsStand: 1 },
    clutter: { parkedBike: 3, trashCan: 1 },
    landmarks: ['domeObservatory', 'clockTower'],
  },
  luxury_marina: {
    id: 'luxury_marina', theme: 'beachfront',
    archetypeWeights: { villa: 3, restaurant: 3, beachShop: 3, artDecoHotel: 2, apartment: 2 },
    heightScale: 1.05, infillDensity: 0.55, wallPalette: [0xf4f0e6, 0xb9e3f0, 0x9fd8cf, 0xf6e3a1], accentPalette: [0x1d5f78, 0x2e8b84, 0xf4f0e6], roofPalette: ROOF_FLAT,
    signage: 'painted', sidewalk: 'boardwalk', vegetation: 0.6, palms: ['palmCoconut', 'palmRoyal'],
    furniture: { bench: 2, bollard: 3, streetlight: 2, planter: 2 },
    clutter: { crates: 2, patioUmbrella: 2, patioTable: 2 },
    landmarks: ['lighthouse'],
  },
  // ---- r1 ----
  palm_park: {
    id: 'palm_park', theme: 'park',
    archetypeWeights: { bungalow: 3, restaurant: 2, beachShop: 2, municipal: 1, convenienceStore: 1 },
    heightScale: 0.9, infillDensity: 0.5, wallPalette: PASTEL, accentPalette: ACCENT_TROPIC, roofPalette: ROOF_TILE,
    signage: 'painted', sidewalk: 'pavers', vegetation: 1, palms: ['palmCoconut', 'palmFan', 'palmCluster', 'palmRoyal'],
    furniture: { bench: 4, trashCan: 2, streetlight: 2, planter: 1, basketballHoop: 1 },
    clutter: { parkedBike: 2 },
    landmarks: ['bandshell', 'fountainPlaza'],
  },
  financial_core: {
    id: 'financial_core', theme: 'downtown',
    archetypeWeights: { office: 6, parkingGarage: 3, municipal: 2, artDecoHotel: 1, convenienceStore: 2, restaurant: 2 },
    heightScale: 1.25, infillDensity: 0.75, wallPalette: CORPORATE, accentPalette: ACCENT_CORP, roofPalette: ROOF_FLAT,
    signage: 'corporate', sidewalk: 'tile', vegetation: 0.3, palms: ['palmRoyal'],
    furniture: { streetlight: 3, newsStand: 2, bollard: 2, busStop: 2, trashCan: 2, planter: 2, bench: 1 },
    clutter: { dumpster: 2, trashBags: 3, crates: 1, utilityBox: 2 },
    landmarks: ['glassTower'],
  },
  neon_nights: {
    id: 'neon_nights', theme: 'entertainment',
    archetypeWeights: { restaurant: 5, convenienceStore: 2, artDecoHotel: 3, apartment: 2, beachShop: 2, parkingGarage: 1 },
    heightScale: 1.05, infillDensity: 0.7, wallPalette: NEON_WALLS, accentPalette: ACCENT_NEON, roofPalette: ROOF_FLAT,
    signage: 'neon', sidewalk: 'tile', vegetation: 0.35, palms: ['palmCoconut', 'palmRoyal'],
    furniture: { streetlight: 2, newsStand: 1, bollard: 2, patioTable: 3, trashCan: 2, busStop: 1 },
    clutter: { patioUmbrella: 3, trashBags: 2, dumpster: 2, crates: 2 },
    landmarks: ['neonArch', 'ferrisWheel'],
  },
  medical_center: {
    id: 'medical_center', theme: 'civic',
    archetypeWeights: { municipal: 5, office: 3, parkingGarage: 3, apartment: 1, convenienceStore: 1 },
    heightScale: 1.1, infillDensity: 0.55, wallPalette: [0xf4f0e6, 0xe2e4e6, 0xd8e8e4, 0xc9d8e8], accentPalette: [0x2fd3c0, 0xe0574f, 0x2c3e66], roofPalette: ROOF_FLAT,
    signage: 'civic', sidewalk: 'plain', vegetation: 0.45, palms: ['palmRoyal', 'palmFan'],
    furniture: { bench: 2, bollard: 3, streetlight: 2, busStop: 2, trashCan: 1 },
    clutter: { constructionBarrier: 2, utilityBox: 2, crates: 1 },
    landmarks: ['radioMast'],
  },
  // ---- r2 ----
  military_base: {
    id: 'military_base', theme: 'military',
    archetypeWeights: { warehouse: 6, municipal: 3, office: 1, gasStation: 1 },
    heightScale: 0.85, infillDensity: 0.4, wallPalette: MILITARY, accentPalette: [0x5b6340, 0xe8c547, 0x3a3f45], roofPalette: [0x6f7550, 0x8a8f86],
    signage: 'industrial', sidewalk: 'plain', vegetation: 0.15, palms: ['palmFan'],
    furniture: { bollard: 2, streetlight: 2, roadSign: 2 },
    clutter: { crates: 4, constructionBarrier: 3, trafficCone: 2 },
    landmarks: ['radioMast', 'waterTower'],
  },
  police: {
    id: 'police', theme: 'civic',
    archetypeWeights: { municipal: 4, office: 3, apartment: 2, convenienceStore: 2, restaurant: 2, parkingGarage: 1 },
    heightScale: 1, infillDensity: 0.6, wallPalette: CIVIC, accentPalette: [0x2c3e66, 0xe0782a, 0x4a5260], roofPalette: ROOF_FLAT,
    signage: 'civic', sidewalk: 'pavers', vegetation: 0.5, palms: ['palmRoyal', 'palmCoconut'],
    furniture: { bench: 2, streetlight: 3, mailbox: 2, newsStand: 1, busStop: 2, trashCan: 2, planter: 2 },
    clutter: { dumpster: 1, trashBags: 2, utilityBox: 2 },
    landmarks: ['clockTower', 'fountainPlaza'],
  },
  industrial: {
    id: 'industrial', theme: 'industrial',
    archetypeWeights: { warehouse: 7, gasStation: 2, office: 1, convenienceStore: 1, parkingGarage: 1 },
    heightScale: 0.9, infillDensity: 0.55, wallPalette: INDUSTRIAL, accentPalette: [0xe0782a, 0x2c3e66, 0xe8c547], roofPalette: [0x8f949a, 0x9a4a2a],
    signage: 'industrial', sidewalk: 'plain', vegetation: 0.2, palms: ['palmFan'],
    furniture: { streetlight: 2, utilityBox: 3, roadSign: 1, bollard: 1 },
    clutter: { dumpster: 3, crates: 4, trashBags: 2, constructionBarrier: 2, trafficCone: 2 },
    landmarks: ['waterTower'],
  },
  arts_district: {
    id: 'arts_district', theme: 'entertainment',
    archetypeWeights: { restaurant: 4, beachShop: 3, apartment: 3, warehouse: 2, convenienceStore: 2 },
    heightScale: 0.95, infillDensity: 0.65, wallPalette: [0xff8fb1, 0x9fd8cf, 0xf6e3a1, 0xb9c8f0, 0xe0574f, 0xf2c14e], accentPalette: ACCENT_NEON, roofPalette: ROOF_FLAT,
    signage: 'painted', sidewalk: 'brick', vegetation: 0.55, palms: ['palmCoconut', 'palmCluster'],
    furniture: { bench: 2, bikeRack: 2, patioTable: 3, streetlight: 2, planter: 2 },
    clutter: { patioUmbrella: 2, crates: 2, parkedBike: 2, trashBags: 1 },
    landmarks: ['bandshell'],
  },
  // ---- r3 (south, ocean) ----
  sunny_boardwalk: {
    id: 'sunny_boardwalk', theme: 'beachfront',
    archetypeWeights: { beachShop: 6, restaurant: 4, artDecoHotel: 2, bungalow: 2, convenienceStore: 1 },
    heightScale: 0.9, infillDensity: 0.65, wallPalette: PASTEL, accentPalette: ACCENT_TROPIC, roofPalette: ROOF_TILE,
    signage: 'painted', sidewalk: 'boardwalk', vegetation: 0.7, palms: ['palmCoconut', 'palmCluster', 'palmFan'],
    furniture: { bench: 3, trashCan: 2, streetlight: 2, patioTable: 2, bikeRack: 1 },
    clutter: { patioUmbrella: 3, crates: 1, parkedBike: 2 },
    landmarks: ['lighthouse', 'ferrisWheel'],
  },
  suburbs: {
    id: 'suburbs', theme: 'residential',
    archetypeWeights: { bungalow: 6, villa: 1, apartment: 2, convenienceStore: 2, restaurant: 1, gasStation: 1 },
    heightScale: 0.95, infillDensity: 0.55, wallPalette: WARM_RES, accentPalette: ACCENT_TROPIC, roofPalette: ROOF_TILE,
    signage: 'painted', sidewalk: 'plain', vegetation: 0.8, palms: ['palmCoconut', 'palmFan', 'palmCluster'],
    furniture: { mailbox: 4, streetlight: 2, trashCan: 2, hydrant: 1, bench: 1, busStop: 1 },
    clutter: { trashBags: 1, parkedBike: 1, fenceSection: 2 },
    landmarks: ['waterTower'],
  },
  shopping: {
    id: 'shopping', theme: 'downtown',
    archetypeWeights: { convenienceStore: 4, restaurant: 3, office: 2, parkingGarage: 2, apartment: 2, municipal: 1, beachShop: 1 },
    heightScale: 1.1, infillDensity: 0.7, wallPalette: [...DECO, 0xc9cfd6], accentPalette: ACCENT_TROPIC, roofPalette: ROOF_FLAT,
    signage: 'painted', sidewalk: 'tile', vegetation: 0.45, palms: ['palmRoyal', 'palmCoconut'],
    furniture: { bench: 2, streetlight: 3, newsStand: 2, busStop: 2, trashCan: 2, planter: 2, bikeRack: 1 },
    clutter: { shoppingCart: 3, dumpster: 2, trashBags: 2, crates: 1 },
    landmarks: ['fountainPlaza'],
  },
  oceanfront_hotels: {
    id: 'oceanfront_hotels', theme: 'resort',
    archetypeWeights: { artDecoHotel: 6, restaurant: 3, beachShop: 2, apartment: 2, villa: 1 },
    heightScale: 1.15, infillDensity: 0.6, wallPalette: DECO, accentPalette: ACCENT_TROPIC, roofPalette: ROOF_FLAT,
    signage: 'neon', sidewalk: 'tile', vegetation: 0.75, palms: ['palmRoyal', 'palmCoconut', 'palmCluster'],
    furniture: { bench: 2, planter: 3, streetlight: 2, patioTable: 2, bollard: 1 },
    clutter: { patioUmbrella: 3, crates: 1, trashBags: 1 },
    landmarks: ['glassTower', 'lighthouse'],
  },
};

export function districtStyle(id: DistrictId): DistrictStyle {
  return DISTRICT_STYLES[id];
}
