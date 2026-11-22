// [3D] Per-ComponentKind architectural geometry builders for VP2 buildings.
import * as THREE from 'three';
import { SURFACE } from '../materials/surfaceDetailMath';
import {
  bevelBox,
  lathe,
  mergeTagged,
  paint,
  tagSurface,
  taperedBox,
  transform,
  type Vec2,
} from '../geometry/meshUtils';
import type {
  BuildingPalette,
  ComponentInstance,
  ComponentKind,
  MaterialSlot,
} from './buildingTypes';
import { landmarkPartGeometry } from './LandmarkComponents';

export interface ComponentParts {
  opaque: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  emissive: THREE.BufferGeometry;
}

const FIXED_COLORS = {
  glass: 0x5e8fa8,
  glassDark: 0x263542,
  metal: 0x9aa3a8,
  wood: 0x9a6b45,
  concrete: 0xc9b99a,
  foliage: 0x4f8a3a,
  water: 0x2f8fa3,
  rubber: 0x2b2e33,
} as const;

const _tmpColor = new THREE.Color();

function darkenLinear(hex: number, factor: number): number {
  _tmpColor.setHex(hex);
  _tmpColor.multiplyScalar(factor);
  return _tmpColor.getHex();
}

function resolveColor(slot: MaterialSlot, palette: BuildingPalette): number {
  switch (slot) {
    case 'wall': return palette.wall;
    case 'wallAccent': return palette.wallAccent;
    case 'trim': return palette.trim;
    case 'roof': return palette.roof;
    case 'roofTile': return darkenLinear(palette.roof, 0.78);
    case 'awningA': return palette.awningA;
    case 'awningB': return palette.awningB;
    case 'sign': return palette.sign;
    case 'neon': return palette.neon;
    case 'glass': return FIXED_COLORS.glass;
    case 'glassDark': return FIXED_COLORS.glassDark;
    case 'metal': return FIXED_COLORS.metal;
    case 'wood': return FIXED_COLORS.wood;
    case 'concrete': return FIXED_COLORS.concrete;
    case 'foliage': return FIXED_COLORS.foliage;
    case 'water': return FIXED_COLORS.water;
  }
}

function emptyGeom(): THREE.BufferGeometry {
  return mergeTagged([]);
}

function makeBox(
  w: number,
  h: number,
  d: number,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
): THREE.BufferGeometry {
  const b = bevelBox(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d), 0, 1);
  const p = paint(b, color);
  b.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  if (x !== 0 || y !== 0 || z !== 0 || rotY !== 0) {
    const out = transform(t, x, y, z, rotY);
    t.dispose();
    return out;
  }
  return t;
}

function makeBevelBox(
  w: number,
  h: number,
  d: number,
  bevel: number,
  segments: number,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
): THREE.BufferGeometry {
  const b = bevelBox(Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d), bevel, segments);
  const p = paint(b, color);
  b.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  if (x !== 0 || y !== 0 || z !== 0 || rotY !== 0) {
    const out = transform(t, x, y, z, rotY);
    t.dispose();
    return out;
  }
  return t;
}

function makeTapered(
  wb: number,
  db: number,
  wt: number,
  dt: number,
  h: number,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
): THREE.BufferGeometry {
  const g = taperedBox(wb, db, wt, dt, Math.max(0.01, h));
  const p = paint(g, color);
  g.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  if (x !== 0 || y !== 0 || z !== 0 || rotY !== 0) {
    const out = transform(t, x, y, z, rotY);
    t.dispose();
    return out;
  }
  return t;
}

/** Single front-facing (+Z) quad for lightweight glass panes (2 tris). */
function makeFrontQuad(
  w: number,
  h: number,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const hw = Math.max(0.01, w) * 0.5;
  const hh = Math.max(0.01, h) * 0.5;
  const pos = new Float32Array([
    -hw + x, -hh + y, z,
    hw + x, -hh + y, z,
    hw + x, hh + y, z,
    -hw + x, -hh + y, z,
    hw + x, hh + y, z,
    -hw + x, hh + y, z,
  ]);
  const norm = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const uv = new Float32Array([
    0, 0, w, 0, w, h,
    0, 0, w, h, 0, h,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const p = paint(g, color);
  g.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  return t;
}

/** 4-sided bar without end caps (8 tris) for tucked window frames/mullions. */
function makeOpenBar(
  w: number,
  h: number,
  d: number,
  capAxis: 'x' | 'y',
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const hx = Math.max(0.005, w) * 0.5;
  const hy = Math.max(0.005, h) * 0.5;
  const hz = Math.max(0.005, d) * 0.5;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const addQuad = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    dx: number, dy: number, dz: number, du: number, dv: number,
    nx: number, ny: number, nz: number,
  ): void => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uv.push(au, av, bu, bv, cu, cv, au, av, cu, cv, du, dv);
  };
  // +Z & -Z
  addQuad(-hx + x, -hy + y, hz + z, 0, 0, hx + x, -hy + y, hz + z, w, 0, hx + x, hy + y, hz + z, w, h, -hx + x, hy + y, hz + z, 0, h, 0, 0, 1);
  addQuad(hx + x, -hy + y, -hz + z, 0, 0, -hx + x, -hy + y, -hz + z, w, 0, -hx + x, hy + y, -hz + z, w, h, hx + x, hy + y, -hz + z, 0, h, 0, 0, -1);
  if (capAxis === 'y') {
    // +X & -X (skip +Y/-Y caps)
    addQuad(hx + x, -hy + y, hz + z, 0, 0, hx + x, -hy + y, -hz + z, d, 0, hx + x, hy + y, -hz + z, d, h, hx + x, hy + y, hz + z, 0, h, 1, 0, 0);
    addQuad(-hx + x, -hy + y, -hz + z, 0, 0, -hx + x, -hy + y, hz + z, d, 0, -hx + x, hy + y, hz + z, d, h, -hx + x, hy + y, -hz + z, 0, h, -1, 0, 0);
  } else {
    // +Y & -Y (skip +X/-X caps)
    addQuad(-hx + x, hy + y, hz + z, 0, 0, hx + x, hy + y, hz + z, w, 0, hx + x, hy + y, -hz + z, w, d, -hx + x, hy + y, -hz + z, 0, d, 0, 1, 0);
    addQuad(-hx + x, -hy + y, -hz + z, 0, 0, hx + x, -hy + y, -hz + z, w, 0, hx + x, -hy + y, hz + z, w, d, -hx + x, -hy + y, hz + z, 0, d, 0, -1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const p = paint(g, color);
  g.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  return t;
}

/** Quarter-cylinder in (+X, +Z) quadrant centred on origin, smooth curved normals. */
function makeQuarterCylinder(
  w: number,
  h: number,
  d: number,
  segs: number,
  color: number,
  surface: number,
): THREE.BufferGeometry {
  const rx = Math.max(0.05, w);
  const rz = Math.max(0.05, d);
  const hy = Math.max(0.01, h) * 0.5;
  const ox = -rx * 0.5;
  const oz = -rz * 0.5;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const n = Math.max(2, segs);

  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 0.5;
    const a1 = ((i + 1) / n) * Math.PI * 0.5;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const x0 = ox + rx * c0;
    const z0 = oz + rz * s0;
    const x1 = ox + rx * c1;
    const z1 = oz + rz * s1;
    const nx0 = c0;
    const nz0 = s0;
    const nx1 = c1;
    const nz1 = s1;
    const u0 = (i / n) * rx;
    const u1 = ((i + 1) / n) * rx;

    // Curved outer wall
    pos.push(
      x0, -hy, z0, x1, -hy, z1, x1, hy, z1,
      x0, -hy, z0, x1, hy, z1, x0, hy, z0,
    );
    norm.push(
      nx0, 0, nz0, nx1, 0, nz1, nx1, 0, nz1,
      nx0, 0, nz0, nx1, 0, nz1, nx0, 0, nz0,
    );
    uv.push(u0, 0, u1, 0, u1, h, u0, 0, u1, h, u0, h);

    // Top cap (+Y)
    pos.push(ox, hy, oz, x1, hy, z1, x0, hy, z0);
    norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    uv.push(0, 0, x1 - ox, z1 - oz, x0 - ox, z0 - oz);

    // Bottom cap (-Y)
    pos.push(ox, -hy, oz, x0, -hy, z0, x1, -hy, z1);
    norm.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    uv.push(0, 0, x0 - ox, z0 - oz, x1 - ox, z1 - oz);
  }

  // Two flat back faces (-Z and -X)
  pos.push(
    ox, -hy, oz, ox + rx, -hy, oz, ox + rx, hy, oz,
    ox, -hy, oz, ox + rx, hy, oz, ox, hy, oz,
    ox, -hy, oz, ox, hy, oz + rz, ox, -hy, oz + rz,
    ox, -hy, oz, ox, hy, oz, ox, hy, oz + rz,
  );
  norm.push(
    0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, -1, 0, 0, -1, 0, 0, -1,
    -1, 0, 0, -1, 0, 0, -1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0,
  );
  uv.push(
    0, 0, rx, 0, rx, h, 0, 0, rx, h, 0, h,
    0, 0, rz, h, rz, 0, 0, 0, 0, h, rz, h,
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const p = paint(g, color);
  g.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  return t;
}

/** Triangular prism along Z (or X when w < d) for gable roofs. */
function makeGablePrism(
  w: number,
  h: number,
  d: number,
  color: number,
  surface: number,
): THREE.BufferGeometry {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const hd = d * 0.5;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  const addTri = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
  ): void => {
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uv.push(au, av, bu, bv, cu, cv);
  };

  // Front gable (+Z)
  addTri(-hw, -hh, hd, 0, 0, hw, -hh, hd, w, 0, 0, hh, hd, hw, h);
  // Back gable (-Z)
  addTri(hw, -hh, -hd, 0, 0, -hw, -hh, -hd, w, 0, 0, hh, -hd, hw, h);
  // Bottom (-Y)
  addTri(-hw, -hh, -hd, 0, 0, hw, -hh, -hd, w, 0, hw, -hh, hd, w, d);
  addTri(-hw, -hh, -hd, 0, 0, hw, -hh, hd, w, d, -hw, -hh, hd, 0, d);
  // Right slope (+X)
  addTri(hw, -hh, hd, 0, 0, hw, -hh, -hd, d, 0, 0, hh, -hd, d, h);
  addTri(hw, -hh, hd, 0, 0, 0, hh, -hd, d, h, 0, hh, hd, 0, h);
  // Left slope (-X)
  addTri(-hw, -hh, -hd, 0, 0, -hw, -hh, hd, d, 0, 0, hh, hd, d, h);
  addTri(-hw, -hh, -hd, 0, 0, 0, hh, hd, d, h, 0, hh, -hd, 0, h);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const p = paint(g, color);
  g.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  return t;
}

function makeLathe(
  profile: readonly Vec2[],
  segs: number,
  color: number,
  surface: number,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
  closed = true,
): THREE.BufferGeometry {
  const g = lathe(profile, segs, closed);
  const p = paint(g, color);
  g.dispose();
  const t = tagSurface(p, surface);
  p.dispose();
  if (x !== 0 || y !== 0 || z !== 0 || rotY !== 0) {
    const out = transform(t, x, y, z, rotY);
    t.dispose();
    return out;
  }
  return t;
}

function makeRailing(
  w: number,
  h: number,
  d: number,
  lod: 0 | 1,
  color: number,
  list: THREE.BufferGeometry[],
): void {
  if (lod === 1) {
    list.push(makeBox(w, h, Math.min(d, 0.08), color, SURFACE.none));
    return;
  }
  const railH = 0.05;
  const railD = Math.min(d, 0.06);
  // Top & bottom rails
  list.push(makeBox(w, railH, railD, color, SURFACE.none, 0, h * 0.5 - railH * 0.5, 0));
  list.push(makeBox(w, railH * 0.8, railD * 0.8, color, SURFACE.none, 0, -h * 0.5 + railH * 0.5, 0));
  // Posts & balusters
  const count = Math.max(2, Math.min(10, Math.round(w / 0.35) + 1));
  const postW = 0.04;
  for (let i = 0; i < count; i++) {
    const px = count === 1 ? 0 : -w * 0.5 + postW * 0.5 + (i / (count - 1)) * (w - postW);
    list.push(makeBox(postW, h, postW, color, SURFACE.none, px, 0, 0));
  }
}

function mergeAndDispose(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 0) return emptyGeom();
  const out = mergeTagged(list);
  for (let i = 0; i < list.length; i++) {
    list[i].dispose();
  }
  return out;
}

/**
 * Builds local-space { opaque, glass, emissive } geometry for a single ComponentInstance.
 * Exhaustive over every ComponentKind.
 */
export function componentParts(
  c: ComponentInstance,
  palette: BuildingPalette,
  lod: 0 | 1,
): ComponentParts {
  const opaque: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const emissive: THREE.BufferGeometry[] = [];

  const mainColor = resolveColor(c.material, palette);
  const trimColor = palette.trim;
  const metalColor = FIXED_COLORS.metal;
  const concreteColor = FIXED_COLORS.concrete;
  const woodColor = FIXED_COLORS.wood;
  const w = Math.max(0.02, c.w);
  const h = Math.max(0.02, c.h);
  const d = Math.max(0.02, c.d);

  const kind: ComponentKind = c.kind;
  switch (kind) {
    case 'foundation': {
      const capH = Math.min(0.08, h * 0.25);
      const bodyH = Math.max(0.01, h - capH);
      opaque.push(makeBox(w, bodyH, d, mainColor, SURFACE.concrete, 0, -capH * 0.5, 0));
      opaque.push(makeTapered(w + 0.06, d + 0.06, w, d, capH, mainColor, SURFACE.concrete, 0, bodyH * 0.5, 0));
      break;
    }

    case 'wallPanel': {
      opaque.push(makeBox(w, h, d, mainColor, SURFACE.building));
      if (lod === 0 && w > 0.4 && h > 0.4) {
        const rimT = 0.06;
        const rimD = 0.03;
        const rz = d * 0.5 + rimD * 0.4;
        opaque.push(makeBox(w * 0.8, rimT, rimD, trimColor, SURFACE.none, 0, h * 0.35, rz));
        opaque.push(makeBox(w * 0.8, rimT, rimD, trimColor, SURFACE.none, 0, -h * 0.35, rz));
      }
      break;
    }

    case 'cornerColumn': {
      const capH = Math.min(0.18, h * 0.12);
      const shaftH = Math.max(0.02, h - capH * 2);
      opaque.push(makeBevelBox(w, shaftH, d, Math.min(0.04, w * 0.15), lod === 0 ? 1 : 1, mainColor, SURFACE.building));
      opaque.push(makeBox(w + 0.06, capH, d + 0.06, trimColor, SURFACE.none, 0, -h * 0.5 + capH * 0.5, 0));
      opaque.push(makeBox(w + 0.06, capH, d + 0.06, trimColor, SURFACE.none, 0, h * 0.5 - capH * 0.5, 0));
      break;
    }

    case 'roundedCorner': {
      opaque.push(makeQuarterCylinder(w, h, d, lod === 0 ? 6 : 3, mainColor, SURFACE.building));
      break;
    }

    case 'floorBand': {
      const lipH = Math.min(h * 0.4, 0.12);
      opaque.push(makeBox(w, h, d, trimColor, SURFACE.none));
      if (lod === 0 && d > 0.06) {
        opaque.push(makeBox(w + 0.04, lipH, d + 0.06, trimColor, SURFACE.none, 0, h * 0.5 - lipH * 0.5, 0.02));
      }
      break;
    }

    case 'parapet': {
      const capH = Math.min(0.14, h * 0.3);
      const wallH = Math.max(0.02, h - capH);
      opaque.push(makeBox(w, wallH, d, mainColor, SURFACE.building, 0, -capH * 0.5, 0));
      opaque.push(makeBox(w + 0.06, capH, d + 0.08, trimColor, SURFACE.none, 0, h * 0.5 - capH * 0.5, 0));
      break;
    }

    case 'flatRoof': {
      const lipH = Math.min(0.1, h * 0.35);
      opaque.push(makeBevelBox(w, h, d, Math.min(0.04, h * 0.25), 1, mainColor, SURFACE.building));
      if (lod === 0) {
        opaque.push(makeBox(w + 0.06, lipH, d + 0.06, trimColor, SURFACE.none, 0, h * 0.5 - lipH * 0.5, 0));
      }
      break;
    }

    case 'hipRoof': {
      const eaveH = Math.min(0.12, h * 0.2);
      const slopeH = Math.max(0.02, h - eaveH);
      const wt = Math.max(0.15, w - Math.min(w, d) * 0.6);
      const dt = Math.max(0.15, d - Math.min(w, d) * 0.6);
      opaque.push(makeBox(w, eaveH, d, trimColor, SURFACE.none, 0, -h * 0.5 + eaveH * 0.5, 0));
      opaque.push(makeTapered(w, d, wt, dt, slopeH, mainColor, SURFACE.building, 0, eaveH * 0.5, 0));
      break;
    }

    case 'gableRoof': {
      const eaveH = Math.min(0.12, h * 0.18);
      const prismH = Math.max(0.02, h - eaveH);
      opaque.push(makeBox(w, eaveH, d, trimColor, SURFACE.none, 0, -h * 0.5 + eaveH * 0.5, 0));
      opaque.push(transform(makeGablePrism(w, prismH, d, mainColor, SURFACE.building), 0, eaveH * 0.5, 0, 0));
      break;
    }

    case 'tileRoof': {
      const baseH = Math.min(0.16, h * 0.3);
      const slopeH = Math.max(0.02, h - baseH);
      const wt = Math.max(0.2, w * 0.25);
      const dt = Math.max(0.2, d * 0.25);
      opaque.push(makeTapered(w, d, wt, dt, slopeH, mainColor, SURFACE.building, 0, baseH * 0.5, 0));
      opaque.push(makeBox(w + 0.08, baseH, d + 0.08, trimColor, SURFACE.none, 0, -h * 0.5 + baseH * 0.5, 0));
      if (lod === 0) {
        const ribCount = Math.min(5, Math.max(2, Math.floor(slopeH / 0.35)));
        for (let i = 0; i < ribCount; i++) {
          const frac = (i + 0.5) / ribCount;
          const rw = w * (1 - frac * 0.72);
          const rd = d * (1 - frac * 0.72);
          const ry = -h * 0.5 + baseH + frac * slopeH;
          opaque.push(makeBox(rw, 0.05, rd, mainColor, SURFACE.building, 0, ry, 0));
        }
      }
      break;
    }

    case 'steppedRoof': {
      const tiers = lod === 0 ? 3 : 2;
      const tierH = h / tiers;
      for (let i = 0; i < tiers; i++) {
        const scale = 1 - i * (0.55 / tiers);
        const y = -h * 0.5 + (i + 0.5) * tierH;
        opaque.push(makeBox(w * scale, tierH, d * scale, mainColor, SURFACE.building, 0, y, 0));
        if (lod === 0) {
          opaque.push(makeBox(w * scale + 0.06, 0.06, d * scale + 0.06, trimColor, SURFACE.none, 0, y + tierH * 0.5 - 0.03, 0));
        }
      }
      break;
    }

    case 'column': {
      const capH = Math.min(0.16, h * 0.12);
      const shaftH = Math.max(0.02, h - capH * 2);
      const r = Math.min(w, d) * 0.42;
      if (c.variant % 2 === 0) {
        const segs = lod === 0 ? 8 : 6;
        opaque.push(makeLathe([{ x: r, y: -shaftH * 0.5 }, { x: r * 0.92, y: shaftH * 0.5 }], segs, mainColor, SURFACE.building));
      } else {
        opaque.push(makeBevelBox(w * 0.85, shaftH, d * 0.85, Math.min(0.03, r * 0.2), 1, mainColor, SURFACE.building));
      }
      opaque.push(makeBox(w, capH, d, trimColor, SURFACE.none, 0, -h * 0.5 + capH * 0.5, 0));
      opaque.push(makeBox(w, capH, d, trimColor, SURFACE.none, 0, h * 0.5 - capH * 0.5, 0));
      break;
    }

    case 'balcony': {
      const slabH = Math.min(0.18, h * 0.2);
      const railH = Math.max(0.2, h - slabH);
      opaque.push(makeBevelBox(w, slabH, d, 0.03, 1, concreteColor, SURFACE.concrete, 0, -h * 0.5 + slabH * 0.5, 0));
      const railParts: THREE.BufferGeometry[] = [];
      makeRailing(w, railH, 0.06, lod, metalColor, railParts);
      for (const rp of railParts) {
        opaque.push(transform(rp, 0, -h * 0.5 + slabH + railH * 0.5, d * 0.5 - 0.04, 0));
        rp.dispose();
      }
      if (lod === 0) {
        const sideParts: THREE.BufferGeometry[] = [];
        makeRailing(d, railH, 0.06, 1, metalColor, sideParts);
        for (const sp of sideParts) {
          opaque.push(transform(sp, -w * 0.5 + 0.04, -h * 0.5 + slabH + railH * 0.5, 0, Math.PI * 0.5));
          opaque.push(transform(sp, w * 0.5 - 0.04, -h * 0.5 + slabH + railH * 0.5, 0, Math.PI * 0.5));
          sp.dispose();
        }
      }
      break;
    }

    case 'stair': {
      const steps = lod === 0 ? Math.min(6, Math.max(2, Math.round(h / 0.22))) : 2;
      const stepH = h / steps;
      const stepD = d / steps;
      for (let i = 0; i < steps; i++) {
        const sh = stepH * (i + 1);
        const sz = -d * 0.5 + stepD * (i + 0.5);
        opaque.push(makeBox(w * 0.88, sh, stepD, concreteColor, SURFACE.concrete, 0, -h * 0.5 + sh * 0.5, sz));
      }
      if (lod === 0) {
        opaque.push(makeBox(0.06, h, d, trimColor, SURFACE.concrete, -w * 0.47, 0, 0));
        opaque.push(makeBox(0.06, h, d, trimColor, SURFACE.concrete, w * 0.47, 0, 0));
      }
      break;
    }

    case 'exteriorCorridor': {
      const slabH = Math.min(0.2, h * 0.2);
      const railH = Math.max(0.2, h - slabH);
      opaque.push(makeBox(w, slabH, d, concreteColor, SURFACE.concrete, 0, -h * 0.5 + slabH * 0.5, 0));
      const railParts: THREE.BufferGeometry[] = [];
      makeRailing(w, railH, 0.06, lod, metalColor, railParts);
      for (const rp of railParts) {
        opaque.push(transform(rp, 0, -h * 0.5 + slabH + railH * 0.5, d * 0.5 - 0.04, 0));
        rp.dispose();
      }
      break;
    }

    case 'overhang': {
      const fasciaH = Math.min(0.12, h * 0.4);
      opaque.push(makeBox(w, h, d, mainColor, SURFACE.concrete));
      opaque.push(makeBox(w + 0.04, fasciaH, 0.06, trimColor, SURFACE.none, 0, 0, d * 0.5));
      break;
    }

    case 'canopy': {
      const roofH = Math.min(0.45, h * 0.16);
      const postH = Math.max(0.2, h - roofH);
      if (lod === 1) {
        opaque.push(makeBox(w, roofH, d, mainColor, SURFACE.building, 0, h * 0.5 - roofH * 0.5, 0));
      } else {
        opaque.push(makeBevelBox(w, roofH, d, 0.04, 1, mainColor, SURFACE.building, 0, h * 0.5 - roofH * 0.5, 0));
        opaque.push(makeBox(w + 0.06, roofH * 0.35, d + 0.06, trimColor, SURFACE.none, 0, h * 0.5 - roofH * 0.25, 0));
      }
      const postCount = w > 5 ? 4 : 2;
      const postSize = 0.22;
      for (let i = 0; i < postCount; i++) {
        const px = postCount === 2 ? (i === 0 ? -w * 0.35 : w * 0.35) : -w * 0.38 + (i / (postCount - 1)) * w * 0.76;
        opaque.push(makeBox(postSize, postH, postSize, metalColor, SURFACE.none, px, -roofH * 0.5, 0));
      }
      break;
    }

    case 'awning': {
      if (lod === 1) {
        opaque.push(makeTapered(w, d, w, d * 0.35, h, palette.awningA, SURFACE.none));
      } else {
        const stripes = Math.min(10, Math.max(2, Math.round(w / 0.6)));
        const sw = w / stripes;
        const valanceH = Math.min(0.14, h * 0.28);
        for (let i = 0; i < stripes; i++) {
          const sx = -w * 0.5 + (i + 0.5) * sw;
          const col = (i + c.variant) % 2 === 0 ? palette.awningA : palette.awningB;
          opaque.push(makeTapered(sw, d, sw, d * 0.3, h - valanceH * 0.5, col, SURFACE.none, sx, valanceH * 0.25, 0));
          opaque.push(makeBox(sw, valanceH, 0.05, col, SURFACE.none, sx, -h * 0.5 + valanceH * 0.5, d * 0.5 - 0.025));
        }
      }
      break;
    }

    case 'terrace': {
      const deckH = Math.max(0.04, h * 0.6);
      const curbH = Math.max(0.04, h - deckH);
      opaque.push(makeBox(w, deckH, d, concreteColor, SURFACE.concrete, 0, -curbH * 0.5, 0));
      if (lod === 0) {
        const rim = 0.14;
        opaque.push(makeBox(w, curbH, rim, trimColor, SURFACE.concrete, 0, deckH * 0.5, d * 0.5 - rim * 0.5));
        opaque.push(makeBox(rim, curbH, d, trimColor, SURFACE.concrete, -w * 0.5 + rim * 0.5, deckH * 0.5, 0));
        opaque.push(makeBox(rim, curbH, d, trimColor, SURFACE.concrete, w * 0.5 - rim * 0.5, deckH * 0.5, 0));
      }
      break;
    }

    case 'porch': {
      const deckH = Math.min(0.28, h * 0.14);
      const postH = Math.max(0.3, h - deckH);
      opaque.push(makeBox(w, deckH, d, concreteColor, SURFACE.concrete, 0, -h * 0.5 + deckH * 0.5, 0));
      const postCount = w > 3.5 ? 4 : 2;
      for (let i = 0; i < postCount; i++) {
        const px = -w * 0.44 + (i / (postCount - 1)) * w * 0.88;
        opaque.push(makeBox(0.12, postH, 0.12, woodColor, SURFACE.none, px, deckH * 0.5, d * 0.5 - 0.1));
      }
      if (lod === 0) {
        opaque.push(makeBox(w * 0.4, deckH * 0.5, 0.35, concreteColor, SURFACE.concrete, 0, -h * 0.5 + deckH * 0.25, d * 0.5 + 0.18));
        opaque.push(makeBox(w * 0.28, 0.06, 0.06, woodColor, SURFACE.none, -w * 0.34, -h * 0.5 + deckH + 0.45, d * 0.5 - 0.1));
        opaque.push(makeBox(w * 0.28, 0.06, 0.06, woodColor, SURFACE.none, w * 0.34, -h * 0.5 + deckH + 0.45, d * 0.5 - 0.1));
      }
      break;
    }

    case 'window': {
      const isLit = c.material === 'neon';
      const glassBucket = isLit ? emissive : glass;
      const paneColor = isLit ? palette.neon : FIXED_COLORS.glass;
      const recessZ = -Math.min(0.1, d * 0.35);

      if (lod === 1) {
        glassBucket.push(makeFrontQuad(w * 0.88, h * 0.88, paneColor, SURFACE.none, 0, 0, 0.02));
        opaque.push(makeBox(w, h, Math.max(0.04, d * 0.5), trimColor, SURFACE.none, 0, 0, -0.02));
      } else {
        const fw = Math.min(0.08, w * 0.12);
        const fh = Math.min(0.08, h * 0.12);
        const fd = Math.max(0.06, d);
        // 4 frame bars (open-ended bars = 8 tris each = 32 tris)
        opaque.push(makeOpenBar(w, fh, fd, 'x', trimColor, SURFACE.none, 0, h * 0.5 - fh * 0.5, 0));
        opaque.push(makeOpenBar(w, fh, fd, 'x', trimColor, SURFACE.none, 0, -h * 0.5 + fh * 0.5, 0));
        opaque.push(makeOpenBar(fw, h - fh * 2, fd, 'y', trimColor, SURFACE.none, -w * 0.5 + fw * 0.5, 0, 0));
        opaque.push(makeOpenBar(fw, h - fh * 2, fd, 'y', trimColor, SURFACE.none, w * 0.5 - fw * 0.5, 0, 0));
        // Projecting sill (12 tris)
        opaque.push(makeBox(w + 0.1, fh * 1.1, fd + 0.1, trimColor, SURFACE.none, 0, -h * 0.5 - fh * 0.3, 0.05));
        // Recessed glass pane (2 tris)
        glassBucket.push(makeFrontQuad(w - fw * 1.8, h - fh * 1.8, paneColor, SURFACE.none, 0, 0, recessZ));
        // Central mullion (8 tris) -> total 54 tris <= 60
        opaque.push(makeOpenBar(fw * 0.55, h - fh * 2, fd * 0.5, 'y', trimColor, SURFACE.none, 0, 0, recessZ + 0.02));
      }
      break;
    }

    case 'storefront': {
      const kickH = Math.min(0.32, h * 0.16);
      const headH = Math.min(0.18, h * 0.1);
      const glassH = Math.max(0.2, h - kickH - headH);
      const recessZ = -Math.min(0.12, d * 0.35);
      opaque.push(makeBox(w, kickH, d, metalColor, SURFACE.none, 0, -h * 0.5 + kickH * 0.5, 0));
      opaque.push(makeBox(w, headH, d, trimColor, SURFACE.none, 0, h * 0.5 - headH * 0.5, 0));
      const glassBucket = c.material === 'neon' ? emissive : glass;
      const paneColor = c.material === 'neon' ? palette.neon : FIXED_COLORS.glass;
      glassBucket.push(makeFrontQuad(w - 0.1, glassH, paneColor, SURFACE.none, 0, (kickH - headH) * 0.5, recessZ));
      if (lod === 0) {
        const mullions = Math.min(6, Math.max(1, Math.floor(w / 1.4)));
        for (let i = 0; i <= mullions; i++) {
          const mx = -w * 0.5 + 0.04 + (i / mullions) * (w - 0.08);
          opaque.push(makeBox(0.06, glassH, d * 0.6, metalColor, SURFACE.none, mx, (kickH - headH) * 0.5, recessZ + 0.03));
        }
      }
      break;
    }

    case 'door': {
      const fw = Math.min(0.1, w * 0.12);
      const fd = Math.max(0.06, d);
      opaque.push(makeBox(w, fw, fd, trimColor, SURFACE.none, 0, h * 0.5 - fw * 0.5, 0));
      opaque.push(makeBox(fw, h - fw, fd, trimColor, SURFACE.none, -w * 0.5 + fw * 0.5, -fw * 0.5, 0));
      opaque.push(makeBox(fw, h - fw, fd, trimColor, SURFACE.none, w * 0.5 - fw * 0.5, -fw * 0.5, 0));
      const leafW = Math.max(0.1, w - fw * 2);
      const leafH = Math.max(0.1, h - fw);
      const leafCol = c.material === 'trim' ? woodColor : mainColor;
      opaque.push(makeBox(leafW, leafH, fd * 0.5, leafCol, SURFACE.none, 0, -fw * 0.5, -fd * 0.15));
      if (lod === 0) {
        opaque.push(makeBox(leafW * 0.65, leafH * 0.32, 0.04, trimColor, SURFACE.none, 0, h * 0.14, 0));
        opaque.push(makeBox(leafW * 0.65, leafH * 0.32, 0.04, trimColor, SURFACE.none, 0, -h * 0.22, 0));
        opaque.push(makeBox(0.04, 0.14, 0.06, metalColor, SURFACE.none, leafW * 0.35, -0.05, 0.04));
      }
      break;
    }

    case 'garageDoor': {
      const fw = 0.12;
      opaque.push(makeBox(w, fw, d, trimColor, SURFACE.none, 0, h * 0.5 - fw * 0.5, 0));
      opaque.push(makeBox(fw, h - fw, d, trimColor, SURFACE.none, -w * 0.5 + fw * 0.5, -fw * 0.5, 0));
      opaque.push(makeBox(fw, h - fw, d, trimColor, SURFACE.none, w * 0.5 - fw * 0.5, -fw * 0.5, 0));
      opaque.push(makeBox(w - fw * 2, h - fw, d * 0.5, metalColor, SURFACE.none, 0, -fw * 0.5, -d * 0.15));
      if (lod === 0) {
        const ribs = Math.min(6, Math.max(2, Math.floor(h / 0.55)));
        for (let i = 0; i < ribs; i++) {
          const ry = -h * 0.4 + ((i + 0.5) / ribs) * (h * 0.78);
          opaque.push(makeBox(w - fw * 2.2, 0.04, 0.04, trimColor, SURFACE.none, 0, ry, 0.02));
        }
      }
      break;
    }

    case 'loadingBay': {
      opaque.push(makeBox(w, 0.18, d + 0.15, concreteColor, SURFACE.concrete, 0, -h * 0.5 + 0.09, 0.05));
      opaque.push(makeBox(w * 0.85, h * 0.82, d * 0.6, metalColor, SURFACE.none, 0, 0.05, -0.04));
      if (lod === 0) {
        opaque.push(makeBox(0.18, 0.38, 0.18, FIXED_COLORS.rubber, SURFACE.none, -w * 0.38, -h * 0.5 + 0.25, d * 0.5));
        opaque.push(makeBox(0.18, 0.38, 0.18, FIXED_COLORS.rubber, SURFACE.none, w * 0.38, -h * 0.5 + 0.25, d * 0.5));
      }
      break;
    }

    case 'decoPanel': {
      opaque.push(makeBevelBox(w, h, d, Math.min(0.03, Math.min(w, h, d) * 0.2), 1, mainColor, SURFACE.building));
      if (lod === 0) {
        opaque.push(makeBox(w * 0.78, 0.06, d + 0.03, trimColor, SURFACE.none, 0, h * 0.32, 0));
        opaque.push(makeBox(w * 0.78, 0.06, d + 0.03, trimColor, SURFACE.none, 0, -h * 0.32, 0));
        opaque.push(makeBox(0.08, h * 0.65, d + 0.04, trimColor, SURFACE.none, 0, 0, 0));
      }
      break;
    }

    case 'verticalFin': {
      opaque.push(makeTapered(w, d, w * 0.65, d * 0.75, h, mainColor, SURFACE.building));
      break;
    }

    case 'railing': {
      makeRailing(w, h, d, lod, metalColor, opaque);
      break;
    }

    case 'shutter': {
      const col = c.material === 'trim' ? woodColor : mainColor;
      opaque.push(makeBox(w, h, d, col, SURFACE.none));
      if (lod === 0) {
        const slats = Math.min(5, Math.max(2, Math.floor(h / 0.25)));
        for (let i = 0; i < slats; i++) {
          const sy = -h * 0.38 + (i / (slats - 1)) * h * 0.76;
          opaque.push(makeBox(w * 0.8, 0.04, d + 0.03, trimColor, SURFACE.none, 0, sy, 0.01));
        }
      }
      break;
    }

    case 'sign': {
      if (lod === 1) {
        opaque.push(makeBox(w, h, d, mainColor, SURFACE.none));
      } else {
        opaque.push(makeBevelBox(w, h, d, Math.min(0.03, d * 0.25), 1, trimColor, SURFACE.none));
        opaque.push(makeBox(w * 0.88, h * 0.78, d + 0.02, mainColor, SURFACE.none));
      }
      break;
    }

    case 'neonSign': {
      const tube = Math.min(0.06, Math.min(w, h) * 0.15);
      opaque.push(makeBox(w * 0.94, h * 0.9, Math.max(0.03, d * 0.5), FIXED_COLORS.glassDark, SURFACE.none, 0, 0, -d * 0.2));
      emissive.push(makeBox(w, tube, tube, palette.neon, SURFACE.none, 0, h * 0.5 - tube * 0.5, d * 0.3));
      emissive.push(makeBox(w, tube, tube, palette.neon, SURFACE.none, 0, -h * 0.5 + tube * 0.5, d * 0.3));
      emissive.push(makeBox(tube, h, tube, palette.neon, SURFACE.none, -w * 0.5 + tube * 0.5, 0, d * 0.3));
      emissive.push(makeBox(tube, h, tube, palette.neon, SURFACE.none, w * 0.5 - tube * 0.5, 0, d * 0.3));
      break;
    }

    case 'wallLamp': {
      opaque.push(makeBox(w * 0.7, h * 0.5, d * 0.7, metalColor, SURFACE.none, 0, h * 0.2, 0));
      const r = Math.min(w, d) * 0.32;
      const bulb = makeLathe(
        [{ x: 0, y: -r }, { x: r, y: 0 }, { x: r * 0.7, y: r * 0.8 }, { x: 0, y: r }],
        lod === 0 ? 6 : 4,
        palette.neon,
        SURFACE.none,
        0,
        -h * 0.15,
        d * 0.15,
      );
      emissive.push(bulb);
      break;
    }

    case 'acUnit': {
      opaque.push(makeBevelBox(w, h, d, 0.03, 1, metalColor, SURFACE.none));
      if (lod === 0) {
        const fr = Math.min(w, h) * 0.32;
        opaque.push(transform(
          makeLathe([{ x: fr, y: -0.02 }, { x: fr, y: 0.02 }], 6, FIXED_COLORS.glassDark, SURFACE.none),
          -w * 0.15, 0, d * 0.5, 0,
        ));
        opaque.push(makeBox(w * 0.32, h * 0.65, 0.03, FIXED_COLORS.glassDark, SURFACE.none, w * 0.25, 0, d * 0.5));
      }
      break;
    }

    case 'drainpipe': {
      const r = Math.min(w, d) * 0.45;
      const segs = lod === 0 ? 6 : 4;
      opaque.push(makeLathe([{ x: r, y: -h * 0.5 }, { x: r, y: h * 0.5 }], segs, mainColor, SURFACE.none));
      if (lod === 0) {
        opaque.push(makeBox(r * 2.2, r * 2, d, mainColor, SURFACE.none, 0, -h * 0.5 + r, r * 0.8));
      }
      break;
    }

    case 'roofVent': {
      opaque.push(makeBox(w * 0.85, h * 0.7, d * 0.85, metalColor, SURFACE.none, 0, -h * 0.15, 0));
      opaque.push(makeTapered(w, d, w * 0.5, d * 0.5, h * 0.3, metalColor, SURFACE.none, 0, h * 0.35, 0));
      break;
    }

    case 'mechanicalBox': {
      opaque.push(makeBevelBox(w, h, d, 0.04, 1, metalColor, SURFACE.none));
      if (lod === 0) {
        opaque.push(makeLathe(
          [{ x: 0.08, y: 0 }, { x: 0.08, y: h * 0.45 }],
          6,
          metalColor,
          SURFACE.none,
          w * 0.3,
          h * 0.5,
          0,
        ));
      }
      break;
    }

    case 'waterTank': {
      const legH = h * 0.38;
      const tankH = h * 0.62;
      const r = Math.min(w, d) * 0.44;
      const segs = lod === 0 ? 8 : 6;
      opaque.push(makeLathe(
        [
          { x: r, y: -tankH * 0.4 },
          { x: r, y: tankH * 0.25 },
          { x: 0, y: tankH * 0.5 },
        ],
        segs,
        woodColor,
        SURFACE.none,
        0,
        legH * 0.5,
        0,
      ));
      const legOffset = r * 0.65;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          opaque.push(makeBox(0.12, legH, 0.12, woodColor, SURFACE.none, sx * legOffset, -h * 0.5 + legH * 0.5, sz * legOffset));
        }
      }
      break;
    }

    case 'satelliteDish': {
      const r = Math.min(w, d) * 0.48;
      const segs = lod === 0 ? 8 : 5;
      opaque.push(makeBox(0.1, h * 0.55, 0.1, metalColor, SURFACE.none, 0, -h * 0.22, 0));
      opaque.push(makeLathe(
        [{ x: 0, y: 0 }, { x: r * 0.6, y: h * 0.12 }, { x: r, y: h * 0.35 }],
        segs,
        metalColor,
        SURFACE.none,
        0,
        h * 0.05,
        0,
      ));
      if (lod === 0) {
        opaque.push(makeBox(0.05, h * 0.32, 0.05, metalColor, SURFACE.none, 0, h * 0.28, r * 0.2));
      }
      break;
    }

    case 'solarPanel': {
      opaque.push(makeBox(w * 0.15, h * 0.45, d * 0.15, metalColor, SURFACE.none, 0, -h * 0.25, 0));
      const frame = makeBox(w, 0.06, d, metalColor, SURFACE.none);
      const tiltedFrame = transform(frame, 0, 0.08, 0, 0);
      tiltedFrame.rotateX(0.35);
      frame.dispose();
      opaque.push(tiltedFrame);

      const cell = makeBox(w * 0.9, 0.04, d * 0.9, FIXED_COLORS.glassDark, SURFACE.none);
      const tiltedCell = transform(cell, 0, 0.1, 0, 0);
      tiltedCell.rotateX(0.35);
      cell.dispose();
      glass.push(tiltedCell);
      break;
    }

    case 'rooftopPatio': {
      const deckH = Math.min(0.14, h * 0.12);
      opaque.push(makeBox(w, deckH, d, concreteColor, SURFACE.concrete, 0, -h * 0.5 + deckH * 0.5, 0));
      const railParts: THREE.BufferGeometry[] = [];
      makeRailing(w, 0.75, 0.05, 1, metalColor, railParts);
      for (const rp of railParts) {
        opaque.push(transform(rp, 0, -h * 0.5 + deckH + 0.37, d * 0.5 - 0.04, 0));
        rp.dispose();
      }
      if (lod === 0) {
        const poleH = Math.max(1.2, h * 0.75);
        opaque.push(makeBox(0.07, poleH, 0.07, woodColor, SURFACE.none, 0, -h * 0.5 + deckH + poleH * 0.5, 0));
        const ur = Math.min(w, d) * 0.35;
        opaque.push(makeLathe(
          [{ x: ur, y: 0 }, { x: 0, y: 0.35 }],
          6,
          palette.awningA,
          SURFACE.none,
          0,
          -h * 0.5 + deckH + poleH - 0.1,
          0,
        ));
      }
      break;
    }

    case 'chimney': {
      const capH = Math.min(0.16, h * 0.18);
      opaque.push(makeBevelBox(w, h - capH, d, 0.03, 1, mainColor, SURFACE.building, 0, -capH * 0.5, 0));
      opaque.push(makeBox(w + 0.1, capH, d + 0.1, trimColor, SURFACE.none, 0, h * 0.5 - capH * 0.5, 0));
      break;
    }

    case 'pool': {
      const rim = 0.25;
      opaque.push(makeBox(w, h, rim, concreteColor, SURFACE.concrete, 0, 0, d * 0.5 - rim * 0.5));
      opaque.push(makeBox(w, h, rim, concreteColor, SURFACE.concrete, 0, 0, -d * 0.5 + rim * 0.5));
      opaque.push(makeBox(rim, h, Math.max(0.05, d - rim * 2), concreteColor, SURFACE.concrete, -w * 0.5 + rim * 0.5, 0, 0));
      opaque.push(makeBox(rim, h, Math.max(0.05, d - rim * 2), concreteColor, SURFACE.concrete, w * 0.5 - rim * 0.5, 0, 0));
      opaque.push(makeBox(Math.max(0.1, w - rim * 2), h * 0.6, Math.max(0.1, d - rim * 2), FIXED_COLORS.water, SURFACE.none, 0, -h * 0.15, 0));
      break;
    }

    case 'gardenWall': {
      const capH = Math.min(0.1, h * 0.15);
      opaque.push(makeBox(w, h - capH, d, mainColor, SURFACE.concrete, 0, -capH * 0.5, 0));
      if (lod === 0) {
        opaque.push(makeBevelBox(w + 0.06, capH, d + 0.06, 0.02, 1, trimColor, SURFACE.concrete, 0, h * 0.5 - capH * 0.5, 0));
      }
      break;
    }

    case 'rampDeck': {
      opaque.push(makeBox(w, h * 0.4, d, concreteColor, SURFACE.concrete, 0, -h * 0.3, 0));
      if (lod === 0) {
        opaque.push(makeBox(0.08, h * 0.7, d, metalColor, SURFACE.none, -w * 0.5 + 0.05, 0.1, 0));
        opaque.push(makeBox(0.08, h * 0.7, d, metalColor, SURFACE.none, w * 0.5 - 0.05, 0.1, 0));
      }
      break;
    }

    case 'guardrail': {
      makeRailing(w, h, d, lod, metalColor, opaque);
      break;
    }

    case 'pumpIsland': {
      const curbH = Math.min(0.18, h * 0.15);
      const pumpH = Math.max(0.4, h - curbH);
      const pw = Math.min(0.7, w * 0.25);
      const pd = Math.min(0.6, d * 0.65);
      const offsets = w > 1.8 ? [-w * 0.28, w * 0.28] : [0];
      if (lod === 1) {
        opaque.push(makeBox(w, curbH, d, concreteColor, SURFACE.concrete, 0, -h * 0.5 + curbH * 0.5, 0));
        for (const px of offsets) {
          opaque.push(makeBox(pw, pumpH, pd, mainColor, SURFACE.none, px, curbH * 0.5, 0));
          glass.push(makeFrontQuad(pw * 0.7, pumpH * 0.25, FIXED_COLORS.glassDark, SURFACE.none, px, curbH * 0.5 + pumpH * 0.22, pd * 0.5 + 0.01));
        }
      } else {
        opaque.push(makeBevelBox(w, curbH, d, 0.03, 1, concreteColor, SURFACE.concrete, 0, -h * 0.5 + curbH * 0.5, 0));
        for (const px of offsets) {
          opaque.push(makeBevelBox(pw, pumpH, pd, 0.03, 1, mainColor, SURFACE.none, px, curbH * 0.5, 0));
          glass.push(makeBox(pw * 0.7, pumpH * 0.25, 0.03, FIXED_COLORS.glassDark, SURFACE.none, px, curbH * 0.5 + pumpH * 0.22, pd * 0.5 + 0.01));
        }
      }
      break;
    }

    case 'landmarkPart': {
      const lm = landmarkPartGeometry(c, palette, lod);
      const tagged = tagSurface(lm, SURFACE.building);
      lm.dispose();
      if (c.material === 'neon') {
        emissive.push(tagged);
      } else {
        opaque.push(tagged);
      }
      break;
    }

    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      break;
    }
  }

  return {
    opaque: mergeAndDispose(opaque),
    glass: mergeAndDispose(glass),
    emissive: mergeAndDispose(emissive),
  };
}

/**
 * Convenience helper returning a single merged BufferGeometry for a ComponentInstance.
 */
export function componentGeometry(
  c: ComponentInstance,
  palette: BuildingPalette,
  lod: 0 | 1,
): THREE.BufferGeometry {
  const parts = componentParts(c, palette, lod);
  const merged = mergeTagged([parts.opaque, parts.glass, parts.emissive]);
  parts.opaque.dispose();
  parts.glass.dispose();
  parts.emissive.dispose();
  return merged;
}
