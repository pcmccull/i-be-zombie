// [3D] VP2 landmark part geometry (docs/12_visual_polish2.md §5/§7, ARCHITECTURE §VP2-1).
// BuildingComponents delegates ComponentKind 'landmarkPart' here.
// Output is building-local, centred on the component box [-w/2,w/2] x [-h/2,h/2] x [-d/2,d/2],
// non-indexed with exact attributes { position, normal, color, uv, aSurface }.
import * as THREE from 'three';
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
import type { BuildingPalette, ComponentInstance } from './buildingTypes';
import { LANDMARK_PART } from './landmarkPlans';

const FIXED = {
  glass: 0x5e8fa8,
  glassDark: 0x263542,
  metal: 0x9aa3a8,
  water: 0x2f8fa3,
  concrete: 0xc9b99a,
} as const;

function makePainted(geom: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const p = paint(geom, color);
  const t = tagSurface(p, SURFACE.building);
  p.dispose();
  return t;
}

function addBox(
  out: THREE.BufferGeometry[],
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
  bevel = 0,
): void {
  const raw = bevelBox(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d), bevel, 1);
  const tagged = makePainted(raw, color);
  raw.dispose();
  if (x !== 0 || y !== 0 || z !== 0 || rotY !== 0) {
    const moved = transform(tagged, x, y, z, rotY);
    tagged.dispose();
    out.push(moved);
  } else {
    out.push(tagged);
  }
}

function addTapered(
  out: THREE.BufferGeometry[],
  wb: number,
  db: number,
  wt: number,
  dt: number,
  h: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): void {
  const raw = taperedBox(Math.max(0.01, wb), Math.max(0.01, db), Math.max(0.01, wt), Math.max(0.01, dt), Math.max(0.01, h));
  const tagged = makePainted(raw, color);
  raw.dispose();
  if (x !== 0 || y !== 0 || z !== 0) {
    const moved = transform(tagged, x, y, z, 0);
    tagged.dispose();
    out.push(moved);
  } else {
    out.push(tagged);
  }
}

function addLathe(
  out: THREE.BufferGeometry[],
  profile: readonly Vec2[],
  segs: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  closed = true,
): void {
  const raw = lathe(profile, segs, closed);
  const tagged = makePainted(raw, color);
  raw.dispose();
  if (x !== 0 || y !== 0 || z !== 0) {
    const moved = transform(tagged, x, y, z, 0);
    tagged.dispose();
    out.push(moved);
  } else {
    out.push(tagged);
  }
}

function addRotatedMesh(
  out: THREE.BufferGeometry[],
  raw: THREE.BufferGeometry,
  color: number,
  rx: number,
  ry: number,
  rz: number,
  tx = 0,
  ty = 0,
  tz = 0,
): void {
  const nonIdx = raw.index ? raw.toNonIndexed() : raw.clone();
  if (rx !== 0 || ry !== 0 || rz !== 0) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    nonIdx.applyMatrix4(m);
  }
  if (tx !== 0 || ty !== 0 || tz !== 0) {
    nonIdx.translate(tx, ty, tz);
  }
  const tagged = makePainted(nonIdx, color);
  nonIdx.dispose();
  out.push(tagged);
}

/**
 * Generates a strut/beam connecting two 3D points (ax,ay,az) -> (bx,by,bz).
 */
function addStrut(
  out: THREE.BufferGeometry[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  thickness: number,
  color: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const raw = bevelBox(thickness, len, thickness, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5),
    q,
    new THREE.Vector3(1, 1, 1),
  );
  raw.applyMatrix4(m);
  const tagged = makePainted(raw, color);
  raw.dispose();
  out.push(tagged);
}

/**
 * Concave bandshell quarter/half-dome sail shell opening toward +Z, centred inside [-w/2,w/2] x [-h/2,h/2] x [-d/2,d/2].
 */
function buildBandshell(w: number, h: number, d: number, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const rxOut = w * 0.5;
  const ryOut = h;
  const rzOut = d * 0.5;
  const thick = Math.min(0.4, Math.min(w, h, d) * 0.08);
  const rxIn = Math.max(0.1, rxOut - thick);
  const ryIn = Math.max(0.1, ryOut - thick);
  const rzIn = Math.max(0.1, rzOut - thick);

  const uSegs = lod === 1 ? 6 : 12;
  const vSegs = lod === 1 ? 4 : 8;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const cWall = new THREE.Color(palette.wall);
  const cAccent = new THREE.Color(palette.wallAccent);

  const pt = (u: number, v: number, rx: number, ry: number, rz: number): [number, number, number] => {
    const theta = (u - 0.5) * Math.PI; // -pi/2 .. +pi/2 -> back is -Z
    const phi = v * Math.PI * 0.5;      // 0 at base, pi/2 at crown
    const cp = Math.cos(phi);
    return [
      Math.sin(theta) * cp * rx,
      -h * 0.5 + Math.sin(phi) * ry,
      rz * 0.5 - Math.cos(theta) * cp * rz * 1.45,
    ];
  };

  // Clamp Z inside [-d/2, d/2]
  const clampPt = (p: [number, number, number]): [number, number, number] => [
    Math.max(-w * 0.5, Math.min(w * 0.5, p[0])),
    Math.max(-h * 0.5, Math.min(h * 0.5, p[1])),
    Math.max(-d * 0.5, Math.min(d * 0.5, p[2])),
  ];

  const pushTri = (a: number[], b: number[], c: number[], color: THREE.Color, flip = false): void => {
    const p1 = flip ? c : b;
    const p2 = flip ? b : c;
    pos.push(a[0], a[1], a[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    col.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
    uv.push(a[0], a[1], p1[0], p1[1], p2[0], p2[1]);
  };

  for (let i = 0; i < uSegs; i++) {
    const u0 = i / uSegs;
    const u1 = (i + 1) / uSegs;
    const stripCol = lod === 0 && i % 2 === 1 ? cAccent : cWall;
    for (let j = 0; j < vSegs; j++) {
      const v0 = j / vSegs;
      const v1 = (j + 1) / vSegs;
      // Outer shell
      const o00 = clampPt(pt(u0, v0, rxOut, ryOut, rzOut));
      const o10 = clampPt(pt(u1, v0, rxOut, ryOut, rzOut));
      const o11 = clampPt(pt(u1, v1, rxOut, ryOut, rzOut));
      const o01 = clampPt(pt(u0, v1, rxOut, ryOut, rzOut));
      pushTri(o00, o10, o11, cWall);
      pushTri(o00, o11, o01, cWall);
      // Inner shell
      const i00 = clampPt(pt(u0, v0, rxIn, ryIn, rzIn));
      const i10 = clampPt(pt(u1, v0, rxIn, ryIn, rzIn));
      const i11 = clampPt(pt(u1, v1, rxIn, ryIn, rzIn));
      const i01 = clampPt(pt(u0, v1, rxIn, ryIn, rzIn));
      pushTri(i00, i10, i11, stripCol, true);
      pushTri(i00, i11, i01, stripCol, true);
    }
    // Front lip rim connecting outer and inner at v=0..1? At v=0 (base), and at u=0 / u=1
    const oBase0 = clampPt(pt(u0, 0, rxOut, ryOut, rzOut));
    const oBase1 = clampPt(pt(u1, 0, rxOut, ryOut, rzOut));
    const iBase0 = clampPt(pt(u0, 0, rxIn, ryIn, rzIn));
    const iBase1 = clampPt(pt(u1, 0, rxIn, ryIn, rzIn));
    pushTri(oBase0, iBase0, iBase1, cAccent);
    pushTri(oBase0, iBase1, oBase1, cAccent);
  }

  // Side edges at u=0 and u=1
  for (let j = 0; j < vSegs; j++) {
    const v0 = j / vSegs;
    const v1 = (j + 1) / vSegs;
    const oL0 = clampPt(pt(0, v0, rxOut, ryOut, rzOut));
    const oL1 = clampPt(pt(0, v1, rxOut, ryOut, rzOut));
    const iL0 = clampPt(pt(0, v0, rxIn, ryIn, rzIn));
    const iL1 = clampPt(pt(0, v1, rxIn, ryIn, rzIn));
    pushTri(oL0, oL1, iL1, cAccent);
    pushTri(oL0, iL1, iL0, cAccent);

    const oR0 = clampPt(pt(1, v0, rxOut, ryOut, rzOut));
    const oR1 = clampPt(pt(1, v1, rxOut, ryOut, rzOut));
    const iR0 = clampPt(pt(1, v0, rxIn, ryIn, rzIn));
    const iR1 = clampPt(pt(1, v1, rxIn, ryIn, rzIn));
    pushTri(oR0, iR1, oR1, cAccent);
    pushTri(oR0, iR0, iR1, cAccent);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const tagged = tagSurface(g, SURFACE.building);
  g.dispose();
  out.push(tagged);
  return out;
}

/**
 * Half-cylinder barrel vault along X, centred in [-w/2,w/2] x [-h/2,h/2] x [-d/2,d/2].
 */
function buildHangarVault(w: number, h: number, d: number, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry[] {
  const segs = lod === 1 ? 8 : 16;
  const hz = d * 0.5;
  const hy = h * 0.5;
  const pts: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push({ x: Math.cos(a) * hz, y: -hy + Math.sin(a) * h });
  }
  const raw = extrudeProfile(pts, w, 0);
  const out: THREE.BufferGeometry[] = [];
  addRotatedMesh(out, raw, palette.roof, 0, Math.PI * 0.5, 0);
  raw.dispose();

  if (lod === 0) {
    const ribs = 4;
    for (let i = 0; i < ribs; i++) {
      const rx = -w * 0.36 + (i / (ribs - 1)) * (w * 0.72);
      const rib = extrudeProfile(pts, 0.25, 0);
      addRotatedMesh(out, rib, FIXED.metal, 0, Math.PI * 0.5, 0, rx, 0, 0);
      rib.dispose();
    }
  }
  return out;
}

export function landmarkPartGeometry(c: ComponentInstance, palette: BuildingPalette, lod: 0 | 1): THREE.BufferGeometry {
  const w = Math.max(0.05, Number.isFinite(c.w) ? c.w : 1);
  const h = Math.max(0.05, Number.isFinite(c.h) ? c.h : 1);
  const d = Math.max(0.05, Number.isFinite(c.d) ? c.d : 1);
  const pieces: THREE.BufferGeometry[] = [];
  const segs = lod === 1 ? 8 : 14;

  switch (c.variant) {
    case LANDMARK_PART.LIGHTHOUSE_TOWER: {
      const rBot = Math.min(w, d) * 0.5;
      const rTop = rBot * 0.62;
      const bands = lod === 1 ? 3 : 5;
      const bandH = h / bands;
      for (let i = 0; i < bands; i++) {
        const t0 = i / bands;
        const t1 = (i + 1) / bands;
        const y0 = -h * 0.5 + t0 * h;
        const y1 = -h * 0.5 + t1 * h;
        const r0 = rBot + (rTop - rBot) * t0;
        const r1 = rBot + (rTop - rBot) * t1;
        const color = i % 2 === 1 ? palette.wallAccent : palette.wall;
        addLathe(pieces, [{ x: r0, y: y0 }, { x: r1, y: y1 }], segs, color);
      }
      void bandH;
      break;
    }

    case LANDMARK_PART.LIGHTHOUSE_GALLERY: {
      const r = Math.min(w, d) * 0.5;
      const deckH = h * 0.35;
      addLathe(pieces, [{ x: r * 0.96, y: -h * 0.5 }, { x: r, y: -h * 0.5 + deckH }], segs, palette.trim);
      if (lod === 0) {
        const railR = r * 0.95;
        const railPosts = 8;
        for (let i = 0; i < railPosts; i++) {
          const a = (i / railPosts) * Math.PI * 2;
          addBox(pieces, 0.08, h * 0.65, 0.08, palette.trim, Math.cos(a) * railR, h * 0.17, Math.sin(a) * railR);
        }
        addLathe(pieces, [{ x: railR, y: h * 0.42 }, { x: railR, y: h * 0.5 }], segs, palette.trim, 0, 0, 0, false);
      }
      break;
    }

    case LANDMARK_PART.LIGHTHOUSE_LANTERN: {
      const r = Math.min(w, d) * 0.5;
      const glassTop = h * 0.08;
      addLathe(pieces, [{ x: r * 0.9, y: -h * 0.5 }, { x: r * 0.9, y: glassTop }], segs, FIXED.glass);
      addLathe(pieces, [{ x: r, y: glassTop }, { x: r * 0.65, y: h * 0.34 }, { x: 0.04, y: h * 0.5 }], segs, palette.roof);
      break;
    }

    case LANDMARK_PART.LIGHTHOUSE_BEACON: {
      const r = Math.min(w, d) * 0.5;
      addLathe(pieces, [{ x: r, y: -h * 0.5 }, { x: r, y: h * 0.5 }], lod === 1 ? 6 : 10, palette.neon);
      break;
    }

    case LANDMARK_PART.TOWER_LEGS: {
      const legT = Math.min(0.28, Math.min(w, d) * 0.1);
      const bx = w * 0.5 - legT;
      const bz = d * 0.5 - legT;
      const tx = bx * 0.68;
      const tz = bz * 0.68;
      const yBot = -h * 0.5 + legT * 0.5;
      const yTop = h * 0.5 - legT * 0.5;
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [sx, sz] of corners) {
        addStrut(pieces, sx * bx, yBot, sz * bz, sx * tx, yTop, sz * tz, legT, FIXED.metal);
      }
      if (lod === 0) {
        const levels = 2;
        for (let lv = 1; lv <= levels; lv++) {
          const t = lv / (levels + 1);
          const y = -h * 0.5 + t * h;
          const lx = bx + (tx - bx) * t;
          const lz = bz + (tz - bz) * t;
          addBox(pieces, lx * 2, legT * 0.7, legT * 0.7, FIXED.metal, 0, y, lz);
          addBox(pieces, lx * 2, legT * 0.7, legT * 0.7, FIXED.metal, 0, y, -lz);
          addBox(pieces, legT * 0.7, legT * 0.7, lz * 2, FIXED.metal, lx, y, 0);
          addBox(pieces, legT * 0.7, legT * 0.7, lz * 2, FIXED.metal, -lx, y, 0);
        }
      }
      break;
    }

    case LANDMARK_PART.WATER_TANK_BOWL: {
      const r = Math.min(w, d) * 0.46;
      const bodyTop = h * 0.2;
      addLathe(pieces, [{ x: r, y: -h * 0.5 }, { x: r, y: bodyTop }], segs, palette.wall);
      addLathe(pieces, [{ x: r * 1.04, y: bodyTop }, { x: r * 0.7, y: h * 0.38 }, { x: 0.04, y: h * 0.5 }], segs, palette.roof);
      if (lod === 0) {
        addLathe(pieces, [{ x: r * 1.06, y: -h * 0.48 }, { x: r * 1.06, y: -h * 0.42 }], segs, palette.trim);
        addLathe(pieces, [{ x: r * 1.03, y: -h * 0.15 }, { x: r * 1.03, y: -h * 0.1 }], segs, palette.trim);
      }
      break;
    }

    case LANDMARK_PART.CLOCK_SHAFT: {
      addTapered(pieces, w, d, w * 0.86, d * 0.86, h, palette.wall);
      if (lod === 0) {
        addBox(pieces, w * 0.92, Math.min(0.45, h * 0.05), d * 0.92, palette.wallAccent, 0, h * 0.45, 0);
        addBox(pieces, w * 1.0, Math.min(0.6, h * 0.06), d * 1.0, palette.trim, 0, -h * 0.5 + Math.min(0.3, h * 0.03), 0);
      }
      break;
    }

    case LANDMARK_PART.CLOCK_FACE: {
      const r = Math.min(w, h) * 0.5;
      const rim = lathe([{ x: r, y: -d * 0.4 }, { x: r, y: d * 0.4 }], lod === 1 ? 10 : 14);
      addRotatedMesh(pieces, rim, palette.trim, Math.PI * 0.5, 0, 0);
      rim.dispose();

      const face = lathe([{ x: r * 0.86, y: -d * 0.45 }, { x: r * 0.86, y: d * 0.48 }], lod === 1 ? 10 : 14);
      addRotatedMesh(pieces, face, palette.sign, Math.PI * 0.5, 0, 0);
      face.dispose();

      // Hour ticks + hands (no numerals)
      const zTick = d * 0.46;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        addBox(pieces, r * 0.12, r * 0.24, 0.04, palette.trim, Math.sin(a) * r * 0.68, Math.cos(a) * r * 0.68, zTick, a);
      }
      addBox(pieces, r * 0.1, r * 0.52, 0.04, palette.trim, 0, r * 0.2, zTick);
      addBox(pieces, r * 0.4, r * 0.09, 0.04, palette.trim, r * 0.15, 0, zTick);
      break;
    }

    case LANDMARK_PART.CLOCK_SPIRE: {
      addTapered(pieces, w, d, 0.06, 0.06, h, palette.roof);
      break;
    }

    case LANDMARK_PART.CONTROL_SHAFT: {
      const r = Math.min(w, d) * 0.5;
      addLathe(
        pieces,
        [
          { x: r, y: -h * 0.5 },
          { x: r * 0.82, y: 0 },
          { x: r * 0.72, y: h * 0.42 },
          { x: r * 0.94, y: h * 0.5 },
        ],
        segs,
        palette.wall,
      );
      break;
    }

    case LANDMARK_PART.CONTROL_CAB: {
      const r = Math.min(w, d) * 0.5;
      addLathe(pieces, [{ x: r * 0.65, y: -h * 0.5 }, { x: r * 0.94, y: -h * 0.12 }], segs, palette.wall);
      addLathe(pieces, [{ x: r * 0.92, y: -h * 0.12 }, { x: r, y: h * 0.35 }], segs, FIXED.glass);
      addLathe(pieces, [{ x: r, y: h * 0.35 }, { x: r, y: h * 0.5 }], segs, palette.trim);
      break;
    }

    case LANDMARK_PART.CONTROL_ROOF: {
      const r = Math.min(w, d) * 0.5;
      addLathe(pieces, [{ x: r, y: -h * 0.5 }, { x: r * 0.92, y: h * 0.15 }], segs, palette.roof);
      addLathe(pieces, [{ x: r * 0.35, y: h * 0.15 }, { x: r * 0.25, y: h * 0.5 }], Math.max(6, segs - 2), FIXED.metal);
      break;
    }

    case LANDMARK_PART.MAST_LATTICE: {
      const legT = Math.min(0.18, Math.min(w, d) * 0.08);
      const bx = w * 0.5 - legT;
      const bz = d * 0.5 - legT;
      const tx = bx * 0.18;
      const tz = bz * 0.18;
      const yBot = -h * 0.5 + legT * 0.5;
      const yTop = h * 0.5 - legT * 0.5;
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [sx, sz] of corners) {
        addStrut(pieces, sx * bx, yBot, sz * bz, sx * tx, yTop, sz * tz, legT, FIXED.metal);
      }
      const rings = lod === 1 ? 2 : 5;
      for (let i = 1; i <= rings; i++) {
        const t = i / (rings + 1);
        const y = -h * 0.5 + t * h;
        const lx = bx + (tx - bx) * t;
        const lz = bz + (tz - bz) * t;
        const col = i === rings ? palette.wallAccent : FIXED.metal;
        addBox(pieces, lx * 2, legT * 0.7, legT * 0.7, col, 0, y, lz);
        addBox(pieces, lx * 2, legT * 0.7, legT * 0.7, col, 0, y, -lz);
        addBox(pieces, legT * 0.7, legT * 0.7, lz * 2, col, lx, y, 0);
        addBox(pieces, legT * 0.7, legT * 0.7, lz * 2, col, -lx, y, 0);
      }
      break;
    }

    case LANDMARK_PART.MAST_BEACON: {
      const poleW = Math.min(w, d) * 0.25;
      addBox(pieces, poleW, h * 0.75, poleW, FIXED.metal, 0, -h * 0.125, 0);
      const bulbR = Math.min(w, d) * 0.45;
      addLathe(
        pieces,
        [{ x: 0.01, y: h * 0.22 }, { x: bulbR, y: h * 0.36 }, { x: 0.01, y: h * 0.5 }],
        lod === 1 ? 6 : 8,
        palette.neon,
      );
      break;
    }

    case LANDMARK_PART.FOUNTAIN_BASIN: {
      const r = Math.min(w, d) * 0.5;
      addLathe(
        pieces,
        [
          { x: r * 0.92, y: -h * 0.5 },
          { x: r, y: -h * 0.1 },
          { x: r, y: h * 0.1 },
          { x: r * 0.85, y: h * 0.1 },
          { x: r * 0.85, y: -h * 0.2 },
          { x: r * 0.35, y: -h * 0.2 },
          { x: r * 0.28, y: h * 0.5 },
        ],
        segs,
        FIXED.concrete,
      );
      break;
    }

    case LANDMARK_PART.FOUNTAIN_WATER: {
      const r = Math.min(w, d) * 0.5;
      addLathe(pieces, [{ x: r, y: -h * 0.5 }, { x: r, y: h * 0.5 }], segs, FIXED.water);
      break;
    }

    case LANDMARK_PART.FOUNTAIN_JET: {
      const r = Math.min(w, d) * 0.5;
      addLathe(
        pieces,
        [
          { x: r * 0.28, y: -h * 0.5 },
          { x: r * 0.18, y: h * 0.3 },
          { x: r * 0.9, y: h * 0.5 },
        ],
        lod === 1 ? 6 : 10,
        FIXED.water,
      );
      break;
    }

    case LANDMARK_PART.BANDSHELL_SHELL: {
      pieces.push(...buildBandshell(w, h, d, palette, lod));
      break;
    }

    case LANDMARK_PART.WHEEL_RIM: {
      const R = Math.min(w, h) * 0.47;
      const tube = Math.max(0.08, Math.min(R * 0.06, d * 0.18));
      const torus = new THREE.TorusGeometry(R, tube, lod === 1 ? 5 : 6, lod === 1 ? 16 : 28);
      if (lod === 1) {
        addRotatedMesh(pieces, torus, palette.wallAccent, 0, 0, 0);
      } else {
        const zOff = Math.min(d * 0.32, Math.max(0, d * 0.5 - tube));
        addRotatedMesh(pieces, torus, palette.wallAccent, 0, 0, 0, 0, 0, zOff);
        addRotatedMesh(pieces, torus, palette.wallAccent, 0, 0, 0, 0, 0, -zOff);
      }
      torus.dispose();
      break;
    }

    case LANDMARK_PART.WHEEL_SPOKES: {
      const R = Math.min(w, h) * 0.5;
      const spokes = 12;
      const thick = Math.max(0.06, R * 0.015);
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        addStrut(pieces, 0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, 0, thick, FIXED.metal);
      }
      break;
    }

    case LANDMARK_PART.WHEEL_HUB: {
      const r = Math.min(w, h) * 0.5;
      const cyl = lathe([{ x: r, y: -d * 0.5 }, { x: r, y: d * 0.5 }], lod === 1 ? 8 : 12);
      addRotatedMesh(pieces, cyl, palette.trim, Math.PI * 0.5, 0, 0);
      cyl.dispose();
      break;
    }

    case LANDMARK_PART.WHEEL_SUPPORT: {
      const legT = Math.min(0.32, Math.min(w, d) * 0.14);
      const bx = w * 0.5 - legT;
      const bz = d * 0.5 - legT;
      const yBot = -h * 0.5 + legT * 0.5;
      const yTop = h * 0.5 - legT * 0.5;
      addStrut(pieces, -bx, yBot, bz, 0, yTop, bz * 0.35, legT, FIXED.metal);
      addStrut(pieces, bx, yBot, bz, 0, yTop, bz * 0.35, legT, FIXED.metal);
      addStrut(pieces, -bx, yBot, -bz, 0, yTop, -bz * 0.35, legT, FIXED.metal);
      addStrut(pieces, bx, yBot, -bz, 0, yTop, -bz * 0.35, legT, FIXED.metal);
      break;
    }

    case LANDMARK_PART.WHEEL_GONDOLA: {
      const R = Math.min(w, h) * 0.45;
      const gw = Math.min(0.9, R * 0.16);
      const gh = Math.min(0.9, R * 0.16);
      const gd = Math.min(d * 0.85, 1.3);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const gx = Math.cos(a) * R;
        const gy = Math.sin(a) * R;
        addBox(pieces, gw, gh * 0.65, gd, palette.wall, gx, gy - gh * 0.15, 0);
        addBox(pieces, gw * 1.04, gh * 0.2, gd * 1.04, palette.trim, gx, gy + gh * 0.32, 0);
      }
      break;
    }

    case LANDMARK_PART.DOME_DRUM: {
      const r = Math.min(w, d) * 0.49;
      addLathe(pieces, [{ x: r, y: -h * 0.5 }, { x: r, y: h * 0.5 }], segs, palette.wall);
      if (lod === 0) {
        addLathe(pieces, [{ x: r * 1.02, y: h * 0.38 }, { x: r * 1.02, y: h * 0.5 }], segs, palette.trim);
      }
      break;
    }

    case LANDMARK_PART.DOME_SHELL: {
      const r = Math.min(w, d) * 0.5;
      const steps = lod === 1 ? 4 : 7;
      const prof: Vec2[] = [];
      for (let i = 0; i <= steps; i++) {
        const phi = (i / steps) * Math.PI * 0.5;
        prof.push({ x: Math.cos(phi) * r, y: -h * 0.5 + Math.sin(phi) * h });
      }
      addLathe(pieces, prof, segs, palette.roof);
      break;
    }

    case LANDMARK_PART.DOME_RIBS: {
      const r = Math.min(w, d) * 0.5;
      const ribs = 8;
      for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * Math.PI * 2;
        const x1 = Math.cos(a) * r * 0.92;
        const z1 = Math.sin(a) * r * 0.92;
        const x2 = Math.cos(a) * r * 0.55;
        const z2 = Math.sin(a) * r * 0.55;
        addStrut(pieces, x1, -h * 0.46, z1, x2, h * 0.25, z2, 0.14, palette.trim);
        addStrut(pieces, x2, h * 0.25, z2, 0, h * 0.46, 0, 0.14, palette.trim);
      }
      break;
    }

    case LANDMARK_PART.DOME_SLIT: {
      addBox(pieces, w, h, d, FIXED.glassDark, 0, 0, 0, 0, 0.04);
      break;
    }

    case LANDMARK_PART.GLASS_SHAFT: {
      addTapered(pieces, w, d, w * 0.9, d * 0.9, h, FIXED.glass);
      if (lod === 0) {
        const tiers = 5;
        for (let i = 1; i < tiers; i++) {
          const t = i / tiers;
          const y = -h * 0.5 + t * h;
          const s = 1 - 0.1 * t;
          addBox(pieces, w * s + 0.04, 0.18, d * s + 0.04, FIXED.glassDark, 0, y, 0);
        }
        for (const sx of [-0.25, 0.25]) {
          addBox(pieces, 0.16, h, d * 0.96, palette.trim, w * sx, 0, 0);
        }
        for (const sz of [-0.25, 0.25]) {
          addBox(pieces, w * 0.96, h, 0.16, palette.trim, 0, 0, d * sz);
        }
      }
      break;
    }

    case LANDMARK_PART.GLASS_CROWN: {
      addBox(pieces, w, h * 0.36, d, palette.trim, 0, -h * 0.32, 0);
      addBox(pieces, w * 0.72, h * 0.32, d * 0.72, FIXED.glass, 0, 0.02 * h, 0);
      addTapered(pieces, 0.22, 0.22, 0.05, 0.05, h * 0.34, FIXED.metal, 0, h * 0.33, 0);
      break;
    }

    case LANDMARK_PART.ARCH_SPAN: {
      const raw = arch(w, h, d, lod === 1 ? 6 : 12);
      pieces.push(makePainted(raw, palette.neon));
      raw.dispose();
      break;
    }

    case LANDMARK_PART.ARCH_PYLON: {
      addBox(pieces, w, h, d, palette.wallAccent, 0, 0, 0, 0, Math.min(0.05, w * 0.1));
      break;
    }

    case LANDMARK_PART.HANGAR_VAULT: {
      pieces.push(...buildHangarVault(w, h, d, palette, lod));
      break;
    }

    case LANDMARK_PART.HANGAR_ENDS: {
      const segsEnd = lod === 1 ? 6 : 12;
      const hz = d * 0.5;
      const hy = h * 0.5;
      const pts: Vec2[] = [];
      for (let i = 0; i <= segsEnd; i++) {
        const a = (i / segsEnd) * Math.PI;
        pts.push({ x: Math.cos(a) * hz, y: -hy + Math.sin(a) * h });
      }
      const raw = extrudeProfile(pts, w, 0);
      addRotatedMesh(outRef(pieces), raw, palette.wall, 0, Math.PI * 0.5, 0);
      raw.dispose();
      break;
    }

    default: {
      addBox(pieces, w, h, d, palette.wallAccent);
      break;
    }
  }

  if (pieces.length === 0) {
    addBox(pieces, w, h, d, palette.wall);
  }
  const merged = mergeTagged(pieces);
  for (let i = 0; i < pieces.length; i++) pieces[i].dispose();
  return merged;
}

function outRef(arr: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  return arr;
}
