/** [pure] Deterministic, indexed, smooth character shells in unscaled rig-unit bind space. */
import { HB, HUMANOID_BONE_COUNT, REGION } from './characterTypes';
import { poseToBoneMatrices, type BodyShape } from './humanoidRig';
import { createPose, RIG } from '../../visuals/zombieRig';

export interface BodyMeshData {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array;
  skinIndex: Uint16Array; skinWeight: Float32Array; region: Uint8Array;
  index: Uint32Array; triangles: number;
}

type Weights = readonly (readonly [number, number])[];
interface Ring {
  bone: number; y: number; rx: number; rz: number; region: number; weights: Weights;
  x?: number; z?: number; thumb?: number; face?: boolean; headY?: number;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const TAU = Math.PI * 2;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const single = (bone: number): Weights => [[bone, 1]];

/** Linear weight ramp across +/-25% of the shorter adjacent segment, shared by joint rings. */
function blend(t: number, joint: number, span: number, a: number, b: number): Weights {
  const w = clamp01((t - joint) / (span * 0.5) + 0.5);
  return [[a, 1 - w], [b, w]];
}

export function buildBodyMesh(shape: BodyShape, lod: 0 | 1): BodyMeshData {
  const alpha = shape.id === 'alpha';
  const sides = alpha ? (lod === 0 ? 24 : 10) : (lod === 0 ? 12 : 6);
  const positions: number[] = [], uvs: number[] = [], bones: number[] = [], weights: number[] = [];
  const regions: number[] = [], indices: number[] = [];
  const bind = new Float32Array(HUMANOID_BONE_COUNT * 16);
  poseToBoneMatrices(createPose(), { ...shape, scale: 1, width: 1 }, IDENTITY, bind);

  function vertex(x: number, y: number, z: number, bone: number, region: number, influence: Weights, u: number, v: number): number {
    const b = bone * 16, id = positions.length / 3;
    positions.push(bind[b] * x + bind[b + 4] * y + bind[b + 8] * z + bind[b + 12],
      bind[b + 1] * x + bind[b + 5] * y + bind[b + 9] * z + bind[b + 13],
      bind[b + 2] * x + bind[b + 6] * y + bind[b + 10] * z + bind[b + 14]);
    regions.push(region); uvs.push(u, v);
    // Merge duplicate influences, drop tiny weights, then normalize. At most four survive.
    const merged = new Map<number, number>();
    for (const [i, w] of influence) merged.set(i, (merged.get(i) ?? 0) + w);
    const active = [...merged].filter(([, w]) => w >= 0.01).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = active.reduce((v, [, w]) => v + w, 0);
    for (let i = 0; i < 4; i++) {
      bones.push(active[i]?.[0] ?? 0); weights.push(active[i] ? active[i][1] / sum : 0);
    }
    return id;
  }

  /** Each loft has its own indices, including poles; the UV seam reuses the first vertex. */
  function loft(rows: Ring[], n: number, descending = false, bottomY?: number, topY?: number): void {
    const first = positions.length / 3;
    let distance = 0;
    let prevX = 0, prevY = 0, prevZ = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const b = row.bone * 16, lx = row.x ?? 0, lz = row.z ?? 0;
      const wx = bind[b] * lx + bind[b + 4] * row.y + bind[b + 8] * lz + bind[b + 12];
      const wy = bind[b + 1] * lx + bind[b + 5] * row.y + bind[b + 9] * lz + bind[b + 13];
      const wz = bind[b + 2] * lx + bind[b + 6] * row.y + bind[b + 10] * lz + bind[b + 14];
      if (r > 0) distance += Math.hypot(wx - prevX, wy - prevY, wz - prevZ);
      prevX = wx; prevY = wy; prevZ = wz;
      for (let j = 0; j < n; j++) {
        const angle = TAU * j / n, c = Math.cos(angle), s = Math.sin(angle);
        let x = row.rx * c, z = row.rz * s;
        if (row.thumb) {
          // Separate thumb-shaped lobe, with a notch toward the finger mass, on the same closed hand shell.
          const direction = Math.sign(row.thumb);
          const lobe = Math.exp(-Math.pow((c * direction + 0.92) / 0.22, 2)) * Math.abs(row.thumb);
          x -= lobe * direction; z += lobe * 0.45;
        }
        if (row.face && s > 0) {
          const h = row.headY ?? 0;
          const eyeBand = Math.exp(-Math.pow((h - 0.245) / 0.055, 2));
          const socket = Math.exp(-Math.pow((Math.abs(c) - 0.48) / 0.22, 2));
          const brow = Math.exp(-Math.pow((h - 0.31) / 0.035, 2));
          const nose = Math.exp(-Math.pow(c / 0.24, 2)) * Math.exp(-Math.pow((h - 0.205) / 0.05, 2));
          z += s * (-0.023 * eyeBand * socket + 0.021 * brow + 0.045 * nose) * shape.headScale;
        }
        vertex((row.x ?? 0) + x, row.y, (row.z ?? 0) + z, row.bone, row.region, row.weights,
          j / n * TAU * (row.rx + row.rz) * 0.5, distance);
      }
    }
    function face(a: number, b: number, c: number): void {
      if (descending) indices.push(a, c, b); else indices.push(a, b, c);
    }
    for (let r = 0; r < rows.length - 1; r++) for (let j = 0; j < n; j++) {
      const a = first + r * n + j, b = first + r * n + (j + 1) % n;
      face(a, a + n, b); face(b, a + n, b + n);
    }
    const a = rows[0], z = rows[rows.length - 1];
    const start = vertex(a.x ?? 0, bottomY ?? a.y, a.z ?? 0, a.bone, a.region, a.weights, 0, 0);
    const end = vertex(z.x ?? 0, topY ?? z.y, z.z ?? 0, z.bone, z.region, z.weights, 0, distance);
    const last = first + (rows.length - 1) * n;
    for (let j = 0; j < n; j++) {
      face(start, first + j, first + (j + 1) % n);
      face(end, last + (j + 1) % n, last + j);
    }
  }

  const tw = shape.torsoWidth, td = shape.torsoDepth;
  const torso: Ring[] = [
    { bone: HB.hips, y: -0.065, rx: 0.16 * tw, rz: 0.115 * td, region: REGION.pants, weights: single(HB.hips) },
    { bone: HB.spine, y: 0.12, rx: 0.18 * tw, rz: (0.12 + shape.belly * 0.055) * td,
      z: shape.belly * 0.025, region: REGION.shirt, weights: blend(0.12, 0.08, 0.3, HB.hips, HB.spine) },
    { bone: HB.chest, y: 0.28, rx: 0.205 * tw, rz: (0.13 + shape.belly * 0.02) * td,
      region: REGION.shirt, weights: blend(0.28, 0.25, 0.45, HB.spine, HB.chest) },
    { bone: HB.chest, y: 0.445, rx: (RIG.shoulderX + 0.025) * tw, rz: 0.115 * td,
      region: REGION.shirt, weights: single(HB.chest) },
    { bone: HB.chest, y: 0.50, rx: 0.145 * tw, rz: 0.09 * td,
      region: REGION.shirt, weights: blend(0.50, 0.55, 0.2, HB.chest, HB.neck) },
    { bone: HB.neck, y: 0.035, rx: 0.064, rz: 0.061, region: REGION.skin, weights: [[HB.neck, 0.6], [HB.head, 0.4]] },
  ];
  if (lod === 1 && !alpha) loft([torso[0], torso[1], torso[3], torso[5]], sides);
  else loft(refine(torso, alpha ? (lod === 0 ? 2 : 1) : 1), sides);

  for (let side = 0; side < 2; side++) {
    const left = side === 0, upper = left ? HB.upperArmL : HB.upperArmR, fore = upper + 1, hand = upper + 2;
    const wrist = RIG.upperArm + RIG.forearm * shape.armLength;
    // Same rule as humanoidRig: asymmetry changes the right HAND MESH, never elbow/leg lengths.
    const hs = shape.handScale * (left ? 1 : 1 + 0.8 * shape.shoulderAsym);
    const upperWidth = 0.072 * Math.sqrt(tw), foreWidth = 0.057 * Math.sqrt(tw);
    const arm: Ring[] = [];
    const armRing = (t: number, rx: number, rz: number, region: number): void => {
      let w: Weights;
      if (t < 0.1) w = blend(t, 0, RIG.upperArm, HB.chest, upper);
      else if (t < RIG.upperArm + RIG.forearm * 0.5) w = blend(t, RIG.upperArm, RIG.forearm, upper, fore);
      else w = blend(t, wrist, RIG.forearm * shape.armLength, fore, hand);
      arm.push({ bone: upper, y: -t, rx, rz, region, weights: w });
    };
    armRing(-0.035, upperWidth * 0.9, upperWidth * 0.9, REGION.shirt);
    if (lod === 0 || alpha) armRing(0.09, upperWidth, upperWidth * 0.9, REGION.shirt);
    armRing(0.20, foreWidth * 1.12, foreWidth, REGION.shirt);
    armRing(RIG.upperArm, foreWidth, foreWidth, REGION.skin);
    if (lod === 0 || alpha) armRing(RIG.upperArm + 0.075, foreWidth * 1.05, foreWidth, REGION.skin);
    armRing(wrist - 0.06, 0.039 * hs, 0.036 * hs, REGION.skin);
    armRing(wrist, 0.035 * hs, 0.033 * hs, REGION.skin);
    // Hand sections are in the drooping hand frame, closing into rounded fingers below the wrist.
    arm.push({ bone: hand, y: -0.065 * hs, rx: 0.052 * hs, rz: 0.035 * hs,
      thumb: 0.028 * hs, region: REGION.skin, weights: single(hand) });
    arm.push({ bone: hand, y: -0.125 * hs, rx: 0.034 * hs, rz: 0.024 * hs,
      region: REGION.skin, weights: single(hand) });
    // Mirror thumb toward the torso; limb shells remain disjoint by index and tuck into the shirt.
    if (!left) for (const row of arm) if (row.thumb) row.thumb = -row.thumb;
    loft(refine(arm, alpha && lod === 0 ? 2 : 1), sides, true, arm[0].y + 0.025, -0.145 * hs);
  }

  for (let side = 0; side < 2; side++) {
    const thigh = side === 0 ? HB.upperLegL : HB.upperLegR, shin = thigh + 1, foot = thigh + 2;
    const ft = shape.footScale, thick = shape.thighThickness;
    const leg: Ring[] = [];
    const legRing = (t: number, rx: number, rz: number): void => {
      const w = t < 0.1 ? blend(t, 0, RIG.thigh, HB.hips, thigh)
        : t < 0.55 ? blend(t, RIG.thigh, RIG.shin, thigh, shin)
        : blend(t, RIG.thigh + RIG.shin, 0.2, shin, foot);
      leg.push({ bone: thigh, y: -t, rx, rz, region: REGION.pants, weights: w });
    };
    legRing(-0.025, 0.092 * thick, 0.10 * thick);
    if (lod === 0 || alpha) legRing(0.17, 0.088 * thick, 0.087 * thick);
    legRing(RIG.thigh, 0.061 * thick, 0.065 * thick);
    legRing(0.53, 0.060 * thick, 0.066 * thick);
    if (lod === 0 || alpha) legRing(0.63, 0.045 * thick, 0.052 * thick);
    // Big rounded shoe; sole is exactly y=0 for every shape before root scaling.
    leg.push({ bone: foot, y: 0.005, z: 0.045 * ft, rx: 0.067 * ft, rz: 0.105 * ft,
      region: REGION.shoes, weights: [[shin, 0.2], [foot, 0.8]] });
    leg.push({ bone: foot, y: -0.025, z: 0.065 * ft, rx: 0.078 * ft, rz: 0.135 * ft,
      region: REGION.shoes, weights: single(foot) });
    leg.push({ bone: foot, y: -RIG.ankleH, z: 0.062 * ft, rx: 0.068 * ft, rz: 0.125 * ft,
      region: REGION.shoes, weights: single(foot) });
    loft(refine(leg, alpha && lod === 0 ? 2 : 1), sides, true, leg[0].y + 0.02, -RIG.ankleH);
  }

  const hs = shape.headScale;
  const head: Ring[] = [];
  const headRows = alpha ? (lod === 0 ? 15 : 7) : (lod === 0 ? 9 : 4);
  for (let i = 0; i < headRows; i++) {
    const t = (i + 1) / (headRows + 1), latitude = -Math.PI / 2 + Math.PI * t;
    const y = 0.21 + 0.205 * Math.sin(latitude);
    // Squared-off chin, full cheeks, domed skull; facial features sculpt the same shell.
    const radius = Math.cos(latitude), cheek = 1 + 0.09 * Math.exp(-Math.pow((y - 0.16) / 0.07, 2));
    head.push({ bone: HB.head, y: y * hs, rx: 0.145 * hs * radius * cheek,
      rz: 0.132 * hs * radius, z: 0.013 * hs, region: REGION.skin, face: true, headY: y,
      weights: [[HB.jaw, (1 - clamp01((y - 0.075) / 0.12)) * 0.8],
        [HB.head, 1 - (1 - clamp01((y - 0.075) / 0.12)) * 0.8]] });
  }
  loft(head, sides, false, 0.005 * hs, 0.415 * hs);

  const eyeSides = alpha ? (lod === 0 ? 16 : 8) : (lod === 0 ? 8 : 5);
  const eyeRows = alpha ? (lod === 0 ? 6 : 2) : (lod === 0 ? 3 : 1);
  for (const sign of [1, -1]) {
    const ex = sign * 0.066 * hs, ey = 0.257 * hs, ez = 0.119 * hs;
    const er = 0.035 * shape.eyeScale;
    const eye: Ring[] = [];
    for (let i = 0; i < eyeRows; i++) {
      const lat = -Math.PI / 2 + Math.PI * (i + 1) / (eyeRows + 1);
      eye.push({ bone: HB.head, x: ex, y: ey + er * Math.sin(lat), z: ez,
        rx: er * Math.cos(lat), rz: er * 0.8 * Math.cos(lat), region: REGION.eyeWhite, weights: single(HB.head) });
    }
    loft(eye, eyeSides, false, ey - er, ey + er);
    // Open pupil disc: the only intentionally non-watertight surface.
    const pupilZ = ez + er * 0.81, pr = er * 0.43;
    const center = vertex(ex, ey, pupilZ, HB.head, REGION.pupil, single(HB.head), 0, 0);
    for (let i = 0; i < eyeSides; i++) {
      const a = TAU * i / eyeSides;
      vertex(ex + Math.cos(a) * pr, ey + Math.sin(a) * pr, pupilZ,
        HB.head, REGION.pupil, single(HB.head), Math.cos(a) * pr, Math.sin(a) * pr);
    }
    for (let i = 0; i < eyeSides; i++) indices.push(center, center + 1 + i, center + 1 + (i + 1) % eyeSides);
  }
  // A closed slack grin, embedded slightly in the chin and following the jaw hinge.
  loft([{ bone: HB.jaw, x: 0, y: 0.045 * hs, z: 0.101 * hs, rx: 0.071 * hs, rz: 0.009,
    region: REGION.mouth, weights: single(HB.jaw) }], lod === 1 ? 4 : 8, false, 0.034 * hs, 0.056 * hs);

  const pos = new Float32Array(positions), index = new Uint32Array(indices), normals = new Float32Array(pos.length);
  // Area-weighted smooth normals. Indexed rings, poles and shells have no duplicate seam vertices.
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [a, b, c]) { normals[j] += nx; normals[j + 1] += ny; normals[j + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return { positions: pos, normals, uvs: new Float32Array(uvs), skinIndex: new Uint16Array(bones),
    skinWeight: new Float32Array(weights), region: new Uint8Array(regions), index, triangles: index.length / 3 };
}

/** More longitudinal samples for the hero, retaining joint rows and their exact weights. */
function refine(rows: Ring[], factor: number): Ring[] {
  if (factor === 1) return rows;
  const out: Ring[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    out.push(a);
    // Different bone frames at neck/wrist/ankle are already close joint rings; do not interpolate local coordinates.
    if (b && a.bone === b.bone) out.push({ ...a, y: (a.y + b.y) * 0.5,
      x: ((a.x ?? 0) + (b.x ?? 0)) * 0.5, z: ((a.z ?? 0) + (b.z ?? 0)) * 0.5,
      rx: (a.rx + b.rx) * 0.5, rz: (a.rz + b.rz) * 0.5,
      weights: [...a.weights.map(([bone, w]) => [bone, w * 0.5] as const), ...b.weights.map(([bone, w]) => [bone, w * 0.5] as const)] });
  }
  return out;
}
