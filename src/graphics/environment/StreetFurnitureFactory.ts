// [3D] Procedural street furniture, urban clutter, and flat road/sidewalk detail geometries (VP2-T005).
// All geometries are vertex-coloured, metric-UV, tagged with SURFACE ids, and cached per (kind, variant, lod).
import * as THREE from 'three';
import { mulberry32, randRange } from '../../utils/rng';
import type { Rng } from '../../core/types';
import { GeometryCache } from '../geometry/GeometryCache';
import {
  arch,
  bevelBox,
  extrudeProfile,
  lathe,
  mergeTagged,
  paint,
  tagSurface,
  taperedBox,
  transform,
  type Vec2,
} from '../geometry/meshUtils';
import { SURFACE } from '../materials/surfaceDetailMath';
import type { FurnitureKind } from './environmentKinds';

/**
 * Curb top equals the sidewalk top; groundLevels has no sidewalk constant;
 * the flat-kind rule caps flat items at 0.15 m so the value is clamped to 0.15;
 * a 5 mm mismatch with CityDistrict paving is a known follow-up.
 */
export const SIDEWALK_TOP = 0.15;

const PALETTE = {
  asphalt: 0x4a5260,
  sidewalk: 0xa9a294,
  concrete: 0xc9b99a,
  concreteDark: 0x8c8578,
  metal: 0x9aa3a8,
  metalDark: 0x5c646b,
  warning: 0xffb347,
  red: 0xd94b43,
  awningRed: 0xe0574f,
  awningTeal: 0x2e8b84,
  awningYellow: 0xf2c14e,
  glass: 0x9fc2d6,
  wood: 0x8a6a4a,
  woodDark: 0x624932,
  white: 0xe8e4dc,
  dark: 0x2c3036,
  green: 0x466d4a,
  blueGrey: 0x536b78,
  soil: 0x4e3c2c,
  foliage: 0x457d36,
  foliageAlt: 0x37682c,
  grass: 0x4f8a3a,
} as const;

const cache = new GeometryCache<string, THREE.BufferGeometry>();

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

function makeRng(kind: FurnitureKind, variant: number): Rng {
  const seed = (fnv1a(kind) ^ Math.imul(variant + 1, 0x9e3779b9)) >>> 0;
  return mulberry32(seed);
}

/**
 * Helper to paint, surface-tag, and position a sub-part, disposing intermediate clones.
 */
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
  disposeBase = true,
): THREE.BufferGeometry {
  const p = paint(base, color);
  const t = tagSurface(p, surface);
  p.dispose();
  const out = transform(t, x, y, z, rotY, sx, sy, sz);
  t.dispose();
  if (disposeBase) base.dispose();
  return out;
}

function boxPart(
  w: number,
  h: number,
  d: number,
  bevel: number,
  segs: number,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
): THREE.BufferGeometry {
  return part(bevelBox(w, h, d, bevel, segs), color, surface, x, y, z, rotY);
}

function buildTubeAlong(
  pts: readonly THREE.Vector3[],
  radius: number,
  radialSegs: number,
  closedEnds = true,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([...pts]);
  const tubularSegs = Math.max(2, pts.length - 1);
  const raw = new THREE.TubeGeometry(curve, tubularSegs, radius, radialSegs, false);
  const g = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!closedEnds || pts.length < 2) return g;
  return g;
}

function buildFlatStrip(
  points: readonly Vec2[],
  height: number,
  yBottom = 0,
): THREE.BufferGeometry {
  // Extrudes along Z in XY plane, then rotates -PI/2 around X so XY becomes XZ (Y up).
  const raw = extrudeProfile(points, height, 0);
  raw.rotateX(-Math.PI * 0.5);
  raw.translate(0, yBottom + height * 0.5, 0);
  return raw;
}

function buildBentHoop(width: number, height: number, tubeR: number, radialSegs: number, pathSegs: number): THREE.BufferGeometry {
  const hw = width * 0.5;
  const pts: THREE.Vector3[] = [];
  const archStart = height - hw;
  pts.push(new THREE.Vector3(-hw, 0, 0));
  if (archStart > 0.05) {
    pts.push(new THREE.Vector3(-hw, archStart, 0));
  }
  for (let i = 1; i < pathSegs; i++) {
    const a = (i / pathSegs) * Math.PI;
    pts.push(new THREE.Vector3(-Math.cos(a) * hw, archStart + Math.sin(a) * hw, 0));
  }
  if (archStart > 0.05) {
    pts.push(new THREE.Vector3(hw, archStart, 0));
  }
  pts.push(new THREE.Vector3(hw, 0, 0));
  return buildTubeAlong(pts, tubeR, radialSegs);
}

function buildTorusRing(majorR: number, tubeR: number, radialSegs: number, tubularSegs: number): THREE.BufferGeometry {
  const raw = new THREE.TorusGeometry(majorR, tubeR, radialSegs, tubularSegs);
  const g = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();
  return g;
}

function mergeAndDispose(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeTagged(parts);
  for (let i = 0; i < parts.length; i++) parts[i].dispose();
  return merged;
}

// ---------------------------------------------------------------------------
// Builders per FurnitureKind
// ---------------------------------------------------------------------------

function buildStreetlight(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const h = variant === 1 ? 6.2 : variant === 2 ? 5.7 : 6.0;
  const metalCol = variant === 2 ? PALETTE.metalDark : PALETTE.metal;
  const parts: THREE.BufferGeometry[] = [];
  if (lod === 0) {
    const baseProf: Vec2[] = [
      { x: 0.22, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0.14, y: 0.7 },
      { x: 0.09, y: 0.85 },
      { x: 0.075, y: h - 0.5 },
    ];
    parts.push(part(lathe(baseProf, 8, true), metalCol, SURFACE.none));
    const armPts = [
      new THREE.Vector3(0, h - 0.55, 0),
      new THREE.Vector3(0, h - 0.15, 0.35),
      new THREE.Vector3(0, h, 0.85),
      new THREE.Vector3(0, h - 0.05, 1.35),
    ];
    parts.push(part(buildTubeAlong(armPts, 0.055, 6), metalCol, SURFACE.none));
    parts.push(boxPart(0.32, 0.12, 0.52, 0.03, 1, metalCol, SURFACE.none, 0, h - 0.06, 1.55));
    parts.push(boxPart(0.24, 0.04, 0.4, 0, 1, 0xfff2cc, SURFACE.none, 0, h - 0.12, 1.55));
  } else {
    const poleProf: Vec2[] = [
      { x: 0.2, y: 0 },
      { x: 0.12, y: 0.7 },
      { x: 0.075, y: h - 0.3 },
    ];
    parts.push(part(lathe(poleProf, 5, true), metalCol, SURFACE.none));
    parts.push(boxPart(0.1, 0.1, 1.4, 0, 1, metalCol, SURFACE.none, 0, h - 0.15, 0.65));
    parts.push(boxPart(0.32, 0.12, 0.52, 0, 1, metalCol, SURFACE.none, 0, h - 0.12, 1.5));
  }
  return mergeAndDispose(parts);
}

function buildBusStop(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frameCol = variant === 1 ? PALETTE.metalDark : PALETTE.metal;
  const roofCol = variant === 2 ? PALETTE.awningTeal : frameCol;
  const w = 2.6;
  const d = 1.4;
  const h = 2.6;
  if (lod === 0) {
    parts.push(part(lathe([{ x: 0.06, y: 0 }, { x: 0.06, y: h - 0.1 }], 6, true), frameCol, SURFACE.none, -w * 0.44, 0, -d * 0.35));
    parts.push(part(lathe([{ x: 0.06, y: 0 }, { x: 0.06, y: h - 0.1 }], 6, true), frameCol, SURFACE.none, w * 0.44, 0, -d * 0.35));
    parts.push(boxPart(w, 0.14, d, 0.04, 1, roofCol, SURFACE.none, 0, h - 0.07, 0.05));
    parts.push(boxPart(w * 0.84, 2.0, 0.05, 0, 1, PALETTE.glass, SURFACE.none, 0, 1.25, -d * 0.35));
    parts.push(boxPart(0.05, 2.0, d * 0.78, 0, 1, PALETTE.glass, SURFACE.none, -w * 0.44, 1.25, 0.04));
    for (let i = 0; i < 3; i++) {
      parts.push(boxPart(1.6, 0.05, 0.11, 0, 1, PALETTE.wood, SURFACE.none, 0.1, 0.46, -0.18 + i * 0.14));
    }
    parts.push(boxPart(0.08, 0.44, 0.42, 0, 1, frameCol, SURFACE.none, -0.58, 0.22, -0.04));
    parts.push(boxPart(0.08, 0.44, 0.42, 0, 1, frameCol, SURFACE.none, 0.78, 0.22, -0.04));
  } else {
    parts.push(boxPart(0.1, h - 0.1, 0.1, 0, 1, frameCol, SURFACE.none, -w * 0.44, (h - 0.1) * 0.5, -d * 0.35));
    parts.push(boxPart(0.1, h - 0.1, 0.1, 0, 1, frameCol, SURFACE.none, w * 0.44, (h - 0.1) * 0.5, -d * 0.35));
    parts.push(boxPart(w, 0.14, d, 0, 1, roofCol, SURFACE.none, 0, h - 0.07, 0.05));
    parts.push(boxPart(w * 0.84, 2.0, 0.05, 0, 1, PALETTE.glass, SURFACE.none, 0, 1.25, -d * 0.35));
    parts.push(boxPart(0.05, 2.0, d * 0.78, 0, 1, PALETTE.glass, SURFACE.none, -w * 0.44, 1.25, 0.04));
    parts.push(boxPart(1.6, 0.45, 0.45, 0, 1, PALETTE.wood, SURFACE.none, 0.1, 0.225, -0.04));
  }
  return mergeAndDispose(parts);
}

function buildBench(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const woodCol = variant === 1 ? PALETTE.woodDark : variant === 2 ? 0x9b7a56 : PALETTE.wood;
  const w = variant === 2 ? 1.95 : 1.8;
  if (lod === 0) {
    const seatCount = variant === 1 ? 4 : 3;
    for (let i = 0; i < seatCount; i++) {
      const z = -0.14 + (i / (seatCount - 1)) * 0.32;
      const bev = i === seatCount - 1 ? 0.012 : 0;
      parts.push(boxPart(w - 0.08, 0.05, 0.09, bev, 1, woodCol, SURFACE.none, 0, 0.44, z));
    }
    const backCount = variant === 1 ? 3 : variant === 2 ? 1 : 2;
    for (let i = 0; i < backCount; i++) {
      const y = backCount === 1 ? 0.72 : 0.62 + i * 0.14;
      const h = backCount === 1 ? 0.22 : 0.09;
      const bev = i === backCount - 1 ? 0.012 : 0;
      parts.push(boxPart(w - 0.08, h, 0.05, bev, 1, woodCol, SURFACE.none, 0, y, -0.22));
    }
    for (const sx of [-1, 1]) {
      parts.push(boxPart(0.08, 0.44, 0.5, 0, 1, PALETTE.metalDark, SURFACE.none, sx * (w * 0.42), 0.22, 0));
      parts.push(boxPart(0.07, 0.05, 0.48, 0, 1, PALETTE.metalDark, SURFACE.none, sx * (w * 0.42), 0.64, -0.02));
      parts.push(boxPart(0.06, 0.42, 0.06, 0, 1, PALETTE.metalDark, SURFACE.none, sx * (w * 0.42), 0.65, -0.22));
    }
  } else {
    parts.push(boxPart(w, 0.08, 0.45, 0, 1, woodCol, SURFACE.none, 0, 0.44, 0.02));
    parts.push(boxPart(w, 0.32, 0.07, 0, 1, woodCol, SURFACE.none, 0, 0.72, -0.22));
    parts.push(boxPart(0.09, 0.44, 0.46, 0, 1, PALETTE.metalDark, SURFACE.none, -w * 0.42, 0.22, 0));
    parts.push(boxPart(0.09, 0.44, 0.46, 0, 1, PALETTE.metalDark, SURFACE.none, w * 0.42, 0.22, 0));
  }
  return mergeAndDispose(parts);
}

function buildTrashCan(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lidCol = variant === 1 ? PALETTE.green : variant === 2 ? PALETTE.blueGrey : PALETTE.metalDark;
  const h = variant === 1 ? 1.06 : variant === 2 ? 0.96 : 1.0;
  const rTop = variant === 2 ? 0.31 : 0.29;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.23, y: 0 },
      { x: rTop, y: h * 0.74 },
      { x: rTop + 0.02, y: h * 0.78 },
      { x: rTop, y: h * 0.8 },
    ], 10, true), PALETTE.metal, SURFACE.none));
    parts.push(part(lathe([
      { x: rTop + 0.025, y: h * 0.78 },
      { x: rTop + 0.01, y: h * 0.92 },
      { x: rTop * 0.55, y: h * 0.99 },
      { x: 0.02, y: h },
    ], 10, true), lidCol, SURFACE.none));
    parts.push(boxPart(0.16, 0.05, 0.05, 0, 1, PALETTE.metalDark, SURFACE.none, 0, h + 0.02, 0));
  } else {
    parts.push(part(lathe([
      { x: 0.23, y: 0 },
      { x: rTop, y: h * 0.78 },
      { x: rTop * 0.6, y: h * 0.98 },
      { x: 0.02, y: h },
    ], 6, true), lidCol, SURFACE.none));
  }
  return mergeAndDispose(parts);
}

function buildMailbox(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const boxCol = variant === 1 ? PALETTE.metalDark : variant === 2 ? PALETTE.green : PALETTE.blueGrey;
  const postCol = PALETTE.wood;
  if (lod === 0) {
    parts.push(boxPart(0.1, 0.96, 0.1, 0.015, 1, postCol, SURFACE.none, 0, 0.48, 0));
    parts.push(part(arch(0.36, 0.36, 0.45, 8, 0.17), boxCol, SURFACE.none, 0, 1.12, 0));
    parts.push(boxPart(0.32, 0.28, 0.04, 0, 1, PALETTE.metal, SURFACE.none, 0, 1.09, 0.23));
    parts.push(boxPart(0.03, 0.18, 0.04, 0, 1, PALETTE.red, SURFACE.none, 0.2, 1.18, 0.06));
    parts.push(boxPart(0.03, 0.06, 0.1, 0, 1, PALETTE.red, SURFACE.none, 0.2, 1.27, 0.09));
  } else {
    parts.push(boxPart(0.1, 0.96, 0.1, 0, 1, postCol, SURFACE.none, 0, 0.48, 0));
    parts.push(part(arch(0.36, 0.36, 0.45, 4, 0.17), boxCol, SURFACE.none, 0, 1.12, 0));
    parts.push(boxPart(0.03, 0.18, 0.04, 0, 1, PALETTE.red, SURFACE.none, 0.2, 1.18, 0.06));
  }
  return mergeAndDispose(parts);
}

function buildNewsStand(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bodyCol = variant === 1 ? PALETTE.awningRed : variant === 2 ? PALETTE.awningTeal : PALETTE.blueGrey;
  if (lod === 0) {
    parts.push(boxPart(1.16, 0.12, 0.86, 0, 1, PALETTE.concreteDark, SURFACE.concrete, 0, 0.06, 0));
    parts.push(boxPart(1.14, 1.14, 0.84, 0.03, 1, bodyCol, SURFACE.none, 0, 0.69, 0));
    parts.push(boxPart(1.22, 0.12, 0.92, 0.03, 1, PALETTE.metalDark, SURFACE.none, 0, 1.34, 0.02));
    parts.push(boxPart(0.82, 0.56, 0.04, 0, 1, PALETTE.glass, SURFACE.none, -0.06, 0.86, 0.42));
    parts.push(boxPart(0.18, 0.32, 0.05, 0, 1, PALETTE.metal, SURFACE.none, 0.44, 0.82, 0.42));
  } else {
    parts.push(boxPart(1.14, 1.24, 0.84, 0, 1, bodyCol, SURFACE.none, 0, 0.62, 0));
    parts.push(boxPart(1.22, 0.12, 0.92, 0, 1, PALETTE.metalDark, SURFACE.none, 0, 1.32, 0.02));
    parts.push(boxPart(0.82, 0.56, 0.04, 0, 1, PALETTE.glass, SURFACE.none, -0.06, 0.86, 0.42));
  }
  return mergeAndDispose(parts);
}

function buildBikeRack(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hoopCount = variant === 1 ? 3 : 2;
  const col = variant === 2 ? PALETTE.metalDark : PALETTE.metal;
  if (lod === 0) {
    parts.push(boxPart(1.0, 0.05, 0.8, 0.015, 1, PALETTE.concreteDark, SURFACE.concrete, 0, 0.025, 0));
    for (let i = 0; i < hoopCount; i++) {
      const z = hoopCount === 2 ? -0.22 + i * 0.44 : -0.26 + i * 0.26;
      parts.push(part(buildBentHoop(0.76, 0.78, 0.028, 5, 5), col, SURFACE.none, 0, 0.03, z));
    }
  } else {
    parts.push(boxPart(1.0, 0.05, 0.8, 0, 1, PALETTE.concreteDark, SURFACE.concrete, 0, 0.025, 0));
    for (let i = 0; i < 2; i++) {
      const z = -0.22 + i * 0.44;
      parts.push(part(taperedBox(0.76, 0.06, 0.56, 0.06, 0.76), col, SURFACE.none, 0, 0.42, z));
    }
  }
  return mergeAndDispose(parts);
}

function buildHydrant(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.warning : variant === 2 ? 0xc2453d : PALETTE.red;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.23, y: 0 },
      { x: 0.23, y: 0.08 },
      { x: 0.15, y: 0.12 },
      { x: 0.17, y: 0.35 },
      { x: 0.15, y: 0.58 },
      { x: 0.19, y: 0.62 },
      { x: 0.16, y: 0.74 },
      { x: 0.04, y: 0.8 },
    ], 10, true), col, SURFACE.none));
    for (const sx of [-1, 1]) {
      parts.push(part(lathe([
        { x: 0.06, y: 0 },
        { x: 0.06, y: 0.12 },
        { x: 0.08, y: 0.14 },
      ], 6, true), PALETTE.metal, SURFACE.none, sx * 0.14, 0.48, 0, sx > 0 ? 0 : Math.PI));
      // Orient nozzle along +/-X: lathe is along +Y, rotate via box or keep simple nozzle cap
      parts.pop()?.dispose();
      parts.push(boxPart(0.12, 0.1, 0.1, 0.02, 1, PALETTE.metal, SURFACE.none, sx * 0.19, 0.48, 0));
    }
    parts.push(boxPart(0.08, 0.06, 0.08, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.81, 0));
  } else {
    parts.push(part(lathe([
      { x: 0.22, y: 0 },
      { x: 0.16, y: 0.12 },
      { x: 0.16, y: 0.6 },
      { x: 0.14, y: 0.76 },
      { x: 0.03, y: 0.8 },
    ], 6, true), col, SURFACE.none));
    parts.push(boxPart(0.46, 0.1, 0.1, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.48, 0));
  }
  return mergeAndDispose(parts);
}

function buildBollard(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.warning : PALETTE.metalDark;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.2, y: 0 },
      { x: 0.18, y: 0.06 },
      { x: 0.14, y: 0.12 },
      { x: 0.14, y: 0.8 },
      { x: 0.1, y: 0.88 },
      { x: 0.02, y: 0.9 },
    ], 10, true), col, SURFACE.none));
    if (variant !== 1) {
      parts.push(part(lathe([
        { x: 0.145, y: 0.65 },
        { x: 0.145, y: 0.76 },
      ], 10, false), PALETTE.warning, SURFACE.none));
    }
  } else {
    parts.push(part(lathe([
      { x: 0.19, y: 0 },
      { x: 0.14, y: 0.12 },
      { x: 0.14, y: 0.82 },
      { x: 0.03, y: 0.9 },
    ], 6, true), col, SURFACE.none));
  }
  return mergeAndDispose(parts);
}

function buildPlanter(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const potCol = variant === 1 ? PALETTE.wood : PALETTE.concrete;
  const potSurf = variant === 1 ? SURFACE.none : SURFACE.concrete;
  const shrubCol = variant === 2 ? PALETTE.foliageAlt : PALETTE.foliage;
  if (lod === 0) {
    parts.push(part(taperedBox(0.84, 0.46, 0.98, 0.58, 0.42), potCol, potSurf, 0, 0.21, 0));
    parts.push(boxPart(1.0, 0.08, 0.6, 0.02, 1, potCol, potSurf, 0, 0.43, 0));
    parts.push(boxPart(0.86, 0.04, 0.46, 0, 1, PALETTE.soil, SURFACE.grass, 0, 0.45, 0));
    for (const ox of [-0.24, 0, 0.24]) {
      const r = ox === 0 ? 0.22 : 0.18;
      parts.push(part(lathe([
        { x: 0.05, y: 0 },
        { x: r, y: r * 0.5 },
        { x: r * 0.85, y: r * 0.95 },
        { x: 0.02, y: r * 1.15 },
      ], 6, true), shrubCol, SURFACE.none, ox, 0.45, 0));
    }
  } else {
    parts.push(part(taperedBox(0.84, 0.46, 0.98, 0.58, 0.46), potCol, potSurf, 0, 0.23, 0));
    parts.push(part(lathe([
      { x: 0.08, y: 0 },
      { x: 0.28, y: 0.12 },
      { x: 0.04, y: 0.24 },
    ], 5, true), shrubCol, SURFACE.none, -0.18, 0.45, 0));
    parts.push(part(lathe([
      { x: 0.08, y: 0 },
      { x: 0.28, y: 0.12 },
      { x: 0.04, y: 0.24 },
    ], 5, true), shrubCol, SURFACE.none, 0.18, 0.45, 0));
  }
  return mergeAndDispose(parts);
}

function buildRoadSign(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const faceCol = variant === 1 ? PALETTE.warning : variant === 2 ? PALETTE.white : PALETTE.metal;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.045, y: 0 },
      { x: 0.045, y: 2.35 },
    ], 6, true), PALETTE.metal, SURFACE.none));
    parts.push(boxPart(0.64, 0.64, 0.05, 0.02, 1, PALETTE.metalDark, SURFACE.none, 0, 2.08, 0.03));
    parts.push(boxPart(0.56, 0.56, 0.03, 0, 1, faceCol, SURFACE.none, 0, 2.08, 0.06));
  } else {
    parts.push(boxPart(0.08, 2.3, 0.08, 0, 1, PALETTE.metal, SURFACE.none, 0, 1.15, 0));
    parts.push(boxPart(0.64, 0.64, 0.06, 0, 1, faceCol, SURFACE.none, 0, 2.08, 0.04));
  }
  return mergeAndDispose(parts);
}

function buildUtilityBox(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.green : PALETTE.metal;
  if (lod === 0) {
    parts.push(boxPart(0.92, 0.14, 0.62, 0, 1, PALETTE.concrete, SURFACE.concrete, 0, 0.07, 0));
    parts.push(boxPart(0.86, 1.26, 0.56, 0.03, 1, col, SURFACE.none, 0, 0.77, 0));
    parts.push(boxPart(0.72, 1.06, 0.03, 0, 1, PALETTE.metalDark, SURFACE.none, 0, 0.77, 0.28));
    for (let i = 0; i < 3; i++) {
      parts.push(boxPart(0.46, 0.04, 0.04, 0, 1, PALETTE.metalDark, SURFACE.none, 0, 0.96 + i * 0.1, 0.295));
    }
  } else {
    parts.push(boxPart(0.92, 0.14, 0.62, 0, 1, PALETTE.concrete, SURFACE.concrete, 0, 0.07, 0));
    parts.push(boxPart(0.86, 1.26, 0.56, 0, 1, col, SURFACE.none, 0, 0.77, 0));
  }
  return mergeAndDispose(parts);
}

function buildPatioTable(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const topCol = variant === 1 ? PALETTE.wood : variant === 2 ? PALETTE.white : PALETTE.metal;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.02, y: 0 },
      { x: 0.26, y: 0.02 },
      { x: 0.26, y: 0.05 },
      { x: 0.06, y: 0.08 },
      { x: 0.04, y: 0.7 },
    ], 8, true), PALETTE.metalDark, SURFACE.none));
    parts.push(part(lathe([
      { x: 0.02, y: 0.7 },
      { x: 0.39, y: 0.7 },
      { x: 0.4, y: 0.725 },
      { x: 0.39, y: 0.75 },
      { x: 0.02, y: 0.75 },
    ], 12, true), topCol, SURFACE.none));
  } else {
    parts.push(part(lathe([
      { x: 0.24, y: 0 },
      { x: 0.05, y: 0.08 },
      { x: 0.05, y: 0.7 },
    ], 5, true), PALETTE.metalDark, SURFACE.none));
    parts.push(part(lathe([
      { x: 0.4, y: 0.7 },
      { x: 0.4, y: 0.75 },
    ], 6, true), topCol, SURFACE.none));
  }
  return mergeAndDispose(parts);
}

function buildPatioUmbrella(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pairs: readonly [number, number][] = [
    [PALETTE.awningRed, PALETTE.white],
    [PALETTE.awningTeal, PALETTE.awningYellow],
    [PALETTE.awningRed, PALETTE.awningYellow],
  ];
  const [colA, colB] = pairs[variant];
  const r = variant === 1 ? 1.25 : variant === 2 ? 1.15 : 1.2;
  const h = variant === 2 ? 2.36 : 2.3;
  const eaveY = h - 0.55;

  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.035, y: 0 },
      { x: 0.035, y: h - 0.05 },
    ], 6, true), PALETTE.wood, SURFACE.none));
    parts.push(boxPart(0.08, 0.08, 0.08, 0, 1, PALETTE.woodDark, SURFACE.none, 0, h - 0.02, 0));
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const pos = new Float32Array([
        0, h - 0.04, 0,
        Math.cos(a1) * r, eaveY, Math.sin(a1) * r,
        Math.cos(a0) * r, eaveY, Math.sin(a0) * r,
        // underside
        0, h - 0.06, 0,
        Math.cos(a0) * r, eaveY - 0.01, Math.sin(a0) * r,
        Math.cos(a1) * r, eaveY - 0.01, Math.sin(a1) * r,
      ]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const col = i % 2 === 0 ? colA : colB;
      parts.push(part(g, col, SURFACE.none));
    }
  } else {
    parts.push(boxPart(0.07, h, 0.07, 0, 1, PALETTE.wood, SURFACE.none, 0, h * 0.5, 0));
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const pos = new Float32Array([
        0, h, 0,
        Math.cos(a1) * r, eaveY, Math.sin(a1) * r,
        Math.cos(a0) * r, eaveY, Math.sin(a0) * r,
      ]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      parts.push(part(g, i % 2 === 0 ? colA : colB, SURFACE.none));
    }
  }
  return mergeAndDispose(parts);
}

function buildDumpster(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.blueGrey : variant === 2 ? PALETTE.metalDark : PALETTE.green;
  if (lod === 0) {
    parts.push(boxPart(1.76, 0.96, 1.06, 0.04, 1, col, SURFACE.none, 0, 0.56, 0));
    parts.push(boxPart(1.82, 0.08, 1.12, 0.02, 1, PALETTE.metalDark, SURFACE.none, 0, 1.06, 0));
    parts.push(boxPart(1.78, 0.08, 0.98, 0.02, 1, PALETTE.dark, SURFACE.none, 0, 1.14, -0.04));
    for (const sx of [-0.72, 0.72]) {
      for (const sz of [-0.38, 0.38]) {
        parts.push(boxPart(0.1, 0.14, 0.14, 0, 1, PALETTE.dark, SURFACE.none, sx, 0.07, sz));
      }
    }
  } else {
    parts.push(boxPart(1.78, 1.02, 1.08, 0, 1, col, SURFACE.none, 0, 0.58, 0));
    parts.push(boxPart(1.8, 0.08, 1.02, 0, 1, PALETTE.dark, SURFACE.none, 0, 1.14, -0.02));
    parts.push(boxPart(1.5, 0.12, 0.85, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.06, 0));
  }
  return mergeAndDispose(parts);
}

function buildTrashBags(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rng = makeRng('trashBags', variant);
  const count = variant === 1 ? 4 : 3;
  const tints = [0x262a2e, 0x343940, 0x2d3338];
  if (lod === 0) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rng.next() * 0.4;
      const dist = count === 4 ? 0.24 : 0.2;
      const r = randRange(rng, 0.2, 0.26);
      const h = randRange(rng, 0.52, 0.72);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const bag = lathe([
        { x: r * 0.75, y: 0 },
        { x: r, y: h * 0.3 },
        { x: r * 0.82, y: h * 0.65 },
        { x: r * 0.3, y: h * 0.85 },
        { x: r * 0.42, y: h },
        { x: 0.02, y: h + 0.03 },
      ], 6, true);
      parts.push(part(bag, tints[i % tints.length], SURFACE.none, x, 0, z));
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const bag = lathe([
        { x: 0.18, y: 0 },
        { x: 0.24, y: 0.28 },
        { x: 0.06, y: 0.62 },
      ], 4, true);
      parts.push(part(bag, tints[i % tints.length], SURFACE.none, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2));
    }
  }
  return mergeAndDispose(parts);
}

function buildCrates(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colA = PALETTE.wood;
  const colB = variant === 1 ? 0x9b7954 : PALETTE.woodDark;
  if (lod === 0) {
    // Bottom crate
    parts.push(boxPart(0.95, 0.5, 0.85, 0.02, 1, colA, SURFACE.none, 0, 0.25, 0));
    parts.push(boxPart(0.99, 0.08, 0.89, 0, 1, colB, SURFACE.none, 0, 0.46, 0));
    parts.push(boxPart(0.99, 0.08, 0.89, 0, 1, colB, SURFACE.none, 0, 0.06, 0));
    // Top crate rotated slightly
    parts.push(boxPart(0.68, 0.48, 0.64, 0.02, 1, colB, SURFACE.none, 0.06, 0.74, -0.04, 0.18));
    parts.push(boxPart(0.72, 0.07, 0.68, 0, 1, colA, SURFACE.none, 0.06, 0.94, -0.04, 0.18));
  } else {
    parts.push(boxPart(0.96, 0.5, 0.86, 0, 1, colA, SURFACE.none, 0, 0.25, 0));
    parts.push(boxPart(0.68, 0.48, 0.64, 0, 1, colB, SURFACE.none, 0.06, 0.74, -0.04, 0.18));
  }
  return mergeAndDispose(parts);
}

function buildShoppingCart(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const accent = variant === 1 ? PALETTE.red : variant === 2 ? PALETTE.awningTeal : PALETTE.metalDark;
  if (lod === 0) {
    // Base frame
    parts.push(boxPart(0.54, 0.04, 0.82, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.16, 0));
    // Basket bottom + top rim bars
    parts.push(boxPart(0.52, 0.03, 0.66, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.48, 0.06));
    parts.push(boxPart(0.56, 0.04, 0.04, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.86, 0.4));
    parts.push(boxPart(0.56, 0.04, 0.04, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.86, -0.28));
    for (const sx of [-0.26, 0.26]) {
      parts.push(boxPart(0.04, 0.04, 0.72, 0, 1, PALETTE.metal, SURFACE.none, sx, 0.86, 0.06));
      parts.push(boxPart(0.04, 0.38, 0.04, 0, 1, PALETTE.metal, SURFACE.none, sx, 0.67, 0.39));
      parts.push(boxPart(0.04, 0.72, 0.04, 0, 1, PALETTE.metal, SURFACE.none, sx, 0.52, -0.28));
      parts.push(boxPart(0.04, 0.12, 0.04, 0, 1, PALETTE.metal, SURFACE.none, sx, 0.92, -0.36));
    }
    parts.push(boxPart(0.58, 0.05, 0.05, 0, 1, accent, SURFACE.none, 0, 0.98, -0.4));
    for (const sx of [-0.24, 0.24]) {
      for (const sz of [-0.34, 0.36]) {
        parts.push(boxPart(0.05, 0.12, 0.12, 0, 1, PALETTE.dark, SURFACE.none, sx, 0.06, sz));
      }
    }
  } else {
    parts.push(boxPart(0.54, 0.05, 0.82, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.16, 0));
    parts.push(boxPart(0.54, 0.38, 0.68, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.66, 0.06));
    parts.push(boxPart(0.56, 0.06, 0.06, 0, 1, accent, SURFACE.none, 0, 0.96, -0.38));
    parts.push(boxPart(0.5, 0.12, 0.12, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.06, 0.35));
    parts.push(boxPart(0.5, 0.12, 0.12, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.06, -0.34));
  }
  return mergeAndDispose(parts);
}

function buildParkedBike(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frameCol = variant === 1 ? PALETTE.awningRed : variant === 2 ? PALETTE.awningTeal : PALETTE.blueGrey;
  if (lod === 0) {
    for (const z of [-0.52, 0.52]) {
      const wheel = buildTorusRing(0.32, 0.035, 5, 8);
      wheel.rotateY(Math.PI * 0.5);
      parts.push(part(wheel, PALETTE.dark, SURFACE.none, 0, 0.35, z));
    }
    parts.push(boxPart(0.05, 0.05, 0.72, 0, 1, frameCol, SURFACE.none, 0, 0.66, 0));
    parts.push(boxPart(0.05, 0.44, 0.05, 0, 1, frameCol, SURFACE.none, 0, 0.56, -0.18));
    parts.push(boxPart(0.05, 0.52, 0.05, 0, 1, frameCol, SURFACE.none, 0, 0.6, 0.36));
    parts.push(boxPart(0.14, 0.06, 0.24, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.82, -0.2));
    parts.push(boxPart(0.46, 0.04, 0.04, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.88, 0.36));
  } else {
    parts.push(boxPart(0.07, 0.64, 0.64, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.32, -0.52));
    parts.push(boxPart(0.07, 0.64, 0.64, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.32, 0.52));
    parts.push(boxPart(0.07, 0.3, 0.72, 0, 1, frameCol, SURFACE.none, 0, 0.6, 0));
    parts.push(boxPart(0.46, 0.05, 0.05, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.88, 0.36));
  }
  return mergeAndDispose(parts);
}

function buildConstructionBarrier(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mainCol = variant === 1 ? PALETTE.white : PALETTE.warning;
  const stripeCol = variant === 1 ? PALETTE.warning : PALETTE.white;
  if (lod === 0) {
    for (const sx of [-0.76, 0.76]) {
      parts.push(boxPart(0.08, 0.96, 0.08, 0, 1, PALETTE.metalDark, SURFACE.none, sx, 0.48, 0));
      parts.push(boxPart(0.1, 0.06, 0.4, 0, 1, PALETTE.metalDark, SURFACE.none, sx, 0.03, 0));
    }
    parts.push(boxPart(1.96, 0.22, 0.07, 0.015, 1, mainCol, SURFACE.none, 0, 0.82, 0));
    parts.push(boxPart(1.96, 0.18, 0.07, 0.015, 1, mainCol, SURFACE.none, 0, 0.48, 0));
    for (const sx of [-0.55, 0, 0.55]) {
      parts.push(boxPart(0.24, 0.2, 0.08, 0, 1, stripeCol, SURFACE.none, sx, 0.82, 0));
    }
  } else {
    parts.push(boxPart(0.09, 0.96, 0.38, 0, 1, PALETTE.metalDark, SURFACE.none, -0.76, 0.48, 0));
    parts.push(boxPart(0.09, 0.96, 0.38, 0, 1, PALETTE.metalDark, SURFACE.none, 0.76, 0.48, 0));
    parts.push(boxPart(1.96, 0.22, 0.07, 0, 1, mainCol, SURFACE.none, 0, 0.82, 0));
    parts.push(boxPart(1.96, 0.18, 0.07, 0, 1, mainCol, SURFACE.none, 0, 0.48, 0));
  }
  return mergeAndDispose(parts);
}

function buildFenceSection(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (variant === 0) {
    // Picket fence
    parts.push(boxPart(2.0, 0.07, 0.05, 0, 1, PALETTE.white, SURFACE.none, 0, 0.32, 0));
    parts.push(boxPart(2.0, 0.07, 0.05, 0, 1, PALETTE.white, SURFACE.none, 0, 0.9, 0));
    const count = lod === 0 ? 7 : 4;
    for (let i = 0; i < count; i++) {
      const x = -0.84 + (i / (count - 1)) * 1.68;
      parts.push(boxPart(0.14, 1.1, 0.04, 0, 1, PALETTE.white, SURFACE.none, x, 0.55, 0.02));
      if (lod === 0) {
        parts.push(part(taperedBox(0.14, 0.04, 0.02, 0.02, 0.12), PALETTE.white, SURFACE.none, x, 1.16, 0.02));
      }
    }
  } else if (variant === 1) {
    // Chain-link look
    parts.push(boxPart(0.07, 1.2, 0.07, 0, 1, PALETTE.metal, SURFACE.none, -0.96, 0.6, 0));
    parts.push(boxPart(0.07, 1.2, 0.07, 0, 1, PALETTE.metal, SURFACE.none, 0.96, 0.6, 0));
    parts.push(boxPart(1.96, 0.05, 0.05, 0, 1, PALETTE.metal, SURFACE.none, 0, 1.18, 0));
    parts.push(boxPart(1.96, 0.05, 0.05, 0, 1, PALETTE.metal, SURFACE.none, 0, 0.12, 0));
    const bars = lod === 0 ? 5 : 2;
    for (let i = 0; i < bars; i++) {
      const x = -0.68 + (i / Math.max(1, bars - 1)) * 1.36;
      parts.push(boxPart(0.025, 1.04, 0.025, 0, 1, PALETTE.metalDark, SURFACE.none, x, 0.65, 0));
    }
  } else {
    // Low wooden slat fence
    parts.push(boxPart(0.09, 1.0, 0.09, 0, 1, PALETTE.woodDark, SURFACE.none, -0.95, 0.5, 0));
    parts.push(boxPart(0.09, 1.0, 0.09, 0, 1, PALETTE.woodDark, SURFACE.none, 0.95, 0.5, 0));
    const slats = lod === 0 ? 4 : 2;
    for (let i = 0; i < slats; i++) {
      const y = 0.24 + (i / (slats - 1)) * 0.64;
      parts.push(boxPart(1.94, 0.14, 0.04, lod === 0 ? 0.01 : 0, 1, PALETTE.wood, SURFACE.none, 0, y, 0.02));
    }
  }
  return mergeAndDispose(parts);
}

function buildGasPump(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const accent = variant === 1 ? PALETTE.awningTeal : variant === 2 ? PALETTE.warning : PALETTE.red;
  if (lod === 0) {
    parts.push(boxPart(0.8, 0.14, 0.6, 0.02, 1, PALETTE.concrete, SURFACE.concrete, 0, 0.07, 0));
    parts.push(boxPart(0.66, 1.2, 0.44, 0.03, 1, PALETTE.white, SURFACE.none, 0, 0.74, 0));
    parts.push(boxPart(0.72, 0.24, 0.48, 0.03, 1, accent, SURFACE.none, 0, 1.46, 0));
    parts.push(boxPart(0.44, 0.28, 0.04, 0, 1, PALETTE.glass, SURFACE.none, 0, 1.04, 0.22));
    const hosePts = [
      new THREE.Vector3(0.33, 1.15, 0),
      new THREE.Vector3(0.45, 0.85, 0.06),
      new THREE.Vector3(0.42, 0.5, 0.04),
      new THREE.Vector3(0.34, 0.72, 0),
    ];
    parts.push(part(buildTubeAlong(hosePts, 0.024, 5), PALETTE.dark, SURFACE.none));
  } else {
    parts.push(boxPart(0.8, 0.14, 0.6, 0, 1, PALETTE.concrete, SURFACE.concrete, 0, 0.07, 0));
    parts.push(boxPart(0.66, 1.2, 0.44, 0, 1, PALETTE.white, SURFACE.none, 0, 0.74, 0));
    parts.push(boxPart(0.72, 0.24, 0.48, 0, 1, accent, SURFACE.none, 0, 1.46, 0));
    parts.push(boxPart(0.44, 0.28, 0.04, 0, 1, PALETTE.glass, SURFACE.none, 0, 1.04, 0.22));
  }
  return mergeAndDispose(parts);
}

function buildBasketballHoop(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rimCol = variant === 1 ? PALETTE.red : PALETTE.warning;
  if (lod === 0) {
    parts.push(part(lathe([{ x: 0.08, y: 0 }, { x: 0.07, y: 2.9 }], 6, true), PALETTE.metalDark, SURFACE.none, 0, 0, -0.45));
    parts.push(boxPart(0.1, 0.1, 0.65, 0, 1, PALETTE.metalDark, SURFACE.none, 0, 2.75, -0.15));
    parts.push(boxPart(0.9, 0.68, 0.05, 0.015, 1, PALETTE.white, SURFACE.none, 0, 2.75, 0.18));
    parts.push(boxPart(0.42, 0.3, 0.02, 0, 1, rimCol, SURFACE.none, 0, 2.66, 0.21));
    const rim = buildTorusRing(0.22, 0.02, 5, 8);
    rim.rotateX(Math.PI * 0.5);
    parts.push(part(rim, rimCol, SURFACE.none, 0, 2.52, 0.44));
    parts.push(part(lathe([{ x: 0.13, y: 0 }, { x: 0.21, y: 0.34 }], 8, false), PALETTE.white, SURFACE.none, 0, 2.18, 0.44));
  } else {
    parts.push(boxPart(0.12, 2.9, 0.12, 0, 1, PALETTE.metalDark, SURFACE.none, 0, 1.45, -0.45));
    parts.push(boxPart(0.1, 0.1, 0.65, 0, 1, PALETTE.metalDark, SURFACE.none, 0, 2.75, -0.15));
    parts.push(boxPart(0.9, 0.68, 0.06, 0, 1, PALETTE.white, SURFACE.none, 0, 2.75, 0.18));
    parts.push(boxPart(0.42, 0.06, 0.42, 0, 1, rimCol, SURFACE.none, 0, 2.52, 0.44));
  }
  return mergeAndDispose(parts);
}

function buildTrafficCone(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.awningRed : PALETTE.warning;
  if (lod === 0) {
    parts.push(boxPart(0.48, 0.05, 0.48, 0.015, 1, PALETTE.dark, SURFACE.none, 0, 0.025, 0));
    parts.push(part(lathe([
      { x: 0.19, y: 0.05 },
      { x: 0.11, y: 0.4 },
      { x: 0.055, y: 0.74 },
      { x: 0.02, y: 0.75 },
    ], 10, true), col, SURFACE.none));
    parts.push(part(lathe([
      { x: 0.125, y: 0.34 },
      { x: 0.098, y: 0.48 },
    ], 10, false), PALETTE.white, SURFACE.none));
  } else {
    parts.push(boxPart(0.46, 0.05, 0.46, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.025, 0));
    parts.push(part(lathe([
      { x: 0.18, y: 0.05 },
      { x: 0.04, y: 0.75 },
    ], 6, true), col, SURFACE.none));
  }
  return mergeAndDispose(parts);
}

// ---------------------------------------------------------------------------
// FLAT KINDS (every vertex y in [0, 0.15])
// ---------------------------------------------------------------------------

function buildManhole(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.metalDark : PALETTE.metal;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.44, y: 0 },
      { x: 0.44, y: 0.025 },
      { x: 0.38, y: 0.03 },
      { x: 0.36, y: 0.05 },
      { x: 0.02, y: 0.05 },
    ], 12, true), col, SURFACE.none));
    parts.push(part(lathe([
      { x: 0.24, y: 0.05 },
      { x: 0.24, y: 0.058 },
      { x: 0.18, y: 0.058 },
      { x: 0.18, y: 0.05 },
    ], 10, false), PALETTE.metalDark, SURFACE.none));
  } else {
    parts.push(part(lathe([
      { x: 0.44, y: 0 },
      { x: 0.42, y: 0.04 },
      { x: 0.02, y: 0.04 },
    ], 6, true), col, SURFACE.none));
  }
  return mergeAndDispose(parts);
}

function buildStormDrain(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = variant === 1 ? PALETTE.metalDark : PALETTE.metal;
  if (lod === 0) {
    parts.push(boxPart(0.92, 0.02, 0.56, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.01, 0));
    parts.push(boxPart(0.96, 0.03, 0.06, 0, 1, col, SURFACE.none, 0, 0.015, -0.27));
    parts.push(boxPart(0.96, 0.03, 0.06, 0, 1, col, SURFACE.none, 0, 0.015, 0.27));
    for (let i = 0; i < 5; i++) {
      const x = -0.36 + i * 0.18;
      parts.push(boxPart(0.05, 0.035, 0.52, 0, 1, col, SURFACE.none, x, 0.018, 0));
    }
  } else {
    parts.push(boxPart(0.94, 0.02, 0.56, 0, 1, PALETTE.dark, SURFACE.none, 0, 0.01, 0));
    parts.push(boxPart(0.94, 0.035, 0.1, 0, 1, col, SURFACE.none, 0, 0.018, -0.14));
    parts.push(boxPart(0.94, 0.035, 0.1, 0, 1, col, SURFACE.none, 0, 0.018, 0.14));
  }
  return mergeAndDispose(parts);
}

function buildRoadPatch(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const col = variant === 1 ? 0x3f4754 : variant === 2 ? 0x525a68 : PALETTE.asphalt;
  const pts: Vec2[] = variant === 1
    ? [{ x: -0.6, y: -0.45 }, { x: 0.5, y: -0.5 }, { x: 0.65, y: 0.2 }, { x: 0.1, y: 0.55 }, { x: -0.55, y: 0.35 }]
    : [{ x: -0.55, y: -0.5 }, { x: 0.6, y: -0.38 }, { x: 0.52, y: 0.45 }, { x: -0.2, y: 0.52 }, { x: -0.62, y: 0.1 }];
  const g = lod === 0
    ? buildFlatStrip(pts, 0.01, 0)
    : bevelBox(1.1, 0.01, 0.95, 0, 1);
  if (lod === 1) g.translate(0, 0.005, 0);
  return mergeAndDispose([part(g, col, SURFACE.asphalt)]);
}

function buildCurb(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const col = variant === 1 ? PALETTE.concreteDark : PALETTE.concrete;
  const bev = variant === 0 ? 0.02 : variant === 1 ? 0.012 : 0.028;
  const g = lod === 0
    ? bevelBox(1.0, SIDEWALK_TOP, 0.22, bev, 1)
    : bevelBox(1.0, SIDEWALK_TOP, 0.22, 0, 1);
  // Base at y = 0, top at exactly SIDEWALK_TOP (0.15)
  g.translate(0, SIDEWALK_TOP * 0.5, 0);
  return mergeAndDispose([part(g, col, SURFACE.concrete)]);
}

function buildCurbRamp(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const col = variant === 1 ? PALETTE.concreteDark : PALETTE.concrete;
  const parts: THREE.BufferGeometry[] = [];
  if (lod === 0) {
    // Sloped wedge from z=-0.45 (y=0.15) down to z=+0.45 (y=0.025); bevel=0.01 expands Y by +-0.01
    const profile: Vec2[] = [
      { x: -0.48, y: 0.01 },
      { x: 0.48, y: 0.01 },
      { x: 0.48, y: 0.025 },
      { x: -0.36, y: 0.14 },
      { x: -0.48, y: 0.14 },
    ];
    const wedge = extrudeProfile(profile, 1.0, 0.01);
    wedge.rotateY(-Math.PI * 0.5);
    parts.push(part(wedge, col, SURFACE.concrete));
  } else {
    parts.push(boxPart(1.0, 0.075, 0.96, 0, 1, col, SURFACE.concrete, 0, 0.0375, 0));
  }
  return mergeAndDispose(parts);
}

function buildDriveway(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const col = variant === 1 ? PALETTE.concreteDark : PALETTE.concrete;
  const g = lod === 0
    ? bevelBox(1.0, 0.02, 1.0, 0.005, 1)
    : bevelBox(1.0, 0.02, 1.0, 0, 1);
  g.translate(0, 0.01, 0);
  return mergeAndDispose([part(g, col, SURFACE.concrete)]);
}

function buildMedianHatch(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stripeCol = variant === 1 ? PALETTE.white : PALETTE.awningYellow;
  parts.push(boxPart(1.0, 0.005, 1.0, 0, 1, PALETTE.asphalt, SURFACE.asphalt, 0, 0.0025, 0));
  const count = lod === 0 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const x = count === 3 ? -0.3 + i * 0.3 : -0.25 + i * 0.5;
    parts.push(part(bevelBox(0.12, 0.004, 0.92, 0, 1), stripeCol, SURFACE.none, x, 0.008, 0, 0.45));
  }
  return mergeAndDispose(parts);
}

function buildTrafficIsland(variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rimCol = variant === 1 ? PALETTE.concreteDark : PALETTE.concrete;
  if (lod === 0) {
    parts.push(part(lathe([
      { x: 0.95, y: 0 },
      { x: 0.95, y: 0.1 },
      { x: 0.9, y: 0.12 },
      { x: 0.02, y: 0.12 },
    ], 12, true), rimCol, SURFACE.concrete, 0, 0, 0, 0, 1.0, 1.0, 1.5));
    parts.push(part(lathe([
      { x: 0.78, y: 0.1 },
      { x: 0.75, y: 0.12 },
      { x: 0.02, y: 0.12 },
    ], 10, true), PALETTE.grass, SURFACE.grass, 0, 0, 0, 0, 1.0, 1.0, 1.5));
  } else {
    parts.push(part(lathe([
      { x: 0.94, y: 0 },
      { x: 0.92, y: 0.12 },
      { x: 0.02, y: 0.12 },
    ], 6, true), rimCol, SURFACE.concrete, 0, 0, 0, 0, 1.0, 1.0, 1.5));
    parts.push(part(lathe([
      { x: 0.76, y: 0.1 },
      { x: 0.74, y: 0.12 },
      { x: 0.02, y: 0.12 },
    ], 6, true), PALETTE.grass, SURFACE.grass, 0, 0, 0, 0, 1.0, 1.0, 1.5));
  }
  return mergeAndDispose(parts);
}

function buildFurniture(kind: FurnitureKind, variant: 0 | 1 | 2, lod: 0 | 1): THREE.BufferGeometry {
  switch (kind) {
    case 'streetlight': return buildStreetlight(variant, lod);
    case 'busStop': return buildBusStop(variant, lod);
    case 'bench': return buildBench(variant, lod);
    case 'trashCan': return buildTrashCan(variant, lod);
    case 'mailbox': return buildMailbox(variant, lod);
    case 'newsStand': return buildNewsStand(variant, lod);
    case 'bikeRack': return buildBikeRack(variant, lod);
    case 'hydrant': return buildHydrant(variant, lod);
    case 'bollard': return buildBollard(variant, lod);
    case 'planter': return buildPlanter(variant, lod);
    case 'roadSign': return buildRoadSign(variant, lod);
    case 'utilityBox': return buildUtilityBox(variant, lod);
    case 'patioTable': return buildPatioTable(variant, lod);
    case 'patioUmbrella': return buildPatioUmbrella(variant, lod);
    case 'dumpster': return buildDumpster(variant, lod);
    case 'trashBags': return buildTrashBags(variant, lod);
    case 'crates': return buildCrates(variant, lod);
    case 'shoppingCart': return buildShoppingCart(variant, lod);
    case 'parkedBike': return buildParkedBike(variant, lod);
    case 'constructionBarrier': return buildConstructionBarrier(variant, lod);
    case 'fenceSection': return buildFenceSection(variant, lod);
    case 'gasPump': return buildGasPump(variant, lod);
    case 'basketballHoop': return buildBasketballHoop(variant, lod);
    case 'trafficCone': return buildTrafficCone(variant, lod);
    case 'manhole': return buildManhole(variant, lod);
    case 'stormDrain': return buildStormDrain(variant, lod);
    case 'roadPatch': return buildRoadPatch(variant, lod);
    case 'curb': return buildCurb(variant, lod);
    case 'curbRamp': return buildCurbRamp(variant, lod);
    case 'driveway': return buildDriveway(variant, lod);
    case 'medianHatch': return buildMedianHatch(variant, lod);
    case 'trafficIsland': return buildTrafficIsland(variant, lod);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled FurnitureKind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Returns the cached procedural BufferGeometry for a street furniture item.
 * Returned geometry is a SHARED cached instance — do not dispose; call disposeFurnitureCaches().
 */
export function furnitureGeometry(
  kind: FurnitureKind,
  variant: number,
  lod: 0 | 1,
): THREE.BufferGeometry {
  const v = normalizeVariant(variant);
  return cache.get(`${kind}|${v}|${lod}`, () => buildFurniture(kind, v, lod));
}

/**
 * Visual extents (w along X, d along Z, h height) for LOD0 variant 0.
 */
export function furnitureFootprint(kind: FurnitureKind): { w: number; d: number; h: number } {
  const geom = furnitureGeometry(kind, 0, 0);
  if (!geom.boundingBox) geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  return {
    w: Math.max(0.01, bb.max.x - bb.min.x),
    d: Math.max(0.01, bb.max.z - bb.min.z),
    h: Math.max(0.01, bb.max.y - bb.min.y),
  };
}

/**
 * Disposes all cached furniture geometries and clears the cache.
 */
export function disposeFurnitureCaches(): void {
  cache.dispose();
}
