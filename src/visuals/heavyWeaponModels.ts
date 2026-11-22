// [3D] Low-poly heavy stronghold weapons drawn on top of their crew (HeavyWeapon): a tripod machine gun the gunner
// stands behind, and a tank whose hull is fixed (GuardAgent.hullFacing) while the turret tracks the crew's aim.
// Everything is a handful of flat-shaded boxes/cylinders with one owned material per model (hit flash / wreck tint).
import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { HeavyWeapon } from '../core/types';

export interface HeavyModel {
  kind: HeavyWeapon;
  /** MG: child of the crew rig (follows facing). Tank: placed in world space by the renderer. */
  root: THREE.Group;
  /** Tank turret (yaw relative to the hull); null for the MG. */
  turret: THREE.Group | null;
  barrel: THREE.Object3D;
  meshes: THREE.Mesh[];
  material: THREE.MeshLambertMaterial;
  geometries: THREE.BufferGeometry[];
  wrecked: boolean;
}

const WRECK = new THREE.Color(0x2c2a27);

function painted(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function part(model: HeavyModel, parent: THREE.Object3D, geo: THREE.BufferGeometry, hex: number,
  x: number, y: number, z: number): THREE.Mesh {
  const g = painted(geo, hex);
  const mesh = new THREE.Mesh(g, model.material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  model.meshes.push(mesh);
  model.geometries.push(g);
  return mesh;
}

function newModel(kind: HeavyWeapon): HeavyModel {
  return {
    kind, root: new THREE.Group(), turret: null, barrel: new THREE.Object3D(), meshes: [], geometries: [], wrecked: false,
    material: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  };
}

/** Tripod MG in front of the gunner (local +Z = facing), barrel at chest height. */
export function createMachineGun(): HeavyModel {
  const m = newModel('mg');
  m.root.name = 'HeavyMG';
  const steel = 0x2b3035, dark = 0x1b1e21;
  for (const [x, z] of [[-0.32, 0.75], [0.32, 0.75], [0, 0.3]]) {
    const leg = part(m, m.root, new THREE.CylinderGeometry(0.03, 0.035, 1.15, 5), steel, x, 0.52, z);
    leg.rotation.x = z > 0.5 ? -0.35 : 0.35;
  }
  part(m, m.root, new THREE.BoxGeometry(0.2, 0.18, 0.62), dark, 0, 1.1, 0.62); // receiver
  const barrel = part(m, m.root, new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6), steel, 0, 1.12, 1.25);
  barrel.rotation.x = Math.PI / 2;
  part(m, m.root, new THREE.BoxGeometry(0.42, 0.34, 0.06), 0x3d4436, 0, 1.18, 0.86); // gun shield
  part(m, m.root, new THREE.BoxGeometry(0.22, 0.16, 0.3), 0x55603a, 0.26, 0.95, 0.5); // ammo can
  m.barrel = barrel;
  return m;
}

/** Tank: hull + tracks, turret with a long gun (local +Z = forward). */
export function createTank(): HeavyModel {
  const m = newModel('tank');
  m.root.name = 'HeavyTank';
  const t = BALANCE.heavy.tank, w = t.hullWidth, l = t.hullLength;
  const hull = 0x5a6440, hullDark = 0x434b30, track = 0x26282a;
  for (const side of [-1, 1]) {
    part(m, m.root, new THREE.BoxGeometry(0.72, 0.95, l), track, side * (w / 2 - 0.36), 0.48, 0);
    for (let i = 0; i < 5; i++) {
      const wheel = part(m, m.root, new THREE.CylinderGeometry(0.32, 0.32, 0.12, 8), 0x3a3d3f,
        side * (w / 2 + 0.02), 0.38, -l / 2 + 0.7 + i * (l - 1.4) / 4);
      wheel.rotation.z = Math.PI / 2;
    }
  }
  part(m, m.root, new THREE.BoxGeometry(w - 1.3, 0.8, l - 0.2), hull, 0, 0.85, 0);
  part(m, m.root, new THREE.BoxGeometry(w - 0.2, 0.36, l - 0.6), hullDark, 0, 1.38, -0.1);
  part(m, m.root, new THREE.BoxGeometry(w - 0.4, 0.34, 0.9), hull, 0, 1.15, l / 2 - 0.35); // glacis
  const turret = new THREE.Group();
  turret.position.set(0, 1.56, -0.25);
  m.root.add(turret);
  part(m, turret, new THREE.BoxGeometry(2.0, 0.62, 2.3), hull, 0, 0.31, 0);
  part(m, turret, new THREE.BoxGeometry(1.5, 0.22, 1.2), hullDark, 0, 0.72, -0.25);
  part(m, turret, new THREE.CylinderGeometry(0.3, 0.3, 0.18, 8), 0x3a4128, 0.45, 0.92, -0.35); // hatch
  const gun = part(m, turret, new THREE.CylinderGeometry(0.09, 0.12, 3.0, 8), 0x353a2a, 0, 0.36, 2.55);
  gun.rotation.x = Math.PI / 2;
  part(m, turret, new THREE.BoxGeometry(0.34, 0.34, 0.4), 0x353a2a, 0, 0.36, 1.2); // mantlet
  m.turret = turret;
  m.barrel = gun;
  return m;
}

/** Knocked-out look: charred tint, turret slewed and the gun drooping. Idempotent. */
export function setWrecked(m: HeavyModel, wrecked: boolean): void {
  if (m.wrecked === wrecked) return;
  m.wrecked = wrecked;
  m.material.color.copy(wrecked ? WRECK : new THREE.Color(0xffffff));
  if (m.kind === 'tank' && m.turret) {
    m.turret.rotation.z = wrecked ? 0.12 : 0;
    m.barrel.rotation.x = wrecked ? Math.PI / 2 + 0.22 : Math.PI / 2;
  } else if (m.kind === 'mg') {
    m.root.rotation.z = wrecked ? 0.9 : 0;
    m.root.position.y = wrecked ? -0.35 : 0;
  }
}

export function setHeavyMaterial(m: HeavyModel, mat: THREE.Material): void {
  for (const mesh of m.meshes) mesh.material = mat;
}

export function disposeHeavy(m: HeavyModel): void {
  m.root.removeFromParent();
  for (const g of m.geometries) g.dispose();
  m.material.dispose();
}
