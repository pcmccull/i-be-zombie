import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  SIDEWALK_TOP,
  disposeFurnitureCaches,
  furnitureFootprint,
  furnitureGeometry,
} from '../src/graphics/environment/StreetFurnitureFactory';
import {
  disposeVegetationCaches,
  plantFootprint,
  plantGeometry,
} from '../src/graphics/environment/VegetationFactory';
import {
  FLAT_KINDS,
  FURNITURE_KINDS,
  PLANT_KINDS,
  type FurnitureKind,
  type PlantKind,
} from '../src/graphics/environment/environmentKinds';
import { countTriangles } from '../src/graphics/geometry/meshUtils';
import { GROUND_TOP } from '../src/world/groundLevels';

// Note: groundLevels has no sidewalk constant; CityDistrict paving is 0.155 m,
// while SIDEWALK_TOP is clamped to 0.15 m to satisfy the flat-kind <= 0.15 m cap.
const EXPECTED_ATTRS = ['position', 'normal', 'color', 'uv', 'aSurface'];

function hashPositions(geom: THREE.BufferGeometry): number {
  const attr = geom.getAttribute('position');
  const bytes = new Uint8Array(
    (attr.array as Float32Array).buffer,
    (attr.array as Float32Array).byteOffset,
    attr.count * 3 * 4,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function assertValidGeometry(geom: THREE.BufferGeometry): void {
  const names = Object.keys(geom.attributes);
  expect(names.length).toBe(EXPECTED_ATTRS.length);
  for (const name of EXPECTED_ATTRS) {
    expect(names).toContain(name);
  }

  const pos = geom.getAttribute('position');
  const norm = geom.getAttribute('normal');
  const col = geom.getAttribute('color');
  const uv = geom.getAttribute('uv');
  const surf = geom.getAttribute('aSurface');

  expect(pos.count).toBeGreaterThan(0);
  expect(pos.itemSize).toBe(3);
  expect(norm.itemSize).toBe(3);
  expect(col.itemSize).toBe(3);
  expect(uv.itemSize).toBe(2);
  expect(surf.itemSize).toBe(1);

  let nonFinite = 0;
  for (const name of EXPECTED_ATTRS) {
    const arr = geom.getAttribute(name).array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) nonFinite++;
    }
  }
  expect(nonFinite).toBe(0);

  let zeroNormals = 0;
  const nArr = norm.array as Float32Array;
  for (let i = 0; i < norm.count; i++) {
    const len = Math.hypot(nArr[i * 3], nArr[i * 3 + 1], nArr[i * 3 + 2]);
    if (len <= 1e-4) zeroNormals++;
  }
  expect(zeroNormals).toBe(0);
}

describe('environmentAssets', () => {
  afterEach(() => {
    disposeFurnitureCaches();
    disposeVegetationCaches();
  });

  it('builds every FurnitureKind at lod 0/1 and variants 0..2 with valid attributes and budgets', () => {
    for (const kind of FURNITURE_KINDS) {
      for (const lod of [0, 1] as const) {
        for (const variant of [0, 1, 2]) {
          const geom = furnitureGeometry(kind, variant, lod);
          assertValidGeometry(geom);
          const tris = countTriangles(geom);
          const budget = lod === 0 ? 300 : 80;
          expect(tris, `${kind} lod=${lod} v=${variant} tris=${tris}`).toBeLessThanOrEqual(budget);
        }
      }
    }
  });

  it('builds every PlantKind at lod 0/1 and variants 0..2 with valid attributes and budgets', () => {
    const tallTrees = new Set<PlantKind>([
      'palmCoconut',
      'palmRoyal',
      'palmFan',
      'palmCluster',
      'ornamentalTree',
    ]);
    for (const kind of PLANT_KINDS) {
      for (const lod of [0, 1] as const) {
        for (const variant of [0, 1, 2]) {
          const set = plantGeometry(kind, variant, lod);
          if (set.wood) assertValidGeometry(set.wood);
          assertValidGeometry(set.foliage);
          const tris = (set.wood ? countTriangles(set.wood) : 0) + countTriangles(set.foliage);
          const budget = tallTrees.has(kind)
            ? (lod === 0 ? 900 : 200)
            : (lod === 0 ? 300 : 80);
          expect(tris, `${kind} lod=${lod} v=${variant} tris=${tris}`).toBeLessThanOrEqual(budget);
        }
      }
    }
  });

  it('enforces flat-kind height <= 0.15 and curb top === SIDEWALK_TOP', () => {
    expect(SIDEWALK_TOP).toBe(0.15);
    expect(SIDEWALK_TOP).toBeLessThanOrEqual(0.15);
    expect(GROUND_TOP.road).toBeLessThan(SIDEWALK_TOP);

    for (const kind of FLAT_KINDS) {
      const fKind = kind as FurnitureKind;
      for (const lod of [0, 1] as const) {
        for (const variant of [0, 1, 2]) {
          const geom = furnitureGeometry(fKind, variant, lod);
          geom.computeBoundingBox();
          const bb = geom.boundingBox!;
          expect(bb.min.y, `${kind} min.y`).toBeGreaterThanOrEqual(-1e-5);
          expect(bb.max.y, `${kind} max.y`).toBeLessThanOrEqual(0.15 + 1e-5);
          if (fKind === 'curb') {
            expect(bb.max.y).toBeCloseTo(SIDEWALK_TOP, 5);
          }
        }
      }
    }
  });

  it('caches shared BufferGeometry instances across repeated calls', () => {
    expect(furnitureGeometry('bench', 0, 0)).toBe(furnitureGeometry('bench', 0, 0));
    expect(furnitureGeometry('curb', 4, 1)).toBe(furnitureGeometry('curb', 1, 1));
    const p1 = plantGeometry('palmCoconut', 0, 0);
    const p2 = plantGeometry('palmCoconut', 0, 0);
    expect(p1.foliage).toBe(p2.foliage);
    expect(p1.wood).toBe(p2.wood);
  });

  it('produces deterministic geometry across cache disposal and rebuild', () => {
    const fSample: FurnitureKind[] = ['streetlight', 'bench', 'trashCan', 'curb', 'patioUmbrella'];
    const pSample: PlantKind[] = ['palmCoconut', 'palmRoyal', 'shrubFlowering', 'hedge', 'ornamentalTree'];

    const fBefore = fSample.map((k) => hashPositions(furnitureGeometry(k, 1, 0)));
    const pBefore = pSample.map((k) => {
      const s = plantGeometry(k, 1, 0);
      return [s.wood ? hashPositions(s.wood) : 0, hashPositions(s.foliage)];
    });

    disposeFurnitureCaches();
    disposeVegetationCaches();

    const fAfter = fSample.map((k) => hashPositions(furnitureGeometry(k, 1, 0)));
    const pAfter = pSample.map((k) => {
      const s = plantGeometry(k, 1, 0);
      return [s.wood ? hashPositions(s.wood) : 0, hashPositions(s.foliage)];
    });

    expect(fAfter).toEqual(fBefore);
    expect(pAfter).toEqual(pBefore);
  });

  it('returns finite positive footprints for all furniture and plants', () => {
    for (const kind of FURNITURE_KINDS) {
      const fp = furnitureFootprint(kind);
      expect(Number.isFinite(fp.w) && fp.w > 0).toBe(true);
      expect(Number.isFinite(fp.d) && fp.d > 0).toBe(true);
      expect(Number.isFinite(fp.h) && fp.h > 0).toBe(true);
      if (FLAT_KINDS.has(kind)) {
        expect(fp.h).toBeLessThanOrEqual(0.15 + 1e-5);
      }
    }
    for (const kind of PLANT_KINDS) {
      const fp = plantFootprint(kind);
      expect(Number.isFinite(fp.w) && fp.w > 0).toBe(true);
      expect(Number.isFinite(fp.d) && fp.d > 0).toBe(true);
      expect(Number.isFinite(fp.h) && fp.h > 0).toBe(true);
    }
  });

  it('produces distinct geometry for variants 0 and 1 on key furniture kinds', () => {
    const distinctKinds: FurnitureKind[] = ['trashCan', 'bench', 'fenceSection', 'patioUmbrella', 'curb'];
    for (const kind of distinctKinds) {
      const h0 = hashPositions(furnitureGeometry(kind, 0, 0));
      const h1 = hashPositions(furnitureGeometry(kind, 1, 0));
      expect(h0, `${kind} variant 0 vs 1`).not.toBe(h1);
    }
  });
});
