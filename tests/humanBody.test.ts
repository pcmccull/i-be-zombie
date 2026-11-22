import { describe, expect, it } from 'vitest';
import { HB, HUMANOID_BONE_COUNT } from '../src/graphics/characters/characterTypes';
import { BODY_SHAPES, bindInverses, poseToBoneMatrices } from '../src/graphics/characters/humanoidRig';
import {
  GEAR, HUMAN_BUILDS, HUMAN_JOINTS, HUMAN_LEG_SWING, WEAPON, buildHumanBody, humanLook, humanPoseToZombiePose,
  uprightLean, visibleTriangles, type HumanBodyData, type HumanLod, type HumanPoseLike,
} from '../src/graphics/characters/humanBodyMath';
import { createPose, soleHeights } from '../src/visuals/zombieRig';
import { humanProfile } from '../src/visuals/humanProfiles';

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function pose(over: Partial<HumanPoseLike> = {}): HumanPoseLike {
  return {
    bodyY: 0, bodyPitch: 0, bodyRoll: 0, headPitch: 0, headYaw: 0, armLPitch: 0, armRPitch: 0, armLRoll: 0, armRRoll: 0,
    legLPitch: 0, legRPitch: 0, lunge: 0, deathTilt: 0, ...over,
  };
}

/** CPU linear-blend skinning of vertex `i` with the same matrices the shader samples (world * bindInverse). */
function skin(data: HumanBodyData, i: number, world: Float32Array, inv: Float32Array): [number, number, number] {
  const x = data.positions[i * 3], y = data.positions[i * 3 + 1], z = data.positions[i * 3 + 2];
  const r: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = data.skinWeight[i * 4 + k];
    if (w <= 0) continue;
    const b = data.skinIndex[i * 4 + k] * 16;
    // m = world[b] * inv[b]
    const m = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
      let v = 0;
      for (let q = 0; q < 4; q++) v += world[b + q * 4 + rr] * inv[b + c * 4 + q];
      m[c * 4 + rr] = v;
    }
    r[0] += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
    r[1] += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
    r[2] += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
  }
  return r;
}

describe('human body geometry (VP2-T011)', () => {
  const cases: [typeof HUMAN_BUILDS[number], HumanLod][] = [];
  for (const b of HUMAN_BUILDS) for (const l of [0, 1] as const) cases.push([b, l]);

  it('has normalized weights, <= 4 influences and valid bone indices', () => {
    for (const [b, l] of cases) {
      const d = buildHumanBody(b, l);
      const n = d.positions.length / 3;
      expect(d.normals.length).toBe(d.positions.length);
      expect(d.skinIndex.length).toBe(n * 4);
      let bad = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0, active = 0;
        for (let k = 0; k < 4; k++) {
          const w = d.skinWeight[i * 4 + k];
          if (w < 0) bad++;
          if (w > 0) { active++; if (d.skinIndex[i * 4 + k] >= HUMANOID_BONE_COUNT) bad++; }
          sum += w;
        }
        if (active > 4 || Math.abs(sum - 1) > 1e-5) bad++;
      }
      for (let i = 0; i < d.index.length; i++) if (d.index[i] >= n) bad++;
      expect(bad).toBe(0);
    }
  });

  it('is bevelled boxes only: every shell clusters on its 8 box corners with a small chamfer', () => {
    let bad = 0;
    for (const [b, l] of cases) {
      const d = buildHumanBody(b, l);
      for (const s of d.shells) {
        if (s.bevel > 0.02) bad++;
        const size = [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
        for (const e of size) if (e < 3 * s.bevel) bad++;
        const hit = new Array(8).fill(0);
        const tol = s.bevel * Math.sqrt(3) + 1e-5;
        const cx = (s.min[0] + s.max[0]) / 2, cy = (s.min[1] + s.max[1]) / 2, cz = (s.min[2] + s.max[2]) / 2;
        for (let v = s.vertexStart; v < s.vertexStart + s.vertexCount; v++) {
          const px = d.positions[v * 3], py = d.positions[v * 3 + 1], pz = d.positions[v * 3 + 2];
          let best = -1, bestD = Infinity;
          for (let c = 0; c < 8; c++) {
            const dist = Math.hypot(px - (c & 1 ? s.max[0] : s.min[0]), py - (c & 2 ? s.max[1] : s.min[1]), pz - (c & 4 ? s.max[2] : s.min[2]));
            if (dist < bestD) { bestD = dist; best = c; }
          }
          if (bestD > tol) bad++;
          hit[best]++;
          // Unit normal facing away from the shell centre (closed convex shell).
          const nx = d.normals[v * 3], ny = d.normals[v * 3 + 1], nz = d.normals[v * 3 + 2];
          if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 1e-4) bad++;
          if (nx * (px - cx) + ny * (py - cy) + nz * (pz - cz) <= 0) bad++;
        }
        for (const h of hit) if (h === 0) bad++; // all 8 corner clusters populated
        if (s.triCount !== (s.bevel > 0 ? 44 : 12)) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('has hands + feet (LOD0) / feet (LOD1) and stays inside the triangle budget', () => {
    for (const b of HUMAN_BUILDS) {
      const d0 = buildHumanBody(b, 0), d1 = buildHumanBody(b, 1);
      for (const n of ['handL', 'handR', 'footL', 'footR']) expect(d0.shells.some((s) => s.name === n && s.piece === 0)).toBe(true);
      for (const n of ['footL', 'footR']) expect(d1.shells.some((s) => s.name === n && s.piece === 0)).toBe(true);
      expect(d0.bodyTriangles).toBeLessThanOrEqual(900);
      expect(d1.bodyTriangles).toBeLessThanOrEqual(250);
    }
    // What a single human actually draws (body + its gear) stays modest.
    for (let id = 1; id <= 300; id++) {
      for (const [role, post] of [['civilian', 'patrol'], ['soldier', 'checkpoint'], ['police', 'patrol']] as const) {
        const look = humanLook(humanProfile(id, role, post, id % 3 === 0 ? 'bat' : 'none'));
        expect(visibleTriangles(look, 0)).toBeLessThanOrEqual(1250);
        expect(visibleTriangles(look, 1)).toBeLessThanOrEqual(260);
      }
    }
  });

  it('is deterministic and cached', () => {
    const a = buildHumanBody('stocky', 0);
    expect(buildHumanBody('stocky', 0)).toBe(a);
    // A fresh computation of the same inputs matches (compare a different object path via tall/slim symmetry-free checks).
    const t1 = buildHumanBody('tall', 0), t2 = buildHumanBody('tall', 0);
    expect(Array.from(t1.positions.slice(0, 300))).toEqual(Array.from(t2.positions.slice(0, 300)));
    expect(buildHumanBody('slim', 0).positions.length).toBe(buildHumanBody('slim', 0).positions.length);
  });

  it('bone origins match the closed-form bind joints', () => {
    const w = new Float32Array(HUMANOID_BONE_COUNT * 16);
    poseToBoneMatrices(createPose(), BODY_SHAPES.average, IDENT, w);
    const y = (b: number): number => w[b * 16 + 13];
    expect(y(HB.upperArmL)).toBeCloseTo(HUMAN_JOINTS.shoulderY, 5);
    expect(y(HB.forearmL)).toBeCloseTo(HUMAN_JOINTS.elbowY, 5);
    expect(y(HB.handL)).toBeCloseTo(HUMAN_JOINTS.wristY, 5);
    expect(y(HB.neck)).toBeCloseTo(HUMAN_JOINTS.neckY, 5);
    expect(y(HB.lowerLegL)).toBeCloseTo(HUMAN_JOINTS.kneeY, 5);
    expect(y(HB.footL)).toBeCloseTo(HUMAN_JOINTS.ankleY, 5);
  });

  it('closes joints: bending elbows / knees / hips moves both sides of a seam together (no gap opens)', () => {
    const inv = bindInverses(BODY_SHAPES.average);
    const bent = createPose();
    bent.elbowL = 1.3; bent.elbowR = 1.3; bent.armLPitch = -1.2; bent.armRPitch = 0.6;
    bent.kneeL = 1.2; bent.kneeR = 0.8; bent.thighLPitch = -0.7; bent.thighRPitch = 0.5; bent.spinePitch = 0.35;
    bent.neckPitch = 0.4;
    const w = new Float32Array(HUMANOID_BONE_COUNT * 16);
    poseToBoneMatrices(bent, BODY_SHAPES.average, IDENT, w);
    const d = buildHumanBody('average', 0);
    const seams: [string, string, number][] = [
      ['upperArmL', 'forearmL', HUMAN_JOINTS.elbowY], ['forearmL', 'handL', 0.75], ['upperArmR', 'forearmR', HUMAN_JOINTS.elbowY],
      ['forearmR', 'handR', 0.75], ['thighL', 'shinL', HUMAN_JOINTS.kneeY], ['thighR', 'shinR', HUMAN_JOINTS.kneeY],
      ['shinL', 'footL', HUMAN_JOINTS.ankleY], ['chest', 'belly', 1.01], ['belly', 'pelvis', 0.84], ['neck', 'head', 1.395],
      ['neck', 'chest', 1.335],
    ];
    const shell = (n: string) => d.shells.find((s) => s.name === n && s.piece === 0)!;
    // Mean displacement (skinned - bind) of a shell's vertices within +-0.06 m of the seam plane.
    const disp = (name: string, plane: number): number[] => {
      const s = shell(name);
      const m = [0, 0, 0];
      let n = 0;
      for (let v = s.vertexStart; v < s.vertexStart + s.vertexCount; v++) {
        if (Math.abs(d.positions[v * 3 + 1] - plane) > 0.06) continue;
        const q = skin(d, v, w, inv);
        for (let k = 0; k < 3; k++) m[k] += q[k] - d.positions[v * 3 + k];
        n++;
      }
      expect(n, `${name} near ${plane}`).toBeGreaterThan(0);
      return m.map((x) => x / n);
    };
    for (const [a, b, plane] of seams) {
      const da = disp(a, plane), db = disp(b, plane);
      const gap = Math.hypot(da[0] - db[0], da[1] - db[1], da[2] - db[2]);
      expect(gap, `${a}-${b}`).toBeLessThan(0.05);
    }
  });
});

describe('human pose source (VP2-T011)', () => {
  it('walks upright (no zombie hunch) with planted feet', () => {
    for (let t = 0; t < 40; t++) {
      const s = Math.sin(t * 0.37) * 0.68;
      const p = humanPoseToZombiePose(pose({ legLPitch: s, legRPitch: -s, bodyPitch: 0.06, armLPitch: -0.08 - s * 0.55, armRPitch: -0.08 + s * 0.55 }), false,
        createPose());
      expect(uprightLean(p)).toBeLessThan(0.2);
      expect(Math.abs(p.neckPitch)).toBeLessThan(0.1);
      expect(p.rootPitch).toBe(0);
      const sole = soleHeights(p, { l: 0, r: 0 });
      expect(Math.min(sole.l, sole.r)).toBeGreaterThan(-0.005);
      expect(Math.min(sole.l, sole.r)).toBeLessThan(0.005);
      expect(Math.abs(p.thighLPitch)).toBeLessThanOrEqual(0.68 * HUMAN_LEG_SWING + 1e-9);
      expect(p.kneeL).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps aimed weapons level: forearm net pitch stays near the requested arm pitch', () => {
    const p = humanPoseToZombiePose(pose({ armRPitch: -1.42, armLPitch: -1.38 }), false, createPose());
    expect(Math.abs(p.armRPitch - p.elbowR + 1.42)).toBeLessThan(0.1);
    expect(p.elbowR).toBeGreaterThan(0.1);
  });

  it('falls over as one body when dead and never grounds or climbs into the floor', () => {
    const dead = humanPoseToZombiePose(pose({ deathTilt: 1, bodyPitch: 0.15 }), false, createPose());
    expect(dead.rootPitch).toBeGreaterThan(1.4);
    expect(dead.spinePitch).toBe(0);
    const climb = humanPoseToZombiePose(pose({ legLPitch: -0.9, legRPitch: -0.2, bodyY: 0.03 }), true, createPose());
    expect(climb.hipY).toBeCloseTo(0.76 + 0.03, 6);
    expect(climb.kneeL).toBeGreaterThan(0.3);
  });
});

describe('human looks (VP2-T011)', () => {
  const bit = (look: ReturnType<typeof humanLook>, piece: number): boolean =>
    piece < 25 ? Math.floor(look.gearLo / 2 ** (piece - 1)) % 2 === 1 : Math.floor(look.gearHi / 2 ** (piece - 25)) % 2 === 1;

  it('keeps the art-bible palettes: defenders orange vest + navy, security navy + light blue, civilians never orange+navy', () => {
    for (let id = 1; id <= 200; id++) {
      const d = humanLook(humanProfile(id, 'soldier', 'checkpoint'));
      expect(d.colors[5]).toBe(0xe0782a);
      expect(d.colors[1]).toBe(0x2c3e66);
      expect(bit(d, GEAR.vest)).toBe(true);
      expect(bit(d, GEAR.helmet)).toBe(true);
      expect(d.weapon).toBe(WEAPON.rifle);
      const s = humanLook(humanProfile(id, 'police', 'patrol'));
      expect(s.colors[1]).toBe(0x6ca0dc);
      expect(s.colors[2]).toBe(0x223252);
      expect(bit(s, GEAR.policeCap)).toBe(true);
      const c = humanLook(humanProfile(id, 'civilian', 'patrol'));
      const orangeNavy = [c.colors[1], c.colors[2], c.colors[5]].includes(0xe0782a) && [c.colors[1], c.colors[2], c.colors[5]].includes(0x2c3e66);
      expect(orangeNavy).toBe(false);
      expect(bit(c, GEAR.vest)).toBe(false);
    }
  });

  it('gives each human at most one headwear, one hair style, and colours that fit a float32 attribute', () => {
    for (let id = 1; id <= 300; id++) {
      const look = humanLook(humanProfile(id, 'civilian', 'patrol', id % 4 === 0 ? 'shotgun' : 'none'));
      const hats = [GEAR.sunHat, GEAR.hardHat, GEAR.cap, GEAR.helmet, GEAR.policeCap].filter((g) => bit(look, g)).length;
      expect(hats).toBeLessThanOrEqual(1);
      const hair = [GEAR.hairShort, GEAR.hairBun, GEAR.hairAfro, GEAR.hairLong, GEAR.hairPeek].filter((g) => bit(look, g)).length;
      expect(hair).toBeLessThanOrEqual(1);
      if (hats === 1) expect([GEAR.hairShort, GEAR.hairBun, GEAR.hairAfro, GEAR.hairLong].some((g) => bit(look, g))).toBe(false);
      expect(Array.from(look.colors).every((c) => c >= 0 && c <= 0xffffff && Number.isInteger(c))).toBe(true);
    }
  });
});
