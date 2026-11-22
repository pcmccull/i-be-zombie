// [pure] Seeded, collider-respecting building plans. No rendering or world mutation.
import type { BuildingArchetype, BuildingDef, Facing4 } from '../../core/types';
import { ARCHETYPE_MIN_FOOTPRINT, STYLE_ARCHETYPES, type DistrictStyle } from '../../content/districtStyles';
import { mulberry32, pick, randInt } from '../../utils/rng';
import { BUILDING_ARCHETYPES, floorsForHeight, type RoofKitKind } from './buildingArchetypes';
import { planLandmark } from './landmarkPlans';
import { GROUND_LEVEL_HEIGHT, MAX_CANOPY_REACH, type BuildingConfig, type BuildingPlan,
  type ComponentInstance, type ComponentKind, type MaterialSlot } from './buildingTypes';

function buildingSeed(b: BuildingDef, index: number): number {
  // FNV-1a of index and centimetre-rounded world extents; independent of colour and district RNG streams.
  const p = b.footprint;
  const key = [index, ...[p.minX, p.minZ, p.maxX, p.maxZ].map(n => Math.round(n * 100))].join(':');
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function configForBuilding(b: BuildingDef, index: number, style: DistrictStyle): BuildingConfig {
  const seed = b.seed ?? buildingSeed(b, index), rng = mulberry32(seed);
  const p = b.footprint, dx = p.maxX - p.minX, dz = p.maxZ - p.minZ;
  const compatible = STYLE_ARCHETYPES[b.style];
  const fits = (a: BuildingArchetype): boolean => {
    const m = ARCHETYPE_MIN_FOOTPRINT[a];
    return Math.min(dx, dz) >= m.w && Math.max(dx, dz) >= m.d && b.height >= m.h;
  };
  const candidates = compatible.filter(a => fits(a) && (style.archetypeWeights[a] ?? 0) > 0);
  let archetype = b.archetype ?? compatible.find(fits) ?? compatible[0];
  if (b.archetype === undefined && candidates.length) {
    let ticket = rng.next() * candidates.reduce((n, a) => n + style.archetypeWeights[a]!, 0);
    for (const a of candidates) {
      ticket -= style.archetypeWeights[a]!;
      if (ticket < 0) { archetype = a; break; }
    }
  }
  const frontage = b.frontage ?? 'south';
  // Clockwise world directions [south(+Z), east(+X), north(-Z), west(-X)].
  // Subtract the frontage rotation: world frontage -> local south, next clockwise -> local east.
  // south: S/E/N/W -> S/E/N/W; east: E/N/W/S -> S/E/N/W;
  // north: N/W/S/E -> S/E/N/W; west: W/S/E/N -> S/E/N/W.
  const sides: Facing4[] = ['south', 'east', 'north', 'west'];
  const turn = sides.indexOf(frontage);
  const sharedWalls = (b.sharedWalls ?? []).map(s => sides[(sides.indexOf(s) - turn + 4) % 4]);
  if (sharedWalls.includes('south')) throw new RangeError('Building frontage cannot be a shared wall');
  const margins: Record<Facing4, number> = {
    south: b.lot ? Math.max(0, b.lot.maxZ - p.maxZ) : 0,
    north: b.lot ? Math.max(0, p.minZ - b.lot.minZ) : 0,
    east: b.lot ? Math.max(0, b.lot.maxX - p.maxX) : 0,
    west: b.lot ? Math.max(0, p.minX - b.lot.minX) : 0,
  };
  const rules = BUILDING_ARCHETYPES[archetype === 'landmark' ? 'municipal' : archetype];
  const paletteRng = mulberry32(seed ^ 0x50414c);
  const accent = (): number => pick(paletteRng, style.accentPalette);
  return {
    archetype, ...(b.landmark === undefined ? {} : { landmark: b.landmark }), seed,
    width: turn % 2 ? dz : dx, depth: turn % 2 ? dx : dz, height: b.height,
    ...floorsForHeight(b.height, rules),
    roofStyle: pick(rng, rules.roofs), facadeStyle: pick(rng, rules.facades),
    windowPattern: pick(rng, rules.windows), entranceStyle: pick(rng, rules.entrances),
    balconyFrequency: rules.balconies[0] + rng.next() * (rules.balconies[1] - rules.balconies[0]),
    palette: { wall: pick(paletteRng, style.wallPalette), wallAccent: accent(), trim: accent(),
      roof: pick(paletteRng, style.roofPalette), awningA: accent(), awningB: accent(), sign: accent(), neon: accent() },
    signage: style.signage, sharedWalls,
    lotExtent: { front: margins[sides[turn]], right: margins[sides[(turn + 1) % 4]],
      back: margins[sides[(turn + 2) % 4]], left: margins[sides[(turn + 3) % 4]] },
    lotBlockers: [],
  };
}

const MASS_KINDS: ReadonlySet<ComponentKind> = new Set([
  'foundation', 'wallPanel', 'cornerColumn', 'roundedCorner', 'floorBand', 'parapet',
  'flatRoof', 'hipRoof', 'gableRoof', 'tileRoof', 'steppedRoof', 'column', 'balcony', 'stair',
  'exteriorCorridor', 'overhang', 'canopy', 'terrace', 'porch', 'rampDeck', 'guardrail', 'landmarkPart',
]);

export function planBuilding(cfg: BuildingConfig): BuildingPlan {
  if (cfg.archetype === 'landmark') return planLandmark(cfg);
  if (cfg.sharedWalls.includes('south')) throw new RangeError('Building frontage cannot be a shared wall');
  const a = cfg.archetype, rules = BUILDING_ARCHETYPES[a], rng = mulberry32(cfg.seed);
  const components: ComponentInstance[] = [];
  const w = cfg.width, d = cfg.depth, h = cfg.height;
  const storey = h / cfg.floors;
  // One trim profile for the whole building, not independently randomized components.
  const trimVariant = randInt(rng, 0, 2);
  const add = (kind: ComponentKind, x: number, y: number, z: number, cw: number, ch: number, cd: number,
    material: MaterialSlot = 'wall', rotY = 0, variant = trimVariant): void => {
    components.push({ kind, x, y, z, w: cw, h: ch, d: cd, material, rotY, variant,
      lod: MASS_KINDS.has(kind) ? 1 : 0 });
  };
  const faces: readonly Facing4[] = ['south', 'east', 'north', 'west'];
  const angle = (side: Facing4): number => faces.indexOf(side) * Math.PI / 2;
  const span = (side: Facing4): number => side === 'south' || side === 'north' ? w : d;
  // Face u runs along local face-X. Negative offset embeds ground details inside collider truth;
  // positive offset places an overhead projection outside the facade.
  const face = (side: Facing4, kind: ComponentKind, u: number, y: number, cw: number, ch: number, cd: number,
    material: MaterialSlot, offset = -cd / 2, variant = trimVariant): void => {
    const r = angle(side), normal = (side === 'south' || side === 'north' ? d : w) / 2 + offset;
    add(kind, Math.cos(r) * u + Math.sin(r) * normal, y, -Math.sin(r) * u + Math.cos(r) * normal,
      cw, ch, cd, material, r, variant);
  };
  add('foundation', 0, 0.1, 0, w, 0.2, d, 'concrete');
  const garage = a === 'parkingGarage';
  for (let f = 0; f < cfg.floors; f++) {
    const base = f * storey;
    for (const side of faces) {
      const s = span(side), shared = cfg.sharedWalls.includes(side);
      if (!garage || shared) {
        if (f === 0) face(side, 'wallPanel', 0, h / 2, s, h, 0.24,
          cfg.facadeStyle === 'metal' ? 'metal' : 'wall', -0.2);
      } else {
        face(side, 'guardrail', 0, base + 0.65, s - 0.4, 0.9, 0.18, 'concrete');
      }
      face(side, 'floorBand', 0, base + storey - 0.08, s, 0.16, 0.2, 'trim');
      if (shared) continue;
      const maxBays = ['bungalow', 'beachShop', 'restaurant', 'convenienceStore', 'gasStation'].includes(a) ? 3 : 5;
      const bayCount = Math.max(3, Math.min(maxBays, Math.floor(s / 3.2)));
      // Odd grids centre the entrance, porch and grand portico on the same axis.
      const bays = a === 'bungalow' && (side === 'east' || side === 'west') ? 1 : bayCount % 2 ? bayCount : bayCount - 1;
      const pitch = (s - 0.8) / bays;
      const entryBay = Math.floor((bays - 1) / 2);
      for (let bay = 0; bay < bays; bay++) {
        const u = -s / 2 + 0.4 + pitch * (bay + 0.5);
        const entry = side === 'south' && f === 0 && bay === entryBay;
        const loading = a === 'warehouse' && side === 'south' && f === 0 && bay === entryBay + 1;
        const retail = ['convenienceStore', 'restaurant', 'beachShop', 'gasStation'].includes(a);
        let kind: ComponentKind = 'window';
        if (entry) kind = garage ? 'garageDoor' : a === 'warehouse' ? 'loadingBay' : 'door';
        else if (loading) kind = 'garageDoor';
        else if (retail && f === 0 && side === 'south') kind = 'storefront';
        else if (garage || cfg.windowPattern === 'none') continue;
        const openingW = Math.min(pitch * (kind === 'window' ? (cfg.windowPattern === 'ribbon' ? 0.91 : 0.65) : 0.82),
          kind === 'door' ? 1.65 : 6);
        const openingH = Math.min(storey - 0.65, kind === 'window' ? 1.45 : 2.3);
        const y = base + (kind === 'window' ? storey * 0.55 : 0.2 + openingH / 2);
        face(side, kind, u, y, openingW, openingH, 0.12,
          kind === 'loadingBay' || kind === 'garageDoor' ? 'metal' : 'glassDark', -0.06,
          kind === 'door' ? rules.entrances.indexOf(cfg.entranceStyle) : trimVariant);
        if (a === 'bungalow' && kind === 'window') {
          for (const sign of [-1, 1]) face(side, 'shutter', u + sign * (openingW / 2 + 0.12), y,
            0.2, openingH, 0.1, 'wood');
        }
        if (f >= 1 && side === 'south' && rng.next() < cfg.balconyFrequency) {
          const slabY = base + 0.12;
          face(side, 'balcony', u, slabY, pitch * 0.87, 0.24, 1.2, 'concrete', 0.5);
          face(side, 'railing', u, base + 0.72, pitch * 0.87, 1, 0.1, 'metal', 1.05);
        }
      }
      if (a === 'office' || a === 'artDecoHotel') {
        for (const sign of [-1, 1]) face(side, 'verticalFin', sign * (s / 2 - 0.4), base + storey / 2,
          0.24, storey, 0.32, 'wallAccent');
      }
    }
    if (garage) add('floorBand', 0, base + 0.1, 0, w, 0.2, d, 'concrete');
  }
  for (const x of [-w / 2 + 0.22, w / 2 - 0.22]) for (const z of [-d / 2 + 0.22, d / 2 - 0.22]) {
    add(a === 'artDecoHotel' ? 'roundedCorner' : 'cornerColumn', x, h / 2, z, 0.44, h, 0.44, 'trim');
  }

  // All roof bases sit at collider height. Pitched roofs and kit are the explicitly permitted roof silhouette.
  add('flatRoof', 0, h + 0.08, 0, w, 0.16, d, 'roof');
  if (cfg.roofStyle === 'hip' || cfg.roofStyle === 'gable' || cfg.roofStyle === 'tile') {
    const kind = cfg.roofStyle === 'hip' ? 'hipRoof' : cfg.roofStyle === 'gable' ? 'gableRoof' : 'tileRoof';
    add(kind, 0, h + 0.7, 0, w + 0.5, 1.4, d + 0.5, cfg.roofStyle === 'tile' ? 'roofTile' : 'roof');
  } else if (cfg.roofStyle === 'stepped') {
    for (let step = 0; step < 3; step++) add('steppedRoof', 0, h + 0.15 + step * 0.3, 0,
      w * (0.9 - step * 0.15), 0.3, d * (0.9 - step * 0.15), 'wallAccent', 0, step);
  } else if (cfg.roofStyle === 'sawtooth') {
    const teeth = Math.max(2, Math.min(5, Math.floor(w / 4)));
    for (let i = 0; i < teeth; i++) add('gableRoof', -w / 2 + (i + 0.5) * w / teeth,
      h + 0.45, 0, w / teeth, 0.9, d, 'roof', 0, 1);
  }
  if (cfg.roofStyle === 'parapet' || a === 'artDecoHotel') for (const side of faces) {
    face(side, 'parapet', 0, h + 0.35, span(side), 0.7, 0.22, 'trim');
  }

  // Allocate kit to a fixed grid; large devices never intersect one another or leave the roof.
  const kit = Object.entries(rules.roofKit) as [RoofKitKind, readonly [number, number]][];
  let kitIndex = 0;
  const kitBase = h + (['hip', 'gable', 'tile'].includes(cfg.roofStyle) ? 1.45 : cfg.roofStyle === 'stepped' ? 1 : 0.2);
  for (const [kind, count] of kit) {
    const n = randInt(rng, count[0], count[1]);
    for (let i = 0; i < n; i++, kitIndex++) {
      const kw = Math.min(1.6, w / 4), kd = Math.min(1.4, d / 4);
      const kh = kind === 'waterTank' ? 1.4 : kind === 'solarPanel' || kind === 'rooftopPatio' ? 0.25 : 0.7;
      add(kind, ((kitIndex % 3) - 1) * w / 4, kitBase + kh / 2,
        (Math.floor(kitIndex / 3) - 1) * d / 4, kw, kh, kd, kind === 'solarPanel' ? 'glassDark' : 'metal');
    }
  }

  const frontAwning = (kind: 'awning' | 'canopy', width = w * 0.85): void => {
    // At the lowest legacy heights this remains above the 2.4 m collision threshold.
    face('south', kind, 0, Math.max(GROUND_LEVEL_HEIGHT + 0.15, Math.min(3, h - 0.15)),
      width, 0.24, 1.6, 'awningA', 0.65, a === 'beachShop' ? 1 : trimVariant);
  };
  const forecourtDepth = Math.min(1.8, cfg.lotExtent.front);
  const porch = (kind: 'porch' | 'stair'): void => {
    const depth = forecourtDepth > 0 ? forecourtDepth : Math.min(1.4, d / 3);
    add(kind, 0, 0.15, forecourtDepth > 0 ? d / 2 + depth / 2 : d / 2 - depth / 2,
      Math.min(3.4, w * 0.65), 0.3, depth, 'concrete');
  };
  if (cfg.entranceStyle === 'porch') porch('porch');
  if (['convenienceStore', 'restaurant', 'beachShop'].includes(a)) frontAwning('awning');
  if (a === 'artDecoHotel' || cfg.entranceStyle === 'canopy') frontAwning('canopy');
  if (a === 'artDecoHotel') face('south', 'decoPanel', 0, h * 0.65, Math.min(1.6, w / 6),
    Math.min(2.2, h / 4), 0.16, 'wallAccent');
  if (a === 'restaurant' || a === 'villa') {
    const patioD = Math.min(4, cfg.lotExtent.front || d / 3);
    add('terrace', 0, 0.1, cfg.lotExtent.front ? d / 2 + patioD / 2 : d / 2 - patioD / 2,
      w * 0.8, 0.2, patioD, 'concrete', 0, a === 'restaurant' ? 1 : 0);
    if (cfg.entranceStyle === 'arch') face('south', 'decoPanel', 0, Math.min(2.7, h - 0.15),
      Math.min(2.8, w / 2), 0.24, 0.2, 'trim', -0.1, 1);
  }
  if (a === 'bungalow' || a === 'villa') {
    const gardenD = cfg.lotExtent.front > 0 ? Math.min(2.4, cfg.lotExtent.front) : Math.min(2.4, d / 3);
    const z = cfg.lotExtent.front > 0 ? d / 2 + gardenD / 2 : d / 2 - gardenD / 2;
    // Two planted garden-wall slots leave the entrance clear; foliage is a material, never a new obstacle.
    for (const sign of [-1, 1]) add('gardenWall', sign * w * 0.37, 0.3, z, w * 0.16, 0.6,
      gardenD, a === 'bungalow' ? 'foliage' : 'concrete', 0, a === 'bungalow' ? 1 : 0);
    if (a === 'villa') add('pool', 0, 0.08, cfg.lotExtent.front >= 3 ? d / 2 + 1.5 : -d * 0.18,
      w * 0.4, 0.16, Math.min(3, d * 0.35), 'water');
  }
  if (a === 'municipal') {
    porch('stair');
    frontAwning('canopy', w * 0.55);
    // Grand entrance columns are embedded in the footprint, including when there is no front lot.
    for (const sign of [-1, 1]) add('column', sign * Math.min(2.3, w * 0.22), 1.5,
      d / 2 - 0.3, 0.5, 3, 0.5, 'trim');
  }
  if (a === 'apartment' && cfg.floors > 1 && rng.next() < 0.5) {
    const side = faces.find(s => s !== 'south' && !cfg.sharedWalls.includes(s));
    if (side) {
      for (let f = 1; f < cfg.floors; f++) face(side, 'exteriorCorridor', 0, f * storey + 0.1,
        span(side) * 0.9, 0.2, 1.2, 'concrete', 0.5);
      // Inset the ground flight into the same side as the corridor; its upper end meets that landing.
      face(side, 'stair', 0, storey / 2, 1.4, storey,
        Math.min(4, (side === 'east' || side === 'west' ? w : d) / 2), 'concrete');
    }
  }
  if (garage) {
    add('rampDeck', w / 2 - 1, Math.min(storey, h) / 2, 0, 1.8, Math.min(storey, h), d * 0.7,
      'concrete', 0, 1);
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) add('column', x, h / 2, 0, 0.5, h, 0.5, 'concrete');
  }
  if (a === 'warehouse') for (const side of ['east', 'west'] as const) {
    if (!cfg.sharedWalls.includes(side)) face(side, 'drainpipe', 0, h / 2, 0.12, h, 0.12, 'metal');
  }
  if (a === 'convenienceStore' && !cfg.sharedWalls.includes('east')) {
    face('east', 'acUnit', 0, Math.max(2.8, h - 0.7), 0.8, 0.6, 0.5, 'metal', 0.18);
  }
  if (rules.sign && rules.signage.includes(cfg.signage)) {
    const neon = cfg.signage === 'neon' && rules.neonSign;
    face('south', neon ? 'neonSign' : 'sign', 0, Math.max(2.65, Math.min(h - 0.25, 3.4)),
      Math.min(w * 0.7, 7), 0.45, 0.14, neon ? 'neon' : 'sign');
  }
  if (a === 'gasStation') {
    const validPumps = cfg.lotBlockers.filter(r => r.minZ >= d / 2 && r.maxZ <= d / 2 + MAX_CANOPY_REACH &&
      r.minX >= -w / 2 && r.maxX <= w / 2 && r.maxX > r.minX && r.maxZ > r.minZ);
    for (const r of validPumps) {
      const x = (r.minX + r.maxX) / 2, z = (r.minZ + r.maxZ) / 2;
      add('pumpIsland', x, 0.7, z, r.maxX - r.minX, 1.4, r.maxZ - r.minZ, 'metal');
      add('canopy', x, 3.6, z, r.maxX - r.minX, 0.3, r.maxZ - r.minZ, 'awningA');
    }
    if (!validPumps.length && cfg.lotBlockers.length === 0 && cfg.lotExtent.front > 0) {
      const reach = Math.min(MAX_CANOPY_REACH, cfg.lotExtent.front);
      add('canopy', 0, 3.6, d / 2 + reach / 2, w * 0.9, 0.3, reach, 'awningA');
    }
    // No invented support obstacles: ground posts are omitted unless a future caller supplies matching prop geometry.
  }
  return { config: cfg, components };
}
