import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AABB, CityLandmarkKind } from '../src/core/types';
import { DISTRICT_STYLES } from '../src/content/districtStyles';
import { buildBuildingGeometry, planTriangleCount } from '../src/graphics/buildings/BuildingFactory';
import { planBuilding } from '../src/graphics/buildings/buildingPlan';
import {
  FLAT_COMPONENT_KINDS,
  GROUND_LEVEL_HEIGHT,
  MAX_OVERHANG,
  type BuildingConfig,
  type BuildingPalette,
  type ComponentInstance,
} from '../src/graphics/buildings/buildingTypes';
import { landmarkPartGeometry } from '../src/graphics/buildings/LandmarkComponents';
import { LANDMARK_PART, planLandmark } from '../src/graphics/buildings/landmarkPlans';

const REF_SIZES: Record<CityLandmarkKind, { w: number; d: number; h: number }> = {
  lighthouse: { w: 6, d: 6, h: 18 },
  waterTower: { w: 8, d: 8, h: 16 },
  clockTower: { w: 7, d: 7, h: 20 },
  controlTower: { w: 10, d: 10, h: 24 },
  radioMast: { w: 5, d: 5, h: 28 },
  fountainPlaza: { w: 12, d: 12, h: 3 },
  bandshell: { w: 16, d: 12, h: 8 },
  ferrisWheel: { w: 18, d: 6, h: 22 },
  domeObservatory: { w: 14, d: 14, h: 12 },
  glassTower: { w: 16, d: 16, h: 40 },
  neonArch: { w: 4, d: 14, h: 9 },
  hangar: { w: 30, d: 24, h: 12 },
};

const ALL_KINDS = Object.keys(REF_SIZES) as CityLandmarkKind[];

const TEST_PALETTE: BuildingPalette = {
  wall: DISTRICT_STYLES.sunny_boardwalk.wallPalette[0],
  wallAccent: DISTRICT_STYLES.sunny_boardwalk.accentPalette[0],
  trim: DISTRICT_STYLES.sunny_boardwalk.accentPalette[1],
  roof: DISTRICT_STYLES.sunny_boardwalk.roofPalette[0],
  awningA: DISTRICT_STYLES.sunny_boardwalk.accentPalette[0],
  awningB: DISTRICT_STYLES.sunny_boardwalk.accentPalette[2],
  sign: 0xf4f0e6,
  neon: 0xff3ea5,
};

function makeCfg(kind: CityLandmarkKind | undefined, scale = 1, seed = 42): BuildingConfig {
  const ref = REF_SIZES[kind ?? 'glassTower'];
  return {
    archetype: 'landmark',
    ...(kind === undefined ? {} : { landmark: kind }),
    width: ref.w * scale,
    depth: ref.d * scale,
    height: ref.h * scale,
    floors: 1,
    floorHeight: 3.2,
    roofStyle: 'flat',
    facadeStyle: 'concrete',
    palette: TEST_PALETTE,
    windowPattern: 'none',
    balconyFrequency: 0,
    entranceStyle: 'grand',
    signage: 'neon',
    sharedWalls: [],
    lotExtent: { front: 0, back: 0, left: 0, right: 0 },
    lotBlockers: [],
    seed,
  };
}

function componentBounds(c: ComponentInstance): AABB {
  const sx = Math.abs(Math.cos(c.rotY)) * (c.w * 0.5) + Math.abs(Math.sin(c.rotY)) * (c.d * 0.5);
  const sz = Math.abs(Math.sin(c.rotY)) * (c.w * 0.5) + Math.abs(Math.cos(c.rotY)) * (c.d * 0.5);
  return { minX: c.x - sx, maxX: c.x + sx, minZ: c.z - sz, maxZ: c.z + sz };
}

function contains(outer: AABB, inner: AABB, eps = 1e-5): boolean {
  return (
    inner.minX >= outer.minX - eps &&
    inner.maxX <= outer.maxX + eps &&
    inner.minZ >= outer.minZ - eps &&
    inner.maxZ <= outer.maxZ + eps
  );
}

function assertValidAttributes(geom: THREE.BufferGeometry, label: string): void {
  expect(geom.index, `${label}: expected non-indexed`).toBeNull();
  const pos = geom.getAttribute('position');
  const norm = geom.getAttribute('normal');
  const col = geom.getAttribute('color');
  const uv = geom.getAttribute('uv');
  const surf = geom.getAttribute('aSurface');
  expect(pos, `${label}: position`).toBeDefined();
  expect(norm, `${label}: normal`).toBeDefined();
  expect(col, `${label}: color`).toBeDefined();
  expect(uv, `${label}: uv`).toBeDefined();
  expect(surf, `${label}: aSurface`).toBeDefined();

  const count = pos.count;
  expect(norm.count).toBe(count);
  expect(col.count).toBe(count);
  expect(uv.count).toBe(count);
  expect(surf.count).toBe(count);

  for (const attr of [pos, norm, col, uv, surf]) {
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      expect(Number.isFinite(arr[i]), `${label}: non-finite ${attr.name}`).toBe(true);
    }
  }
}

describe('landmarkPlans and LandmarkComponents', () => {
  it.each(ALL_KINDS)('%s plan is deterministic, fits footprint/height, and meets tri budgets at 0.7x, 1.0x, 1.3x', (kind) => {
    for (const scale of [0.7, 1.0, 1.3]) {
      const cfg = makeCfg(kind, scale);
      const plan = planLandmark(cfg);
      expect(planLandmark(cfg)).toEqual(plan);
      expect(planBuilding(cfg)).toEqual(plan);

      const footprint: AABB = {
        minX: -cfg.width * 0.5,
        maxX: cfg.width * 0.5,
        minZ: -cfg.depth * 0.5,
        maxZ: cfg.depth * 0.5,
      };
      const overhangBox: AABB = {
        minX: footprint.minX - MAX_OVERHANG,
        maxX: footprint.maxX + MAX_OVERHANG,
        minZ: footprint.minZ - MAX_OVERHANG,
        maxZ: footprint.maxZ + MAX_OVERHANG,
      };

      let maxTop = -Infinity;
      let maxMassTop = -Infinity;

      for (const c of plan.components) {
        expect([c.x, c.y, c.z, c.w, c.h, c.d, c.rotY, c.variant].every(Number.isFinite)).toBe(true);
        expect(c.w).toBeGreaterThan(0);
        expect(c.h).toBeGreaterThan(0);
        expect(c.d).toBeGreaterThan(0);

        const bottom = c.y - c.h * 0.5;
        const top = c.y + c.h * 0.5;
        const box = componentBounds(c);
        maxTop = Math.max(maxTop, top);
        if (c.lod === 1) maxMassTop = Math.max(maxMassTop, top);

        if (bottom < GROUND_LEVEL_HEIGHT - 1e-6) {
          const isFlat = FLAT_COMPONENT_KINDS.has(c.kind) && top <= 0.3 + 1e-6;
          expect(isFlat || contains(footprint, box), `${kind}@${scale} ground ${c.kind} outside footprint`).toBe(true);
        } else {
          expect(contains(overhangBox, box), `${kind}@${scale} overhang ${c.kind} > ${MAX_OVERHANG}`).toBe(true);
        }
      }

      expect(maxTop).toBeLessThanOrEqual(cfg.height + 0.5);
      expect(Math.abs(maxMassTop - cfg.height)).toBeLessThanOrEqual(0.5);

      const g0 = buildBuildingGeometry(plan, 0);
      const g1 = buildBuildingGeometry(plan, 1);
      for (const b of [g0.opaque, g0.glass, g0.emissive, g1.opaque, g1.glass, g1.emissive]) {
        assertValidAttributes(b, `${kind}@${scale}`);
        b.dispose();
      }

      const tris0 = planTriangleCount(plan, 0);
      const tris1 = planTriangleCount(plan, 1);
      expect(tris0).toBeGreaterThan(0);
      expect(tris1).toBeGreaterThan(0);
      expect(tris0).toBeLessThanOrEqual(12000);
      expect(tris1).toBeLessThanOrEqual(1500);

      if (scale === 1.0) {
        console.info(`Landmark ${kind}: LOD0=${tris0} tris, LOD1=${tris1} tris`);
      }
    }
  }, 20000);

  it('treats undefined landmark as glassTower', () => {
    const undefPlan = planLandmark(makeCfg(undefined));
    const glassPlan = planLandmark(makeCfg('glassTower'));
    expect(undefPlan.components).toEqual(glassPlan.components);
  });

  it('produces finite, non-empty, box-contained geometry for every LANDMARK_PART at LOD 0 and 1', () => {
    const partIds = Object.values(LANDMARK_PART);
    for (const id of partIds) {
      for (const lod of [0, 1] as const) {
        const comp: ComponentInstance = {
          kind: 'landmarkPart',
          x: 0,
          y: 0,
          z: 0,
          rotY: 0,
          w: 6,
          h: 8,
          d: 6,
          material: id === LANDMARK_PART.ARCH_SPAN || id === LANDMARK_PART.LIGHTHOUSE_BEACON || id === LANDMARK_PART.MAST_BEACON ? 'neon' : 'wall',
          variant: id,
          lod,
        };
        const geom = landmarkPartGeometry(comp, TEST_PALETTE, lod);
        assertValidAttributes(geom, `part=${id} lod=${lod}`);
        const pos = geom.getAttribute('position');
        expect(pos.count).toBeGreaterThan(0);
        for (let i = 0; i < pos.count; i++) {
          expect(Math.abs(pos.getX(i)), `part=${id} lod=${lod} X`).toBeLessThanOrEqual(comp.w * 0.5 + 1e-4);
          expect(Math.abs(pos.getY(i)), `part=${id} lod=${lod} Y`).toBeLessThanOrEqual(comp.h * 0.5 + 1e-4);
          expect(Math.abs(pos.getZ(i)), `part=${id} lod=${lod} Z`).toBeLessThanOrEqual(comp.d * 0.5 + 1e-4);
        }
        geom.dispose();
      }
    }
  }, 20000);
});
