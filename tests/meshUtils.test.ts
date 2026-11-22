import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  arch,
  bevelBox,
  countTriangles,
  extrudeProfile,
  lathe,
  mergeTagged,
  paint,
  roundedBox,
  tagSurface,
  taperedBox,
  transform,
} from '../src/graphics/geometry/meshUtils';
import { GeometryCache } from '../src/graphics/geometry/GeometryCache';
import { componentGeometry, componentParts } from '../src/graphics/buildings/BuildingComponents';
import {
  buildBuildingGeometry,
  disposeBuildingCaches,
  planTriangleCount,
} from '../src/graphics/buildings/BuildingFactory';
import {
  COMPONENT_KINDS,
  type BuildingConfig,
  type BuildingPalette,
  type BuildingPlan,
  type ComponentInstance,
  type ComponentKind,
} from '../src/graphics/buildings/buildingTypes';

const TEST_PALETTE: BuildingPalette = {
  wall: 0xf4f0e6,
  wallAccent: 0x9fd8cf,
  trim: 0xe8e2d5,
  roof: 0xc0623f,
  awningA: 0xe0574f,
  awningB: 0x2e8b84,
  sign: 0xf2c14e,
  neon: 0xff5fd7,
};

function assertFiniteAndUnitNormals(geom: THREE.BufferGeometry): void {
  const pos = geom.getAttribute('position');
  const norm = geom.getAttribute('normal');
  expect(pos).toBeDefined();
  expect(norm).toBeDefined();
  for (let i = 0; i < pos.count; i++) {
    expect(Number.isFinite(pos.getX(i))).toBe(true);
    expect(Number.isFinite(pos.getY(i))).toBe(true);
    expect(Number.isFinite(pos.getZ(i))).toBe(true);
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    expect(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)).toBe(true);
    const len = Math.hypot(nx, ny, nz);
    expect(len).toBeCloseTo(1, 3);
  }
}

function countBoundaryEdgesWelded(geom: THREE.BufferGeometry): number {
  const pos = geom.getAttribute('position');
  const q = (v: number): number => Math.round(v * 10000);
  const vertKey = (i: number): string => `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
  const edgeCounts = new Map<string, number>();

  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ks = [vertKey(i), vertKey(i + 1), vertKey(i + 2)];
    for (let e = 0; e < 3; e++) {
      const a = ks[e];
      const b = ks[(e + 1) % 3];
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }

  let boundary = 0;
  for (const c of edgeCounts.values()) {
    if (c !== 2) boundary++;
  }
  return boundary;
}

describe('meshUtils', () => {
  it('bevelBox and roundedBox are watertight, have unit normals, hard flats, and metric UVs', () => {
    const b = bevelBox(4, 3, 2, 0.2, 2);
    expect(countTriangles(b)).toBeGreaterThan(12);
    assertFiniteAndUnitNormals(b);
    expect(countBoundaryEdgesWelded(b)).toBe(0);

    // Check hard axis-aligned normals on flat faces (first 12 triangles = 36 verts)
    const norm = b.getAttribute('normal');
    for (let i = 0; i < 36; i++) {
      const ax = Math.abs(norm.getX(i));
      const ay = Math.abs(norm.getY(i));
      const az = Math.abs(norm.getZ(i));
      expect(Math.max(ax, ay, az)).toBeCloseTo(1, 5);
    }

    // Metric UVs: flat +Z face has width 4 - 2*0.2 = 3.6, height 3 - 2*0.2 = 2.6
    const uv = b.getAttribute('uv');
    let maxU = 0;
    let maxV = 0;
    for (let i = 0; i < 36; i++) {
      if (uv.getX(i) > maxU) maxU = uv.getX(i);
      if (uv.getY(i) > maxV) maxV = uv.getY(i);
    }
    expect(maxU).toBeCloseTo(3.6, 2);
    expect(maxV).toBeCloseTo(2.6, 2);

    const r = roundedBox(2, 2, 2, 0.3, 4);
    assertFiniteAndUnitNormals(r);
    expect(countBoundaryEdgesWelded(r)).toBe(0);

    b.dispose();
    r.dispose();
  });

  it('lathe, extrudeProfile, arch, and taperedBox produce finite geometry and expected bboxes', () => {
    const l = lathe([{ x: 0.5, y: -1 }, { x: 0.5, y: 1 }], 8, true);
    assertFiniteAndUnitNormals(l);
    l.computeBoundingBox();
    expect(l.boundingBox?.min.y).toBeCloseTo(-1, 3);
    expect(l.boundingBox?.max.y).toBeCloseTo(1, 3);
    expect(l.boundingBox?.max.x).toBeCloseTo(0.5, 3);
    l.dispose();

    // Concave L-shape clockwise
    const e = extrudeProfile(
      [
        { x: -1, y: -1 },
        { x: -1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: -1 },
      ],
      1.5,
      0.05,
    );
    assertFiniteAndUnitNormals(e);
    e.computeBoundingBox();
    expect(e.boundingBox?.min.z).toBeCloseTo(-0.75, 2);
    expect(e.boundingBox?.max.z).toBeCloseTo(0.75, 2);
    e.dispose();

    const a = arch(2, 3, 0.5, 8);
    assertFiniteAndUnitNormals(a);
    a.computeBoundingBox();
    expect(a.boundingBox?.max.y).toBeCloseTo(1.5, 2);
    expect(a.boundingBox?.min.y).toBeCloseTo(-1.5, 2);
    a.dispose();

    const t = taperedBox(4, 4, 1, 1, 2);
    assertFiniteAndUnitNormals(t);
    expect(countBoundaryEdgesWelded(t)).toBe(0);
    t.dispose();
  });

  it('mergeTagged enforces exact 5 attributes, non-indexed output, and handles empty/mixed inputs', () => {
    const empty = mergeTagged([]);
    expect(empty.index).toBeNull();
    expect(Object.keys(empty.attributes).sort()).toEqual(['aSurface', 'color', 'normal', 'position', 'uv']);
    expect(empty.getAttribute('position').count).toBe(0);
    empty.dispose();

    const rawBox = new THREE.BoxGeometry(1, 1, 1); // indexed, no color, no aSurface
    const custom = tagSurface(paint(bevelBox(1, 1, 1, 0.1, 1), 0xff0000), 4);
    const merged = mergeTagged([rawBox, custom]);
    expect(merged.index).toBeNull();
    expect(Object.keys(merged.attributes).sort()).toEqual(['aSurface', 'color', 'normal', 'position', 'uv']);
    expect(countTriangles(merged)).toBe(12 + countTriangles(custom));

    // Check default color (1,1,1) and aSurface (0) on rawBox portion (first 36 verts)
    const cAttr = merged.getAttribute('color');
    const sAttr = merged.getAttribute('aSurface');
    expect(cAttr.getX(0)).toBeCloseTo(1, 4);
    expect(sAttr.getX(0)).toBe(0);
    expect(sAttr.getX(36)).toBe(4);

    rawBox.dispose();
    custom.dispose();
    merged.dispose();
  });

  it('transform maps +Z to +X at rotY=pi/2 and keeps normals unit length under non-uniform scale', () => {
    const box = bevelBox(1, 1, 2, 0, 1);
    const t = transform(box, 10, 0, 0, Math.PI * 0.5, 2, 0.5, 3);
    t.computeBoundingBox();
    // Z extent (2 * 3 = 6) rotated +pi/2 maps to X (+-3 around x=10 -> [7, 13])
    expect(t.boundingBox?.min.x).toBeCloseTo(7, 3);
    expect(t.boundingBox?.max.x).toBeCloseTo(13, 3);
    assertFiniteAndUnitNormals(t);
    box.dispose();
    t.dispose();
  });
});

describe('GeometryCache', () => {
  it('builds once per key and disposes cached values', () => {
    let builds = 0;
    const cache = new GeometryCache<string>({ keyOf: (k) => k });
    const g1 = cache.get('a', () => {
      builds++;
      return bevelBox(1, 1, 1, 0, 1);
    });
    const g2 = cache.get('a', () => {
      builds++;
      return bevelBox(1, 1, 1, 0, 1);
    });
    expect(g1).toBe(g2);
    expect(builds).toBe(1);
    expect(cache.size).toBe(1);
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe('BuildingComponents', () => {
  it('builds finite, non-empty, deterministic geometry for every ComponentKind with LOD1 <= LOD0 tris', () => {
    for (const kind of COMPONENT_KINDS) {
      const comp: ComponentInstance = {
        kind,
        x: 0,
        y: 0,
        z: 0,
        rotY: 0,
        w: 2.4,
        h: 2.2,
        d: 1.2,
        material: kind === 'neonSign' ? 'neon' : 'wall',
        variant: 1,
        lod: 1,
      };
      const g0 = componentGeometry(comp, TEST_PALETTE, 0);
      const g0Repeat = componentGeometry(comp, TEST_PALETTE, 0);
      const g1 = componentGeometry(comp, TEST_PALETTE, 1);

      const t0 = countTriangles(g0);
      const t1 = countTriangles(g1);
      expect(t0, `${kind} LOD0 should be non-empty`).toBeGreaterThan(0);
      expect(t1, `${kind} LOD1 should be <= LOD0`).toBeLessThanOrEqual(t0);
      assertFiniteAndUnitNormals(g0);
      assertFiniteAndUnitNormals(g1);

      const p0 = g0.getAttribute('position').array as Float32Array;
      const p0r = g0Repeat.getAttribute('position').array as Float32Array;
      expect(p0.length).toBe(p0r.length);
      for (let i = 0; i < p0.length; i++) {
        expect(p0[i]).toBe(p0r[i]);
      }

      g0.dispose();
      g0Repeat.dispose();
      g1.dispose();
    }
  });

  it('routes glass and emissive buckets properly', () => {
    const win: ComponentInstance = {
      kind: 'window', x: 0, y: 0, z: 0, rotY: 0, w: 1.2, h: 1.4, d: 0.25, material: 'wall', variant: 0, lod: 0,
    };
    const wParts = componentParts(win, TEST_PALETTE, 0);
    expect(countTriangles(wParts.opaque)).toBeGreaterThan(0);
    expect(countTriangles(wParts.glass)).toBeGreaterThan(0);
    expect(countTriangles(wParts.emissive)).toBe(0);
    expect(countTriangles(wParts.opaque) + countTriangles(wParts.glass)).toBeLessThanOrEqual(60);
    wParts.opaque.dispose();
    wParts.glass.dispose();
    wParts.emissive.dispose();

    const neon: ComponentInstance = {
      kind: 'neonSign', x: 0, y: 0, z: 0, rotY: 0, w: 2.0, h: 0.6, d: 0.2, material: 'neon', variant: 0, lod: 0,
    };
    const nParts = componentParts(neon, TEST_PALETTE, 0);
    expect(countTriangles(nParts.emissive)).toBeGreaterThan(0);
    nParts.opaque.dispose();
    nParts.glass.dispose();
    nParts.emissive.dispose();
  });
});

function makeConfig(archetype: BuildingConfig['archetype'], w: number, d: number, h: number, floors: number): BuildingConfig {
  return {
    archetype,
    width: w,
    depth: d,
    height: h,
    floors,
    floorHeight: h / floors,
    roofStyle: 'flat',
    facadeStyle: 'stucco',
    palette: TEST_PALETTE,
    windowPattern: 'grid',
    balconyFrequency: 0.5,
    entranceStyle: 'porch',
    signage: 'neon',
    sharedWalls: [],
    lotExtent: { front: 2, back: 2, left: 2, right: 2 },
    lotBlockers: [],
    seed: 1,
  };
}

function comp(
  kind: ComponentKind,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: ComponentInstance['material'],
  lod: 0 | 1,
  rotY = 0,
  variant = 0,
): ComponentInstance {
  return { kind, x, y, z, rotY, w, h, d, material, variant, lod };
}

function buildShowcasePlans(): Array<{ name: string; size: 'small' | 'large'; plan: BuildingPlan }> {
  // (a) SMALL bungalow (~8x6 m)
  const bungalow: BuildingPlan = {
    config: makeConfig('bungalow', 8, 6, 4.5, 1),
    components: [
      comp('foundation', 0, 0.15, 0, 8.2, 0.3, 6.2, 'concrete', 1),
      comp('wallPanel', 0, 1.8, 0, 8, 3, 6, 'wall', 1),
      comp('hipRoof', 0, 3.9, 0, 8.6, 1.4, 6.6, 'roof', 1),
      comp('porch', 0, 1.1, 3.8, 4.2, 2.2, 1.6, 'wood', 1),
      comp('door', 0, 1.2, 3.05, 1.1, 2.2, 0.2, 'wood', 0),
      comp('window', -2.4, 1.8, 3.05, 1.1, 1.2, 0.2, 'trim', 0),
      comp('window', 2.4, 1.8, 3.05, 1.1, 1.2, 0.2, 'trim', 0),
      comp('window', -2.4, 1.8, -3.05, 1.1, 1.2, 0.2, 'trim', 0, Math.PI),
      comp('window', 2.4, 1.8, -3.05, 1.1, 1.2, 0.2, 'trim', 0, Math.PI),
      comp('shutter', -3.1, 1.8, 3.05, 0.3, 1.2, 0.08, 'wallAccent', 0),
      comp('shutter', 3.1, 1.8, 3.05, 0.3, 1.2, 0.08, 'wallAccent', 0),
    ],
  };

  // (b) SMALL convenience store
  const store: BuildingPlan = {
    config: makeConfig('convenienceStore', 10, 8, 4.2, 1),
    components: [
      comp('foundation', 0, 0.1, 0, 10.2, 0.2, 8.2, 'concrete', 1),
      comp('wallPanel', 0, 2.1, 0, 10, 3.8, 8, 'wall', 1),
      comp('parapet', 0, 4.2, 0, 10.2, 0.5, 8.2, 'wall', 1),
      comp('storefront', 0, 1.5, 4.05, 7.6, 2.6, 0.25, 'glass', 1),
      comp('awning', 0, 3.1, 4.7, 8.2, 0.6, 1.4, 'awningA', 1),
      comp('sign', 0, 4.0, 4.15, 5.2, 0.8, 0.2, 'sign', 1),
      comp('neonSign', 0, 4.0, 4.3, 4.4, 0.55, 0.15, 'neon', 0),
      comp('wallLamp', -4.2, 2.6, 4.1, 0.25, 0.35, 0.25, 'neon', 0),
      comp('wallLamp', 4.2, 2.6, 4.1, 0.25, 0.35, 0.25, 'neon', 0),
    ],
  };

  // (c) LARGE art deco hotel (~18x14 m, 6 floors, ~40 windows)
  const hotelComps: ComponentInstance[] = [
    comp('foundation', 0, 0.2, 0, 18.2, 0.4, 14.2, 'concrete', 1),
    comp('wallPanel', 0, 10.2, 0, 18, 19.6, 14, 'wall', 1),
    comp('parapet', 0, 20.2, 0, 18.2, 0.7, 14.2, 'wall', 1),
    comp('steppedRoof', 0, 21.3, 0, 11, 2.2, 8, 'roof', 1),
    comp('roundedCorner', 8.5, 10.2, 6.5, 1.2, 19.6, 1.2, 'wallAccent', 1),
    comp('roundedCorner', -8.5, 10.2, 6.5, 1.2, 19.6, 1.2, 'wallAccent', 1, -Math.PI * 0.5),
    comp('verticalFin', 0, 11, 7.2, 0.45, 16, 0.6, 'wallAccent', 1),
    comp('verticalFin', -4.5, 11, 7.2, 0.35, 15, 0.5, 'wallAccent', 0),
    comp('verticalFin', 4.5, 11, 7.2, 0.35, 15, 0.5, 'wallAccent', 0),
    comp('drainpipe', -8.8, 10, 6.8, 0.14, 19, 0.14, 'metal', 0),
    comp('drainpipe', 8.8, 10, 6.8, 0.14, 19, 0.14, 'metal', 0),
    comp('waterTank', 4.5, 21.8, -2.5, 2.2, 3.0, 2.2, 'wood', 0),
    comp('acUnit', -5, 20.8, 2, 1.2, 0.8, 1.0, 'metal', 0),
    comp('acUnit', -3, 20.8, 2, 1.2, 0.8, 1.0, 'metal', 0),
  ];
  for (let fl = 1; fl < 6; fl++) {
    const y = fl * 3.2 + 1.5;
    for (let bx = -6; bx <= 6; bx += 3) {
      if (bx !== 0) {
        hotelComps.push(comp('window', bx, y, 7.05, 1.3, 1.5, 0.2, 'trim', 0));
        hotelComps.push(comp('window', bx, y, -7.05, 1.3, 1.5, 0.2, 'trim', 0, Math.PI));
      }
    }
    hotelComps.push(comp('balcony', -3, y - 0.7, 7.5, 2.4, 1.0, 1.1, 'concrete', 0));
    hotelComps.push(comp('balcony', 3, y - 0.7, 7.5, 2.4, 1.0, 1.1, 'concrete', 0));
  }
  const hotel: BuildingPlan = {
    config: makeConfig('artDecoHotel', 18, 14, 20, 6),
    components: hotelComps,
  };

  // (d) LARGE parking garage (~20x14 m)
  const garageComps: ComponentInstance[] = [
    comp('foundation', 0, 0.15, 0, 20.2, 0.3, 14.2, 'concrete', 1),
    comp('flatRoof', 0, 12.2, 0, 20, 0.4, 14, 'roof', 1),
    comp('rampDeck', 6, 6, 0, 5, 11.5, 11, 'concrete', 1),
  ];
  for (let fl = 0; fl < 4; fl++) {
    const y = fl * 3.0 + 0.2;
    garageComps.push(comp('floorBand', 0, y, 0, 20, 0.3, 14, 'concrete', 1));
    garageComps.push(comp('guardrail', 0, y + 0.65, 7.0, 19.6, 1.0, 0.1, 'metal', 0));
    garageComps.push(comp('guardrail', 0, y + 0.65, -7.0, 19.6, 1.0, 0.1, 'metal', 0, Math.PI));
  }
  for (const cx of [-9, -3, 3, 9]) {
    for (const cz of [-6.5, 6.5]) {
      garageComps.push(comp('column', cx, 6.0, cz, 0.7, 12.0, 0.7, 'concrete', 1));
    }
  }
  const garage: BuildingPlan = {
    config: makeConfig('parkingGarage', 20, 14, 12, 4),
    components: garageComps,
  };

  // (e) LARGE office tower
  const officeComps: ComponentInstance[] = [
    comp('foundation', 0, 0.2, 0, 16.2, 0.4, 14.2, 'concrete', 1),
    comp('wallPanel', 0, 12.2, 0, 16, 24, 14, 'wall', 1),
    comp('parapet', 0, 24.4, 0, 16.2, 0.6, 14.2, 'wall', 1),
    comp('storefront', 0, 1.8, 7.05, 13, 3.2, 0.25, 'glass', 1),
    comp('mechanicalBox', -4, 25.1, 0, 3.0, 1.6, 2.5, 'metal', 0),
    comp('roofVent', 0, 24.9, 2, 1.0, 0.8, 1.0, 'metal', 0),
    comp('satelliteDish', 4.5, 25.2, -2, 1.6, 1.8, 1.6, 'metal', 0),
    comp('solarPanel', 0, 24.9, -4, 2.5, 0.9, 1.5, 'glassDark', 0),
    comp('solarPanel', 3, 24.9, -4, 2.5, 0.9, 1.5, 'glassDark', 0),
  ];
  for (let fl = 1; fl < 7; fl++) {
    const y = fl * 3.2 + 1.5;
    for (let bx = -5.5; bx <= 5.5; bx += 2.75) {
      officeComps.push(comp('window', bx, y, 7.05, 1.8, 1.6, 0.2, 'trim', 0));
    }
  }
  const office: BuildingPlan = {
    config: makeConfig('office', 16, 14, 24, 7),
    components: officeComps,
  };

  // (f) Gas station kit
  const gasStation: BuildingPlan = {
    config: makeConfig('gasStation', 12, 10, 4.5, 1),
    components: [
      comp('canopy', 0, 2.5, 0, 11, 5.0, 7.5, 'wallAccent', 1),
      comp('pumpIsland', -2.8, 0.9, 0, 2.6, 1.8, 1.0, 'metal', 1),
      comp('pumpIsland', 2.8, 0.9, 0, 2.6, 1.8, 1.0, 'metal', 1),
      comp('sign', 0, 4.7, 3.8, 4.0, 0.7, 0.2, 'sign', 1),
    ],
  };

  // (g) Warehouse
  const warehouse: BuildingPlan = {
    config: makeConfig('warehouse', 20, 14, 7, 1),
    components: [
      comp('foundation', 0, 0.15, 0, 20.2, 0.3, 14.2, 'concrete', 1),
      comp('wallPanel', 0, 3.5, 0, 20, 6.8, 14, 'wall', 1),
      comp('gableRoof', 0, 7.8, 0, 20.6, 2.0, 14.6, 'roof', 1),
      comp('garageDoor', -5, 2.0, 7.05, 3.8, 3.8, 0.2, 'metal', 1),
      comp('garageDoor', 0, 2.0, 7.05, 3.8, 3.8, 0.2, 'metal', 1),
      comp('loadingBay', 5.5, 2.0, 7.1, 3.8, 3.6, 0.4, 'concrete', 1),
      comp('roofVent', -4, 8.2, 0, 1.2, 0.9, 1.2, 'metal', 0),
      comp('roofVent', 4, 8.2, 0, 1.2, 0.9, 1.2, 'metal', 0),
    ],
  };

  return [
    { name: 'bungalow', size: 'small', plan: bungalow },
    { name: 'convenienceStore', size: 'small', plan: store },
    { name: 'artDecoHotel', size: 'large', plan: hotel },
    { name: 'parkingGarage', size: 'large', plan: garage },
    { name: 'officeTower', size: 'large', plan: office },
    { name: 'gasStation', size: 'small', plan: gasStation },
    { name: 'warehouse', size: 'large', plan: warehouse },
  ];
}

describe('BuildingFactory showcases and budgets', () => {
  it('meets LOD0/LOD1 triangle budgets, enforces LOD1 filtering, and is deterministic', () => {
    disposeBuildingCaches();
    const showcases = buildShowcasePlans();

    for (const sc of showcases) {
      const m0 = buildBuildingGeometry(sc.plan, 0);
      const m0Repeat = buildBuildingGeometry(sc.plan, 0);
      const m1 = buildBuildingGeometry(sc.plan, 1);

      const tris0 = countTriangles(m0.opaque) + countTriangles(m0.glass) + countTriangles(m0.emissive);
      const tris1 = countTriangles(m1.opaque) + countTriangles(m1.glass) + countTriangles(m1.emissive);

      expect(tris0).toBe(planTriangleCount(sc.plan, 0));
      expect(tris1).toBe(planTriangleCount(sc.plan, 1));

      const max0 = sc.size === 'small' ? 3000 : 12000;
      const max1 = sc.size === 'small' ? 400 : 1500;
      console.log(`[Showcase ${sc.name} (${sc.size})] LOD0=${tris0} (<= ${max0}), LOD1=${tris1} (<= ${max1})`);

      expect(tris0).toBeLessThanOrEqual(max0);
      expect(tris1).toBeLessThanOrEqual(max1);
      expect(tris1).toBeLessThanOrEqual(tris0);

      // Determinism: identical position arrays
      const pA = m0.opaque.getAttribute('position').array as Float32Array;
      const pB = m0Repeat.opaque.getAttribute('position').array as Float32Array;
      expect(pA.length).toBe(pB.length);
      for (let i = 0; i < pA.length; i++) {
        expect(pA[i]).toBe(pB[i]);
      }

      // LOD1 includes lod===1 components only
      const expectedLod1Tris = sc.plan.components
        .filter((c) => c.lod === 1)
        .reduce((acc, c) => acc + countTriangles(componentGeometry(c, sc.plan.config.palette, 1)), 0);
      expect(tris1).toBe(expectedLod1Tris);

      m0.opaque.dispose(); m0.glass.dispose(); m0.emissive.dispose();
      m0Repeat.opaque.dispose(); m0Repeat.glass.dispose(); m0Repeat.emissive.dispose();
      m1.opaque.dispose(); m1.glass.dispose(); m1.emissive.dispose();
    }

    disposeBuildingCaches();
  }, 30_000);
});
