/**
 * [pure] Zombie skeleton: joint dimensions, the pose record every zombie (horde + Alpha) is driven by,
 * and the tiny leg forward-kinematics used for ground alignment (feet planted) and tests.
 *
 * Character space: y up, feet at y = 0, +Z forward, +X = the character's left.
 * Rotation conventions (radians, right-handed):
 *   - pitch (about X) > 0 swings a hanging limb BACKWARD and tips an upright segment (spine, neck) FORWARD.
 *   - roll (about Z) > 0 swings a hanging limb toward +X (outward for the left side).
 *   - yaw (about Y) > 0 turns toward +X, same as the world facing convention.
 * Knee / elbow are flexion amounts (>= 0): knee folds the shin backward, elbow folds the forearm forward.
 */

export const RIG = {
  /** Hip joint height when both legs are straight (thigh + shin + ankle). */
  hipY: 0.76,
  hipHalfWidth: 0.11,
  thigh: 0.37,
  shin: 0.33,
  /** Ankle joint above the sole. */
  ankleH: 0.06,
  /** Spine pivot above the hip joint line. */
  waistY: 0.05,
  /** Neck pivot above the spine pivot. */
  neckY: 0.55,
  neckZ: 0.015,
  shoulderX: 0.24,
  shoulderY: 0.47,
  upperArm: 0.29,
  forearm: 0.25,
  /** Jaw hinge relative to the neck pivot. */
  jawY: 0.075,
  jawZ: 0.035,
} as const;

export interface ZombiePose {
  // Whole-body fall about the ground point under the feet (death / rise).
  rootY: number;
  rootPitch: number;
  rootRoll: number;
  // Pelvis frame (position in rig units, relative to the ground point).
  hipX: number;
  hipY: number;
  hipZ: number;
  hipPitch: number;
  hipYaw: number;
  hipRoll: number;
  // Spine (chest) relative to the pelvis.
  spinePitch: number;
  spineYaw: number;
  spineRoll: number;
  // Head relative to the chest.
  neckPitch: number;
  neckYaw: number;
  neckRoll: number;
  jaw: number;
  // Vertical shoulder offsets (rig units): uneven, hunched shoulders and spasms.
  shrugL: number;
  shrugR: number;
  armLPitch: number;
  armLYaw: number;
  armLRoll: number;
  elbowL: number;
  armRPitch: number;
  armRYaw: number;
  armRRoll: number;
  elbowR: number;
  thighLPitch: number;
  thighLRoll: number;
  kneeL: number;
  ankleL: number;
  thighRPitch: number;
  thighRRoll: number;
  kneeR: number;
  ankleR: number;
}

export type PoseField = keyof ZombiePose;

export const POSE_FIELDS: readonly PoseField[] = [
  'rootY', 'rootPitch', 'rootRoll',
  'hipX', 'hipY', 'hipZ', 'hipPitch', 'hipYaw', 'hipRoll',
  'spinePitch', 'spineYaw', 'spineRoll',
  'neckPitch', 'neckYaw', 'neckRoll', 'jaw',
  'shrugL', 'shrugR',
  'armLPitch', 'armLYaw', 'armLRoll', 'elbowL',
  'armRPitch', 'armRYaw', 'armRRoll', 'elbowR',
  'thighLPitch', 'thighLRoll', 'kneeL', 'ankleL',
  'thighRPitch', 'thighRRoll', 'kneeR', 'ankleR',
];

export function createPose(): ZombiePose {
  const p = {} as ZombiePose;
  for (const f of POSE_FIELDS) p[f] = 0;
  p.hipY = RIG.hipY;
  return p;
}

export function copyPose(src: ZombiePose, out: ZombiePose): ZombiePose {
  for (let i = 0; i < POSE_FIELDS.length; i++) {
    const f = POSE_FIELDS[i];
    out[f] = src[f];
  }
  return out;
}

/** Vertical drop from the hip joint to the ankle (rig units) for a leg with the given absolute thigh angle. */
export function ankleDrop(thighAngle: number, knee: number): number {
  return RIG.thigh * Math.cos(thighAngle) + RIG.shin * Math.cos(thighAngle + knee);
}

/** Forward (+Z) offset of the ankle from the hip joint. */
export function ankleReach(thighAngle: number, knee: number): number {
  return -(RIG.thigh * Math.sin(thighAngle) + RIG.shin * Math.sin(thighAngle + knee));
}

/** Vertical drop from the hip joint to the knee. */
export function kneeDrop(thighAngle: number): number {
  return RIG.thigh * Math.cos(thighAngle);
}

/**
 * Hip height that puts the lowest contact point (sole, or a knee when kneeling) on the ground.
 * Thigh roll shortens the vertical drop by cos(roll).
 */
export function groundedHipY(p: ZombiePose): number {
  const aL = p.hipPitch + p.thighLPitch;
  const aR = p.hipPitch + p.thighRPitch;
  const cL = Math.cos(p.thighLRoll);
  const cR = Math.cos(p.thighRRoll);
  const footL = ankleDrop(aL, p.kneeL) * cL + RIG.ankleH;
  const footR = ankleDrop(aR, p.kneeR) * cR + RIG.ankleH;
  const knee = Math.max(kneeDrop(aL) * cL, kneeDrop(aR) * cR) + 0.06;
  return Math.max(footL, footR, knee);
}

/** Foot sole heights above ground (rig units, ignoring the root fall) — used by tests. */
export function soleHeights(p: ZombiePose, out: { l: number; r: number }): { l: number; r: number } {
  out.l = p.hipY - (ankleDrop(p.hipPitch + p.thighLPitch, p.kneeL) * Math.cos(p.thighLRoll) + RIG.ankleH);
  out.r = p.hipY - (ankleDrop(p.hipPitch + p.thighRPitch, p.kneeR) * Math.cos(p.thighRRoll) + RIG.ankleH);
  return out;
}

/** Ankle forward positions relative to the ground point (rig units) — used by tests (foot slide). */
export function footReach(p: ZombiePose, out: { l: number; r: number }): { l: number; r: number } {
  out.l = p.hipZ + ankleReach(p.hipPitch + p.thighLPitch, p.kneeL);
  out.r = p.hipZ + ankleReach(p.hipPitch + p.thighRPitch, p.kneeR);
  return out;
}
