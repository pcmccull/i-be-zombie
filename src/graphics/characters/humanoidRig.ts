/** [pure] Rig-unit skeleton shared by CPU and GPU skinning. No renderer dependencies. */
import { BONE_PARENT, HB, HUMANOID_BONE_COUNT, type BodyShapeId } from './characterTypes';
import { createPose, RIG, type ZombiePose } from '../../visuals/zombieRig';

export interface BodyShape {
  id: BodyShapeId;
  scale: number; width: number; headScale: number; neckLength: number;
  torsoWidth: number; torsoDepth: number; belly: number; hunch: number;
  shoulderSlope: number; shoulderAsym: number; armLength: number;
  handScale: number; footScale: number; thighThickness: number; eyeScale: number;
}

const average: BodyShape = {
  id: 'average', scale: 1, width: 1, headScale: 1.12, neckLength: 1,
  torsoWidth: 1, torsoDepth: 1, belly: 0, hunch: 0, shoulderSlope: 0,
  shoulderAsym: 0, armLength: 1, handScale: 1.2, footScale: 1.2,
  thighThickness: 1, eyeScale: 1.25,
};
export const BODY_SHAPES: Readonly<Record<BodyShapeId, BodyShape>> = {
  average,
  tallSkinny: { ...average, id: 'tallSkinny', scale: 1.12, width: 0.82, torsoWidth: 0.9,
    torsoDepth: 0.9, hunch: 0.17, shoulderSlope: 0.65, armLength: 1.17, headScale: 1.16 },
  shortRound: { ...average, id: 'shortRound', scale: 0.86, width: 1.28, belly: 0.8,
    torsoWidth: 1.14, torsoDepth: 1.18, hunch: 0.15, shoulderSlope: 0.8, neckLength: 0.94,
    armLength: 1.15, handScale: 1.3, footScale: 1.3 },
  heavy: { ...average, id: 'heavy', scale: 1.08, width: 1.3, torsoWidth: 1.22,
    torsoDepth: 1.2, belly: 0.45, hunch: 0.2, shoulderSlope: 0.7,
    thighThickness: 1.32, armLength: 1.18, handScale: 1.4, footScale: 1.4 },
  lanky: { ...average, id: 'lanky', scale: 1.06, width: 0.8, torsoWidth: 0.88,
    torsoDepth: 0.86, neckLength: 1.08, hunch: 0.3, shoulderSlope: 1,
    armLength: 1.3, handScale: 1.3, footScale: 1.25, eyeScale: 1.35 },
  alpha: { ...average, id: 'alpha', scale: 1.22, width: 1.12, headScale: 1.2,
    torsoWidth: 1.13, torsoDepth: 1.1, belly: 0.2, hunch: 0.3, shoulderSlope: 0.8,
    shoulderAsym: 1, armLength: 1.25, handScale: 1.35, footScale: 1.35, eyeScale: 1.4 },
};

const HUNCH_RAD = 0.35;
// Only these shape fields change bone frames: neckLength, armLength (hand origin ONLY),
// shoulderSlope/asym (shoulder offsets/roll), hunch. Mesh volumes never change leg FK.
// Alpha hand size is mesh-only: right = handScale * (1 + 0.8 * shoulderAsym).
export function restBoneOffsets(shape: BodyShape, out = new Float32Array(HUMANOID_BONE_COUNT * 3)): Float32Array {
  out.fill(0);
  out[HB.hips * 3 + 1] = RIG.hipY;
  out[HB.spine * 3 + 1] = RIG.waistY;
  // Chest/head translations are zero: splitting rotation must not move the old pivots.
  out[HB.neck * 3 + 1] = RIG.neckY * shape.neckLength;
  out[HB.neck * 3 + 2] = RIG.neckZ;
  out[HB.jaw * 3 + 1] = RIG.jawY; out[HB.jaw * 3 + 2] = RIG.jawZ;
  for (let side = 0; side < 2; side++) {
    const shoulder = side === 0 ? HB.shoulderL : HB.shoulderR;
    const thigh = side === 0 ? HB.upperLegL : HB.upperLegR;
    const sign = side === 0 ? 1 : -1;
    out[shoulder * 3] = sign * (RIG.shoulderX - shape.shoulderSlope * 0.012);
    out[shoulder * 3 + 1] = RIG.shoulderY - shape.shoulderSlope * 0.018
      + (side === 1 ? shape.shoulderAsym * 0.05 : 0);
    out[shoulder * 3 + 2] = shape.shoulderSlope * 0.035;
    out[(shoulder + 2) * 3 + 1] = -RIG.upperArm;
    out[(shoulder + 3) * 3 + 1] = -RIG.forearm * shape.armLength;
    out[thigh * 3] = sign * RIG.hipHalfWidth;
    out[(thigh + 1) * 3 + 1] = -RIG.thigh;
    out[(thigh + 2) * 3 + 1] = -RIG.shin;
  }
  return out;
}

// Scratch is overwritten on every call. No arrays, closures or objects are allocated in FK.
const world = new Float64Array(HUMANOID_BONE_COUNT * 16);
const local = new Float64Array(16);
const rot = new Float64Array(9);
const half = new Float64Array(9);
const total = new Float64Array(9);
const extra = new Float64Array(9);

/** Column-major Rx*Ry*Rz (XYZ) or Ry*Rx*Rz (YXZ), matching THREE.Euler. */
function euler(x: number, y: number, z: number, yxz: boolean, r: Float64Array): void {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  if (yxz) {
    r[0] = c * e + d * b * f; r[1] = a * f; r[2] = c * b * f - d * e;
    r[3] = d * b * e - c * f; r[4] = a * e; r[5] = d * f + c * b * e;
    r[6] = d * a; r[7] = -b; r[8] = c * a;
  } else {
    r[0] = c * e; r[1] = a * f + b * d * e; r[2] = b * f - a * d * e;
    r[3] = -c * f; r[4] = a * e - b * d * f; r[5] = b * e + a * d * f;
    r[6] = d; r[7] = -b * c; r[8] = a * c;
  }
}

function product(a: Float64Array, b: Float64Array, out: Float64Array, transposeA = false): void {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    let v = 0;
    for (let k = 0; k < 3; k++) v += a[transposeA ? r * 3 + k : k * 3 + r] * b[c * 3 + k];
    out[c * 3 + r] = v;
  }
}

function writeBone(i: number, x: number, y: number, z: number, root: ArrayLike<number>, sx = 1, sy = 1, sz = 1): void {
  for (let c = 0; c < 3; c++) {
    const s = c === 0 ? sx : c === 1 ? sy : sz;
    for (let r = 0; r < 3; r++) local[c * 4 + r] = rot[c * 3 + r] * s;
    local[c * 4 + 3] = 0;
  }
  local[12] = x; local[13] = y; local[14] = z; local[15] = 1;
  const p = BONE_PARENT[i], base = p * 16, dest = i * 16;
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += (p < 0 ? root[k * 4 + r] : world[base + k * 4 + r]) * local[c * 4 + k];
    world[dest + c * 4 + r] = v;
  }
}

export function poseToBoneMatrices(p: ZombiePose, s: BodyShape, root: ArrayLike<number>, out: Float32Array, offset = 0): void {
  euler(p.rootPitch, 0, p.rootRoll, false, rot);
  writeBone(HB.root, 0, p.rootY * s.scale, 0, root, s.scale * s.width, s.scale, s.scale);
  euler(p.hipPitch, p.hipYaw, p.hipRoll, true, rot);
  writeBone(HB.hips, p.hipX, p.hipY, p.hipZ, root);
  euler(p.spinePitch * 0.5, p.spineYaw * 0.5, p.spineRoll * 0.5, true, half);
  rot.set(half); writeBone(HB.spine, 0, RIG.waistY, 0, root);
  euler(p.spinePitch, p.spineYaw, p.spineRoll, true, total);
  euler(s.hunch * HUNCH_RAD, 0, 0, false, extra);
  product(total, extra, rot); total.set(rot);
  product(half, total, rot, true);
  writeBone(HB.chest, 0, 0, 0, root);
  euler(p.neckPitch * 0.4, p.neckYaw * 0.4, p.neckRoll * 0.4, true, half);
  rot.set(half); writeBone(HB.neck, 0, RIG.neckY * s.neckLength, RIG.neckZ, root);
  euler(p.neckPitch, p.neckYaw, p.neckRoll, true, total);
  product(half, total, rot, true); writeBone(HB.head, 0, 0, 0, root);
  euler(p.jaw, 0, 0, false, rot); writeBone(HB.jaw, 0, RIG.jawY, RIG.jawZ, root);
  for (let side = 0; side < 2; side++) {
    const left = side === 0, sign = left ? 1 : -1, shoulder = left ? HB.shoulderL : HB.shoulderR;
    const pitch = left ? p.armLPitch : p.armRPitch, elbow = left ? p.elbowL : p.elbowR;
    euler(0, 0, sign * s.shoulderSlope * 0.12, false, rot);
    writeBone(shoulder, sign * (RIG.shoulderX - s.shoulderSlope * 0.012),
      RIG.shoulderY + (left ? p.shrugL : p.shrugR) - s.shoulderSlope * 0.018
      + (left ? 0 : s.shoulderAsym * 0.05), s.shoulderSlope * 0.035, root);
    euler(pitch, left ? p.armLYaw : p.armRYaw, left ? p.armLRoll : p.armRRoll, false, rot);
    writeBone(shoulder + 1, 0, 0, 0, root);
    euler(-elbow, 0, 0, false, rot); writeBone(shoulder + 2, 0, -RIG.upperArm, 0, root);
    // Deterministic wrist droop: rest 0.15 rad + elbow follow-through - arm-pitch compensation.
    const wrist = 0.15 + 0.35 * elbow - 0.25 * Math.max(-1, Math.min(1, pitch));
    euler(wrist, 0, 0, false, rot); writeBone(shoulder + 3, 0, -RIG.forearm * s.armLength, 0, root);
  }
  for (let side = 0; side < 2; side++) {
    const left = side === 0, thigh = left ? HB.upperLegL : HB.upperLegR;
    euler(left ? p.thighLPitch : p.thighRPitch, 0, left ? p.thighLRoll : p.thighRRoll, false, rot);
    writeBone(thigh, (left ? 1 : -1) * RIG.hipHalfWidth, 0, 0, root);
    euler(left ? p.kneeL : p.kneeR, 0, 0, false, rot); writeBone(thigh + 1, 0, -RIG.thigh, 0, root);
    euler(left ? p.ankleL : p.ankleR, 0, 0, false, rot); writeBone(thigh + 2, 0, -RIG.shin, 0, root);
  }
  for (let i = 0; i < world.length; i++) out[offset + i] = world[i];
}

/**
 * Bind matrices exclude scale/width: the mesh is in rig units. Runtime skinning is
 * poseToBoneMatrices(pose, shape, root) * bindInverses(shape), applying root scale ONCE.
 */
export function bindInverses(shape: BodyShape): Float32Array {
  const bind = new Float32Array(HUMANOID_BONE_COUNT * 16);
  poseToBoneMatrices(createPose(), { ...shape, scale: 1, width: 1 },
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], bind);
  const out = new Float32Array(bind.length);
  for (let i = 0; i < HUMANOID_BONE_COUNT; i++) {
    const b = i * 16;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[b + c * 4 + r] = bind[b + r * 4 + c];
    for (let r = 0; r < 3; r++) out[b + 12 + r] = -(out[b + r] * bind[b + 12]
      + out[b + 4 + r] * bind[b + 13] + out[b + 8 + r] * bind[b + 14]);
    out[b + 15] = 1;
  }
  return out;
}
