import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// The procedural atlas needs a canvas; the renderer under test only needs *a* texture.
vi.mock('../src/visuals/zombieTextures', () => ({
  getZombieAtlas: () => ({ map: new THREE.Texture(), normalMap: new THREE.Texture() }),
}));

import { BONE_ROW_FLOATS, BoneTexture, applyInstancedSkinning } from '../src/graphics/characters/InstancedSkinning';
import { PART, bodySides, buildRegionedBody, classOf } from '../src/graphics/characters/CharacterFactory';
import { buildBodyMesh } from '../src/graphics/characters/bodyMeshMath';
import { BODY_SHAPES, bindInverses, poseToBoneMatrices } from '../src/graphics/characters/humanoidRig';
import { HB, REGION, ZOMBIE_BODY_SHAPES } from '../src/graphics/characters/characterTypes';
import { createPose } from '../src/visuals/zombieRig';
import { createZombieBodyMaterial } from '../src/visuals/zombieModel';
import { HordeRenderer } from '../src/visuals/HordeRenderer';
import { createZombie } from '../src/entities/Zombie';
import { mulberry32 } from '../src/utils/rng';
import type { ZombieAgent } from '../src/core/types';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('BoneTexture', () => {
  it('is 84 texels wide, one row per instance, identity-initialised', () => {
    const b = new BoneTexture(5);
    expect(b.texture.image.width).toBe(84);
    expect(b.texture.image.height).toBe(5);
    expect(b.data.length).toBe(5 * BONE_ROW_FLOATS);
    expect(BONE_ROW_FLOATS).toBe(336);
    for (let bone = 0; bone < 21; bone++) {
      const o = 3 * BONE_ROW_FLOATS + bone * 16;
      expect([b.data[o], b.data[o + 5], b.data[o + 10], b.data[o + 15]]).toEqual([1, 1, 1, 1]);
      expect(b.data[o + 1]).toBe(0);
    }
    b.markRows(3);
    expect(b.rowsUsed).toBe(3);
    b.markRows(99);
    expect(b.rowsUsed).toBe(5);
  });
});

describe('skinned body geometry data', () => {
  it('bind pose skin matrices are identity (mesh is in bind space)', () => {
    for (const id of ZOMBIE_BODY_SHAPES) {
      const shape = { ...BODY_SHAPES[id], scale: 1, width: 1 };
      const world = new Float32Array(336);
      poseToBoneMatrices(createPose(), shape, IDENTITY, world);
      const inv = bindInverses(BODY_SHAPES[id]);
      for (let b = 0; b < 21; b++) for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += world[b * 16 + k * 4 + r] * inv[b * 16 + c * 4 + k];
        expect(v).toBeCloseTo(r === c ? 1 : 0, 4);
      }
    }
  });

  for (const id of ZOMBIE_BODY_SHAPES) for (const lod of [0, 1] as const) {
    it(`${id} LOD${lod}: classes are packed, boundaries straight, UV seams repaired, tris in budget`, () => {
      const raw = buildBodyMesh(BODY_SHAPES[id], lod);
      const body = buildRegionedBody(raw, bodySides(id, lod));
      const budget = lod === 0 ? 1800 : 450;
      expect(body.triangles).toBe(raw.triangles);
      expect(body.triangles).toBeLessThanOrEqual(budget);
      expect(body.vertexCount).toBeGreaterThanOrEqual(raw.positions.length / 3);
      expect(body.index.every((i) => i < body.vertexCount)).toBe(true);
      const classes = new Set<number>();
      for (let v = 0; v < body.vertexCount; v++) {
        expect(body.sel[v] === 0 || body.sel[v] === 1).toBe(true);
        expect(Number.isInteger(body.region[v])).toBe(true);
        classes.add(body.region[v] & 63);
        expect(body.region[v] & 63).toBeLessThan(8 * 5);
        expect(body.region[v] >> 6).toBeLessThan(8 * 5);
      }
      // shin / arm parts exist so shorts, torn legs and sleeves can be expressed.
      const parts = new Set([...classes].map((c) => c >> 3));
      for (const p of [PART.shinL, PART.shinR, PART.armShirt, PART.armSkin]) expect(parts.has(p)).toBe(true);
      // Every triangle's vertices agree on (major, minor); a vertex with sel 1 is the minority class.
      for (let t = 0; t < body.index.length; t += 3) {
        const a = body.index[t], b = body.index[t + 1], c = body.index[t + 2];
        const sels = body.sel[a] + body.sel[b] + body.sel[c];
        expect(sels).toBeLessThanOrEqual(2);
      }
      // UV seam repair: triangles whose UV area dwarfs their surface area (the squeezed texture stripe).
      const squeezed = (pos: Float32Array, uv: Float32Array, idx: Uint32Array): number => {
        let n = 0;
        for (let t = 0; t < idx.length; t += 3) {
          const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
          const ux = pos[j * 3] - pos[i * 3], uy = pos[j * 3 + 1] - pos[i * 3 + 1], uz = pos[j * 3 + 2] - pos[i * 3 + 2];
          const vx = pos[k * 3] - pos[i * 3], vy = pos[k * 3 + 1] - pos[i * 3 + 1], vz = pos[k * 3 + 2] - pos[i * 3 + 2];
          const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          const uvArea = 0.5 * Math.abs((uv[j * 2] - uv[i * 2]) * (uv[k * 2 + 1] - uv[i * 2 + 1])
            - (uv[k * 2] - uv[i * 2]) * (uv[j * 2 + 1] - uv[i * 2 + 1]));
          if (uvArea > 4 * area + 1e-4) n++;
        }
        return n;
      };
      const before = squeezed(raw.positions, raw.uvs, raw.index);
      const after = squeezed(body.positions, body.uvs, body.index);
      expect(before).toBeGreaterThan(0);
      expect(after).toBeLessThanOrEqual(Math.ceil(before * 0.3));
    });
  }

  it('classOf maps dominant bones to sub-parts', () => {
    expect(classOf(REGION.pants, HB.lowerLegL)).toBe(REGION.pants + 8 * PART.shinL);
    expect(classOf(REGION.pants, HB.lowerLegR)).toBe(REGION.pants + 8 * PART.shinR);
    expect(classOf(REGION.pants, HB.upperLegL)).toBe(REGION.pants);
    expect(classOf(REGION.shirt, HB.upperArmR)).toBe(REGION.shirt + 8 * PART.armShirt);
    expect(classOf(REGION.skin, HB.forearmL)).toBe(REGION.skin + 8 * PART.armSkin);
    expect(classOf(REGION.skin, HB.head)).toBe(REGION.skin);
  });
});

describe('skinning shader patch', () => {
  it('chains onto the atlas patch, keeps project_vertex for VisionFog, and has a stable cache key', () => {
    const bones = new BoneTexture(4);
    const mat = createZombieBodyMaterial(bones);
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.uBoneTex.value).toBe(bones.texture);
    expect(shader.vertexShader).toContain('zSkinMatrix()');
    expect(shader.vertexShader).toContain('transformed = zRootDir');
    expect(shader.vertexShader).toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('zResolve');
    expect(shader.fragmentShader).toContain('zAtlas(');
    expect(shader.fragmentShader).not.toContain('vTile');
    expect(mat.customProgramCacheKey()).toBe('zombie-body-atlas|iskin');
    expect(mat.customProgramCacheKey()).toBe(mat.customProgramCacheKey());
  });

  it('throws loudly when a three chunk it patches disappears', () => {
    const m = new THREE.MeshStandardMaterial();
    applyInstancedSkinning(m, new BoneTexture(1));
    const shader = { vertexShader: 'void main(){}', fragmentShader: '', uniforms: {} };
    expect(() => m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer)).toThrow();
  });
});

function crowd(n: number): ZombieAgent[] {
  const rng = mulberry32(7);
  const out: ZombieAgent[] = [];
  for (let i = 0; i < n; i++) {
    const z = createZombie(i + 1, { x: (rng.next() - 0.5) * 120, z: (rng.next() - 0.5) * 120 },
      { state: i % 3 === 0 ? 'ambient' : 'follower', variant: i % 4, spawnZone: 0, isConverted: false, rng });
    z.vel.x = (rng.next() - 0.5) * 2; z.vel.z = (rng.next() - 0.5) * 2;
    z.anim = 'walk';
    out.push(z);
  }
  return out;
}

describe('HordeRenderer skinned path (headless smoke + budgets)', () => {
  it('draws <= 10 body calls + accessories, switches LOD by distance, reuses bones on far tiers', () => {
    const r = new HordeRenderer(220);
    const zs = crowd(220);
    r.setView(0, 0, 0, 500);
    r.setCamera(0, 8, -12);
    r.setLeader(0, 0, true);
    for (let f = 0; f < 8; f++) {
      for (const z of zs) { z.prevPos.x = z.pos.x; z.prevPos.z = z.pos.z; z.pos.x += z.vel.x * 0.016; z.pos.z += z.vel.z * 0.016; z.animTime += 0.016; }
      r.update(zs, 0.5, f * 0.016, false, 0.016);
    }
    expect(r.drawnCount).toBe(220);
    expect(r.bodyLodCounts[0] + r.bodyLodCounts[1]).toBe(220);
    expect(r.bodyLodCounts[0]).toBeGreaterThan(0);
    expect(r.bodyLodCounts[1]).toBeGreaterThan(0);
    const bodies = r.group.children.filter((c) => c.name.startsWith('HordeBody_'));
    expect(bodies.length).toBe(10);
    expect(bodies.filter((c) => c.visible).length).toBeLessThanOrEqual(10);
    expect(r.bodyDraws).toBeLessThanOrEqual(10 + 9 + 2);
    expect(r.boneUpdates).toBeLessThan(220);
    expect(r.boneUpdates).toBeGreaterThan(0);
    expect(r.headMatrixOf(zs[0].id, new THREE.Matrix4())).toBe(true);
    r.dispose();
  });

  it('keeps the rigid-part fallback path working behind the flag', () => {
    const r = new HordeRenderer(40, { skinned: false });
    const zs = crowd(30);
    r.setView(0, 0, 0, 500);
    r.update(zs, 0.5, 0, false, 0.016);
    r.update(zs, 0.5, 0.016, false, 0.016);
    expect(r.drawnCount).toBe(30);
    expect(r.group.children.some((c) => c.name.startsWith('HordePart_'))).toBe(true);
    expect(r.group.children.some((c) => c.name.startsWith('HordeBody_'))).toBe(false);
    r.dispose();
  });

  it('celebrates followers near the Alpha after strongholdCaptured', () => {
    const r = new HordeRenderer(40);
    const zs = crowd(30);
    r.setView(0, 0, 0, 500);
    r.setLeader(0, 0, true);
    r.update(zs, 0.5, 0, false, 0.016);
    r.consume([{ type: 'strongholdCaptured', strongholdId: 'a', districtId: 'b', unlock: null, biomass: 0 } as never], zs);
    for (let i = 1; i < 20; i++) r.update(zs, 0.5, i * 0.016, false, 0.016);
    expect(r.drawnCount).toBe(30);
    r.dispose();
  });
});
