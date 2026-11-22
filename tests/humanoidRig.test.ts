import { describe, expect, it } from 'vitest';
import { bindInverses, BODY_SHAPES, poseToBoneMatrices, restBoneOffsets, type BodyShape } from '../src/graphics/characters/humanoidRig';
import { BONE_PARENT, HB, HUMANOID_BONE_COUNT } from '../src/graphics/characters/characterTypes';
import { createPose, POSE_FIELDS, RIG, type ZombiePose } from '../src/visuals/zombieRig';
import { mulberry32 } from '../src/utils/rng';

const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

// Independent axis-rotation composition, porting zombieModel.local/composeBones without three.
function euler(x: number, y: number, z: number, order: 'XYZ' | 'YXZ'): number[] {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const rx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const ry = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const rz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return multiply(multiply(order === 'XYZ' ? rx : ry, order === 'XYZ' ? ry : rx), rz);
}

function reference(p: ZombiePose, s: BodyShape, root: number[]): Map<number, number[]> {
  const bones = new Map<number, number[]>();
  const local = (parent: number[], id: number, x: number, y: number, z: number,
    rx: number, ry: number, rz: number, order: 'XYZ' | 'YXZ' = 'XYZ'): number[] => {
    const m = euler(rx, ry, rz, order); m[12] = x; m[13] = y; m[14] = z;
    const result = multiply(parent, m); bones.set(id, result); return result;
  };
  const r = euler(p.rootPitch, 0, p.rootRoll, 'XYZ');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 4 + j] *= s.scale * (i === 0 ? s.width : 1);
  r[13] = p.rootY * s.scale;
  const b0 = multiply(root, r); bones.set(HB.root, b0);
  const hips = local(b0, HB.hips, p.hipX, p.hipY, p.hipZ, p.hipPitch, p.hipYaw, p.hipRoll, 'YXZ');
  // Old single spine corresponds to the NEW chest orientation, at the identical pivot.
  const spine = local(hips, HB.chest, 0, RIG.waistY, 0, p.spinePitch, p.spineYaw, p.spineRoll, 'YXZ');
  const head = local(spine, HB.head, 0, RIG.neckY, RIG.neckZ, p.neckPitch, p.neckYaw, p.neckRoll, 'YXZ');
  local(head, HB.jaw, 0, RIG.jawY, RIG.jawZ, p.jaw, 0, 0);
  for (let side = 0; side < 2; side++) {
    const left = side === 0, upper = left ? HB.upperArmL : HB.upperArmR;
    const arm = local(spine, upper, (left ? 1 : -1) * RIG.shoulderX, RIG.shoulderY + (left ? p.shrugL : p.shrugR), 0,
      left ? p.armLPitch : p.armRPitch, left ? p.armLYaw : p.armRYaw, left ? p.armLRoll : p.armRRoll);
    local(arm, upper + 1, 0, -RIG.upperArm, 0, -(left ? p.elbowL : p.elbowR), 0, 0);
    const thigh = left ? HB.upperLegL : HB.upperLegR;
    const upperLeg = local(hips, thigh, (left ? 1 : -1) * RIG.hipHalfWidth, 0, 0,
      left ? p.thighLPitch : p.thighRPitch, 0, left ? p.thighLRoll : p.thighRRoll);
    const lower = local(upperLeg, thigh + 1, 0, -RIG.thigh, 0, left ? p.kneeL : p.kneeR, 0, 0);
    local(lower, thigh + 2, 0, -RIG.shin, 0, left ? p.ankleL : p.ankleR, 0, 0);
  }
  return bones;
}

describe('21-bone humanoid rig', () => {
  it('matches composeBones for 200 random poses: all leg chains and average upper body', () => {
    const rng = mulberry32(0x21b0), out = new Float32Array(HUMANOID_BONE_COUNT * 16);
    let maxError = 0;
    for (let sample = 0; sample < 200; sample++) {
      const p = createPose();
      for (const key of POSE_FIELDS) p[key] = (rng.next() * 2 - 1) * 1.4;
      p.hipY = 0.4 + rng.next() * 0.5;
      const root = euler(rng.next(), rng.next() * 6, rng.next(), 'YXZ');
      root[12] = rng.next() * 20 - 10; root[13] = rng.next() * 3; root[14] = rng.next() * 20 - 10;
      for (const s of Object.values(BODY_SHAPES)) {
        poseToBoneMatrices(p, s, root, out);
        const ref = reference(p, s, root);
        const selected = [HB.root, HB.hips, HB.upperLegL, HB.lowerLegL, HB.footL, HB.upperLegR, HB.lowerLegR, HB.footR];
        if (s.id === 'average') selected.push(HB.chest, HB.head, HB.jaw, HB.upperArmL, HB.forearmL, HB.upperArmR, HB.forearmR);
        for (const b of selected) for (let i = 0; i < 16; i++) maxError = Math.max(maxError, Math.abs(out[b * 16 + i] - ref.get(b)![i]));
      }
    }
    expect(maxError).toBeLessThan(1e-4);
  });

  it('uses unscaled bind inverses and the supplied offset without overwriting adjacent rows', () => {
    let maxError = 0;
    for (const s of Object.values(BODY_SHAPES)) {
      const bind = new Float32Array(HUMANOID_BONE_COUNT * 16);
      const inverses = bindInverses(s);
      poseToBoneMatrices(createPose(), { ...s, scale: 1, width: 1 }, identity(), bind);
      for (let b = 0; b < HUMANOID_BONE_COUNT; b++) {
        const m = multiply(bind.subarray(b * 16, b * 16 + 16), inverses.subarray(b * 16, b * 16 + 16));
        for (let i = 0; i < 16; i++) maxError = Math.max(maxError, Math.abs(m[i] - identity()[i]));
      }
      const out = new Float32Array(bind.length + 6).fill(123);
      poseToBoneMatrices(createPose(), s, identity(), out, 3);
      expect([...out.subarray(0, 3), ...out.subarray(out.length - 3)]).toEqual([123, 123, 123, 123, 123, 123]);
      expect(out.every(Number.isFinite)).toBe(true);
    }
    expect(maxError).toBeLessThan(1e-5);
  });

  it('returns parent-relative translations matching every rest world origin', () => {
    let maxError = 0;
    const out = new Float32Array(336), storage = new Float32Array(63);
    for (const s of Object.values(BODY_SHAPES)) {
      expect(restBoneOffsets(s, storage)).toBe(storage);
      expect(restBoneOffsets(s)).toEqual(storage);
      expect([...storage.subarray(HB.chest * 3, HB.chest * 3 + 3)]).toEqual([0, 0, 0]);
      poseToBoneMatrices(createPose(), { ...s, scale: 1, width: 1 }, identity(), out);
      for (let i = 1; i < 21; i++) {
        const p = BONE_PARENT[i] * 16;
        for (let r = 0; r < 3; r++) {
          const expected = out[p + r] * storage[i * 3] + out[p + r + 4] * storage[i * 3 + 1]
            + out[p + r + 8] * storage[i * 3 + 2] + out[p + r + 12];
          maxError = Math.max(maxError, Math.abs(out[i * 16 + 12 + r] - expected));
        }
      }
    }
    expect(maxError).toBeLessThan(1e-6);
  });

  it('reuses the same output for 10,000 finite FK calls (allocation/performance proxy)', () => {
    const out = new Float32Array(336), root = identity(), p = createPose();
    for (let i = 0; i < 10_000; i++) {
      p.elbowL = i / 10_000 * Math.PI; p.neckYaw = Math.sin(i);
      poseToBoneMatrices(p, BODY_SHAPES.alpha, root, out);
    }
    expect(out.every(Number.isFinite)).toBe(true);
  });
});
