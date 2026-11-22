/**
 * [pure] Deterministic human character profiles (archetype, build, skin tone, hair, outfit palette, props).
 *
 * No three.js import and no Math.random(): everything is derived deterministically from the entity id
 * and sim role/post/weapon so appearances and phase offsets stay stable across frames and reloads.
 */
import type { CivilianWeapon, HumanPost, HumanRole } from '../core/types';
import { mulberry32 } from '../utils/rng';

export type HumanArchetype = 'tourist' | 'resident' | 'worker' | 'security' | 'defender';

export const HUMAN_ARCHETYPES: readonly HumanArchetype[] = [
  'tourist',
  'resident',
  'worker',
  'security',
  'defender',
];

export type HairStyle = 'bald' | 'short' | 'bun' | 'afro' | 'long';

export const HAIR_STYLES: readonly HairStyle[] = ['bald', 'short', 'bun', 'afro', 'long'];

export type BodyBuild = 'slim' | 'average' | 'stocky' | 'tall';

export type HumanProp =
  | 'sunHat'
  | 'camera'
  | 'backpack'
  | 'sunglasses'
  | 'tote'
  | 'phone'
  | 'hardHat'
  | 'cap'
  | 'toolBelt'
  | 'policeCap'
  | 'radio'
  | 'helmet';

export type ShirtPattern = 'solid' | 'floral' | 'striped' | 'tabard' | 'uniform' | 'tactical';

export interface HumanOutfitPalette {
  shirt: number;
  shirtAccent: number;
  shirtPattern: ShirtPattern;
  pants: number;
  shoes: number;
  hat: number;
  prop: number;
  shorts: boolean;
  skirt: boolean;
}

export interface HumanProfile {
  id: number;
  archetype: HumanArchetype;
  role: HumanRole;
  post: HumanPost;
  weapon: CivilianWeapon;
  skinTone: number;
  sunburned: boolean;
  hairStyle: HairStyle;
  hairColor: number;
  build: BodyBuild;
  scaleY: number;
  scaleXZ: number;
  phaseOffset: number;
  cadenceScale: number;
  palette: HumanOutfitPalette;
  props: HumanProp[];
}

export const HUMAN_SKIN_TONES: readonly number[] = [
  0xf2ccb0, // fair peach
  0xe5b896, // light warm
  0xdba885, // medium tan
  0xc68e68, // olive / golden brown
  0xab724e, // warm brown
  0x8d5b3c, // rich brown
  0x6b422a, // deep brown
  0x4e2f1e, // dark umber
];

const HAIR_COLORS: readonly number[] = [
  0x1e1c1a, // black
  0x3b2a1e, // dark brown
  0x6e4f32, // chestnut
  0x9c7a4c, // sandy blonde
  0xc8a96e, // blonde
  0x8c3b28, // auburn
  0x96999e, // silver grey
];

const TOURIST_SHIRTS: readonly [number, number][] = [
  [0x2b9eb3, 0xff7b6b], // teal + coral floral
  [0xe85d75, 0xf7e371], // hibiscus pink + yellow
  [0x3a9679, 0xfaf0ca], // palm green + cream
  [0x4ea8de, 0xffb703], // sky blue + marigold
  [0xf4a261, 0xfefae0], // mango + bone white
  [0x9b5de5, 0x00bbf9], // orchid + aqua
];

const TOURIST_SHORTS: readonly number[] = [
  0xd9ceb0, // khaki
  0x8ab6c4, // faded surf blue
  0x6e7a62, // sage
  0xeae2d0, // linen
];

const RESIDENT_TOPS: readonly [number, number][] = [
  [0xb84a42, 0xeae6dc], // terracotta tee
  [0x477a5c, 0xd8eadc], // teal-green top
  [0xc9a648, 0xf6eed6], // mustard tee
  [0x7a5c8f, 0xe4d9ee], // plum hoodie/tee
  [0xd6cfc2, 0x5d7a8c], // cream tee
  [0x527d85, 0xeef2f3], // slate-teal top
  [0xd9738c, 0xfaf0f2], // rose tank
];

const RESIDENT_BOTTOMS: readonly number[] = [
  0x415a77, // denim jeans
  0x3b3e42, // charcoal
  0x8c7b65, // khaki tan
  0x594638, // warm brown
  0x4d5446, // olive drab
];

const WORKER_SHIRTS: readonly number[] = [
  0x4e5d6c, // slate work tee
  0x5c5346, // dusty brown tee
  0x3f474d, // charcoal tee
  0x726a5a, // stone grey tee
];

const WORKER_TABARDS: readonly number[] = [
  0xb8e638, // hi-vis lime-yellow
  0xc8f03a, // hi-vis chartreuse
  0xd4f244, // hi-vis yellow-green
];

const WORKER_PANTS: readonly number[] = [
  0x3b5375, // work denim
  0x594938, // canvas brown
  0x373b40, // dark work trousers
];

export const BUILD_DIMS: Record<BodyBuild, { scaleY: number; scaleXZ: number }> = {
  slim: { scaleY: 0.99, scaleXZ: 0.89 },
  average: { scaleY: 1.0, scaleXZ: 1.0 },
  stocky: { scaleY: 0.96, scaleXZ: 1.14 },
  tall: { scaleY: 1.07, scaleXZ: 0.97 },
};

function hashInt(id: number, salt = 0): number {
  let h = (id ^ 0x9e3779b9 ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
}

function resolveArchetype(role: HumanRole, post: HumanPost, u: number): HumanArchetype {
  if (role === 'soldier') return 'defender';
  if (role === 'police' || post === 'barricade') return 'security';
  // Civilian: ~45% tourist, ~35% resident, ~20% worker
  if (u < 0.45) return 'tourist';
  if (u < 0.80) return 'resident';
  return 'worker';
}

function pickBuild(r: () => number, archetype: HumanArchetype): BodyBuild {
  const u = r();
  if (archetype === 'defender') {
    if (u < 0.25) return 'tall';
    if (u < 0.55) return 'stocky';
    return 'average';
  }
  if (archetype === 'worker') {
    if (u < 0.35) return 'stocky';
    if (u < 0.55) return 'tall';
    if (u < 0.85) return 'average';
    return 'slim';
  }
  if (u < 0.24) return 'slim';
  if (u < 0.56) return 'average';
  if (u < 0.80) return 'stocky';
  return 'tall';
}

/**
 * Deterministic human profile from entity id + role/post/weapon.
 */
export function humanProfile(
  id: number,
  role: HumanRole = 'soldier',
  post: HumanPost = 'checkpoint',
  weapon: CivilianWeapon = 'none',
): HumanProfile {
  const seed = hashInt(id, 19);
  const rng = mulberry32(seed);
  const r = (): number => rng.next();

  const archetype = resolveArchetype(role, post, r());
  const skinTone = pick(r, HUMAN_SKIN_TONES);
  const hairStyle = pick(r, HAIR_STYLES);
  const hairColor = pick(r, HAIR_COLORS);
  const build = pickBuild(r, archetype);
  const { scaleY, scaleXZ } = BUILD_DIMS[build];
  const phaseOffset = ((hashInt(id, 41) & 0xffff) / 0xffff) * Math.PI * 2;
  const cadenceScale = 0.92 + ((hashInt(id, 53) & 0xffff) / 0xffff) * 0.16;

  let sunburned = false;
  const props: HumanProp[] = [];
  let palette: HumanOutfitPalette;

  switch (archetype) {
    case 'defender': {
      props.push('helmet');
      palette = {
        shirt: 0x2c3e66, // navy uniform
        shirtAccent: 0xe0782a, // faction orange vest
        shirtPattern: 'tactical',
        pants: 0x2c3e66,
        shoes: 0x1e2229,
        hat: 0x243252,
        prop: 0x242930,
        shorts: false,
        skirt: false,
      };
      break;
    }
    case 'security': {
      props.push('policeCap', 'radio');
      palette = {
        shirt: 0x6ca0dc, // light blue police shirt
        shirtAccent: 0xf2c94c, // gold badge
        shirtPattern: 'uniform',
        pants: 0x223252, // dark navy
        shoes: 0x181b22,
        hat: 0x223252,
        prop: 0x1b2028,
        shorts: false,
        skirt: false,
      };
      break;
    }
    case 'tourist': {
      const [shirt, shirtAccent] = pick(r, TOURIST_SHIRTS);
      const pants = pick(r, TOURIST_SHORTS);
      const hatRoll = r();
      if (hatRoll < 0.45) props.push('sunHat');
      const gearRoll = r();
      if (gearRoll < 0.4) props.push('camera');
      else if (gearRoll < 0.72) props.push('backpack');
      if (r() < 0.55) props.push('sunglasses');
      sunburned = r() < 0.25;
      palette = {
        shirt,
        shirtAccent,
        shirtPattern: 'floral',
        pants,
        shoes: r() < 0.5 ? 0xd8a868 : 0x5c4632, // sandal leather/tan
        hat: r() < 0.5 ? 0xe5d3a1 : 0xd4be88, // straw hat
        prop: r() < 0.5 ? 0x3b4d5e : 0x8c4a3e,
        shorts: true,
        skirt: false,
      };
      break;
    }
    case 'resident': {
      const [shirt, shirtAccent] = pick(r, RESIDENT_TOPS);
      const pants = pick(r, RESIDENT_BOTTOMS);
      const skirt = r() < 0.25;
      const shorts = !skirt && r() < 0.35;
      const propRoll = r();
      if (propRoll < 0.42) props.push('tote');
      else if (propRoll < 0.75) props.push('phone');
      palette = {
        shirt,
        shirtAccent,
        shirtPattern: r() < 0.28 ? 'striped' : 'solid',
        pants,
        shoes: r() < 0.5 ? 0xe2dfd6 : 0x36393e,
        hat: 0x4a5568,
        prop: r() < 0.5 ? 0xd9c29c : 0x5d8aa8,
        shorts,
        skirt,
      };
      break;
    }
    case 'worker': {
      const shirt = pick(r, WORKER_SHIRTS);
      const shirtAccent = pick(r, WORKER_TABARDS); // yellow-green hi-vis (never orange)
      const pants = pick(r, WORKER_PANTS);
      props.push(r() < 0.7 ? 'hardHat' : 'cap', 'toolBelt');
      palette = {
        shirt,
        shirtAccent,
        shirtPattern: 'tabard',
        pants,
        shoes: 0x5a422b, // work boots
        hat: r() < 0.6 ? 0xf2c94c : 0xedf2f4, // yellow or white hard hat / cap
        prop: 0x4b382a,
        shorts: false,
        skirt: false,
      };
      break;
    }
  }

  return {
    id,
    archetype,
    role,
    post,
    weapon,
    skinTone,
    sunburned,
    hairStyle,
    hairColor,
    build,
    scaleY,
    scaleXZ,
    phaseOffset,
    cadenceScale,
    palette,
    props,
  };
}
