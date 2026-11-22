/**
 * [pure] VP2-T011 human body: blocky bevelled-box segments skinned to the shared 21-bone humanoid skeleton.
 *
 * User rule (MEMORY "Humans stay blocky"): humans never get rounded heads / tapered limbs (they would read as zombies).
 * Every shell here is an axis-aligned box in the bind pose with an optional SMALL chamfer (<= 0.02 m); joints are closed
 * by overlapping the shells and blending two bones across a short band around the joint plane (miter seam).
 *
 * One geometry per (build x LOD) holds the body (piece 0) plus every gear variant (hair, hats, vests, weapons...).
 * A per-instance mask (`HumanLook`) decides which gear pieces are drawn; the renderer collapses the rest in the vertex
 * shader. Per-vertex `region` picks one of 12 per-instance colour slots or a fixed palette colour.
 *
 * Also owns the pose source for humans: `humanPoseToZombiePose` maps LowPolyCharacters' PoseParams output (upright
 * walk / run / panic / aim / stagger) onto a ZombiePose so `poseToBoneMatrices` drives the same skeleton as zombies.
 */
import { HB } from './characterTypes';
import { createPose, groundedHipY, RIG, type ZombiePose } from '../../visuals/zombieRig';
import { BUILD_DIMS, type BodyBuild, type HumanProfile } from '../../visuals/humanProfiles';

export type HumanLod = 0 | 1;
export const HUMAN_BUILDS: readonly BodyBuild[] = ['slim', 'average', 'stocky', 'tall'];
export function humanBuildIndex(b: BodyBuild): number {
  return b === 'slim' ? 0 : b === 'average' ? 1 : b === 'stocky' ? 2 : 3;
}

// ---- Bind-pose joint heights (rig units; mirror humanoidRig.restBoneOffsets for the 'average' shape) -------------
const HIP_Y = RIG.hipY;
const SPINE_Y = HIP_Y + RIG.waistY;
const SHOULDER_Y = SPINE_Y + RIG.shoulderY;
const ELBOW_Y = SHOULDER_Y - RIG.upperArm;
const WRIST_Y = ELBOW_Y - RIG.forearm;
const NECK_Y = SPINE_Y + RIG.neckY;
const KNEE_Y = HIP_Y - RIG.thigh;
const ANKLE_Y = KNEE_Y - RIG.shin;
export const HUMAN_JOINTS = {
  hipY: HIP_Y, spineY: SPINE_Y, shoulderY: SHOULDER_Y, elbowY: ELBOW_Y, wristY: WRIST_Y,
  neckY: NECK_Y, kneeY: KNEE_Y, ankleY: ANKLE_Y, shoulderX: RIG.shoulderX, hipX: RIG.hipHalfWidth,
} as const;

// ---- Gear / region / weapon vocabulary ---------------------------------------------------------------------------
/** Gear piece ids. 1..24 live in the low 24-bit mask, 25.. in the high mask (bit = id - 25). */
export const GEAR = {
  hairShort: 1, hairBun: 2, hairAfro: 3, hairLong: 4, hairPeek: 5, sunHat: 6, hardHat: 7, cap: 8, helmet: 9,
  policeCap: 10, sunglasses: 11, vest: 12, secKit: 13, floral: 14, camera: 15, backpack: 16, hiVis: 17,
  teeCollar: 18, teeStripe: 19, belt: 20, buckle: 21, toolPouches: 22, skirt: 23, kneePads: 24,
  boots: 25, sandals: 26, sneakers: 27, tote: 28, phone: 29,
} as const;
export const WEAPON = { none: 0, bat: 1, pistol: 2, shotgun: 3, rifle: 4 } as const;

/** Per-instance colour slots (vertex `region` < 12). */
export const SLOT = {
  skin: 0, shirt: 1, pants: 2, shoe: 3, hair: 4, accent: 5, hat: 6, prop: 7, shin: 8, forearm: 9, hand: 10, trim: 11,
} as const;
export const SLOT_COUNT = 12;

/** Fixed palette colours (vertex `region` >= 12). */
export const HUMAN_FIXED_COLORS: readonly number[] = [
  0x242930, 0x1e2228, 0xf2f0ea, 0xdfe6ea, 0x454d59, 0x181a1f, 0x18202c, 0x171a20, 0xb9874f, 0x3a2a1c,
  0x6b4a2e, 0x4a3524, 0x353c45, 0x1c212b, 0x8b95a5, 0x453120, 0x1b2c3f, 0xfaf6ee, 0xf7e371, 0x22252a,
  0x252830, 0x9aa2ad, 0x2b303a, 0xeae6dc, 0x141a24, 0x3b322c, 0x1d222b, 0x111418, 0x2a3038,
];
const FX = {
  steel: 12, eye: 13, white: 14, reflective: 15, gunmetal: 16, visor: 18, sunBar: 19, wood: 20, grip: 21, stock: 22,
  pump: 23, pouch: 24, knee: 25, buckle: 26, toolPouch: 27, lens: 28, collar: 29, yellow: 30, strap: 31, camBody: 32,
  camLens: 33, packPocket: 34, teeCollar: 35, brim: 36, handle: 37, phone: 38, antenna: 39, pocket: 40,
} as const;

/** Per-instance emissive / mode codes (`aFx`). */
export const HUMAN_FX = { none: 0, hit: 1, hover: 2, target: 3, silhouette: 4 } as const;
export const HUMAN_SILHOUETTE_COLOR = 0x1b2124;

// ---- Geometry -----------------------------------------------------------------------------------------------------
export interface HumanShell {
  name: string;
  piece: number; // 0 = body (always drawn)
  weapon: number; // 0 or a WEAPON code
  bone: number;
  region: number;
  min: [number, number, number];
  max: [number, number, number];
  bevel: number;
  vertexStart: number;
  vertexCount: number;
  triStart: number;
  triCount: number;
}

export interface HumanBodyData {
  build: BodyBuild;
  lod: HumanLod;
  positions: Float32Array;
  normals: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** (region, piece, weapon) per vertex. */
  meta: Float32Array;
  index: Uint16Array;
  shells: HumanShell[];
  /** Triangles of always-drawn body shells (piece 0, weapon 0). */
  bodyTriangles: number;
  triangles: number;
}

interface Blend { plane: number; dir: 1 | -1; band: number; other: number; otherNeg?: number }
interface Spec {
  name: string; bone: number; region: number; piece: number; weapon: number;
  c: readonly [number, number, number]; s: readonly [number, number, number];
  bevel: number; blends?: readonly Blend[]; lod1?: boolean;
}

type V3 = readonly [number, number, number];
const L = 1; // character-left = +X
const R = -1;

/** Width factors per build (torso, limb, head). Heights come from the root bone scale (BUILD_DIMS.scaleY). */
function buildFactors(build: BodyBuild): { tw: number; lw: number; hw: number } {
  const d = BUILD_DIMS[build];
  const wf = d.scaleXZ / d.scaleY;
  return { tw: 1 + (wf - 1) * 0.55, lw: wf, hw: 1 + (wf - 1) * 0.3 };
}

function specsFor(build: BodyBuild): Spec[] {
  const { tw, lw, hw } = buildFactors(build);
  const out: Spec[] = [];
  const body = (name: string, bone: number, region: number, c: V3, s: V3, bevel: number, blends?: Blend[]): void => {
    out.push({ name, bone, region, piece: 0, weapon: 0, c, s, bevel, blends });
  };
  const gear = (name: string, piece: number, bone: number, region: number, c: V3, s: V3, bevel = 0, lod1 = false, weapon = 0): void => {
    out.push({ name, bone, region, piece, weapon, c, s, bevel, lod1 });
  };
  const sides = [
    { sx: L, tag: 'L', upperArm: HB.upperArmL, forearm: HB.forearmL, hand: HB.handL, upperLeg: HB.upperLegL, lowerLeg: HB.lowerLegL, foot: HB.footL },
    { sx: R, tag: 'R', upperArm: HB.upperArmR, forearm: HB.forearmR, hand: HB.handR, upperLeg: HB.upperLegR, lowerLeg: HB.lowerLegR, foot: HB.footR },
  ];

  // --- Trunk, neck, head ---
  body('pelvis', HB.hips, SLOT.pants, [0, 0.76, 0], [0.36 * tw, 0.17, 0.215 * tw], 0.015, [
    { plane: 0.84, dir: -1, band: 0.03, other: HB.spine },
    { plane: HIP_Y, dir: 1, band: 0.05, other: HB.upperLegL, otherNeg: HB.upperLegR },
  ]);
  body('belly', HB.spine, SLOT.shirt, [0, 0.925, 0], [0.33 * tw, 0.18, 0.205 * tw], 0.015, [
    { plane: 0.84, dir: 1, band: 0.03, other: HB.hips },
    { plane: 1.01, dir: -1, band: 0.03, other: HB.chest },
  ]);
  body('chest', HB.chest, SLOT.shirt, [0, 1.17, 0], [0.38 * tw, 0.33, 0.235 * tw], 0.02, [
    { plane: 1.01, dir: 1, band: 0.03, other: HB.spine },
  ]);
  body('neck', HB.neck, SLOT.skin, [0, 1.37, 0.012], [0.1, 0.14, 0.1], 0, [
    { plane: 1.335, dir: 1, band: 0.03, other: HB.chest },
    { plane: 1.395, dir: -1, band: 0.03, other: HB.head },
  ]);
  body('head', HB.head, SLOT.skin, [0, 1.505, 0], [0.27 * hw, 0.25, 0.265 * hw], 0.02, [
    { plane: 1.395, dir: 1, band: 0.03, other: HB.neck },
  ]);
  // Face details (always drawn).
  body('eyeL', HB.head, FX.eye, [0.052, 1.52, 0.138], [0.04, 0.032, 0.025], 0);
  body('eyeR', HB.head, FX.eye, [-0.052, 1.52, 0.138], [0.04, 0.032, 0.025], 0);
  body('nose', HB.head, SLOT.skin, [0, 1.49, 0.15], [0.034, 0.05, 0.042], 0);
  body('earL', HB.head, SLOT.skin, [0.138 * hw, 1.5, 0], [0.026, 0.055, 0.04], 0);
  body('earR', HB.head, SLOT.skin, [-0.138 * hw, 1.5, 0], [0.026, 0.055, 0.04], 0);

  // --- Limbs ---
  for (const sd of sides) {
    const ax = sd.sx * HUMAN_JOINTS.shoulderX;
    const lx = sd.sx * HUMAN_JOINTS.hipX;
    body(`upperArm${sd.tag}`, sd.upperArm, SLOT.shirt, [ax, 1.16, 0], [0.125 * lw, 0.35, 0.125 * lw], 0.015, [
      { plane: ELBOW_Y, dir: 1, band: 0.035, other: sd.forearm },
    ]);
    body(`forearm${sd.tag}`, sd.forearm, SLOT.forearm, [ax, 0.8725, 0], [0.105 * lw, 0.255, 0.105 * lw], 0.012, [
      { plane: ELBOW_Y, dir: -1, band: 0.035, other: sd.upperArm },
      { plane: 0.75, dir: 1, band: 0.03, other: sd.hand },
    ]);
    body(`hand${sd.tag}`, sd.hand, SLOT.hand, [ax, 0.695, 0.004], [0.095 * lw, 0.11, 0.105 * lw], 0.01, [
      { plane: 0.75, dir: -1, band: 0.03, other: sd.forearm },
    ]);
    body(`thigh${sd.tag}`, sd.upperLeg, SLOT.pants, [lx, 0.595, 0], [0.16 * lw, 0.42, 0.17 * lw], 0.015, [
      { plane: HIP_Y, dir: -1, band: 0.05, other: HB.hips },
      { plane: KNEE_Y, dir: 1, band: 0.04, other: sd.lowerLeg },
    ]);
    body(`shin${sd.tag}`, sd.lowerLeg, SLOT.shin, [lx, 0.2325, 0], [0.14 * lw, 0.325, 0.15 * lw], 0.012, [
      { plane: KNEE_Y, dir: -1, band: 0.04, other: sd.upperLeg },
      { plane: ANKLE_Y, dir: 1, band: 0.03, other: sd.foot },
    ]);
    body(`foot${sd.tag}`, sd.foot, SLOT.shoe, [lx, 0.05, 0.07], [0.13 * lw, 0.1, 0.26], 0.012);
  }

  // --- Hair (head bone) ---
  const H = HB.head;
  gear('hairShortCrown', GEAR.hairShort, H, SLOT.hair, [0, 1.635, -0.005], [0.29, 0.09, 0.29], 0.01, true);
  gear('hairShortBack', GEAR.hairShort, H, SLOT.hair, [0, 1.54, -0.125], [0.29, 0.17, 0.07]);
  gear('hairBunCrown', GEAR.hairBun, H, SLOT.hair, [0, 1.635, -0.005], [0.29, 0.09, 0.29], 0.01, true);
  gear('hairBunBack', GEAR.hairBun, H, SLOT.hair, [0, 1.54, -0.125], [0.29, 0.17, 0.07]);
  gear('hairBun', GEAR.hairBun, H, SLOT.hair, [0, 1.64, -0.18], [0.13, 0.13, 0.13]);
  gear('hairAfro', GEAR.hairAfro, H, SLOT.hair, [0, 1.65, -0.02], [0.38, 0.2, 0.38], 0.015, true);
  gear('hairLongCrown', GEAR.hairLong, H, SLOT.hair, [0, 1.635, -0.005], [0.29, 0.09, 0.29], 0.01, true);
  gear('hairLongBack', GEAR.hairLong, H, SLOT.hair, [0, 1.45, -0.14], [0.29, 0.34, 0.1]);
  gear('hairLongSideL', GEAR.hairLong, H, SLOT.hair, [0.152, 1.47, -0.02], [0.05, 0.24, 0.16]);
  gear('hairLongSideR', GEAR.hairLong, H, SLOT.hair, [-0.152, 1.47, -0.02], [0.05, 0.24, 0.16]);
  gear('hairPeek', GEAR.hairPeek, H, SLOT.hair, [0, 1.43, -0.13], [0.25, 0.17, 0.1]);

  // --- Headwear ---
  gear('sunHatCrown', GEAR.sunHat, H, SLOT.hat, [0, 1.67, -0.01], [0.24, 0.08, 0.24]);
  gear('sunHatBrim', GEAR.sunHat, H, SLOT.hat, [0, 1.625, 0], [0.54, 0.02, 0.54], 0, true);
  gear('sunHatBand', GEAR.sunHat, H, SLOT.accent, [0, 1.645, -0.01], [0.255, 0.025, 0.255]);
  gear('hardHatDome', GEAR.hardHat, H, SLOT.hat, [0, 1.655, -0.01], [0.3, 0.1, 0.31], 0.015, true);
  gear('hardHatRidge', GEAR.hardHat, H, SLOT.hat, [0, 1.71, -0.01], [0.05, 0.04, 0.3]);
  gear('hardHatBrim', GEAR.hardHat, H, SLOT.hat, [0, 1.625, 0.14], [0.25, 0.02, 0.12]);
  gear('capDome', GEAR.cap, H, SLOT.hat, [0, 1.65, -0.01], [0.29, 0.09, 0.3], 0.012, true);
  gear('capVisor', GEAR.cap, H, SLOT.hat, [0, 1.615, 0.15], [0.2, 0.022, 0.12]);
  gear('helmetDome', GEAR.helmet, H, SLOT.hat, [0, 1.66, -0.01], [0.32, 0.11, 0.34], 0.015, true);
  gear('helmetBand', GEAR.helmet, H, SLOT.accent, [0, 1.625, -0.01], [0.33, 0.04, 0.35]);
  gear('helmetVisor', GEAR.helmet, H, FX.visor, [0, 1.57, 0.14], [0.25, 0.065, 0.05]);
  gear('policeCapBase', GEAR.policeCap, H, SLOT.hat, [0, 1.65, -0.01], [0.3, 0.09, 0.31], 0.012, true);
  gear('policeCapTop', GEAR.policeCap, H, SLOT.hat, [0, 1.7, -0.005], [0.33, 0.04, 0.33]);
  gear('policeCapBrim', GEAR.policeCap, H, FX.brim, [0, 1.615, 0.15], [0.24, 0.025, 0.13]);
  gear('policeCapBadge', GEAR.policeCap, H, SLOT.accent, [0, 1.655, 0.153], [0.06, 0.06, 0.03]);
  gear('sunglassBar', GEAR.sunglasses, H, FX.sunBar, [0, 1.53, 0.14], [0.22, 0.045, 0.03]);
  gear('sunglassLensL', GEAR.sunglasses, H, FX.lens, [0.055, 1.53, 0.143], [0.08, 0.045, 0.032]);
  gear('sunglassLensR', GEAR.sunglasses, H, FX.lens, [-0.055, 1.53, 0.143], [0.08, 0.045, 0.032]);

  // --- Torso gear (chest / hips bones) ---
  const C = HB.chest;
  const zf = 0.118 * tw; // chest front/back surface
  gear('vest', GEAR.vest, C, SLOT.accent, [0, 1.165, 0], [0.425 * tw, 0.3, 0.275 * tw], 0.015, true);
  gear('pouchL', GEAR.vest, C, FX.pouch, [0.1 * tw, 1.12, 0.01], [0.13, 0.12, 0.29 * tw]);
  gear('pouchR', GEAR.vest, C, FX.pouch, [-0.1 * tw, 1.12, 0.01], [0.13, 0.12, 0.29 * tw]);
  gear('vestPocket', GEAR.vest, C, FX.pocket, [0, 1.25, 0.01], [0.14, 0.07, 0.28 * tw]);
  gear('tie', GEAR.secKit, C, SLOT.pants, [0, 1.16, 0.005], [0.065, 0.26, 0.25 * tw]);
  gear('epauletL', GEAR.secKit, C, SLOT.pants, [0.14 * tw, 1.325, 0], [0.11, 0.045, 0.25 * tw]);
  gear('epauletR', GEAR.secKit, C, SLOT.pants, [-0.14 * tw, 1.325, 0], [0.11, 0.045, 0.25 * tw]);
  gear('chestBadge', GEAR.secKit, C, SLOT.accent, [-0.1 * tw, 1.22, 0.005], [0.065, 0.075, 0.26 * tw]);
  gear('radio', GEAR.secKit, C, SLOT.prop, [0.17 * tw, 1.28, 0.05], [0.05, 0.1, 0.06]);
  gear('antenna', GEAR.secKit, C, FX.antenna, [0.18 * tw, 1.36, 0.05], [0.015, 0.12, 0.015]);
  gear('floralCollar', GEAR.floral, C, FX.collar, [0, 1.3, 0], [0.16, 0.08, 0.25 * tw]);
  gear('blotch1', GEAR.floral, C, SLOT.accent, [0.09, 1.22, zf + 0.004], [0.08, 0.08, 0.02]);
  gear('blotch2', GEAR.floral, C, SLOT.accent, [-0.1, 1.14, zf + 0.004], [0.07, 0.07, 0.02]);
  gear('blotch3', GEAR.floral, C, FX.yellow, [0.06, 1.06, zf], [0.08, 0.08, 0.02]);
  gear('blotch4', GEAR.floral, C, SLOT.accent, [-0.07, 1.2, -zf - 0.004], [0.08, 0.08, 0.02]);
  gear('blotch5', GEAR.floral, C, FX.yellow, [0.09, 1.08, -zf], [0.07, 0.07, 0.02]);
  gear('cameraStrap', GEAR.camera, C, FX.strap, [0, 1.24, 0.01], [0.22 * tw, 0.03, 0.25 * tw]);
  gear('cameraBody', GEAR.camera, C, FX.camBody, [0.02, 1.1, zf + 0.03], [0.11, 0.08, 0.06]);
  gear('cameraLens', GEAR.camera, C, FX.camLens, [0.02, 1.1, zf + 0.075], [0.05, 0.05, 0.05]);
  gear('backpack', GEAR.backpack, C, SLOT.prop, [0, 1.16, -zf - 0.08], [0.3 * tw, 0.34, 0.16], 0, true);
  gear('backpackPocket', GEAR.backpack, C, FX.packPocket, [0, 1.08, -zf - 0.15], [0.24, 0.12, 0.05]);
  gear('tabard', GEAR.hiVis, C, SLOT.accent, [0, 1.165, 0], [0.42 * tw, 0.3, 0.27 * tw], 0.015, true);
  gear('stripeHi', GEAR.hiVis, C, FX.reflective, [0, 1.21, 0], [0.43 * tw, 0.055, 0.285 * tw]);
  gear('stripeLo', GEAR.hiVis, C, FX.reflective, [0, 1.08, 0], [0.43 * tw, 0.055, 0.285 * tw]);
  gear('teeCollar', GEAR.teeCollar, C, FX.teeCollar, [0, 1.3, 0], [0.18, 0.075, 0.245 * tw]);
  gear('teeStripe', GEAR.teeStripe, C, SLOT.accent, [0, 1.17, 0], [0.4 * tw, 0.09, 0.25 * tw]);
  gear('belt', GEAR.belt, HB.hips, SLOT.trim, [0, 0.83, 0], [0.385 * tw, 0.06, 0.235 * tw]);
  gear('buckle', GEAR.buckle, HB.hips, FX.buckle, [0, 0.83, 0.12 * tw], [0.08, 0.07, 0.05]);
  gear('toolPouchL', GEAR.toolPouches, HB.hips, FX.toolPouch, [0.2 * tw, 0.77, 0.04], [0.1, 0.1, 0.08]);
  gear('toolPouchR', GEAR.toolPouches, HB.hips, FX.toolPouch, [-0.2 * tw, 0.77, 0.04], [0.1, 0.1, 0.08]);
  gear('skirt', GEAR.skirt, HB.hips, SLOT.pants, [0, 0.64, 0], [0.4 * tw, 0.26, 0.3 * tw], 0.015);

  // --- Leg / foot gear ---
  for (const sd of sides) {
    const lx = sd.sx * HUMAN_JOINTS.hipX;
    gear(`kneePad${sd.tag}`, GEAR.kneePads, sd.lowerLeg, FX.knee, [lx, 0.4, 0.085], [0.11, 0.1, 0.05]);
    gear(`boot${sd.tag}`, GEAR.boots, sd.lowerLeg, SLOT.shoe, [lx, 0.13, 0], [0.15 * lw, 0.12, 0.16 * lw]);
    gear(`sandal${sd.tag}`, GEAR.sandals, sd.foot, SLOT.skin, [lx, 0.1, 0.04], [0.115 * lw, 0.03, 0.15]);
    gear(`sneakerSole${sd.tag}`, GEAR.sneakers, sd.foot, FX.white, [lx, 0.02, 0.07], [0.145 * lw, 0.035, 0.265]);
    gear(`sneakerToe${sd.tag}`, GEAR.sneakers, sd.foot, FX.white, [lx, 0.075, 0.14], [0.13 * lw, 0.05, 0.07]);
  }

  // --- Hand-held (rigid to the hand bone). Offsets are in the old arm frame (down from the shoulder). ---
  const rh = (ox: number, oy: number, oz: number): V3 => [-HUMAN_JOINTS.shoulderX + ox, 1.225 + oy, oz];
  const lh = (ox: number, oy: number, oz: number): V3 => [HUMAN_JOINTS.shoulderX + ox, 1.225 + oy, oz];
  const HR = HB.handR, HL = HB.handL;
  gear('batGrip', 0, HR, FX.grip, rh(0, -0.62, 0.02), [0.054, 0.2, 0.054], 0, false, WEAPON.bat);
  gear('batBarrel', 0, HR, FX.wood, rh(0, -1.0, 0.02), [0.074, 0.62, 0.074], 0, true, WEAPON.bat);
  gear('pistolGrip', 0, HR, FX.steel, rh(0.02, -0.56, 0.03), [0.055, 0.14, 0.14], 0, false, WEAPON.pistol);
  gear('pistolBarrel', 0, HR, FX.steel, rh(0.02, -0.66, 0.07), [0.055, 0.26, 0.08], 0, true, WEAPON.pistol);
  gear('shotgunStock', 0, HR, FX.stock, rh(0.02, -0.6, 0), [0.075, 0.3, 0.1], 0, false, WEAPON.shotgun);
  gear('shotgunBarrel', 0, HR, FX.steel, rh(0.02, -0.86, 0.06), [0.068, 0.78, 0.068], 0, true, WEAPON.shotgun);
  gear('shotgunPump', 0, HR, FX.pump, rh(0.02, -0.8, 0.07), [0.085, 0.16, 0.11], 0, false, WEAPON.shotgun);
  gear('rifleBody', 0, HR, FX.steel, rh(0.08, -0.62, 0.06), [0.075, 0.7, 0.11], 0, true, WEAPON.rifle);
  gear('rifleBarrel', 0, HR, FX.gunmetal, rh(0.08, -0.98, 0.06), [0.05, 0.34, 0.05], 0, false, WEAPON.rifle);
  gear('rifleMag', 0, HR, FX.steel, rh(0.08, -0.56, -0.05), [0.065, 0.12, 0.21], 0, false, WEAPON.rifle);
  gear('rifleGrip', 0, HR, SLOT.accent, rh(0.08, -0.72, 0.08), [0.085, 0.13, 0.085], 0, false, WEAPON.rifle);
  gear('toteBag', GEAR.tote, HL, SLOT.prop, lh(0.04, -0.66, 0.01), [0.07, 0.24, 0.22], 0, true);
  gear('toteHandle', GEAR.tote, HL, FX.handle, lh(0.03, -0.52, 0.01), [0.04, 0.12, 0.04]);
  gear('phone', GEAR.phone, HL, FX.phone, lh(0.02, -0.55, 0.05), [0.03, 0.09, 0.055]);
  return out;
}

/** LOD1 body: eight plain boxes (head, torso, arms, legs, feet); long limbs blend top->bottom bone. */
function lod1BodySpecs(build: BodyBuild): Spec[] {
  const { tw, lw, hw } = buildFactors(build);
  const out: Spec[] = [];
  const add = (name: string, bone: number, region: number, c: V3, s: V3, blends?: Blend[]): void => {
    out.push({ name, bone, region, piece: 0, weapon: 0, c, s, bevel: 0, blends });
  };
  add('head', HB.head, SLOT.skin, [0, 1.505, 0], [0.27 * hw, 0.25, 0.265 * hw]);
  add('torso', HB.chest, SLOT.shirt, [0, 1.0175, 0], [0.37 * tw, 0.635, 0.225 * tw], [
    { plane: 0.78, dir: 1, band: 0.1, other: HB.hips },
  ]);
  for (const [sx, tag, ua, ha, ul, ll, ft] of [
    [L, 'L', HB.upperArmL, HB.handL, HB.upperLegL, HB.lowerLegL, HB.footL],
    [R, 'R', HB.upperArmR, HB.handR, HB.upperLegR, HB.lowerLegR, HB.footR],
  ] as const) {
    const top = 1.335, bot = 0.64, midA = (top + bot) / 2, halfA = (top - bot) / 2;
    add(`arm${tag}`, ua, SLOT.forearm, [sx * HUMAN_JOINTS.shoulderX, midA, 0], [0.115 * lw, top - bot, 0.115 * lw], [
      { plane: midA, dir: 1, band: halfA, other: ha },
    ]);
    const lt = 0.8, lb = 0.07, midL = (lt + lb) / 2, halfL = (lt - lb) / 2;
    add(`leg${tag}`, ul, SLOT.shin, [sx * HUMAN_JOINTS.hipX, midL, 0], [0.15 * lw, lt - lb, 0.16 * lw], [
      { plane: midL, dir: 1, band: halfL, other: ll },
    ]);
    add(`foot${tag}`, ft, SLOT.shoe, [sx * HUMAN_JOINTS.hipX, 0.05, 0.07], [0.13 * lw, 0.1, 0.26]);
  }
  return out;
}

// ---- Shell emission ----------------------------------------------------------------------------------------------
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

interface Acc {
  pos: number[]; nor: number[]; idx: number[]; bones: number[]; wts: number[]; meta: number[];
}

function emitShell(sp: Spec, acc: Acc, lod1: boolean): HumanShell {
  const bevel = lod1 ? 0 : sp.bevel;
  const h = [sp.s[0] / 2, sp.s[1] / 2, sp.s[2] / 2];
  const vStart = acc.pos.length / 3;
  const tStart = acc.idx.length / 3;

  const emit = (pts: number[][]): void => {
    // Newell normal, oriented away from the (origin-centred) box centre.
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nx * cx + ny * cy + nz * cz < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const base = acc.pos.length / 3;
    for (const p of pts) {
      const x = sp.c[0] + p[0], y = sp.c[1] + p[1], z = sp.c[2] + p[2];
      acc.pos.push(x, y, z);
      acc.nor.push(nx, ny, nz);
      // Weights: shell bone, blended toward the neighbour bone across each joint band (strongest blend wins).
      let wo = 0, other = sp.bone;
      if (sp.blends) {
        for (const b of sp.blends) {
          const d = b.dir * (y - b.plane);
          const w = clamp01(0.5 - d / (2 * b.band));
          if (w > wo) { wo = w; other = x < 0 && b.otherNeg !== undefined ? b.otherNeg : b.other; }
        }
      }
      acc.bones.push(sp.bone, other, 0, 0);
      acc.wts.push(1 - wo, wo, 0, 0);
      acc.meta.push(sp.region, sp.piece, sp.weapon);
    }
    for (let i = 1; i < pts.length - 1; i++) acc.idx.push(base, base + i, base + i + 1);
  };

  const fp = (a: number, sa: number, so: readonly number[]): number[] => {
    const p = [0, 0, 0];
    for (let k = 0; k < 3; k++) p[k] = k === a ? sa * h[k] : so[k] * (h[k] - bevel);
    return p;
  };
  const SG = [-1, 1];
  // Six faces
  for (let a = 0; a < 3; a++) for (const sa of SG) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const q: number[][] = [];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const so = [0, 0, 0]; so[u] = su; so[v] = sv;
      q.push(fp(a, sa, so));
    }
    emit(q);
  }
  if (bevel > 0) {
    // Twelve chamfer strips
    for (let a = 0; a < 3; a++) for (let c = a + 1; c < 3; c++) {
      const e = 3 - a - c;
      for (const sa of SG) for (const sc of SG) {
        const mk = (face: number, sf: number, se: number): number[] => {
          const so = [0, 0, 0]; so[a] = sa; so[c] = sc; so[e] = se;
          return fp(face, sf, so);
        };
        emit([mk(a, sa, -1), mk(a, sa, 1), mk(c, sc, 1), mk(c, sc, -1)]);
      }
    }
    // Eight corner triangles
    for (const sx of SG) for (const sy of SG) for (const sz of SG) {
      emit([fp(0, sx, [0, sy, sz]), fp(1, sy, [sx, 0, sz]), fp(2, sz, [sx, sy, 0])]);
    }
  }
  return {
    name: sp.name, piece: sp.piece, weapon: sp.weapon, bone: sp.bone, region: sp.region,
    min: [sp.c[0] - h[0], sp.c[1] - h[1], sp.c[2] - h[2]], max: [sp.c[0] + h[0], sp.c[1] + h[1], sp.c[2] + h[2]],
    bevel, vertexStart: vStart, vertexCount: acc.pos.length / 3 - vStart,
    triStart: tStart, triCount: acc.idx.length / 3 - tStart,
  };
}

const bodyCache = new Map<string, HumanBodyData>();

/** Deterministic skinned geometry for one (build, LOD), in unscaled rig-unit bind space. Cached. */
export function buildHumanBody(build: BodyBuild, lod: HumanLod): HumanBodyData {
  const key = `${build}:${lod}`;
  const hit = bodyCache.get(key);
  if (hit) return hit;
  const specs = lod === 0 ? specsFor(build) : [...lod1BodySpecs(build), ...specsFor(build).filter((s) => s.lod1)];
  const acc: Acc = { pos: [], nor: [], idx: [], bones: [], wts: [], meta: [] };
  const shells: HumanShell[] = [];
  for (const sp of specs) shells.push(emitShell(sp, acc, lod === 1));
  let bodyTriangles = 0;
  for (const s of shells) if (s.piece === 0 && s.weapon === 0) bodyTriangles += s.triCount;
  const data: HumanBodyData = {
    build, lod,
    positions: new Float32Array(acc.pos), normals: new Float32Array(acc.nor),
    skinIndex: new Uint16Array(acc.bones), skinWeight: new Float32Array(acc.wts),
    meta: new Float32Array(acc.meta), index: new Uint16Array(acc.idx),
    shells, bodyTriangles, triangles: acc.idx.length / 3,
  };
  bodyCache.set(key, data);
  return data;
}

// ---- Looks -------------------------------------------------------------------------------------------------------
export interface HumanLook {
  build: BodyBuild;
  buildIndex: number;
  /** Hex colours per SLOT (exact in float32). */
  colors: Float32Array;
  gearLo: number;
  gearHi: number;
  weapon: number;
  /** Tourist-style skin burn is folded into the skin slot. */
  archetype: HumanProfile['archetype'];
}

function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => {
    const x = (a >> s) & 255, y = (b >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function setGear(look: HumanLook, piece: number): void {
  if (piece < 25) look.gearLo += 2 ** (piece - 1);
  else look.gearHi += 2 ** (piece - 25);
}

/** Per-human instance data from its profile. Pure + deterministic. */
export function humanLook(profile: HumanProfile): HumanLook {
  const { palette, archetype, props } = profile;
  const look: HumanLook = {
    build: profile.build, buildIndex: humanBuildIndex(profile.build),
    colors: new Float32Array(SLOT_COUNT), gearLo: 0, gearHi: 0, weapon: 0, archetype,
  };
  const defender = archetype === 'defender', security = archetype === 'security';
  const skin = profile.sunburned ? mixHex(profile.skinTone, 0xe58d82, 0.3) : profile.skinTone;
  const c = look.colors;
  c[SLOT.skin] = skin;
  c[SLOT.shirt] = palette.shirt;
  c[SLOT.pants] = palette.pants;
  c[SLOT.shoe] = palette.shoes;
  c[SLOT.hair] = profile.hairColor;
  c[SLOT.accent] = palette.shirtAccent;
  c[SLOT.hat] = palette.hat;
  c[SLOT.prop] = palette.prop;
  c[SLOT.shin] = palette.shorts || palette.skirt ? skin : palette.pants;
  c[SLOT.forearm] = defender ? palette.shirt : skin;
  c[SLOT.hand] = defender ? palette.shoes : skin;
  c[SLOT.trim] = props.includes('toolBelt') && !defender && !security ? 0x5c422a : palette.shoes;

  const has = (p: HumanProfile['props'][number]): boolean => props.includes(p);
  const coveredByHat = defender || security || has('hardHat') || has('cap') || has('sunHat');
  if (!coveredByHat) {
    if (profile.hairStyle === 'short') setGear(look, GEAR.hairShort);
    else if (profile.hairStyle === 'bun') setGear(look, GEAR.hairBun);
    else if (profile.hairStyle === 'afro') setGear(look, GEAR.hairAfro);
    else if (profile.hairStyle === 'long') setGear(look, GEAR.hairLong);
  } else if (profile.hairStyle === 'long') setGear(look, GEAR.hairPeek);
  if (has('sunglasses')) setGear(look, GEAR.sunglasses);
  if (defender) setGear(look, GEAR.helmet);
  else if (security) setGear(look, GEAR.policeCap);
  else if (has('sunHat')) setGear(look, GEAR.sunHat);
  else if (has('hardHat')) setGear(look, GEAR.hardHat);
  else if (has('cap')) setGear(look, GEAR.cap);

  if (defender) setGear(look, GEAR.vest);
  else if (security) setGear(look, GEAR.secKit);
  else if (archetype === 'tourist') {
    setGear(look, GEAR.floral);
    if (has('camera')) setGear(look, GEAR.camera);
    else if (has('backpack')) setGear(look, GEAR.backpack);
  } else if (archetype === 'worker') setGear(look, GEAR.hiVis);
  else {
    setGear(look, GEAR.teeCollar);
    if (palette.shirtPattern === 'striped') setGear(look, GEAR.teeStripe);
  }

  if (defender || security) { setGear(look, GEAR.belt); setGear(look, GEAR.buckle); }
  else if (has('toolBelt')) { setGear(look, GEAR.belt); setGear(look, GEAR.toolPouches); }
  else if (palette.skirt) setGear(look, GEAR.skirt);
  if (defender) setGear(look, GEAR.kneePads);
  if (archetype === 'tourist') setGear(look, GEAR.sandals);
  else if (archetype === 'resident') setGear(look, GEAR.sneakers);
  else setGear(look, GEAR.boots);

  if (defender) look.weapon = WEAPON.rifle;
  else if (security) look.weapon = WEAPON.pistol;
  else if (profile.weapon === 'bat') look.weapon = WEAPON.bat;
  else if (profile.weapon === 'pistol') look.weapon = WEAPON.pistol;
  else if (profile.weapon === 'shotgun') look.weapon = WEAPON.shotgun;
  if (!defender && !security) {
    if (has('tote')) setGear(look, GEAR.tote);
    else if (has('phone')) setGear(look, GEAR.phone);
  }
  return look;
}

/** Triangles a given look actually draws at `lod` (body + enabled gear), for budgets / tests. */
export function visibleTriangles(look: HumanLook, lod: HumanLod): number {
  const data = buildHumanBody(look.build, lod);
  let n = 0;
  for (const s of data.shells) {
    let on = true;
    if (s.weapon > 0) on = look.weapon === s.weapon;
    else if (s.piece > 0) {
      on = s.piece < 25 ? Math.floor(look.gearLo / 2 ** (s.piece - 1)) % 2 === 1 : Math.floor(look.gearHi / 2 ** (s.piece - 25)) % 2 === 1;
    }
    if (on) n += s.triCount;
  }
  return n;
}

// ---- Pose source -------------------------------------------------------------------------------------------------
/** The subset of LowPolyCharacters' `Pose` this mapper reads (kept structural so this file stays three-free). */
export interface HumanPoseLike {
  bodyY: number; bodyPitch: number; bodyRoll: number;
  headPitch: number; headYaw: number;
  armLPitch: number; armRPitch: number; armLRoll: number; armRRoll: number;
  legLPitch: number; legRPitch: number;
  lunge: number; deathTilt: number;
}

/** Stride amplitude scale: the old rigid legs swung +-0.68 rad; with knees + a grounded pelvis +-0.42 reads as a walk. */
export const HUMAN_LEG_SWING = 0.62;
const FALL = Math.PI * 0.48;

function clampN(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function elbowFor(p: number): number {
  return Math.min(1.2, p > -0.6 ? 0.1 + 0.5 * Math.max(0, -p) : 0.4 + 0.18 * (-p - 0.6));
}
function kneeFor(t: number): number {
  return t > 0 ? 1.1 * t : t < -0.5 ? 1.3 * (-t - 0.5) : 0;
}

/**
 * Maps a human `Pose` (computePose output) onto the shared skeleton's ZombiePose. Humans stay upright: lean is a small
 * spine pitch, legs get knees + a grounded pelvis (feet planted), arms get elbows (aim poses keep the weapon level).
 * `climbing` = anim 'climb' (no grounding, legs stay lifted).
 */
export function humanPoseToZombiePose(h: HumanPoseLike, climbing: boolean, out: ZombiePose): ZombiePose {
  const fresh = createPose();
  for (const k of Object.keys(fresh) as (keyof ZombiePose)[]) out[k] = fresh[k];
  const dead = h.deathTilt > 1e-3;
  if (dead) {
    out.rootPitch = h.bodyPitch + h.deathTilt * FALL;
    out.rootRoll = h.bodyRoll;
    out.rootY = h.deathTilt * 0.16;
  } else {
    out.spinePitch = h.bodyPitch;
    out.spineRoll = h.bodyRoll;
  }
  out.hipZ = h.lunge;
  out.neckPitch = h.headPitch;
  out.neckYaw = h.headYaw;

  const eL = elbowFor(h.armLPitch), eR = elbowFor(h.armRPitch);
  out.armLPitch = h.armLPitch + 0.9 * eL; out.armLRoll = h.armLRoll; out.elbowL = eL;
  out.armRPitch = h.armRPitch + 0.9 * eR; out.armRRoll = h.armRRoll; out.elbowR = eR;

  const k = climbing ? 1 : HUMAN_LEG_SWING;
  let tL = h.legLPitch * k, tR = h.legRPitch * k;
  let kL = kneeFor(tL), kR = kneeFor(tR);
  const cower = !climbing && !dead && h.bodyY < -0.01;
  if (cower) { tL -= 0.25; tR -= 0.25; kL += 0.5; kR += 0.5; }
  out.thighLPitch = tL; out.thighRPitch = tR; out.kneeL = kL; out.kneeR = kR;
  out.ankleL = clampN(-0.85 * (tL + kL), -0.6, 0.6);
  out.ankleR = clampN(-0.85 * (tR + kR), -0.6, 0.6);
  // Natural counter-rotation while striding.
  if (!dead && !climbing) {
    const twist = (h.legLPitch - h.legRPitch) * 0.04;
    out.hipYaw = twist;
    out.spineYaw = -twist * 1.3;
  }
  out.hipY = dead || climbing ? RIG.hipY + h.bodyY : groundedHipY(out);
  return out;
}

/** Fraction of pose-space the mapper treats as upright (tests): absolute spine + hip pitch while walking. */
export function uprightLean(p: ZombiePose): number {
  return Math.abs(p.spinePitch) + Math.abs(p.hipPitch) + Math.abs(p.rootPitch);
}
