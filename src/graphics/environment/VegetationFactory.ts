// [3D] Procedural tropical vegetation and landscaping geometries (VP2-T005).
// Wood and foliage are always returned separately so the renderer can apply applyFoliageWind to foliage only.
import * as THREE from 'three';
import { mulberry32, randRange } from '../../utils/rng';
import type { Rng } from '../../core/types';
import { GeometryCache } from '../geometry/GeometryCache';
import {
  bevelBox,
  lathe,
  mergeTagged,
  paint,
  tagSurface,
  transform,
} from '../geometry/meshUtils';
import { SURFACE } from '../materials/surfaceDetailMath';
import type { PlantKind } from './environmentKinds';

export interface PlantGeometrySet {
  wood: THREE.BufferGeometry | null;
  foliage: THREE.BufferGeometry;
}

const PALETTE = {
  palmTrunk: 0x8a6a4a,
  royalTrunk: 0xb5b0a3,
  royalCrownshaft: 0x5f9a45,
  treeTrunk: 0x5e4532,
  coconut: 0x5c4228,
  foliageLight: 0x4f8a3a,
  foliageMid: 0x3f7432,
  foliageDark: 0x2f5e2a,
  canopyLight: 0x58b847,
  canopyDark: 0x3f9b3a,
  grassYellow: 0x6fa84a,
  soil: 0x4e3c2c,
  concrete: 0xc9b99a,
  flowerPink: 0xff7eb6,
  flowerRed: 0xe0574f,
  flowerOrange: 0xffb347,
  flowerYellow: 0xf2c14e,
} as const;

const cache = new GeometryCache<string, PlantGeometrySet>({
  dispose: (set) => {
    set.wood?.dispose();
    set.foliage.dispose();
  },
});

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalizeVariant(variant: number): 0 | 1 | 2 {
  const n = Math.floor(Number.isFinite(variant) ? variant : 0);
  return (((n % 3) + 3) % 3) as 0 | 1 | 2;
}

function makeRng(kind: PlantKind, variant: number): Rng {
  const seed = (fnv1a(kind) ^ Math.imul(variant + 1, 0x9e3779b9)) >>> 0;
  return mulberry32(seed);
}

function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function part(
  base: THREE.BufferGeometry,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const p = paint(base, color);
  const t = tagSurface(p, surface);
  p.dispose();
  const out = transform(t, x, y, z, rotY, sx, sy, sz);
  t.dispose();
  base.dispose();
  return out;
}

function mergeAndDispose(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeTagged(parts);
  for (let i = 0; i < parts.length; i++) parts[i].dispose();
  return merged;
}

function buildCurvedTaperedTrunk(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  rBottom: number,
  rTop: number,
  pathSegs: number,
  radialSegs: number,
  ringBands = false,
): THREE.BufferGeometry {
  const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  const rings: THREE.Vector3[][] = [];
  const ringNormals: THREE.Vector3[][] = [];
  for (let i = 0; i <= pathSegs; i++) {
    const t = i / pathSegs;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const ref = Math.abs(tangent.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(tangent, ref).normalize();
    const binorm = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const bandBump = ringBands && i > 0 && i < pathSegs && i % 2 === 1 ? 1.12 : 1.0;
    const r = (rBottom + (rTop - rBottom) * t) * bandBump;

    const ring: THREE.Vector3[] = [];
    const rNorm: THREE.Vector3[] = [];
    for (let s = 0; s <= radialSegs; s++) {
      const a = (s / radialSegs) * Math.PI * 2;
      const n = new THREE.Vector3()
        .addScaledVector(side, Math.cos(a))
        .addScaledVector(binorm, Math.sin(a))
        .normalize();
      ring.push(center.clone().addScaledVector(n, r));
      rNorm.push(n);
    }
    rings.push(ring);
    ringNormals.push(rNorm);
  }

  for (let i = 0; i < pathSegs; i++) {
    const v0 = i * 0.8;
    const v1 = (i + 1) * 0.8;
    for (let s = 0; s < radialSegs; s++) {
      const a = rings[i][s];
      const b = rings[i][s + 1];
      const c = rings[i + 1][s + 1];
      const d = rings[i + 1][s];
      const na = ringNormals[i][s];
      const nb = ringNormals[i][s + 1];
      const nc = ringNormals[i + 1][s + 1];
      const nd = ringNormals[i + 1][s];
      const u0 = (s / radialSegs) * 1.2;
      const u1 = ((s + 1) / radialSegs) * 1.2;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      norm.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
      uv.push(u0, v0, u1, v0, u1, v1);

      pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      norm.push(na.x, na.y, na.z, nc.x, nc.y, nc.z, nd.x, nd.y, nd.z);
      uv.push(u0, v0, u1, v1, u0, v1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Arched palm frond strip (double-sided) with quadratic droop, width taper, and optional edge notches.
 */
function buildArchedFrond(
  length: number,
  maxWidth: number,
  archRise: number,
  tipDroop: number,
  lenSegs: number,
  notched: boolean,
): THREE.BufferGeometry {
  const p0 = new THREE.Vector3(0, 0, 0);
  const p1 = new THREE.Vector3(0, archRise, length * 0.52);
  const p2 = new THREE.Vector3(0, archRise - tipDroop, length);
  const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);

  const pos: number[] = [];
  const uv: number[] = [];

  for (let i = 0; i < lenSegs; i++) {
    const t0 = i / lenSegs;
    const t1 = (i + 1) / lenSegs;
    const c0 = curve.getPoint(t0);
    const c1 = curve.getPoint(t1);

    const notch0 = notched && i % 2 === 1 ? 0.68 : 1.0;
    const notch1 = notched && (i + 1) % 2 === 1 ? 0.68 : 1.0;
    const w0 = maxWidth * Math.sin(Math.PI * (0.12 + t0 * 0.85)) * (1 - t0 * 0.35) * notch0;
    const w1 = maxWidth * Math.sin(Math.PI * (0.12 + t1 * 0.85)) * (1 - t1 * 0.35) * notch1;
    const drop0 = -w0 * 0.16;
    const drop1 = -w1 * 0.16;

    // Front/top face
    pos.push(
      c0.x - w0, c0.y + drop0, c0.z,
      c0.x + w0, c0.y + drop0, c0.z,
      c1.x + w1, c1.y + drop1, c1.z,
      c0.x - w0, c0.y + drop0, c0.z,
      c1.x + w1, c1.y + drop1, c1.z,
      c1.x - w1, c1.y + drop1, c1.z,
    );
    uv.push(
      0, t0 * length, 1, t0 * length, 1, t1 * length,
      0, t0 * length, 1, t1 * length, 0, t1 * length,
    );
    // Back/underside face
    pos.push(
      c0.x - w0, c0.y + drop0 - 0.004, c0.z,
      c1.x + w1, c1.y + drop1 - 0.004, c1.z,
      c0.x + w0, c0.y + drop0 - 0.004, c0.z,
      c0.x - w0, c0.y + drop0 - 0.004, c0.z,
      c1.x - w1, c1.y + drop1 - 0.004, c1.z,
      c1.x + w1, c1.y + drop1 - 0.004, c1.z,
    );
    uv.push(
      0, t0 * length, 1, t1 * length, 1, t0 * length,
      0, t0 * length, 0, t1 * length, 1, t1 * length,
    );
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function buildBlob(rx: number, ry: number, rz: number, latSegs: number, lonSegs: number): THREE.BufferGeometry {
  const raw = new THREE.SphereGeometry(1, lonSegs, latSegs);
  raw.scale(rx, ry, rz);
  const g = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();
  return g;
}

// ---------------------------------------------------------------------------
// Builders per PlantKind
// ---------------------------------------------------------------------------

function buildPalmCoconut(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('palmCoconut', variant);
  const h = variant === 1 ? 7.8 : variant === 2 ? 7.2 : 7.5;
  const leanAngle = variant * 2.1 + 0.5;
  const leanDist = 1.05;
  const topPos = new THREE.Vector3(Math.cos(leanAngle) * leanDist, h, Math.sin(leanAngle) * leanDist);
  const midPos = new THREE.Vector3(Math.cos(leanAngle) * leanDist * 0.28, h * 0.52, Math.sin(leanAngle) * leanDist * 0.28);

  const trunk = buildCurvedTaperedTrunk(
    new THREE.Vector3(0, 0, 0),
    midPos,
    topPos,
    0.22,
    0.11,
    lod === 0 ? 8 : 5,
    lod === 0 ? 8 : 5,
    lod === 0,
  );
  const wood = mergeAndDispose([part(trunk, PALETTE.palmTrunk, SURFACE.none)]);

  const foliageParts: THREE.BufferGeometry[] = [];
  if (lod === 0) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      foliageParts.push(part(
        buildBlob(0.13, 0.14, 0.13, 4, 6),
        PALETTE.coconut,
        SURFACE.none,
        topPos.x + Math.cos(a) * 0.15,
        topPos.y - 0.15,
        topPos.z + Math.sin(a) * 0.15,
      ));
    }
  }

  const frondCount = lod === 0 ? (variant === 1 ? 9 : variant === 2 ? 7 : 8) : 5;
  for (let i = 0; i < frondCount; i++) {
    const yaw = (i / frondCount) * Math.PI * 2 + randRange(rng, -0.15, 0.15);
    const fLen = randRange(rng, 2.2, 2.7);
    const frond = buildArchedFrond(
      fLen,
      0.34,
      randRange(rng, 0.45, 0.72),
      randRange(rng, 1.15, 1.55),
      lod === 0 ? 5 : 2,
      lod === 0,
    );
    const col = lerpHex(PALETTE.foliageDark, PALETTE.foliageLight, rng.next());
    foliageParts.push(part(frond, col, SURFACE.none, topPos.x, topPos.y, topPos.z, yaw));
  }

  return { wood, foliage: mergeAndDispose(foliageParts) };
}

function buildPalmRoyal(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('palmRoyal', variant);
  const h = variant === 1 ? 9.3 : 8.9;
  const shaftBot = h - 1.7;
  const woodParts: THREE.BufferGeometry[] = [];
  woodParts.push(part(
    lathe([
      { x: 0.25, y: 0 },
      { x: 0.2, y: shaftBot * 0.4 },
      { x: 0.22, y: shaftBot * 0.7 },
      { x: 0.17, y: shaftBot },
    ], lod === 0 ? 8 : 5, true),
    PALETTE.royalTrunk,
    SURFACE.none,
  ));
  woodParts.push(part(
    lathe([
      { x: 0.18, y: shaftBot },
      { x: 0.19, y: shaftBot + 0.6 },
      { x: 0.15, y: h },
    ], lod === 0 ? 8 : 5, true),
    PALETTE.royalCrownshaft,
    SURFACE.none,
  ));

  const foliageParts: THREE.BufferGeometry[] = [];
  const frondCount = lod === 0 ? 7 : 5;
  for (let i = 0; i < frondCount; i++) {
    const yaw = (i / frondCount) * Math.PI * 2 + randRange(rng, -0.1, 0.1);
    const frond = buildArchedFrond(
      randRange(rng, 2.0, 2.4),
      0.32,
      randRange(rng, 0.85, 1.15),
      randRange(rng, 0.75, 1.05),
      lod === 0 ? 5 : 2,
      lod === 0,
    );
    const col = lerpHex(PALETTE.foliageDark, PALETTE.foliageLight, rng.next());
    foliageParts.push(part(frond, col, SURFACE.none, 0, h - 0.05, 0, yaw));
  }

  return { wood: mergeAndDispose(woodParts), foliage: mergeAndDispose(foliageParts) };
}

function buildPalmFan(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('palmFan', variant);
  const h = variant === 1 ? 3.2 : 2.9;
  const topPos = new THREE.Vector3(0.18, h, 0.12);
  const trunk = buildCurvedTaperedTrunk(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.06, h * 0.5, 0.04),
    topPos,
    0.16,
    0.1,
    lod === 0 ? 6 : 4,
    lod === 0 ? 7 : 5,
    lod === 0,
  );
  const wood = mergeAndDispose([part(trunk, PALETTE.palmTrunk, SURFACE.none)]);

  const foliageParts: THREE.BufferGeometry[] = [];
  const count = lod === 0 ? 7 : 5;
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + randRange(rng, -0.15, 0.15);
    const fan = buildArchedFrond(
      1.15,
      0.48,
      0.42,
      0.55,
      lod === 0 ? 4 : 2,
      lod === 0,
    );
    const col = lerpHex(PALETTE.foliageDark, PALETTE.foliageLight, rng.next());
    foliageParts.push(part(fan, col, SURFACE.none, topPos.x, topPos.y, topPos.z, yaw));
  }

  return { wood, foliage: mergeAndDispose(foliageParts) };
}

function buildPalmCluster(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('palmCluster', variant);
  const trunkCount = lod === 0 ? (variant === 1 ? 4 : 3) : 3;
  const woodParts: THREE.BufferGeometry[] = [];
  const foliageParts: THREE.BufferGeometry[] = [];

  for (let t = 0; t < trunkCount; t++) {
    const a = (t / trunkCount) * Math.PI * 2 + variant * 0.4;
    const h = randRange(rng, 2.5, 3.4);
    const base = new THREE.Vector3(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
    const mid = new THREE.Vector3(Math.cos(a) * 0.42, h * 0.5, Math.sin(a) * 0.42);
    const top = new THREE.Vector3(Math.cos(a) * 0.72, h, Math.sin(a) * 0.72);
    const trunk = buildCurvedTaperedTrunk(base, mid, top, 0.11, 0.07, lod === 0 ? 5 : 3, lod === 0 ? 6 : 4, false);
    woodParts.push(part(trunk, PALETTE.palmTrunk, SURFACE.none));

    const fCount = lod === 0 ? 5 : 4;
    for (let f = 0; f < fCount; f++) {
      const yaw = (f / fCount) * Math.PI * 2 + a;
      const frond = buildArchedFrond(1.1, 0.22, 0.35, 0.65, lod === 0 ? 3 : 2, false);
      const col = lerpHex(PALETTE.foliageDark, PALETTE.foliageLight, rng.next());
      foliageParts.push(part(frond, col, SURFACE.none, top.x, top.y, top.z, yaw));
    }
  }

  return { wood: mergeAndDispose(woodParts), foliage: mergeAndDispose(foliageParts) };
}

function buildOrnamentalTree(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('ornamentalTree', variant);
  const woodParts: THREE.BufferGeometry[] = [];
  const mainTrunk = buildCurvedTaperedTrunk(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.12, 1.4, 0.08),
    new THREE.Vector3(-0.08, 2.9, 0.04),
    0.26,
    0.13,
    lod === 0 ? 6 : 4,
    lod === 0 ? 7 : 5,
    false,
  );
  woodParts.push(part(mainTrunk, PALETTE.treeTrunk, SURFACE.none));

  if (lod === 0) {
    for (let b = 0; b < 2; b++) {
      const a = b * Math.PI + variant * 0.7;
      const branch = buildCurvedTaperedTrunk(
        new THREE.Vector3(0.02, 2.0, 0.04),
        new THREE.Vector3(Math.cos(a) * 0.55, 2.55, Math.sin(a) * 0.55),
        new THREE.Vector3(Math.cos(a) * 1.05, 3.2, Math.sin(a) * 1.05),
        0.11,
        0.05,
        3,
        5,
        false,
      );
      woodParts.push(part(branch, PALETTE.treeTrunk, SURFACE.none));
    }
  }

  const foliageParts: THREE.BufferGeometry[] = [];
  const lobes = lod === 0 ? 4 : 3;
  const latSegs = lod === 0 ? 5 : 3;
  const lonSegs = lod === 0 ? 7 : 5;
  foliageParts.push(part(buildBlob(1.45, 1.15, 1.45, latSegs, lonSegs), PALETTE.canopyLight, SURFACE.none, 0, 3.85, 0));
  for (let i = 0; i < lobes - 1; i++) {
    const a = (i / (lobes - 1)) * Math.PI * 2 + variant * 0.5;
    const col = i % 2 === 0 ? PALETTE.canopyDark : PALETTE.canopyLight;
    foliageParts.push(part(
      buildBlob(randRange(rng, 0.95, 1.15), randRange(rng, 0.8, 0.95), randRange(rng, 0.95, 1.15), latSegs, lonSegs),
      col,
      SURFACE.none,
      Math.cos(a) * 0.95,
      3.35 + (i % 2) * 0.35,
      Math.sin(a) * 0.95,
    ));
  }

  return { wood: mergeAndDispose(woodParts), foliage: mergeAndDispose(foliageParts) };
}

function buildShrubFlowering(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('shrubFlowering', variant);
  const parts: THREE.BufferGeometry[] = [];
  const lat = lod === 0 ? 4 : 3;
  const lon = lod === 0 ? 6 : 4;
  parts.push(part(buildBlob(0.55, 0.42, 0.55, lat, lon), PALETTE.foliageMid, SURFACE.none, 0, 0.35, 0));
  parts.push(part(buildBlob(0.4, 0.32, 0.4, lat, lon), PALETTE.foliageLight, SURFACE.none, -0.25, 0.28, 0.15));
  if (lod === 0) {
    parts.push(part(buildBlob(0.38, 0.3, 0.38, lat, lon), PALETTE.foliageDark, SURFACE.none, 0.24, 0.28, -0.14));
  }

  const flowerCols = [PALETTE.flowerPink, PALETTE.flowerRed, PALETTE.flowerOrange];
  const fCol = flowerCols[variant];
  const fCount = lod === 0 ? 5 : 2;
  for (let i = 0; i < fCount; i++) {
    const a = (i / fCount) * Math.PI * 2 + rng.next() * 0.5;
    parts.push(part(
      buildBlob(0.08, 0.06, 0.08, lod === 0 ? 3 : 2, 4),
      fCol,
      SURFACE.none,
      Math.cos(a) * 0.38,
      0.42 + rng.next() * 0.2,
      Math.sin(a) * 0.38,
    ));
  }
  return { wood: null, foliage: mergeAndDispose(parts) };
}

function buildBushRound(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.foliageLight : variant === 2 ? PALETTE.foliageDark : PALETTE.foliageMid;
  const lat = lod === 0 ? 5 : 3;
  const lon = lod === 0 ? 7 : 5;
  parts.push(part(buildBlob(0.62, 0.5, 0.62, lat, lon), col, SURFACE.none, 0, 0.44, 0));
  if (lod === 0) {
    parts.push(part(buildBlob(0.42, 0.36, 0.42, 4, 6), PALETTE.foliageLight, SURFACE.none, 0.25, 0.36, 0.2));
    parts.push(part(buildBlob(0.4, 0.34, 0.4, 4, 6), PALETTE.foliageDark, SURFACE.none, -0.24, 0.34, -0.18));
  }
  return { wood: null, foliage: mergeAndDispose(parts) };
}

function buildGrassClump(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('grassClump', variant);
  const parts: THREE.BufferGeometry[] = [];
  const blades = lod === 0 ? 10 : 5;
  for (let i = 0; i < blades; i++) {
    const yaw = (i / blades) * Math.PI * 2 + randRange(rng, -0.2, 0.2);
    const blade = buildArchedFrond(randRange(rng, 0.38, 0.58), 0.045, 0.35, 0.18, lod === 0 ? 2 : 1, false);
    const col = i % 2 === 0 ? PALETTE.foliageLight : PALETTE.grassYellow;
    parts.push(part(blade, col, SURFACE.none, Math.cos(yaw) * 0.08, 0, Math.sin(yaw) * 0.08, yaw));
  }
  return { wood: null, foliage: mergeAndDispose(parts) };
}

function buildFlowersTropical(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('flowersTropical', variant);
  const parts: THREE.BufferGeometry[] = [];
  const cols = [PALETTE.flowerPink, PALETTE.flowerOrange, PALETTE.flowerRed, PALETTE.flowerYellow];
  const count = lod === 0 ? 5 : 3;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.18;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = randRange(rng, 0.32, 0.48);
    parts.push(part(lathe([{ x: 0.015, y: 0 }, { x: 0.012, y: h }], lod === 0 ? 4 : 3, false), PALETTE.foliageDark, SURFACE.none, x, 0, z));
    parts.push(part(buildBlob(0.11, 0.04, 0.11, lod === 0 ? 3 : 2, lod === 0 ? 5 : 4), cols[(i + variant) % cols.length], SURFACE.none, x, h + 0.02, z));
  }
  return { wood: null, foliage: mergeAndDispose(parts) };
}

function buildHedge(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const col = variant === 1 ? PALETTE.foliageLight : variant === 2 ? PALETTE.foliageDark : PALETTE.foliageMid;
  const g = lod === 0
    ? bevelBox(1.0, 1.0, 0.5, 0.12, 1)
    : bevelBox(1.0, 1.0, 0.5, 0, 1);
  g.translate(0, 0.5, 0);
  return { wood: null, foliage: mergeAndDispose([part(g, col, SURFACE.none)]) };
}

function buildPlanterBox(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const potCol = variant === 1 ? PALETTE.concrete : PALETTE.palmTrunk;
  const potSurf = variant === 1 ? SURFACE.concrete : SURFACE.none;
  const woodParts: THREE.BufferGeometry[] = [
    part(bevelBox(1.0, 0.45, 0.5, lod === 0 ? 0.02 : 0, 1), potCol, potSurf, 0, 0.225, 0),
    part(bevelBox(0.92, 0.04, 0.42, 0, 1), PALETTE.soil, SURFACE.grass, 0, 0.44, 0),
  ];
  const foliageParts: THREE.BufferGeometry[] = [];
  const count = lod === 0 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const x = count === 3 ? -0.28 + i * 0.28 : -0.2 + i * 0.4;
    foliageParts.push(part(buildBlob(0.2, 0.18, 0.18, 3, 5), PALETTE.foliageLight, SURFACE.none, x, 0.55, 0));
    if (lod === 0) {
      foliageParts.push(part(buildBlob(0.08, 0.05, 0.08, 3, 4), i % 2 === 0 ? PALETTE.flowerPink : PALETTE.flowerYellow, SURFACE.none, x, 0.72, 0.04));
    }
  }
  return { wood: mergeAndDispose(woodParts), foliage: mergeAndDispose(foliageParts) };
}

function buildVine(variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  const rng = makeRng('vine', variant);
  const parts: THREE.BufferGeometry[] = [];
  const leaves = lod === 0 ? 12 : 5;
  for (let i = 0; i < leaves; i++) {
    const x = -0.42 + (i / Math.max(1, leaves - 1)) * 0.84;
    const y = 0.2 + ((i * 37) % 11) * 0.11;
    const z = 0.06 + rng.next() * 0.1;
    const leaf = buildArchedFrond(0.22, 0.09, 0.03, 0.12, 1, false);
    const col = lerpHex(PALETTE.foliageDark, PALETTE.foliageLight, rng.next());
    parts.push(part(leaf, col, SURFACE.none, x, y, z, (rng.next() - 0.5) * 0.6));
  }
  return { wood: null, foliage: mergeAndDispose(parts) };
}

function buildPlant(kind: PlantKind, variant: 0 | 1 | 2, lod: 0 | 1): PlantGeometrySet {
  switch (kind) {
    case 'palmCoconut': return buildPalmCoconut(variant, lod);
    case 'palmRoyal': return buildPalmRoyal(variant, lod);
    case 'palmFan': return buildPalmFan(variant, lod);
    case 'palmCluster': return buildPalmCluster(variant, lod);
    case 'shrubFlowering': return buildShrubFlowering(variant, lod);
    case 'bushRound': return buildBushRound(variant, lod);
    case 'grassClump': return buildGrassClump(variant, lod);
    case 'flowersTropical': return buildFlowersTropical(variant, lod);
    case 'hedge': return buildHedge(variant, lod);
    case 'planterBox': return buildPlanterBox(variant, lod);
    case 'vine': return buildVine(variant, lod);
    case 'ornamentalTree': return buildOrnamentalTree(variant, lod);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled PlantKind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Returns the cached procedural wood/foliage BufferGeometries for a plant kind.
 * Returned geometries are SHARED cached instances — do not dispose; call disposeVegetationCaches().
 */
export function plantGeometry(
  kind: PlantKind,
  variant: number,
  lod: 0 | 1,
): PlantGeometrySet {
  const v = normalizeVariant(variant);
  return cache.get(`${kind}|${v}|${lod}`, () => buildPlant(kind, v, lod));
}

/**
 * Visual extents (w along X, d along Z, h height) for LOD0 variant 0.
 */
export function plantFootprint(kind: PlantKind): { w: number; d: number; h: number } {
  const set = plantGeometry(kind, 0, 0);
  const box = new THREE.Box3();
  if (set.wood) {
    if (!set.wood.boundingBox) set.wood.computeBoundingBox();
    box.union(set.wood.boundingBox!);
  }
  if (!set.foliage.boundingBox) set.foliage.computeBoundingBox();
  box.union(set.foliage.boundingBox!);
  return {
    w: Math.max(0.01, box.max.x - box.min.x),
    d: Math.max(0.01, box.max.z - box.min.z),
    h: Math.max(0.01, box.max.y - box.min.y),
  };
}

/**
 * Disposes all cached vegetation geometries and clears the cache.
 */
export function disposeVegetationCaches(): void {
  cache.dispose();
}
