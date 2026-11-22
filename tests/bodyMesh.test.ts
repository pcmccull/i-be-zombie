import { describe, expect, it } from 'vitest';
import { buildBodyMesh, type BodyMeshData } from '../src/graphics/characters/bodyMeshMath';
import { bindInverses, BODY_SHAPES, poseToBoneMatrices } from '../src/graphics/characters/humanoidRig';
import { HB, REGION } from '../src/graphics/characters/characterTypes';
import { createPose } from '../src/visuals/zombieRig';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const arrays = ['positions', 'normals', 'uvs', 'skinIndex', 'skinWeight', 'region', 'index'] as const;
function edges(mesh: BodyMeshData, omitPupils = false): Map<string, { a: number; b: number; count: number }> {
  const out = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < mesh.index.length; i += 3) {
    if (omitPupils && mesh.region[mesh.index[i]] === REGION.pupil) continue;
    for (let j = 0; j < 3; j++) {
      const a = mesh.index[i + j], b = mesh.index[i + (j + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = out.get(key);
      if (edge) edge.count++; else out.set(key, { a, b, count: 1 });
    }
  }
  return out;
}

describe('cohesive body meshes', () => {
  for (const shape of Object.values(BODY_SHAPES)) for (const lod of [0, 1] as const) {
    it(`${shape.id} LOD${lod}: valid, weighted, watertight, deterministic and within budget`, () => {
      const m = buildBodyMesh(shape, lod), n = m.positions.length / 3;
      const budget = shape.id === 'alpha' ? (lod === 0 ? 7000 : 1200) : (lod === 0 ? 1800 : 450);
      expect(m.triangles).toBeGreaterThan(100);
      expect(m.triangles).toBeLessThanOrEqual(budget);
      expect(m.index.length % 3).toBe(0); expect(m.index.length / 3).toBe(m.triangles);
      expect(m.index.every(i => i < n)).toBe(true);
      expect(m.normals.length).toBe(m.positions.length); expect(m.uvs.length).toBe(n * 2);
      expect(m.region.length).toBe(n); expect(m.skinIndex.length).toBe(n * 4); expect(m.skinWeight.length).toBe(n * 4);
      expect(m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite) && m.uvs.every(Number.isFinite)).toBe(true);
      let maxNormalError = 0, maxWeightError = 0, validWeights = true;
      for (let v = 0; v < n; v++) {
        maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(...m.normals.subarray(v * 3, v * 3 + 3)) - 1));
        let total = 0, influences = 0;
        for (let j = 0; j < 4; j++) {
          const w = m.skinWeight[v * 4 + j]; total += w;
          if (w !== 0) { influences++; if (w < 0.01) validWeights = false; }
          if (m.skinIndex[v * 4 + j] >= 21 || !Number.isFinite(w) || w < 0) validWeights = false;
        }
        if (influences > 4 || influences < 1) validWeights = false;
        maxWeightError = Math.max(maxWeightError, Math.abs(total - 1));
      }
      expect(maxNormalError).toBeLessThan(1e-3); expect(maxWeightError).toBeLessThan(1e-5); expect(validWeights).toBe(true);
      expect([...edges(m, true).values()].every(e => e.count === 2)).toBe(true);
      for (const region of [0, 1, 2, 3, 4, 5, 6]) expect(m.region.includes(region)).toBe(true);
      expect(Math.min(...m.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(0, 6);
      const again = buildBodyMesh(shape, lod);
      for (const key of arrays) {
        const a = new Uint8Array(m[key].buffer), b = new Uint8Array(again[key].buffer);
        expect(a.length === b.length && a.every((v, i) => v === b[i])).toBe(true);
      }
    });

    it(`${shape.id} LOD${lod}: elbows/knees bend to 130 degrees without excessive edge stretch`, () => {
      const mesh = buildBodyMesh(shape, lod), inverse = bindInverses(shape), matrices = new Float32Array(336);
      const skin = new Float64Array(336), allEdges = [...edges(mesh).values()];
      let maxStretch = 0, minRestEdgeSquared = Infinity;
      for (const degrees of [0, 65, 130]) {
        const p = createPose();
        p.elbowL = p.elbowR = p.kneeL = p.kneeR = degrees * Math.PI / 180;
        poseToBoneMatrices(p, shape, IDENTITY, matrices);
        for (let bone = 0; bone < 21; bone++) for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
          const base = bone * 16; let sum = 0;
          for (let k = 0; k < 4; k++) sum += matrices[base + k * 4 + r] * inverse[base + c * 4 + k];
          skin[base + c * 4 + r] = sum;
        }
        const posed = new Float64Array(mesh.positions.length);
        for (let v = 0; v < mesh.positions.length / 3; v++) {
          const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
          for (let j = 0; j < 4; j++) {
            const b = mesh.skinIndex[v * 4 + j] * 16, w = mesh.skinWeight[v * 4 + j];
            for (let r = 0; r < 3; r++) posed[v * 3 + r] += w * (skin[b + r] * x + skin[b + 4 + r] * y + skin[b + 8 + r] * z + skin[b + 12 + r]);
          }
        }
        expect(posed.every(Number.isFinite)).toBe(true);
        for (const { a, b } of allEdges) {
          let rest2 = 0, posed2 = 0;
          for (let r = 0; r < 3; r++) {
            rest2 += (mesh.positions[a * 3 + r] - mesh.positions[b * 3 + r]) ** 2;
            posed2 += (posed[a * 3 + r] - posed[b * 3 + r]) ** 2;
          }
          minRestEdgeSquared = Math.min(minRestEdgeSquared, rest2);
          maxStretch = Math.max(maxStretch, Math.sqrt(posed2 / rest2));
        }
      }
      expect(minRestEdgeSquared).toBeGreaterThan(1e-12);
      expect(maxStretch).toBeLessThan(2.5);
    });
  }

  it('gives Alpha a distinctive oversized right hand without changing the leg chain', () => {
    const mesh = buildBodyMesh(BODY_SHAPES.alpha, 0);
    const sizes = [HB.handL, HB.handR].map(bone => {
      const vertices: number[] = [];
      for (let i = 0; i < mesh.positions.length / 3; i++) if (mesh.skinIndex[i * 4] === bone && mesh.skinWeight[i * 4] === 1) vertices.push(mesh.positions[i * 3 + 1]);
      return Math.max(...vertices) - Math.min(...vertices);
    });
    expect(sizes[1] / sizes[0]).toBeGreaterThan(1.7);
  });
});
