// [pure] VP2 character contract (ARCHITECTURE §VP2-1). Orchestrator-owned.
// One 21-bone humanoid skeleton shared by every zombie body shape and the Alpha (and humans, VP2-T011).

export const HUMANOID_BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL',
  'upperLegR', 'lowerLegR', 'footR',
] as const;

export type HumanoidBone = (typeof HUMANOID_BONES)[number];
export const HUMANOID_BONE_COUNT = HUMANOID_BONES.length; // 21

/** Bone index by name. */
export const HB: Readonly<Record<HumanoidBone, number>> = Object.fromEntries(
  HUMANOID_BONES.map((n, i) => [n, i]),
) as Record<HumanoidBone, number>;

/** Parent index per bone (-1 = root). Order guarantees parent < child. */
export const BONE_PARENT: readonly number[] = [
  -1,          // root
  0,           // hips
  1, 2,        // spine, chest
  3, 4, 5,     // neck, head, jaw
  3, 7, 8, 9,  // shoulderL, upperArmL, forearmL, handL
  3, 11, 12, 13, // shoulderR, upperArmR, forearmR, handR
  1, 15, 16,   // upperLegL, lowerLegL, footL
  1, 18, 19,   // upperLegR, lowerLegR, footR
];

export type BodyShapeId = 'average' | 'tallSkinny' | 'shortRound' | 'heavy' | 'lanky' | 'alpha';
export const ZOMBIE_BODY_SHAPES: readonly BodyShapeId[] = ['average', 'tallSkinny', 'shortRound', 'heavy', 'lanky'];
export const BODY_SHAPE_IDS: readonly BodyShapeId[] = [...ZOMBIE_BODY_SHAPES, 'alpha'];

/** Per-vertex material region (vertex attribute `aRegion`), mapped to atlas tiles / colours by the renderer. */
export type BodyRegion = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const REGION = { skin: 0, shirt: 1, pants: 2, shoes: 3, eyeWhite: 4, pupil: 5, mouth: 6, hair: 7 } as const;

export type ClipName = 'celebrate' | 'bite' | 'hitReact' | 'turnL' | 'turnR' | 'lunge' | 'idleLook' | 'riseFlourish';
export const CLIP_NAMES: readonly ClipName[] = ['celebrate', 'bite', 'hitReact', 'turnL', 'turnR', 'lunge', 'idleLook', 'riseFlourish'];
