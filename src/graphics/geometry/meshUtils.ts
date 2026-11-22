// [3D] Reusable bevelled, lathed, extruded, and tagged BufferGeometry helpers.
// Every function returns a NEW BufferGeometry and never mutates its inputs.
// Callers own (must .dispose()) the results they keep; mergeTagged does NOT dispose its inputs.
// Metric UVs: 1 UV unit = 1 m on generated shapes.
import * as THREE from 'three';

export interface Vec2 {
  x: number;
  y: number;
}

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

function pushTri(
  pos: number[],
  norm: number[],
  uv: number[],
  ax: number, ay: number, az: number, anx: number, any: number, anz: number, au: number, av: number,
  bx: number, by: number, bz: number, bnx: number, bny: number, bnz: number, bu: number, bv: number,
  cx: number, cy: number, cz: number, cnx: number, cny: number, cnz: number, cu: number, cv: number,
): void {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const crx = aby * acz - abz * acy;
  const cry = abz * acx - abx * acz;
  const crz = abx * acy - aby * acx;
  const dot = crx * (anx + bnx + cnx) + cry * (any + bny + cny) + crz * (anz + bnz + cnz);
  if (dot >= 0) {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    norm.push(anx, any, anz, bnx, bny, bnz, cnx, cny, cnz);
    uv.push(au, av, bu, bv, cu, cv);
  } else {
    pos.push(ax, ay, az, cx, cy, cz, bx, by, bz);
    norm.push(anx, any, anz, cnx, cny, cnz, bnx, bny, bnz);
    uv.push(au, av, cu, cv, bu, bv);
  }
}

function pushQuad(
  pos: number[],
  norm: number[],
  uv: number[],
  ax: number, ay: number, az: number, anx: number, any: number, anz: number, au: number, av: number,
  bx: number, by: number, bz: number, bnx: number, bny: number, bnz: number, bu: number, bv: number,
  cx: number, cy: number, cz: number, cnx: number, cny: number, cnz: number, cu: number, cv: number,
  dx: number, dy: number, dz: number, dnx: number, dny: number, dnz: number, du: number, dv: number,
): void {
  pushTri(
    pos, norm, uv,
    ax, ay, az, anx, any, anz, au, av,
    bx, by, bz, bnx, bny, bnz, bu, bv,
    cx, cy, cz, cnx, cny, cnz, cu, cv,
  );
  pushTri(
    pos, norm, uv,
    ax, ay, az, anx, any, anz, au, av,
    cx, cy, cz, cnx, cny, cnz, cu, cv,
    dx, dy, dz, dnx, dny, dnz, du, dv,
  );
}

function buildGeom(pos: number[], norm: number[], uv: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function plainBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const hx = w * 0.5;
  const hy = h * 0.5;
  const hz = d * 0.5;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  // +X
  pushQuad(pos, norm, uv,
    hx, -hy, hz, 1, 0, 0, 0, 0,
    hx, -hy, -hz, 1, 0, 0, d, 0,
    hx, hy, -hz, 1, 0, 0, d, h,
    hx, hy, hz, 1, 0, 0, 0, h);
  // -X
  pushQuad(pos, norm, uv,
    -hx, -hy, -hz, -1, 0, 0, 0, 0,
    -hx, -hy, hz, -1, 0, 0, d, 0,
    -hx, hy, hz, -1, 0, 0, d, h,
    -hx, hy, -hz, -1, 0, 0, 0, h);
  // +Y
  pushQuad(pos, norm, uv,
    -hx, hy, hz, 0, 1, 0, 0, 0,
    hx, hy, hz, 0, 1, 0, w, 0,
    hx, hy, -hz, 0, 1, 0, w, d,
    -hx, hy, -hz, 0, 1, 0, 0, d);
  // -Y
  pushQuad(pos, norm, uv,
    -hx, -hy, -hz, 0, -1, 0, 0, 0,
    hx, -hy, -hz, 0, -1, 0, w, 0,
    hx, -hy, hz, 0, -1, 0, w, d,
    -hx, -hy, hz, 0, -1, 0, 0, d);
  // +Z
  pushQuad(pos, norm, uv,
    -hx, -hy, hz, 0, 0, 1, 0, 0,
    hx, -hy, hz, 0, 0, 1, w, 0,
    hx, hy, hz, 0, 0, 1, w, h,
    -hx, hy, hz, 0, 0, 1, 0, h);
  // -Z
  pushQuad(pos, norm, uv,
    hx, -hy, -hz, 0, 0, -1, 0, 0,
    -hx, -hy, -hz, 0, 0, -1, w, 0,
    -hx, hy, -hz, 0, 0, -1, w, h,
    hx, hy, -hz, 0, 0, -1, 0, h);

  return buildGeom(pos, norm, uv);
}

/**
 * Box with chamfered/rounded edges and corners, centred on the origin.
 * Flat faces have hard axis-aligned normals; bevel strips and corners have smooth unit normals.
 * Watertight (zero boundary edges when positions are welded). Metric UVs.
 */
export function bevelBox(
  w: number,
  h: number,
  d: number,
  bevel: number,
  segments = 2,
): THREE.BufferGeometry {
  const sw = Math.max(1e-4, w);
  const sh = Math.max(1e-4, h);
  const sd = Math.max(1e-4, d);
  const maxB = Math.min(sw, sh, sd) * 0.49;
  const b = Math.max(0, Math.min(bevel, maxB));
  const segs = Math.max(1, Math.floor(segments));

  if (b <= 1e-5) {
    return plainBox(sw, sh, sd);
  }

  const hx = sw * 0.5 - b;
  const hy = sh * 0.5 - b;
  const hz = sd * 0.5 - b;
  const ox = sw * 0.5;
  const oy = sh * 0.5;
  const oz = sd * 0.5;

  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  // 6 flat faces (hard normals, metric UVs)
  // +X / -X
  for (const sx of [-1, 1] as const) {
    const x = sx * ox;
    pushQuad(pos, norm, uv,
      x, -hy, -hz, sx, 0, 0, 0, 0,
      x, -hy, hz, sx, 0, 0, hz * 2, 0,
      x, hy, hz, sx, 0, 0, hz * 2, hy * 2,
      x, hy, -hz, sx, 0, 0, 0, hy * 2);
  }
  // +Y / -Y
  for (const sy of [-1, 1] as const) {
    const y = sy * oy;
    pushQuad(pos, norm, uv,
      -hx, y, -hz, 0, sy, 0, 0, 0,
      hx, y, -hz, 0, sy, 0, hx * 2, 0,
      hx, y, hz, 0, sy, 0, hx * 2, hz * 2,
      -hx, y, hz, 0, sy, 0, 0, hz * 2);
  }
  // +Z / -Z
  for (const sz of [-1, 1] as const) {
    const z = sz * oz;
    pushQuad(pos, norm, uv,
      -hx, -hy, z, 0, 0, sz, 0, 0,
      hx, -hy, z, 0, 0, sz, hx * 2, 0,
      hx, hy, z, 0, 0, sz, hx * 2, hy * 2,
      -hx, hy, z, 0, 0, sz, 0, hy * 2);
  }

  const halfPi = Math.PI * 0.5;

  // 4 edges parallel to X (y-z arc)
  for (const sy of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * halfPi;
        const t1 = ((i + 1) / segs) * halfPi;
        const ny0 = sy * Math.cos(t0);
        const nz0 = sz * Math.sin(t0);
        const ny1 = sy * Math.cos(t1);
        const nz1 = sz * Math.sin(t1);
        const y0 = sy * hy + b * ny0;
        const z0 = sz * hz + b * nz0;
        const y1 = sy * hy + b * ny1;
        const z1 = sz * hz + b * nz1;
        const v0 = t0 * b;
        const v1 = t1 * b;
        pushQuad(pos, norm, uv,
          -hx, y0, z0, 0, ny0, nz0, 0, v0,
          hx, y0, z0, 0, ny0, nz0, hx * 2, v0,
          hx, y1, z1, 0, ny1, nz1, hx * 2, v1,
          -hx, y1, z1, 0, ny1, nz1, 0, v1);
      }
    }
  }

  // 4 edges parallel to Y (x-z arc)
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * halfPi;
        const t1 = ((i + 1) / segs) * halfPi;
        const nx0 = sx * Math.cos(t0);
        const nz0 = sz * Math.sin(t0);
        const nx1 = sx * Math.cos(t1);
        const nz1 = sz * Math.sin(t1);
        const x0 = sx * hx + b * nx0;
        const z0 = sz * hz + b * nz0;
        const x1 = sx * hx + b * nx1;
        const z1 = sz * hz + b * nz1;
        const v0 = t0 * b;
        const v1 = t1 * b;
        pushQuad(pos, norm, uv,
          x0, -hy, z0, nx0, 0, nz0, 0, v0,
          x0, hy, z0, nx0, 0, nz0, hy * 2, v0,
          x1, hy, z1, nx1, 0, nz1, hy * 2, v1,
          x1, -hy, z1, nx1, 0, nz1, 0, v1);
      }
    }
  }

  // 4 edges parallel to Z (x-y arc)
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * halfPi;
        const t1 = ((i + 1) / segs) * halfPi;
        const nx0 = sx * Math.cos(t0);
        const ny0 = sy * Math.sin(t0);
        const nx1 = sx * Math.cos(t1);
        const ny1 = sy * Math.sin(t1);
        const x0 = sx * hx + b * nx0;
        const y0 = sy * hy + b * ny0;
        const x1 = sx * hx + b * nx1;
        const y1 = sy * hy + b * ny1;
        const v0 = t0 * b;
        const v1 = t1 * b;
        pushQuad(pos, norm, uv,
          x0, y0, -hz, nx0, ny0, 0, 0, v0,
          x0, y0, hz, nx0, ny0, 0, hz * 2, v0,
          x1, y1, hz, nx1, ny1, 0, hz * 2, v1,
          x1, y1, -hz, nx1, ny1, 0, 0, v1);
      }
    }
  }

  // 8 corner spherical octants (triangular grid matching the 3 edge arcs identically)
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const cx0 = sx * hx;
        const cy0 = sy * hy;
        const cz0 = sz * hz;
        const cornerVert = (r: number, c: number): [number, number, number, number, number, number, number, number] => {
          const phi = (r / segs) * halfPi;
          const theta = r === 0 ? 0 : (c / r) * halfPi;
          const sinP = Math.sin(phi);
          const nx = sx * sinP * Math.cos(theta);
          const ny = sy * sinP * Math.sin(theta);
          const nz = sz * Math.cos(phi);
          return [cx0 + b * nx, cy0 + b * ny, cz0 + b * nz, nx, ny, nz, phi * b, theta * b];
        };

        for (let r = 1; r <= segs; r++) {
          for (let c = 0; c < r; c++) {
            const a = cornerVert(r - 1, c);
            const v1 = cornerVert(r, c);
            const v2 = cornerVert(r, c + 1);
            pushTri(
              pos, norm, uv,
              a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7],
              v1[0], v1[1], v1[2], v1[3], v1[4], v1[5], v1[6], v1[7],
              v2[0], v2[1], v2[2], v2[3], v2[4], v2[5], v2[6], v2[7],
            );
            if (c < r - 1) {
              const d2 = cornerVert(r - 1, c + 1);
              pushTri(
                pos, norm, uv,
                a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7],
                v2[0], v2[1], v2[2], v2[3], v2[4], v2[5], v2[6], v2[7],
                d2[0], d2[1], d2[2], d2[3], d2[4], d2[5], d2[6], d2[7],
              );
            }
          }
        }
      }
    }
  }

  return buildGeom(pos, norm, uv);
}

/**
 * Rounded box (all edges radius `radius`), smooth normals on rounded edges/corners, hard on flats.
 */
export function roundedBox(
  w: number,
  h: number,
  d: number,
  radius: number,
  segments = 4,
): THREE.BufferGeometry {
  return bevelBox(w, h, d, radius, segments);
}

/**
 * Surface of revolution around the Y axis from a 2D profile (x = radius >= 0, y = height).
 * Smooth normals, optional end caps when closed = true. Metric UVs.
 */
export function lathe(
  profile: readonly Vec2[],
  segs: number,
  closed = true,
): THREE.BufferGeometry {
  const nSegs = Math.max(3, Math.floor(segs));
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  if (profile.length < 2) {
    return buildGeom(pos, norm, uv);
  }

  const pts = profile.map((p) => ({ x: Math.max(0, p.x), y: p.y }));
  const nPts = pts.length;

  // Profile cumulative arc length for metric V
  const vCoords = new Float32Array(nPts);
  for (let i = 1; i < nPts; i++) {
    vCoords[i] = vCoords[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }

  // Per-profile-point smooth 2D normal (nr, ny)
  const pnr = new Float32Array(nPts);
  const pny = new Float32Array(nPts);
  for (let i = 0; i < nPts; i++) {
    let dr = 0;
    let dy = 0;
    if (i > 0) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) || 1;
      dr += (pts[i].x - pts[i - 1].x) / len;
      dy += (pts[i].y - pts[i - 1].y) / len;
    }
    if (i < nPts - 1) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 1;
      dr += (pts[i + 1].x - pts[i].x) / len;
      dy += (pts[i + 1].y - pts[i].y) / len;
    }
    // Tangent is (dr, dy); outward normal in (r, y) plane for bottom-to-top profile is (dy, -dr)
    // Determine direction sign using profile progression (if y generally increases, +dy points outward)
    const nLen = Math.hypot(dy, -dr) || 1;
    pnr[i] = dy / nLen;
    pny[i] = -dr / nLen;
  }

  // Ensure outward normal on average points +r
  let avgNr = 0;
  for (let i = 0; i < nPts; i++) avgNr += pnr[i];
  if (avgNr < 0) {
    for (let i = 0; i < nPts; i++) {
      pnr[i] = -pnr[i];
      pny[i] = -pny[i];
    }
  }

  for (let i = 0; i < nPts - 1; i++) {
    const r0 = pts[i].x;
    const y0 = pts[i].y;
    const r1 = pts[i + 1].x;
    const y1 = pts[i + 1].y;
    if (r0 <= 1e-6 && r1 <= 1e-6) continue;

    const nr0 = pnr[i];
    const ny0 = pny[i];
    const nr1 = pnr[i + 1];
    const ny1 = pny[i + 1];
    const v0 = vCoords[i];
    const v1 = vCoords[i + 1];
    const rMid = (r0 + r1) * 0.5;
    const circ = 2 * Math.PI * rMid;

    for (let s = 0; s < nSegs; s++) {
      const a0 = (s / nSegs) * Math.PI * 2;
      const a1 = ((s + 1) / nSegs) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const u0 = (s / nSegs) * circ;
      const u1 = ((s + 1) / nSegs) * circ;

      if (r0 <= 1e-6) {
        pushTri(
          pos, norm, uv,
          0, y0, 0, 0, ny0 >= 0 ? 1 : -1, 0, (u0 + u1) * 0.5, v0,
          r1 * c1, y1, r1 * s1, nr1 * c1, ny1, nr1 * s1, u1, v1,
          r1 * c0, y1, r1 * s0, nr1 * c0, ny1, nr1 * s0, u0, v1,
        );
      } else if (r1 <= 1e-6) {
        pushTri(
          pos, norm, uv,
          r0 * c0, y0, r0 * s0, nr0 * c0, ny0, nr0 * s0, u0, v0,
          r0 * c1, y0, r0 * s1, nr0 * c1, ny0, nr0 * s1, u1, v0,
          0, y1, 0, 0, ny1 >= 0 ? 1 : -1, 0, (u0 + u1) * 0.5, v1,
        );
      } else {
        pushQuad(
          pos, norm, uv,
          r0 * c0, y0, r0 * s0, nr0 * c0, ny0, nr0 * s0, u0, v0,
          r0 * c1, y0, r0 * s1, nr0 * c1, ny0, nr0 * s1, u1, v0,
          r1 * c1, y1, r1 * s1, nr1 * c1, ny1, nr1 * s1, u1, v1,
          r1 * c0, y1, r1 * s0, nr1 * c0, ny1, nr1 * s0, u0, v1,
        );
      }
    }
  }

  if (closed) {
    const first = pts[0];
    const last = pts[nPts - 1];
    const botNormalY = first.y <= last.y ? -1 : 1;
    const topNormalY = -botNormalY;

    if (first.x > 1e-5) {
      for (let s = 0; s < nSegs; s++) {
        const a0 = (s / nSegs) * Math.PI * 2;
        const a1 = ((s + 1) / nSegs) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        pushTri(
          pos, norm, uv,
          0, first.y, 0, 0, botNormalY, 0, 0, 0,
          first.x * c0, first.y, first.x * s0, 0, botNormalY, 0, first.x * c0, first.x * s0,
          first.x * c1, first.y, first.x * s1, 0, botNormalY, 0, first.x * c1, first.x * s1,
        );
      }
    }
    if (last.x > 1e-5) {
      for (let s = 0; s < nSegs; s++) {
        const a0 = (s / nSegs) * Math.PI * 2;
        const a1 = ((s + 1) / nSegs) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        pushTri(
          pos, norm, uv,
          0, last.y, 0, 0, topNormalY, 0, 0, 0,
          last.x * c1, last.y, last.x * s1, 0, topNormalY, 0, last.x * c1, last.x * s1,
          last.x * c0, last.y, last.x * s0, 0, topNormalY, 0, last.x * c0, last.x * s0,
        );
      }
    }
  }

  return buildGeom(pos, norm, uv);
}

/**
 * Extrudes a closed 2D outline along Z, centred on z = 0 (total Z extent = `depth`).
 * Handles CW/CCW input and concave outlines; optional bevel on front/back edges. Metric UVs.
 */
export function extrudeProfile(
  profile: readonly Vec2[],
  depth: number,
  bevel = 0,
): THREE.BufferGeometry {
  if (profile.length < 3) {
    return buildGeom([], [], []);
  }

  // Normalize winding to CCW
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    area += a.x * b.y - b.x * a.y;
  }
  const pts = area < 0 ? [...profile].reverse() : [...profile];

  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, pts[i].y);
  }
  shape.closePath();

  const sd = Math.max(1e-4, depth);
  const b = Math.max(0, Math.min(bevel, sd * 0.45));
  const extrudeDepth = Math.max(1e-4, sd - 2 * b);

  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: b > 1e-5,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 1,
  });
  raw.translate(0, 0, -extrudeDepth * 0.5);
  const nonIndexed = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();
  if (!nonIndexed.getAttribute('normal')) {
    nonIndexed.computeVertexNormals();
  }
  return nonIndexed;
}

/**
 * Solid arch-topped block (rectangle with a semicircular/segmented top), extruded along Z, centred on origin.
 */
export function arch(
  w: number,
  h: number,
  d: number,
  segs = 10,
  rise?: number,
): THREE.BufferGeometry {
  const sw = Math.max(1e-4, w);
  const sh = Math.max(1e-4, h);
  const sd = Math.max(1e-4, d);
  const nSegs = Math.max(3, Math.floor(segs));
  const r = Math.max(0, Math.min(rise ?? Math.min(sw * 0.5, sh * 0.5), sh));
  const hw = sw * 0.5;
  const hh = sh * 0.5;
  const springY = hh - r;

  const pts: Vec2[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: springY },
  ];
  for (let i = 1; i < nSegs; i++) {
    const a = (i / nSegs) * Math.PI;
    pts.push({
      x: Math.cos(a) * hw,
      y: springY + Math.sin(a) * r,
    });
  }
  pts.push({ x: -hw, y: springY });

  return extrudeProfile(pts, sd, 0);
}

/**
 * Frustum-like box (pyramidal or tapered prism) centred on the origin. Hard face normals, metric UVs.
 */
export function taperedBox(
  wBottom: number,
  dBottom: number,
  wTop: number,
  dTop: number,
  h: number,
): THREE.BufferGeometry {
  const hxb = Math.max(0, wBottom * 0.5);
  const hzb = Math.max(0, dBottom * 0.5);
  const hxt = Math.max(0, wTop * 0.5);
  const hzt = Math.max(0, dTop * 0.5);
  const hy = Math.max(1e-4, h) * 0.5;

  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];

  const face = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
    dx: number, dy: number, dz: number, du: number, dv: number,
    hintX: number, hintY: number, hintZ: number,
  ): void => {
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) {
      // Degenerate first triangle, try second
      const ux2 = cx - ax; const uy2 = cy - ay; const uz2 = cz - az;
      const vx2 = dx - ax; const vy2 = dy - ay; const vz2 = dz - az;
      nx = uy2 * vz2 - uz2 * vy2;
      ny = uz2 * vx2 - ux2 * vz2;
      nz = ux2 * vy2 - uy2 * vx2;
    }
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-8) return;
    nx /= nLen; ny /= nLen; nz /= nLen;
    if (nx * hintX + ny * hintY + nz * hintZ < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    pushQuad(pos, norm, uv,
      ax, ay, az, nx, ny, nz, au, av,
      bx, by, bz, nx, ny, nz, bu, bv,
      cx, cy, cz, nx, ny, nz, cu, cv,
      dx, dy, dz, nx, ny, nz, du, dv);
  };

  // Bottom (-Y)
  if (hxb > 1e-5 && hzb > 1e-5) {
    face(-hxb, -hy, -hzb, 0, 0, hxb, -hy, -hzb, hxb * 2, 0, hxb, -hy, hzb, hxb * 2, hzb * 2, -hxb, -hy, hzb, 0, hzb * 2, 0, -1, 0);
  }
  // Top (+Y)
  if (hxt > 1e-5 && hzt > 1e-5) {
    face(-hxt, hy, hzt, 0, 0, hxt, hy, hzt, hxt * 2, 0, hxt, hy, -hzt, hxt * 2, hzt * 2, -hxt, hy, -hzt, 0, hzt * 2, 0, 1, 0);
  }
  const sideH = Math.hypot(hy * 2, hxb - hxt);
  const sideD = Math.hypot(hy * 2, hzb - hzt);
  // +Z
  face(-hxb, -hy, hzb, 0, 0, hxb, -hy, hzb, hxb * 2, 0, hxt, hy, hzt, hxb + hxt, sideD, -hxt, hy, hzt, hxb - hxt, sideD, 0, 0, 1);
  // -Z
  face(hxb, -hy, -hzb, 0, 0, -hxb, -hy, -hzb, hxb * 2, 0, -hxt, hy, -hzt, hxb + hxt, sideD, hxt, hy, -hzt, hxb - hxt, sideD, 0, 0, -1);
  // +X
  face(hxb, -hy, hzb, 0, 0, hxb, -hy, -hzb, hzb * 2, 0, hxt, hy, -hzt, hzb + hzt, sideH, hxt, hy, hzt, hzb - hzt, sideH, 1, 0, 0);
  // -X
  face(-hxb, -hy, -hzb, 0, 0, -hxb, -hy, hzb, hzb * 2, 0, -hxt, hy, hzt, hzb + hzt, sideH, -hxt, hy, -hzt, hzb - hzt, sideH, -1, 0, 0);

  return buildGeom(pos, norm, uv);
}

/**
 * Returns a copy of `geom` with a Float32 'color' attribute (3 comps, linear via THREE.Color).
 */
export function paint(geom: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const out = geom.clone();
  const pos = out.getAttribute('position');
  const count = pos ? pos.count : 0;
  _color.setHex(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return out;
}

/**
 * Returns a copy of `geom` with a Float32 'aSurface' attribute (1 comp) filled with `surfaceId`.
 */
export function tagSurface(geom: THREE.BufferGeometry, surfaceId: number): THREE.BufferGeometry {
  const out = geom.clone();
  const pos = out.getAttribute('position');
  const count = pos ? pos.count : 0;
  const surf = new Float32Array(count);
  surf.fill(surfaceId);
  out.setAttribute('aSurface', new THREE.BufferAttribute(surf, 1));
  return out;
}

/**
 * Returns a transformed copy of `geom`: scale (sx, sy, sz) -> rotateY(rotY) -> translate(x, y, z).
 * Normals are transformed correctly under non-uniform scale.
 */
export function transform(
  geom: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rotY: number,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const out = geom.clone();
  _pos.set(x, y, z);
  _euler.set(0, rotY, 0);
  _quat.setFromEuler(_euler);
  _scale.set(sx, sy, sz);
  _mat4.compose(_pos, _quat, _scale);
  out.applyMatrix4(_mat4);
  return out;
}

/**
 * Returns the triangle count of `geom`.
 */
export function countTriangles(geom: THREE.BufferGeometry): number {
  if (geom.index) {
    return Math.floor(geom.index.count / 3);
  }
  const pos = geom.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Merges geometries into a single NON-INDEXED BufferGeometry with exact attribute set:
 * { position (3), normal (3), color (3), uv (2), aSurface (1) }.
 * Missing attributes are filled with defaults (computed flat face normal, color (1,1,1), uv (0,0), aSurface 0).
 * Does NOT dispose its inputs.
 */
export function mergeTagged(geoms: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared: THREE.BufferGeometry[] = [];
  const tempToDispose: THREE.BufferGeometry[] = [];
  let totalVerts = 0;

  for (let i = 0; i < geoms.length; i++) {
    const src = geoms[i];
    const pos = src.getAttribute('position');
    if (!pos || pos.count === 0) continue;
    const g = src.index ? src.toNonIndexed() : src;
    if (g !== src) tempToDispose.push(g);
    const gPos = g.getAttribute('position');
    if (!gPos || gPos.count === 0) continue;
    prepared.push(g);
    totalVerts += gPos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const surfaces = new Float32Array(totalVerts);

  let vOffset = 0;
  for (let gi = 0; gi < prepared.length; gi++) {
    const g = prepared[gi];
    const posAttr = g.getAttribute('position');
    const nAttr = g.getAttribute('normal');
    const cAttr = g.getAttribute('color');
    const uvAttr = g.getAttribute('uv');
    const sAttr = g.getAttribute('aSurface');
    const count = posAttr.count;

    for (let v = 0; v < count; v++) {
      const idx = vOffset + v;
      positions[idx * 3] = posAttr.getX(v);
      positions[idx * 3 + 1] = posAttr.getY(v);
      positions[idx * 3 + 2] = posAttr.getZ(v);

      if (cAttr) {
        colors[idx * 3] = cAttr.getX(v);
        colors[idx * 3 + 1] = cAttr.getY(v);
        colors[idx * 3 + 2] = cAttr.getZ(v);
      } else {
        colors[idx * 3] = 1;
        colors[idx * 3 + 1] = 1;
        colors[idx * 3 + 2] = 1;
      }

      if (uvAttr) {
        uvs[idx * 2] = uvAttr.getX(v);
        uvs[idx * 2 + 1] = uvAttr.getY(v);
      }

      surfaces[idx] = sAttr ? sAttr.getX(v) : 0;
    }

    if (nAttr) {
      for (let v = 0; v < count; v++) {
        const idx = vOffset + v;
        normals[idx * 3] = nAttr.getX(v);
        normals[idx * 3 + 1] = nAttr.getY(v);
        normals[idx * 3 + 2] = nAttr.getZ(v);
      }
    } else {
      // Compute flat face normals per triangle
      for (let v = 0; v + 2 < count; v += 3) {
        const i0 = (vOffset + v) * 3;
        const i1 = i0 + 3;
        const i2 = i0 + 6;
        const ax = positions[i1] - positions[i0];
        const ay = positions[i1 + 1] - positions[i0 + 1];
        const az = positions[i1 + 2] - positions[i0 + 2];
        const bx = positions[i2] - positions[i0];
        const by = positions[i2 + 1] - positions[i0 + 1];
        const bz = positions[i2 + 2] - positions[i0 + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        normals[i0] = nx; normals[i0 + 1] = ny; normals[i0 + 2] = nz;
        normals[i1] = nx; normals[i1 + 1] = ny; normals[i1 + 2] = nz;
        normals[i2] = nx; normals[i2 + 1] = ny; normals[i2 + 2] = nz;
      }
    }

    vOffset += count;
  }

  for (let i = 0; i < tempToDispose.length; i++) {
    tempToDispose[i].dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('aSurface', new THREE.BufferAttribute(surfaces, 1));
  return out;
}
