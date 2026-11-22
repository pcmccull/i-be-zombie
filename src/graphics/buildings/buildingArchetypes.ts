// [pure] Architectural vocabulary; dimensions are metres, never collider mutations.
import type { BuildingArchetype } from '../../core/types';
import { ARCHETYPE_MIN_FOOTPRINT, type SignageStyle } from '../../content/districtStyles';
import type { ComponentKind, EntranceStyle, FacadeStyle, RoofStyle, WindowPattern } from './buildingTypes';

export type StandardArchetype = Exclude<BuildingArchetype, 'landmark'>;
export type RoofKitKind = Extract<ComponentKind,
  'roofVent' | 'mechanicalBox' | 'waterTank' | 'satelliteDish' | 'solarPanel' | 'rooftopPatio' | 'chimney'>;
export interface ArchetypeRules {
  readonly floorHeight: number;
  readonly roofs: readonly RoofStyle[];
  readonly facades: readonly FacadeStyle[];
  readonly windows: readonly WindowPattern[];
  readonly entrances: readonly EntranceStyle[];
  readonly balconies: readonly [number, number];
  readonly signage: readonly SignageStyle[];
  readonly sign: boolean;
  readonly neonSign: boolean;
  readonly roofKit: Readonly<Partial<Record<RoofKitKind, readonly [number, number]>>>;
  readonly minSize: { readonly w: number; readonly d: number; readonly h: number };
}

export const bungalow: ArchetypeRules = {
  floorHeight: 3, roofs: ['hip', 'gable', 'tile'], facades: ['stucco', 'siding'], windows: ['paired', 'punched'],
  entrances: ['porch'], balconies: [0, 0], signage: [], sign: false, neonSign: false,
  roofKit: { chimney: [0, 1], solarPanel: [0, 2] }, minSize: ARCHETYPE_MIN_FOOTPRINT.bungalow,
};
export const artDecoHotel: ArchetypeRules = {
  floorHeight: 3.2, roofs: ['stepped'], facades: ['deco'], windows: ['grid', 'paired'],
  entrances: ['canopy'], balconies: [0, 0.45], signage: ['painted', 'neon'], sign: true, neonSign: true,
  roofKit: { mechanicalBox: [1, 2], satelliteDish: [0, 1], rooftopPatio: [0, 1] }, minSize: ARCHETYPE_MIN_FOOTPRINT.artDecoHotel,
};
export const apartment: ArchetypeRules = {
  floorHeight: 3, roofs: ['flat', 'parapet'], facades: ['stucco', 'brick', 'concrete'], windows: ['grid', 'paired'],
  entrances: ['recessed', 'canopy'], balconies: [0.35, 0.8], signage: [], sign: false, neonSign: false,
  roofKit: { waterTank: [0, 1], satelliteDish: [1, 2], roofVent: [1, 2] }, minSize: ARCHETYPE_MIN_FOOTPRINT.apartment,
};
export const convenienceStore: ArchetypeRules = {
  floorHeight: 3.5, roofs: ['flat', 'parapet'], facades: ['stucco', 'brick'], windows: ['storefront'],
  entrances: ['glassDoors'], balconies: [0, 0], signage: ['painted', 'neon', 'corporate', 'industrial', 'civic'], sign: true, neonSign: true,
  roofKit: { roofVent: [1, 3], mechanicalBox: [1, 2] }, minSize: ARCHETYPE_MIN_FOOTPRINT.convenienceStore,
};
export const restaurant: ArchetypeRules = {
  floorHeight: 3.3, roofs: ['flat', 'tile', 'parapet'], facades: ['stucco', 'brick'], windows: ['storefront', 'paired'],
  entrances: ['arch', 'glassDoors'], balconies: [0, 0], signage: ['painted', 'neon', 'corporate', 'civic'], sign: true, neonSign: true,
  roofKit: { chimney: [1, 2], roofVent: [1, 2], rooftopPatio: [0, 1] }, minSize: ARCHETYPE_MIN_FOOTPRINT.restaurant,
};
export const office: ArchetypeRules = {
  floorHeight: 3.6, roofs: ['flat', 'parapet'], facades: ['glass', 'concrete'], windows: ['ribbon', 'grid'],
  entrances: ['glassDoors', 'recessed'], balconies: [0, 0], signage: ['corporate', 'painted'], sign: true, neonSign: false,
  roofKit: { mechanicalBox: [2, 4], roofVent: [1, 2], satelliteDish: [0, 1] }, minSize: ARCHETYPE_MIN_FOOTPRINT.office,
};
export const warehouse: ArchetypeRules = {
  floorHeight: 3.6, roofs: ['flat', 'sawtooth'], facades: ['metal', 'brick'], windows: ['ribbon', 'punched'],
  entrances: ['rollup'], balconies: [0, 0], signage: ['industrial', 'corporate', 'painted'], sign: true, neonSign: false,
  roofKit: { roofVent: [2, 4], mechanicalBox: [0, 2] }, minSize: ARCHETYPE_MIN_FOOTPRINT.warehouse,
};
export const gasStation: ArchetypeRules = {
  floorHeight: 3.3, roofs: ['flat'], facades: ['stucco', 'metal'], windows: ['storefront'],
  entrances: ['glassDoors'], balconies: [0, 0], signage: ['painted', 'neon', 'corporate', 'industrial'], sign: true, neonSign: true,
  roofKit: { roofVent: [1, 2], mechanicalBox: [0, 1] }, minSize: ARCHETYPE_MIN_FOOTPRINT.gasStation,
};
export const beachShop: ArchetypeRules = {
  floorHeight: 3, roofs: ['gable', 'flat', 'tile'], facades: ['siding', 'stucco'], windows: ['storefront'],
  entrances: ['glassDoors', 'porch'], balconies: [0, 0], signage: ['painted', 'neon'], sign: true, neonSign: true,
  roofKit: { roofVent: [0, 1], satelliteDish: [0, 1] }, minSize: ARCHETYPE_MIN_FOOTPRINT.beachShop,
};
export const parkingGarage: ArchetypeRules = {
  floorHeight: 2.8, roofs: ['flat', 'parapet'], facades: ['concrete'], windows: ['none'],
  entrances: ['rollup'], balconies: [0, 0], signage: ['painted', 'corporate', 'civic', 'industrial'], sign: true, neonSign: false,
  roofKit: { roofVent: [1, 2], solarPanel: [0, 2] }, minSize: ARCHETYPE_MIN_FOOTPRINT.parkingGarage,
};
export const villa: ArchetypeRules = {
  floorHeight: 3.4, roofs: ['tile', 'hip'], facades: ['stucco'], windows: ['paired', 'punched'],
  entrances: ['arch', 'porch'], balconies: [0.2, 0.6], signage: [], sign: false, neonSign: false,
  roofKit: { chimney: [1, 1], solarPanel: [0, 2], rooftopPatio: [0, 1] }, minSize: ARCHETYPE_MIN_FOOTPRINT.villa,
};
export const municipal: ArchetypeRules = {
  floorHeight: 3.6, roofs: ['parapet'], facades: ['concrete', 'stucco'], windows: ['grid', 'punched'],
  entrances: ['grand'], balconies: [0, 0], signage: ['civic', 'painted', 'corporate'], sign: true, neonSign: false,
  roofKit: { mechanicalBox: [1, 2], roofVent: [1, 2] }, minSize: ARCHETYPE_MIN_FOOTPRINT.municipal,
};

export const BUILDING_ARCHETYPES: Readonly<Record<StandardArchetype, ArchetypeRules>> = {
  bungalow, artDecoHotel, apartment, convenienceStore, restaurant, office, warehouse, gasStation, beachShop,
  parkingGarage, villa, municipal,
};

/** Integer storeys with a nominal 2.8–3.6 m module. Wall spacing absorbs collider-height residuals.
 * Some legacy heights (e.g. 5 m) cannot be represented by any integer number of 2.8–3.6 m storeys.
 * Plans therefore place floors at height / floors and keep the roof base exactly at collider height.
 */
export function floorsForHeight(height: number, rules: ArchetypeRules): { floors: number; floorHeight: number } {
  const preferred = Math.max(1, Math.round(height / rules.floorHeight));
  const lower = Math.max(1, Math.ceil(height / 3.6));
  const upper = Math.max(1, Math.floor(height / 2.8));
  // Pick the preferred storey count within the exactly representable interval. In the gaps between
  // intervals, choose the closer endpoint rather than allowing rounding to add an entire storey.
  const floors = lower <= upper ? Math.max(lower, Math.min(upper, preferred)) :
    Math.abs(height - upper * 3.6) <= Math.abs(height - lower * 2.8) ? upper : lower;
  return { floors, floorHeight: Math.max(2.8, Math.min(3.6, height / floors)) };
}
