/**
 * [pure] Data-driven zombie looks + movement personalities.
 *
 * Every zombie gets a deterministic profile from its id (and a few sim flags), so its damaged body, gait and
 * outfit stay stable for its whole life instead of re-rolling each frame. Archetypes pick the outfit
 * (former tourist, office worker, lifeguard, ...), body types pick the movement quirks (dragging leg, stiff arm,
 * heavy sway, twitchy thin walker, fresh fast turn). All tuning for the animation controller lives here.
 */
import { mulberry32 } from '../utils/rng';
import type { BodyShapeId } from '../graphics/characters/characterTypes';

/** Texture atlas tile ids (see visuals/zombieTextures.ts — the atlas is ATLAS_GRID × ATLAS_GRID tiles). */
export const ATLAS_GRID = 5;
export const TILE = {
  skin: 0,
  skinRot: 1,
  hawaiianRed: 2,
  hawaiianTeal: 3,
  office: 4,
  tee: 5,
  hiVis: 6,
  police: 7,
  lifeguard: 8,
  sport: 9,
  denim: 10,
  khaki: 11,
  slacks: 12,
  boardShorts: 13,
  leather: 14,
  hair: 15,
  alphaJacket: 16,
  fatigues: 17,
  tank: 18,
  alphaSkin: 19,
  plain: 20,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Archetype =
  | 'tourist'
  | 'office'
  | 'lifeguard'
  | 'construction'
  | 'resident'
  | 'police'
  | 'athlete'
  | 'soldier';

export const ARCHETYPES: readonly Archetype[] = [
  'tourist', 'office', 'lifeguard', 'construction', 'resident', 'police', 'athlete', 'soldier',
];

export type BodyType = 'regular' | 'injuredLeg' | 'stiffArm' | 'heavy' | 'thin' | 'fresh';

export type AccessoryKind =
  | 'hairShort'
  | 'hairMop'
  | 'policeCap'
  | 'hardHat'
  | 'helmet'
  | 'sunglasses'
  | 'tie'
  | 'vest'
  | 'flap';

export const ACCESSORY_KINDS: readonly AccessoryKind[] = [
  'hairShort', 'hairMop', 'policeCap', 'hardHat', 'helmet', 'sunglasses', 'tie', 'vest', 'flap',
];

/** Visual identity: which atlas tile and tint each body part uses. Tints are linear-ish hex multipliers. */
export interface ZombieLook {
  archetype: Archetype;
  skin: number;
  skinTile: TileId;
  torsoTile: TileId;
  torsoTint: number;
  /** 'none' = sleeveless (tank top), 'short' = sleeve stub over skin, 'long' = sleeves to the wrist. */
  sleeves: 'none' | 'short' | 'long';
  pantsTile: TileId;
  pantsTint: number;
  /** Shorts expose the shins. */
  shorts: boolean;
  shoeTint: number;
  hairTint: number;
  accessories: AccessoryKind[];
  /** Torn trouser leg on one side exposing a wounded shin (-1 right, 0 none, 1 left). */
  tornLeg: -1 | 0 | 1;
}

/** Movement personality, consumed by visuals/zombieAnimation.ts. Angles in radians, lengths in rig units. */
export interface GaitProfile {
  body: BodyType;
  /** Forward torso lean, 8°–18°. */
  lean: number;
  headDroop: number;
  /** Constant sideways head tilt. */
  headTilt: number;
  /** Shoulder height difference (rig units, + = left higher). */
  shoulderTilt: number;
  /** Ground distance covered by one full gait cycle (two steps) at normal speed, rig units. */
  stride: number;
  /** Irregular step timing (0..0.3). */
  cadenceJitter: number;
  /** Lateral pelvis sway amplitude (rig units). */
  sway: number;
  hipTwist: number;
  /** 1 = left leg injured / dragging, -1 = right, 0 = none. */
  limpLeg: -1 | 0 | 1;
  /** 0..1 strength of the limp (shorter stride, dragged toe, hitch). */
  limp: number;
  /** 1 = left arm stiff, -1 = right, 0 = none. */
  stiffArm: -1 | 0 | 1;
  /** 'forward' = locked reaching forward, 'bent' = clamped against the chest, 'dead' = hangs limp. */
  stiffMode: 'forward' | 'bent' | 'dead';
  /** Resting shoulder pitch per arm (negative = reaching forward). */
  armReachL: number;
  armReachR: number;
  armOut: number;
  armSwing: number;
  elbowL: number;
  elbowR: number;
  kneeBend: number;
  /** Idle twitch frequency multiplier (1 = average). */
  twitchiness: number;
  /** Lurches per second while walking (mean). */
  lurchRate: number;
  /** Fraction of lurches that become full stumbles. */
  stumble: number;
  /** Personal animation clock rate (idle/twitch speed), 0.85..1.15. */
  playback: number;
  /** 0..1: heavier torso sway, slower cadence. */
  heavy: number;
  /** 0..1: recently infected — more upright, quicker, more deliberate. */
  fresh: number;
  /** Mouth hangs open by this much at rest. */
  jawSlack: number;
  /** Starting gait phase (keeps a crowd out of sync). */
  phase0: number;
  /** Preferred attack styles (indices into ATTACK_STYLES order: swipeR, swipeL, grab, bite, overhead). */
  attackStyles: number[];
}

export interface ZombieProfile {
  id: number;
  seed: number;
  look: ZombieLook;
  gait: GaitProfile;
  /** Uniform body scale (0.92..1.08; brutes ×1.5) and extra shoulder width. */
  scale: number;
  width: number;
  /** 0 forward crumple, 1 twisting side fall, 2 backward collapse. */
  deathStyle: 0 | 1 | 2;
  /** Skinned-mesh body shape (VP2): deterministic per id via its own salt; brutes are 'heavy', the Alpha 'alpha'. */
  bodyShape: BodyShapeId;
}

export const ATTACK_STYLE = { swipeR: 0, swipeL: 1, grab: 2, bite: 3, overhead: 4 } as const;

const SKIN_TONES: readonly number[] = [
  0x8fa384, // desaturated green-gray
  0x9db0ae, // pale bluish
  0xaaae7c, // sickly yellow-green
  0x9c8fa0, // muted purple-gray
  0x7f9877, // deep green
  0xb3baa2, // washed-out pale
  0x8b9c90, // gray-green
  0xa3a58a, // jaundiced olive
];

const HAIR_TINTS: readonly number[] = [0x2b2420, 0x4a3a2c, 0x6b5a45, 0x8a8578, 0x1e1e22, 0x9a7c4e];
const TEE_TINTS: readonly number[] = [0xf08a7a, 0x8fd6c0, 0xf2d36b, 0xb9a3e0, 0xf5f1e6, 0x7fb4e8, 0xe8a05a];
const SPORT_TINTS: readonly number[] = [0xff6a5c, 0x52c7d9, 0xf0e14a, 0x9bd65a, 0xe56ab3];
const OFFICE_TINTS: readonly number[] = [0xffffff, 0xdfe9ff, 0xfff4e0, 0xe9f2e6];
const KHAKI_TINTS: readonly number[] = [0xffffff, 0xe7d9bd, 0xc9c1aa, 0xb9c4a4];
const SLACK_TINTS: readonly number[] = [0x9aa0aa, 0x7a7f88, 0x8b8070, 0x6c7282];
const SHOE_TINTS: readonly number[] = [0x3a3430, 0x55463a, 0xd8d4c8, 0x2a2d33, 0x7a5a3e];

/** Integer hash (deterministic, well mixed). */
export function hashId(id: number, salt = 0): number {
  let h = (id ^ 0x9e3779b9 ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function bodyScaleFromId(id: number): number {
  return 0.92 + (hashId(id, 7) & 0xffff) / 0xffff * 0.16;
}

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
}

function range(r: () => number, a: number, b: number): number {
  return a + (b - a) * r();
}

const BODY_WEIGHTS: readonly [BodyType, number][] = [
  ['regular', 0.33],
  ['injuredLeg', 0.19],
  ['stiffArm', 0.15],
  ['heavy', 0.12],
  ['thin', 0.13],
  ['fresh', 0.08],
];

function pickBody(r: () => number): BodyType {
  let u = r();
  for (const [b, w] of BODY_WEIGHTS) {
    if (u < w) return b;
    u -= w;
  }
  return 'regular';
}

/** Shape weights for bodies that don't constrain it (chosen so the whole crowd lands near 35/18/17/15/15 %). */
const SHAPE_WEIGHTS: readonly [BodyShapeId, number][] = [
  ['average', 0.468],
  ['tallSkinny', 0.153],
  ['shortRound', 0.147],
  ['heavy', 0.119],
  ['lanky', 0.113],
];

/** Deterministic body shape (salt 41 is new, so existing look / gait rolls per id are unchanged). */
export function pickBodyShape(id: number, body: BodyType, brute: boolean): BodyShapeId {
  if (brute) return 'heavy';
  const u = hashId(id, 41) / 4294967296;
  if (body === 'heavy') return u < 0.55 ? 'heavy' : 'shortRound';
  if (body === 'thin') return u < 0.5 ? 'tallSkinny' : 'lanky';
  let x = u;
  for (const [shape, w] of SHAPE_WEIGHTS) {
    if (x < w) return shape;
    x -= w;
  }
  return 'average';
}

export interface ProfileFlags {
  isConverted?: boolean;
  brute?: boolean;
  /** Sim garment variant (0..5); folded into the archetype choice so old saves keep a stable mix. */
  variant?: number;
}

export function buildLook(id: number, r: () => number, archetype: Archetype): ZombieLook {
  const look: ZombieLook = {
    archetype,
    skin: pick(r, SKIN_TONES),
    skinTile: r() < 0.45 ? TILE.skinRot : TILE.skin,
    torsoTile: TILE.tee,
    torsoTint: 0xffffff,
    sleeves: 'short',
    pantsTile: TILE.khaki,
    pantsTint: 0xffffff,
    shorts: false,
    shoeTint: pick(r, SHOE_TINTS),
    hairTint: pick(r, HAIR_TINTS),
    accessories: [],
    tornLeg: 0,
  };
  const hair = (): void => {
    const u = r();
    if (u < 0.45) look.accessories.push('hairShort');
    else if (u < 0.8) look.accessories.push('hairMop');
  };
  switch (archetype) {
    case 'tourist':
      look.torsoTile = r() < 0.5 ? TILE.hawaiianRed : TILE.hawaiianTeal;
      look.torsoTint = r() < 0.5 ? 0xffffff : 0xe8e4d8;
      look.pantsTile = r() < 0.6 ? TILE.khaki : TILE.boardShorts;
      look.pantsTint = look.pantsTile === TILE.khaki ? pick(r, KHAKI_TINTS) : 0xffffff;
      look.shorts = true;
      look.shoeTint = r() < 0.6 ? 0xd8c8a8 : look.shoeTint;
      if (r() < 0.6) look.accessories.push('sunglasses');
      hair();
      break;
    case 'office':
      look.torsoTile = TILE.office;
      look.torsoTint = pick(r, OFFICE_TINTS);
      look.sleeves = 'long';
      look.pantsTile = TILE.slacks;
      look.pantsTint = pick(r, SLACK_TINTS);
      look.shoeTint = 0x2a2420;
      look.accessories.push('tie');
      hair();
      break;
    case 'lifeguard':
      look.torsoTile = r() < 0.55 ? TILE.lifeguard : TILE.tank;
      look.torsoTint = look.torsoTile === TILE.tank ? 0xff6a5a : 0xffffff;
      look.sleeves = 'none';
      look.pantsTile = TILE.boardShorts;
      look.pantsTint = 0xff8070;
      look.shorts = true;
      look.shoeTint = 0xc9b28a;
      if (r() < 0.35) look.accessories.push('sunglasses');
      look.accessories.push(r() < 0.6 ? 'hairMop' : 'hairShort');
      break;
    case 'construction':
      look.torsoTile = TILE.hiVis;
      look.sleeves = 'short';
      look.pantsTile = TILE.denim;
      look.shoeTint = 0x5a4632;
      look.accessories.push('hardHat');
      break;
    case 'resident':
      look.torsoTile = r() < 0.75 ? TILE.tee : TILE.tank;
      look.torsoTint = pick(r, TEE_TINTS);
      look.sleeves = look.torsoTile === TILE.tank ? 'none' : 'short';
      look.shorts = r() < 0.55;
      look.pantsTile = look.shorts ? (r() < 0.5 ? TILE.khaki : TILE.boardShorts) : TILE.denim;
      look.pantsTint = look.pantsTile === TILE.khaki ? pick(r, KHAKI_TINTS) : 0xffffff;
      if (r() < 0.25) look.accessories.push('flap');
      hair();
      break;
    case 'police':
      look.torsoTile = TILE.police;
      look.sleeves = 'short';
      look.pantsTile = TILE.slacks;
      look.pantsTint = 0x4a5878;
      look.shoeTint = 0x18191c;
      look.accessories.push(r() < 0.7 ? 'policeCap' : 'hairShort');
      break;
    case 'athlete':
      look.torsoTile = TILE.sport;
      look.torsoTint = pick(r, SPORT_TINTS);
      look.sleeves = r() < 0.5 ? 'none' : 'short';
      look.pantsTile = TILE.sport;
      look.pantsTint = r() < 0.5 ? 0x3a3f4a : pick(r, SPORT_TINTS);
      look.shorts = true;
      look.shoeTint = r() < 0.5 ? 0xf2f2f2 : 0xff5a3c;
      hair();
      break;
    case 'soldier':
      look.torsoTile = TILE.fatigues;
      look.sleeves = 'long';
      look.pantsTile = TILE.fatigues;
      look.shoeTint = 0x1e2229;
      look.accessories.push('vest', r() < 0.75 ? 'helmet' : 'hairShort');
      break;
  }
  if (!look.shorts && r() < 0.22) look.tornLeg = r() < 0.5 ? 1 : -1;
  void id;
  return look;
}

export function buildGait(r: () => number, body: BodyType, brute: boolean): GaitProfile {
  const deg = Math.PI / 180;
  const g: GaitProfile = {
    body,
    lean: range(r, 9, 16) * deg,
    headDroop: range(r, 0.08, 0.3),
    headTilt: range(r, -0.22, 0.22),
    shoulderTilt: range(r, -0.035, 0.035),
    stride: range(r, 1.15, 1.45),
    cadenceJitter: range(r, 0.06, 0.16),
    sway: range(r, 0.025, 0.05),
    hipTwist: range(r, 0.06, 0.14),
    limpLeg: 0,
    limp: 0,
    stiffArm: 0,
    stiffMode: 'forward',
    armReachL: range(r, -1.25, -0.15),
    armReachR: range(r, -1.25, -0.15),
    armOut: range(r, 0.04, 0.2),
    armSwing: range(r, 0.18, 0.34),
    elbowL: range(r, 0.2, 0.85),
    elbowR: range(r, 0.2, 0.85),
    kneeBend: range(r, 0.1, 0.22),
    twitchiness: range(r, 0.7, 1.3),
    lurchRate: range(r, 0.08, 0.16),
    stumble: range(r, 0.1, 0.3),
    playback: range(r, 0.87, 1.13),
    heavy: 0,
    fresh: 0,
    jawSlack: r() < 0.4 ? range(r, 0.05, 0.22) : 0,
    phase0: r() * Math.PI * 2,
    attackStyles: [0, 1, 2, 3, 4],
  };
  // One arm usually reaches further than the other: never perfectly symmetric.
  if (Math.abs(g.armReachL - g.armReachR) < 0.25) g.armReachR = Math.max(-1.35, g.armReachL - 0.3);

  switch (body) {
    case 'injuredLeg':
      g.limpLeg = r() < 0.5 ? 1 : -1;
      g.limp = range(r, 0.55, 1);
      g.stride *= 0.86;
      g.sway *= 1.5;
      g.lurchRate *= 1.4;
      break;
    case 'stiffArm':
      g.stiffArm = r() < 0.5 ? 1 : -1;
      g.stiffMode = r() < 0.45 ? 'forward' : r() < 0.6 ? 'bent' : 'dead';
      g.attackStyles = g.stiffArm === 1 ? [0, 2, 3] : [1, 2, 3];
      break;
    case 'heavy':
      g.heavy = range(r, 0.6, 1);
      g.sway *= 1.8;
      g.stride *= 0.9;
      g.lean += 2 * deg;
      g.hipTwist *= 0.7;
      g.attackStyles = [2, 4, 0, 1];
      break;
    case 'thin':
      g.cadenceJitter += 0.08;
      g.twitchiness *= 1.6;
      g.sway *= 0.7;
      g.headTilt *= 1.5;
      g.stumble += 0.15;
      g.attackStyles = [0, 1, 3, 3];
      break;
    case 'fresh':
      g.fresh = range(r, 0.6, 1);
      g.lean = range(r, 8, 11) * deg;
      g.headDroop *= 0.5;
      g.stride *= 1.1;
      g.cadenceJitter *= 0.5;
      g.twitchiness *= 0.6;
      g.lurchRate *= 0.5;
      g.armReachL = Math.max(g.armReachL, -0.6);
      g.armReachR = Math.max(g.armReachR, -0.7);
      break;
    case 'regular':
      if (r() < 0.35) {
        // Mild drag on one foot even for "regular" walkers.
        g.limpLeg = r() < 0.5 ? 1 : -1;
        g.limp = range(r, 0.15, 0.35);
      }
      break;
  }
  if (brute) {
    g.heavy = 1;
    g.sway = Math.max(g.sway, 0.07);
    g.lean = 17 * deg;
    g.armReachL = -0.35;
    g.armReachR = -0.45;
    g.armOut = 0.28;
    g.twitchiness *= 0.6;
    g.attackStyles = [4, 2, 4, 0, 1];
  }
  return g;
}

const ARCHETYPE_WEIGHTS: readonly [Archetype, number][] = [
  ['tourist', 0.24],
  ['resident', 0.26],
  ['office', 0.14],
  ['lifeguard', 0.08],
  ['construction', 0.1],
  ['athlete', 0.1],
  ['police', 0.05],
  ['soldier', 0.03],
];

export function pickArchetype(u: number): Archetype {
  for (const [a, w] of ARCHETYPE_WEIGHTS) {
    if (u < w) return a;
    u -= w;
  }
  return 'resident';
}

/** Deterministic profile for a horde zombie. */
export function zombieProfile(id: number, flags: ProfileFlags = {}): ZombieProfile {
  const seed = hashId(id, (flags.variant ?? 0) & 7);
  const rng = mulberry32(seed);
  const r = (): number => rng.next();
  const archetype: Archetype = flags.isConverted
    ? (hashId(id, 31) & 1 ? 'police' : 'soldier')
    : pickArchetype(r());
  const body: BodyType = flags.brute ? 'heavy' : pickBody(r);
  const look = buildLook(id, r, archetype);
  const gait = buildGait(r, body, flags.brute === true);
  const widthBody = body === 'heavy' ? 1.14 : body === 'thin' ? 0.9 : 1;
  return {
    id,
    seed,
    look,
    gait,
    scale: bodyScaleFromId(id) * (flags.brute ? 1.5 : 1),
    width: widthBody * (flags.brute ? 1.2 : 1),
    deathStyle: (hashId(id, 13) % 3) as 0 | 1 | 2,
    bodyShape: pickBodyShape(id, body, flags.brute === true),
  };
}

/** The Alpha: hand-tuned hero profile (upright menace, slight right-leg drag, long reach). */
export function alphaProfile(): ZombieProfile {
  const deg = Math.PI / 180;
  const gait: GaitProfile = {
    body: 'regular',
    lean: 14 * deg,
    headDroop: 0.12,
    headTilt: -0.08,
    shoulderTilt: 0.025,
    stride: 1.5,
    cadenceJitter: 0.07,
    sway: 0.035,
    hipTwist: 0.12,
    limpLeg: -1,
    limp: 0.22,
    stiffArm: 0,
    stiffMode: 'forward',
    armReachL: -0.5,
    armReachR: -0.25,
    armOut: 0.16,
    armSwing: 0.38,
    elbowL: 0.55,
    elbowR: 0.35,
    kneeBend: 0.16,
    twitchiness: 0.65,
    lurchRate: 0.06,
    stumble: 0,
    playback: 1,
    heavy: 0.35,
    fresh: 0.5,
    jawSlack: 0.08,
    phase0: 0,
    attackStyles: [0, 1, 3, 4],
  };
  const look: ZombieLook = {
    archetype: 'resident',
    skin: 0x6f8f55,
    skinTile: TILE.alphaSkin,
    torsoTile: TILE.alphaJacket,
    torsoTint: 0xffffff,
    sleeves: 'long',
    pantsTile: TILE.slacks,
    pantsTint: 0x5a6272,
    shorts: false,
    shoeTint: 0x22252a,
    hairTint: 0x1e1e22,
    accessories: [],
    tornLeg: -1,
  };
  return { id: -1, seed: 0xa1fa, look, gait, scale: 1.22, width: 1.04, deathStyle: 0, bodyShape: 'alpha' };
}
