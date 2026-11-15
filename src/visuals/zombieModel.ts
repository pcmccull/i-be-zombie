/**
 * [3D] Zombie meshes, material and skeleton composition shared by the horde (instanced) and the Alpha (hero rig).
 *
 * Skeleton (visuals/zombieRig.ts): root → hips → {spine → {head → jaw, upper arms → forearms}, thighs → shins → feet}.
 * Each body part is a low-poly merged geometry in its bone's local space; the horde draws one InstancedMesh per part
 * (left/right limbs share one mesh with two instances per zombie), so the draw-call count does not grow with the crowd.
 *
 * Material: MeshStandardMaterial (flat shaded, rough) with a procedural atlas + normal map. Three extra attributes,
 * per vertex (geometry) or per instance (InstancedBufferAttribute) — the shader does not care which:
 *   aTile (float)  atlas tile, `aSkin` (vec3) skin tone, and per-vertex `aMat` (vec3):
 *     x = texture mix (0 = plain vertex colour: eyes, teeth, belts),
 *     y = tint mode (0 none, 1 instance colour = part tint, 2 aSkin = skin tone, e.g. hands on a long-sleeve forearm),
 *     z = emissive glow (eyes).
 * UVs are in metres / UV_METERS and wrapped inside the tile in the fragment shader (textureGrad, seamless tiles).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AccessoryKind, ZombieLook } from './zombieProfiles';
import { ATLAS_GRID, TILE } from './zombieProfiles';
import { RIG, type ZombiePose } from './zombieRig';
import { getZombieAtlas } from './zombieTextures';

/** Subtle baseline emissive of the Alpha (hit flash / frenzy override it, EntityRenderer restores it). */
export const LEADER_GLOW = 0x16300a;

const UV_METERS = 0.55;
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Bones
// ---------------------------------------------------------------------------

export const BONE = {
  root: 0,
  hips: 1,
  spine: 2,
  head: 3,
  jaw: 4,
  upperArmL: 5,
  forearmL: 6,
  upperArmR: 7,
  forearmR: 8,
  thighL: 9,
  shinL: 10,
  footL: 11,
  thighR: 12,
  shinR: 13,
  footR: 14,
} as const;
export const BONE_COUNT = 15;

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _one = new THREE.Vector3(1, 1, 1);
const _local = new THREE.Matrix4();

function local(parent: THREE.Matrix4, out: THREE.Matrix4, x: number, y: number, z: number,
  rx: number, ry: number, rz: number, order: THREE.EulerOrder): void {
  _p.set(x, y, z);
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  _local.compose(_p, _q, _one);
  out.multiplyMatrices(parent, _local);
}

/**
 * World (or parent-relative) matrices for every bone. `root` carries position + facing; scale/width size the body.
 */
export function composeBones(pose: ZombiePose, root: THREE.Matrix4, scale: number, width: number, out: THREE.Matrix4[]): void {
  const b0 = out[BONE.root];
  _p.set(0, pose.rootY * scale, 0);
  _e.set(pose.rootPitch, 0, pose.rootRoll, 'XYZ');
  _q.setFromEuler(_e);
  _s.set(scale * width, scale, scale);
  _local.compose(_p, _q, _s);
  b0.multiplyMatrices(root, _local);

  const hips = out[BONE.hips];
  local(b0, hips, pose.hipX, pose.hipY, pose.hipZ, pose.hipPitch, pose.hipYaw, pose.hipRoll, 'YXZ');
  const spine = out[BONE.spine];
  local(hips, spine, 0, RIG.waistY, 0, pose.spinePitch, pose.spineYaw, pose.spineRoll, 'YXZ');
  const head = out[BONE.head];
  local(spine, head, 0, RIG.neckY, RIG.neckZ, pose.neckPitch, pose.neckYaw, pose.neckRoll, 'YXZ');
  local(head, out[BONE.jaw], 0, RIG.jawY, RIG.jawZ, pose.jaw, 0, 0, 'XYZ');

  const uaL = out[BONE.upperArmL];
  local(spine, uaL, RIG.shoulderX, RIG.shoulderY + pose.shrugL, 0, pose.armLPitch, pose.armLYaw, pose.armLRoll, 'XYZ');
  local(uaL, out[BONE.forearmL], 0, -RIG.upperArm, 0, -pose.elbowL, 0, 0, 'XYZ');
  const uaR = out[BONE.upperArmR];
  local(spine, uaR, -RIG.shoulderX, RIG.shoulderY + pose.shrugR, 0, pose.armRPitch, pose.armRYaw, pose.armRRoll, 'XYZ');
  local(uaR, out[BONE.forearmR], 0, -RIG.upperArm, 0, -pose.elbowR, 0, 0, 'XYZ');

  const thL = out[BONE.thighL];
  local(hips, thL, RIG.hipHalfWidth, 0, 0, pose.thighLPitch, 0, pose.thighLRoll, 'XYZ');
  const shL = out[BONE.shinL];
  local(thL, shL, 0, -RIG.thigh, 0, pose.kneeL, 0, 0, 'XYZ');
  local(shL, out[BONE.footL], 0, -RIG.shin, 0, pose.ankleL, 0, 0, 'XYZ');
  const thR = out[BONE.thighR];
  local(hips, thR, -RIG.hipHalfWidth, 0, 0, pose.thighRPitch, 0, pose.thighRRoll, 'XYZ');
  const shR = out[BONE.shinR];
  local(thR, shR, 0, -RIG.thigh, 0, pose.kneeR, 0, 0, 'XYZ');
  local(shR, out[BONE.footR], 0, -RIG.shin, 0, pose.ankleR, 0, 0, 'XYZ');
}

export function createBoneMatrices(): THREE.Matrix4[] {
  return Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

interface PrimOpts {
  /** Vertex colour (linear multiplier). Default white. */
  color?: number;
  /** 1 = sample the part's atlas tile (default), 0 = plain colour. */
  tex?: number;
  /** 1 = instance tint (default), 2 = skin tone, 0 = none. */
  tint?: number;
  glow?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Box: top (+y) face scale in x/z. Prism: use rTop/rBot. */
  taper?: number;
  taperZ?: number;
  /** Prism: cross-section scale. */
  sx?: number;
  sz?: number;
  sides?: number;
}

const _col = new THREE.Color();

function finish(g: THREE.BufferGeometry, o: PrimOpts, x: number, y: number, z: number): THREE.BufferGeometry {
  if (o.rx || o.ry || o.rz) {
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'XYZ');
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(_e));
  }
  g.translate(x, y, z);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  const mat = new Float32Array(n * 3);
  _col.setHex(o.color ?? 0xffffff);
  const tex = o.tex ?? 1;
  const tint = o.tint ?? 1;
  const glow = o.glow ?? 0;
  for (let i = 0; i < n; i++) {
    colors[i * 3] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
    mat[i * 3] = tex;
    mat[i * 3 + 1] = tint;
    mat[i * 3 + 2] = glow;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 3));
  return g;
}

/** Box with metric UVs per face (centred) and optional top taper. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, o: PrimOpts = {}): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order px, nx, py, ny, pz, nz (4 verts each). Map each face to metres.
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * (du / UV_METERS), 0.5 + (uv.getY(i) - 0.5) * (dv / UV_METERS));
    }
  }
  const tx = o.taper ?? 1;
  const tz = o.taperZ ?? tx;
  if (tx !== 1 || tz !== 1) {
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) pos.setXYZ(i, pos.getX(i) * tx, pos.getY(i), pos.getZ(i) * tz);
    }
  }
  return finish(g, o, x, y, z);
}

/** Vertical prism (low-poly cylinder) with a flat face to the front, centred at (x, y, z). */
function prism(rTop: number, rBot: number, h: number, x: number, y: number, z: number, o: PrimOpts = {}): THREE.BufferGeometry {
  const sides = o.sides ?? 6;
  // thetaStart so a face (not an edge) points to +Z and u = 0.5 sits at the front.
  const g = new THREE.CylinderGeometry(rTop, rBot, h, sides, 1, false, Math.PI + Math.PI / sides, TWO_PI);
  const sx = o.sx ?? 1;
  const sz = o.sz ?? 1;
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = TWO_PI * Math.max(rTop, rBot) * (sx + sz) * 0.5;
  // u = 0.5 + 1/(2·sides) is the front face centre for this thetaStart.
  const uFront = 0.5 - 0.5 / sides;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.5 + (uv.getX(i) - uFront) * (circ / UV_METERS), 0.5 + (uv.getY(i) - 0.5) * (h / UV_METERS));
  }
  return finish(g, o, x, y, z);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!m) throw new Error('zombieModel: geometry merge failed');
  m.computeBoundingSphere();
  return m;
}

const DARK = { tex: 0, tint: 0 } as const;

// ---------------------------------------------------------------------------
// Horde part geometry (bone-local)
// ---------------------------------------------------------------------------

export type HordePart =
  | 'head' | 'jaw' | 'torso' | 'pelvis' | 'upperArm' | 'sleeve' | 'forearm' | 'thigh' | 'shin' | 'foot';

export const HORDE_PARTS: readonly HordePart[] = [
  'head', 'jaw', 'torso', 'pelvis', 'upperArm', 'sleeve', 'forearm', 'thigh', 'shin', 'foot',
];

/** Parts drawn twice per zombie (left + right). */
export const PAIRED_PARTS: ReadonlySet<HordePart> = new Set(['upperArm', 'sleeve', 'forearm', 'thigh', 'shin', 'foot']);

function headGeo(hero: boolean): THREE.BufferGeometry {
  const eyeGlow = hero ? 1.2 : 0.35;
  const parts = [
    prism(0.055, 0.062, 0.1, 0, 0.0, -0.005, {}), // neck
    box(0.25, 0.2, 0.265, 0, 0.215, -0.005, { taper: 0.9 }), // cranium
    box(0.225, 0.11, 0.24, 0, 0.1, 0.012, { taper: 1.1, taperZ: 1.02 }), // cheeks + upper jaw (sunken below)
    box(0.255, 0.045, 0.065, 0, 0.178, 0.112, { color: 0xc8c8c0 }), // heavy brow ridge
    box(0.08, 0.06, 0.03, 0.058, 0.143, 0.124, { color: 0x2c1f2c, tex: 0, tint: 0 }), // sunken sockets
    box(0.08, 0.064, 0.03, -0.06, 0.146, 0.124, { color: 0x2c1f2c, tex: 0, tint: 0 }),
    // asymmetric cloudy eyes
    box(0.044, 0.037, 0.02, 0.058, 0.141, 0.137, { color: hero ? 0xfff27a : 0xdfe6c8, tex: 0, tint: 0, glow: eyeGlow }),
    box(0.03, 0.025, 0.02, -0.062, 0.148, 0.137, { color: hero ? 0xffe25a : 0xc6ceaa, tex: 0, tint: 0, glow: eyeGlow * 0.8 }),
    box(0.013, 0.013, 0.01, 0.064, 0.139, 0.148, { color: 0x4a4a3a, ...DARK }), // one pupil
    box(0.036, 0.062, 0.046, 0.004, 0.108, 0.134, { color: 0xe4e4e0, rz: 0.13 }), // crooked nose
    box(0.115, 0.04, 0.03, 0.006, 0.062, 0.122, { color: 0x2a1214, ...DARK }), // mouth cavity
    box(0.04, 0.022, 0.02, -0.022, 0.07, 0.131, { color: 0xd8cc98, ...DARK }), // upper teeth with a gap
    box(0.032, 0.02, 0.02, 0.027, 0.069, 0.131, { color: 0xcfc28a, ...DARK }),
    box(0.03, 0.062, 0.05, 0.128, 0.14, -0.01, {}), // ears
    box(0.03, 0.06, 0.05, -0.128, 0.142, -0.005, { rz: 0.15 }),
    box(0.05, 0.034, 0.012, -0.086, 0.1, 0.118, { color: 0x6a2020, tex: 0, tint: 0 }), // cheek wound
    box(0.06, 0.025, 0.012, 0.05, 0.255, 0.12, { color: 0x5a2424, tex: 0, tint: 0, rz: -0.3 }), // forehead gash
  ];
  return merge(parts);
}

function jawGeo(): THREE.BufferGeometry {
  return merge([
    box(0.17, 0.058, 0.15, 0, -0.03, 0.035, { taper: 1.12 }),
    box(0.075, 0.018, 0.018, 0.008, -0.003, 0.1, { color: 0xd0c48c, ...DARK }),
    box(0.1, 0.016, 0.02, 0.012, -0.014, 0.106, { color: 0x5a3a3a, tex: 0, tint: 2, rz: 0.12 }), // uneven lower lip
  ]);
}

function torsoGeo(): THREE.BufferGeometry {
  return merge([
    prism(0.172, 0.165, 0.2, 0, 0.1, 0, { sz: 0.68 }), // belly
    prism(0.215, 0.178, 0.3, 0, 0.345, 0.004, { sz: 0.62 }), // chest
    box(0.4, 0.07, 0.2, 0, 0.5, -0.005, { taper: 0.62 }), // hunched trapezius
    prism(0.075, 0.08, 0.05, 0, 0.545, 0.005, {}), // collar
    // tattered hem
    box(0.07, 0.07, 0.02, 0.08, -0.005, 0.11, { rz: 0.2, rx: -0.1 }),
    box(0.06, 0.09, 0.02, -0.05, -0.015, 0.112, { rz: -0.15, rx: -0.08 }),
    box(0.02, 0.08, 0.07, 0.17, -0.01, 0.0, { rz: 0.12 }),
    box(0.08, 0.06, 0.02, -0.02, -0.0, -0.112, { rx: 0.1 }),
  ]);
}

function pelvisGeo(): THREE.BufferGeometry {
  return merge([
    prism(0.172, 0.158, 0.2, 0, 0.035, 0, { sz: 0.7 }),
    prism(0.178, 0.178, 0.04, 0, 0.12, 0, { sz: 0.72, color: 0x3a2c22, ...DARK }), // belt
    box(0.045, 0.032, 0.012, 0.0, 0.12, 0.128, { color: 0x9a8a5a, ...DARK }), // buckle
  ]);
}

function upperArmGeo(): THREE.BufferGeometry {
  return merge([
    box(0.12, 0.09, 0.12, 0, -0.025, 0, { taper: 0.85 }), // shoulder cap
    prism(0.058, 0.047, 0.27, 0, -0.145, 0, { sz: 0.95 }),
  ]);
}

function sleeveGeo(): THREE.BufferGeometry {
  return merge([
    prism(0.074, 0.07, 0.14, 0, -0.065, 0, { sz: 0.98 }),
    box(0.04, 0.05, 0.012, 0.02, -0.15, 0.06, { rx: -0.1 }), // shredded hem
    box(0.012, 0.045, 0.035, 0.068, -0.145, -0.01, {}),
  ]);
}

function forearmGeo(): THREE.BufferGeometry {
  const claw = { color: 0x3c3428, tex: 0, tint: 0 };
  const hand = { tex: 0, tint: 2 } as const;
  return merge([
    prism(0.047, 0.04, 0.21, 0, -0.105, 0, { sz: 0.92 }),
    box(0.072, 0.085, 0.036, 0, -0.255, 0.006, { ...hand, taper: 1.12 }), // palm
    box(0.016, 0.065, 0.018, 0.027, -0.325, 0.012, { ...hand, rx: -0.4 }), // curled fingers
    box(0.016, 0.072, 0.018, 0.009, -0.33, 0.014, { ...hand, rx: -0.5 }),
    box(0.016, 0.068, 0.018, -0.009, -0.328, 0.013, { ...hand, rx: -0.45 }),
    box(0.015, 0.054, 0.018, -0.027, -0.318, 0.01, { ...hand, rx: -0.35 }),
    box(0.018, 0.05, 0.018, 0.0, -0.245, 0.042, { ...hand, rx: -0.8 }), // thumb
    box(0.017, 0.016, 0.02, 0.027, -0.358, 0.026, claw),
    box(0.017, 0.016, 0.02, 0.009, -0.366, 0.031, claw),
    box(0.017, 0.016, 0.02, -0.009, -0.362, 0.029, claw),
    box(0.016, 0.016, 0.02, -0.027, -0.344, 0.022, claw),
  ]);
}

function thighGeo(): THREE.BufferGeometry {
  return merge([prism(0.084, 0.064, 0.36, 0, -0.17, 0, { sz: 0.95 })]);
}

function shinGeo(): THREE.BufferGeometry {
  return merge([
    box(0.075, 0.07, 0.07, 0, -0.01, 0.02, { taper: 0.9 }), // knee
    prism(0.06, 0.044, 0.3, 0, -0.165, -0.005, { sz: 0.95 }),
  ]);
}

function footGeo(): THREE.BufferGeometry {
  return merge([
    box(0.095, 0.075, 0.2, 0, -0.025, 0.035, { taper: 0.88 }),
    box(0.092, 0.05, 0.07, 0, -0.035, 0.145, { taper: 0.8 }), // toe cap
    box(0.102, 0.014, 0.25, 0, -0.056, 0.05, { color: 0x2a2622, ...DARK }), // sole
  ]);
}

const PART_BUILDERS: Record<HordePart, () => THREE.BufferGeometry> = {
  head: () => headGeo(false),
  jaw: jawGeo,
  torso: torsoGeo,
  pelvis: pelvisGeo,
  upperArm: upperArmGeo,
  sleeve: sleeveGeo,
  forearm: forearmGeo,
  thigh: thighGeo,
  shin: shinGeo,
  foot: footGeo,
};

// ---------------------------------------------------------------------------
// Accessories (bone-local, colour from instance tint, fixed atlas tile per vertex)
// ---------------------------------------------------------------------------

export const ACCESSORY_BONE: Record<AccessoryKind, number> = {
  hairShort: BONE.head,
  hairMop: BONE.head,
  policeCap: BONE.head,
  hardHat: BONE.head,
  helmet: BONE.head,
  sunglasses: BONE.head,
  tie: BONE.spine,
  vest: BONE.spine,
  flap: BONE.spine,
};

/** Accessories that stay visible at far LOD (they define the silhouette). */
export const SILHOUETTE_ACCESSORIES: ReadonlySet<AccessoryKind> = new Set(['hairMop', 'policeCap', 'hardHat', 'helmet', 'vest', 'flap']);

function withTile(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('aTile', new THREE.BufferAttribute(new Float32Array(n).fill(tile), 1));
  return g;
}

function accessoryGeo(kind: AccessoryKind): THREE.BufferGeometry {
  switch (kind) {
    case 'hairShort':
      return withTile(merge([
        box(0.262, 0.06, 0.28, 0, 0.32, -0.008, { taper: 0.9 }),
        box(0.262, 0.13, 0.07, 0, 0.24, -0.118, {}),
        box(0.05, 0.05, 0.05, 0.07, 0.355, 0.04, { rz: 0.5, rx: 0.3 }),
        box(0.05, 0.05, 0.05, -0.06, 0.352, -0.05, { rz: -0.4 }),
        box(0.04, 0.06, 0.04, 0.0, 0.36, 0.08, { rx: 0.6 }),
      ]), TILE.hair);
    case 'hairMop':
      return withTile(merge([
        box(0.285, 0.085, 0.3, 0, 0.32, -0.01, { taper: 0.92 }),
        box(0.045, 0.17, 0.25, 0.132, 0.225, -0.02, { rz: -0.06 }),
        box(0.045, 0.19, 0.25, -0.132, 0.215, -0.02, { rz: 0.06 }),
        box(0.285, 0.23, 0.06, 0, 0.18, -0.13, { taper: 1.05 }),
        box(0.1, 0.08, 0.03, 0.06, 0.255, 0.14, { rx: -0.3, rz: 0.2 }), // stringy fringe
        box(0.06, 0.1, 0.03, -0.05, 0.245, 0.14, { rx: -0.25, rz: -0.25 }),
      ]), TILE.hair);
    case 'policeCap':
      return withTile(merge([
        prism(0.148, 0.142, 0.085, 0, 0.33, -0.005, { sides: 8, sz: 1.05 }),
        prism(0.165, 0.15, 0.035, 0, 0.385, -0.005, { sides: 8, sz: 1.08 }),
        box(0.23, 0.018, 0.1, 0, 0.3, 0.17, { rx: 0.28, color: 0x121418, ...DARK }),
        box(0.045, 0.045, 0.012, 0, 0.345, 0.153, { color: 0xe2b33c, ...DARK }),
      ]), TILE.plain);
    case 'hardHat':
      return withTile(merge([
        prism(0.1, 0.152, 0.11, 0, 0.345, -0.005, { sides: 8 }),
        prism(0.19, 0.19, 0.02, 0, 0.292, 0.01, { sides: 8, sz: 1.12 }),
        box(0.04, 0.03, 0.27, 0, 0.4, -0.005, {}),
      ]), TILE.plain);
    case 'helmet':
      return withTile(merge([
        prism(0.115, 0.158, 0.13, 0, 0.33, -0.01, { sides: 8 }),
        prism(0.165, 0.165, 0.022, 0, 0.27, -0.01, { sides: 8, sz: 1.06 }),
        box(0.25, 0.03, 0.02, 0, 0.3, 0.165, { color: 0xe0782a, tex: 0, tint: 0 }),
      ]), TILE.fatigues);
    case 'sunglasses':
      return withTile(merge([
        box(0.24, 0.018, 0.02, 0, 0.168, 0.15, { color: 0x18181c, ...DARK, rz: 0.12 }),
        box(0.082, 0.046, 0.012, 0.056, 0.15, 0.153, { color: 0x1c2a40, tex: 0, tint: 0, rz: 0.12, glow: 0.05 }),
        box(0.082, 0.046, 0.012, -0.058, 0.136, 0.153, { color: 0x1c2a40, tex: 0, tint: 0, rz: 0.12, glow: 0.05 }),
        box(0.012, 0.014, 0.17, 0.124, 0.17, 0.06, { color: 0x18181c, ...DARK }),
        box(0.012, 0.014, 0.17, -0.124, 0.14, 0.06, { color: 0x18181c, ...DARK, rx: 0.15 }),
      ]), TILE.plain);
    case 'tie':
      return withTile(merge([
        box(0.05, 0.045, 0.03, 0, 0.5, 0.118, {}),
        box(0.062, 0.25, 0.016, 0.004, 0.35, 0.128, { taper: 0.7, rx: -0.12, rz: 0.06 }),
      ]), TILE.plain);
    case 'vest':
      return withTile(merge([
        prism(0.235, 0.205, 0.3, 0, 0.34, 0.004, { sz: 0.66 }),
        box(0.08, 0.07, 0.04, 0.08, 0.27, 0.15, { color: 0x3a3f2c, tex: 0, tint: 0 }), // pouches
        box(0.08, 0.07, 0.04, -0.08, 0.27, 0.15, { color: 0x3a3f2c, tex: 0, tint: 0 }),
      ]), TILE.hiVis);
    case 'flap':
      return withTile(merge([
        box(0.26, 0.27, 0.1, 0, 0.3, -0.175, { rx: 0.08, taper: 0.92 }),
        box(0.04, 0.3, 0.02, 0.12, 0.36, -0.02, { rx: -0.1, color: 0x3a2c22, ...DARK }),
        box(0.04, 0.3, 0.02, -0.12, 0.36, -0.02, { rx: -0.1, color: 0x3a2c22, ...DARK }),
      ]), TILE.leather);
  }
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const ATLAS_INSET = 2 / 128;

function patchChunk(chunk: string, find: string, replace: string): string {
  if (!chunk.includes(find)) throw new Error(`zombieModel: shader chunk changed (missing "${find}")`);
  return chunk.replace(find, replace);
}

/** Patches a MeshStandardMaterial with the atlas / tint / glow attributes described in the module header. */
export function createZombieMaterial(opts: { instanced: boolean; emissive?: number }): THREE.MeshStandardMaterial {
  const atlas = getZombieAtlas();
  const mat = new THREE.MeshStandardMaterial({
    map: atlas.map,
    normalMap: atlas.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true,
    flatShading: true,
    roughness: 0.86,
    metalness: 0.0,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
  });
  mat.name = opts.instanced ? 'ZombieHordeMaterial' : 'ZombieHeroMaterial';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aTile;
attribute vec3 aSkin;
attribute vec3 aMat;
varying float vTile;
varying vec3 vMat;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
vTile = aTile;
vMat = aMat;
#ifdef USE_COLOR
  vColor.rgb = color.rgb;
  if (aMat.y > 1.5) {
    vColor.rgb *= aSkin;
  }
#ifdef USE_INSTANCING_COLOR
  else if (aMat.y > 0.5) {
    vColor.rgb *= instanceColor.rgb;
  }
#endif
#endif`);
    const N = ATLAS_GRID.toFixed(1);
    const inset = ATLAS_INSET.toFixed(5);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vTile;
varying vec3 vMat;
vec4 zAtlas(sampler2D tex, vec2 uv) {
  float t = floor(vTile + 0.5);
  vec2 cell = vec2(mod(t, ${N}), ${N} - 1.0 - floor(t / ${N}));
  float span = (1.0 - 2.0 * ${inset}) / ${N};
  vec2 st = (cell + ${inset}) / ${N} + fract(uv) * span;
  return textureGrad(tex, st, dFdx(uv) * span, dFdy(uv) * span);
}`)
      // Includes are expanded after onBeforeCompile, so patch the chunk text and inline it.
      .replace('#include <map_fragment>', patchChunk(THREE.ShaderChunk.map_fragment,
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        'vec4 sampledDiffuseColor = mix( vec4( 1.0 ), zAtlas( map, vMapUv ), vMat.x );'))
      .replace('#include <normal_fragment_maps>', patchChunk(THREE.ShaderChunk.normal_fragment_maps,
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = mix( vec3( 0.5, 0.5, 1.0 ), zAtlas( normalMap, vNormalMapUv ).xyz, vMat.x ) * 2.0 - 1.0;'))
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vColor.rgb * vMat.z;`);
  };
  mat.customProgramCacheKey = () => (opts.instanced ? 'zombie-atlas-i' : 'zombie-atlas-h');
  return mat;
}

// ---------------------------------------------------------------------------
// Horde geometry access
// ---------------------------------------------------------------------------

let cachedParts: Record<HordePart, THREE.BufferGeometry> | null = null;
let cachedAccessories: Record<AccessoryKind, THREE.BufferGeometry> | null = null;

export function getHordePartGeometries(): Record<HordePart, THREE.BufferGeometry> {
  if (!cachedParts) {
    const out = {} as Record<HordePart, THREE.BufferGeometry>;
    for (const p of HORDE_PARTS) out[p] = PART_BUILDERS[p]();
    cachedParts = out;
  }
  return cachedParts;
}

export function getAccessoryGeometries(): Record<AccessoryKind, THREE.BufferGeometry> {
  if (!cachedAccessories) {
    const out = {} as Record<AccessoryKind, THREE.BufferGeometry>;
    for (const k of Object.keys(ACCESSORY_BONE) as AccessoryKind[]) out[k] = accessoryGeo(k);
    cachedAccessories = out;
  }
  return cachedAccessories;
}

export function disposeHordeGeometries(): void {
  if (cachedParts) for (const g of Object.values(cachedParts)) g.dispose();
  if (cachedAccessories) for (const g of Object.values(cachedAccessories)) g.dispose();
  cachedParts = null;
  cachedAccessories = null;
}

// ---------------------------------------------------------------------------
// The Alpha (hero rig): same skeleton, richer per-part detail, tints baked per vertex
// ---------------------------------------------------------------------------

/** Bake tile + tint into a geometry built for the instanced path (aMat.y tint modes → vertex colour). */
function bakeHero(g: THREE.BufferGeometry, tile: number, tint: number, skin: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const color = g.getAttribute('color') as THREE.BufferAttribute;
  const mat = g.getAttribute('aMat') as THREE.BufferAttribute;
  const tc = new THREE.Color(tint);
  const sc = new THREE.Color(skin);
  const tiles = g.getAttribute('aTile') as THREE.BufferAttribute | undefined;
  const tileArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const mode = mat.getY(i);
    const c = mode > 1.5 ? sc : mode > 0.5 ? tc : null;
    if (c) color.setXYZ(i, color.getX(i) * c.r, color.getY(i) * c.g, color.getZ(i) * c.b);
    mat.setY(i, 0);
    tileArr[i] = tiles ? tiles.getX(i) : tile;
  }
  g.setAttribute('aTile', new THREE.BufferAttribute(tileArr, 1));
  g.setAttribute('aSkin', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

function heroExtras(bone: number, look: ZombieLook): THREE.BufferGeometry[] {
  const bone2 = 0xd9cfae;
  const pad = 0x8f7952;
  const trim = 0x4d1e16;
  switch (bone) {
    case BONE.spine:
      return [
        // asymmetric plated shoulder pads + bone spikes down the back: reads as the Alpha from afar
        bakeHero(box(0.24, 0.12, 0.3, 0.2, 0.5, 0, { color: pad, tex: 0, tint: 0, rz: -0.28 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.07, 0.15, 0.07, 0.25, 0.6, 0, { color: 0xb8a47e, tex: 0, tint: 0, rz: -0.2 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.2, 0.11, 0.28, -0.2, 0.5, 0, { color: pad, tex: 0, tint: 0, rz: 0.28 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.065, 0.13, 0.065, -0.24, 0.59, 0, { color: 0xb8a47e, tex: 0, tint: 0, rz: 0.2 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.06, 0.16, 0.07, 0, 0.46, -0.16, { color: bone2, tex: 0, tint: 0, rx: 0.6 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.06, 0.14, 0.07, 0, 0.3, -0.165, { color: bone2, tex: 0, tint: 0, rx: 0.6 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.06, 0.12, 0.07, 0, 0.15, -0.16, { color: bone2, tex: 0, tint: 0, rx: 0.6 }), TILE.plain, 0xffffff, look.skin),
        // torn hood / high collar
        bakeHero(prism(0.16, 0.13, 0.12, 0, 0.56, -0.03, { sz: 0.8, color: trim, tex: 0, tint: 0 }), TILE.plain, 0xffffff, look.skin),
        // exposed ribs through a tear
        bakeHero(box(0.12, 0.015, 0.02, 0.07, 0.3, 0.135, { color: 0xd8ceb0, tex: 0, tint: 0, rz: 0.1 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.11, 0.015, 0.02, 0.07, 0.27, 0.136, { color: 0xd0c6a8, tex: 0, tint: 0, rz: 0.1 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.13, 0.08, 0.012, 0.07, 0.285, 0.13, { color: 0x3a1010, tex: 0, tint: 0 }), TILE.plain, 0xffffff, look.skin),
      ];
    case BONE.forearmL:
    case BONE.forearmR:
      return [
        // longer, sharper claws
        bakeHero(box(0.016, 0.05, 0.016, 0.027, -0.385, 0.04, { color: 0xe8e0c8, tex: 0, tint: 0, rx: -0.6 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.016, 0.055, 0.016, 0.009, -0.392, 0.045, { color: 0xe8e0c8, tex: 0, tint: 0, rx: -0.6 }), TILE.plain, 0xffffff, look.skin),
        bakeHero(box(0.016, 0.05, 0.016, -0.009, -0.388, 0.043, { color: 0xe8e0c8, tex: 0, tint: 0, rx: -0.6 }), TILE.plain, 0xffffff, look.skin),
      ];
    default:
      return [];
  }
}

export interface ZombieHeroRig {
  root: THREE.Group;
  materials: THREE.Material[];
  meshes: THREE.Mesh[];
  /** Bone-relative matrices (root group carries position + facing). */
  bones: THREE.Matrix4[];
  scale: number;
  width: number;
  apply(pose: ZombiePose): void;
  dispose(): void;
}

export function createZombieHeroRig(look: ZombieLook, scale: number, width: number): ZombieHeroRig {
  const root = new THREE.Group();
  root.name = 'ZombieHeroRig';
  const mat = createZombieMaterial({ instanced: false, emissive: LEADER_GLOW });
  const bones = createBoneMatrices();
  const identity = new THREE.Matrix4();

  const torsoTile = look.torsoTile;
  const pantsTile = look.pantsTile;
  const skinTile = look.skinTile;
  const sleeveLong = look.sleeves === 'long';
  type Spec = { bone: number; geo: THREE.BufferGeometry };
  const specs: Spec[] = [];
  const add = (bone: number, g: THREE.BufferGeometry, tile: number, tint: number): void => {
    specs.push({ bone, geo: bakeHero(g, tile, tint, look.skin) });
  };
  add(BONE.head, headGeo(true), skinTile, look.skin);
  add(BONE.jaw, jawGeo(), skinTile, look.skin);
  add(BONE.spine, torsoGeo(), torsoTile, look.torsoTint);
  add(BONE.hips, pelvisGeo(), pantsTile, look.pantsTint);
  for (const [ua, fa, th, sh, ft, side] of [
    [BONE.upperArmL, BONE.forearmL, BONE.thighL, BONE.shinL, BONE.footL, 1],
    [BONE.upperArmR, BONE.forearmR, BONE.thighR, BONE.shinR, BONE.footR, -1],
  ] as const) {
    add(ua, upperArmGeo(), sleeveLong ? torsoTile : skinTile, sleeveLong ? look.torsoTint : look.skin);
    if (look.sleeves !== 'none') add(ua, sleeveGeo(), torsoTile, look.torsoTint);
    // The Alpha's right sleeve is torn away: bare, scarred forearm.
    const bareForearm = !sleeveLong || side === -1;
    add(fa, forearmGeo(), bareForearm ? skinTile : torsoTile, bareForearm ? look.skin : look.torsoTint);
    add(th, thighGeo(), pantsTile, look.pantsTint);
    const bareShin = look.shorts || look.tornLeg === side;
    add(sh, shinGeo(), bareShin ? skinTile : pantsTile, bareShin ? look.skin : look.pantsTint);
    add(ft, footGeo(), TILE.leather, look.shoeTint);
  }
  for (let bone = 0; bone < BONE_COUNT; bone++) {
    for (const g of heroExtras(bone, look)) specs.push({ bone, geo: g });
  }

  // Merge per bone → one mesh per bone.
  const byBone = new Map<number, THREE.BufferGeometry[]>();
  for (const s of specs) {
    const list = byBone.get(s.bone) ?? [];
    list.push(s.geo);
    byBone.set(s.bone, list);
  }
  const meshes: THREE.Mesh[] = [];
  const meshBones: number[] = [];
  for (const [bone, list] of byBone) {
    const geo = merge(list);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.name = `HeroBone${bone}`;
    root.add(mesh);
    meshes.push(mesh);
    meshBones.push(bone);
  }

  const rig: ZombieHeroRig = {
    root,
    materials: [mat],
    meshes,
    bones,
    scale,
    width,
    apply(pose: ZombiePose): void {
      composeBones(pose, identity, scale, width, bones);
      for (let i = 0; i < meshes.length; i++) {
        meshes[i].matrix.copy(bones[meshBones[i]]);
        meshes[i].matrixWorldNeedsUpdate = true;
      }
    },
    dispose(): void {
      for (const m of meshes) m.geometry.dispose();
      mat.dispose();
    },
  };
  return rig;
}
