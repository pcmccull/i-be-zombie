// [3D] todos #10b: corner shops (structures kind 'shopDoor'). Render-only: stucco walls from the shop's shell
// colliders, a striped awning and a lit DRINKS sign over the door, a glowing drinks fridge inside, and the drink cans
// (state.pickups) bobbing on the floor once the door is broken. The door itself is a Landmarks breakable (pick,
// highlight, damage, rubble). ~6 draw calls for every shop in the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../config/balance';
import type { DistrictLayout, GameState, StructureDef } from '../core/types';
import { asGroundDecal, DECAL_Y } from './groundLevels';

const STUCCO = [0xf4b6a6, 0xa8e0d2, 0xf7dc8f, 0xc7b8f0, 0xf6c28b];
const MAX_DRINKS = 64;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, keepUv = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.getAttribute('position').count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!keepUv) g.deleteAttribute('uv');
  return g;
}

function signTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#1f3a5c'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#7ff3ff'; g.lineWidth = 5; g.strokeRect(5, 5, 246, 54);
  g.fillStyle = '#ffe36b'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('DRINKS', 128, 34);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ShopScenery {
  readonly group = new THREE.Group();
  private readonly cans: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly texture: THREE.Texture | null;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(layout: DistrictLayout) {
    this.group.name = 'Shops';
    const shops = layout.structures.filter(s => s.kind === 'shopDoor');
    const walls: THREE.BufferGeometry[] = [], glowParts: THREE.BufferGeometry[] = [], signs: THREE.BufferGeometry[] = [];
    shops.forEach((def, i) => this.buildShop(layout, def, STUCCO[i % STUCCO.length], walls, glowParts, signs));
    const lambert = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.texture = signTexture();
    const signMat = new THREE.MeshBasicMaterial({ map: this.texture ?? undefined, color: this.texture ? 0xffffff : 0xffe36b });
    this.materials.push(lambert, glowMat, signMat);
    const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow: boolean) => {
      if (!parts.length) return;
      const geo = mergeGeometries(parts);
      for (const p of parts) p.dispose();
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name; mesh.castShadow = shadow; mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    add(walls, lambert, 'ShopWalls', true);
    add(glowParts, glowMat, 'ShopGlow', false);
    add(signs, signMat, 'ShopSigns', false);

    const canGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.34, 10);
    canGeo.translate(0, 0.17, 0);
    const canMat = new THREE.MeshLambertMaterial({ color: 0x39d3ff, emissive: 0x0f6f8f });
    const glowGeo = new THREE.RingGeometry(0.25, 0.55, 20);
    glowGeo.rotateX(-Math.PI / 2);
    const ringMat = asGroundDecal(new THREE.MeshBasicMaterial({ color: 0x7ff3ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.geometries.push(canGeo, glowGeo);
    this.materials.push(canMat, ringMat);
    this.cans = new THREE.InstancedMesh(canGeo, canMat, MAX_DRINKS);
    this.glows = new THREE.InstancedMesh(glowGeo, ringMat, MAX_DRINKS);
    for (const m of [this.cans, this.glows]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.cans.name = 'ShopDrinks';
    this.glows.name = 'ShopDrinkGlow';
  }

  private buildShop(layout: DistrictLayout, def: StructureDef, stucco: number, walls: THREE.BufferGeometry[],
    glow: THREE.BufferGeometry[], signs: THREE.BufferGeometry[]): void {
    const prefix = def.tag.replace(/-door$/, '-');
    const h = BALANCE.shops.wallHeight;
    for (const c of layout.colliders) {
      if (!c.tag?.startsWith(prefix) || c.tag === def.tag) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ, cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      walls.push(box(w, h, d, cx, h / 2, cz, stucco));
      walls.push(box(w + 0.12, 0.22, d + 0.12, cx, h + 0.06, cz, 0xf8f4ec)); // parapet trim
    }
    const south = Math.abs(def.facing) < 1e-6;
    const door = def.rect, e = def.enclosure;
    // Outward normal of the door face, and the facade span along it.
    const nx = south ? 0 : -1, nz = south ? 1 : 0;
    const faceX = south ? (door.minX + door.maxX) / 2 : door.minX, faceZ = south ? door.maxZ : (door.minZ + door.maxZ) / 2;
    const span = south ? e.maxX - e.minX + 1.2 : e.maxZ - e.minZ + 1.2;
    // Striped awning over the whole front.
    for (let k = 0; k < 6; k++) {
      const t = -span / 2 + span * (k + 0.5) / 6, col = k % 2 ? 0xffffff : 0xe8505b;
      const wx = south ? span / 6 : 1.3, wz = south ? 1.3 : span / 6;
      walls.push(box(wx, 0.12, wz, faceX + (south ? t : 0) + nx * 0.65, 2.75, faceZ + (south ? 0 : t) + nz * 0.65, col));
    }
    // DRINKS sign above the door (uv-mapped box, front face carries the texture).
    const sw = 2.6, sh = 0.62, st = 0.12;
    const sign = new THREE.BoxGeometry(south ? sw : st, sh, south ? st : sw).toNonIndexed();
    sign.translate(faceX + nx * 0.12, h - 0.25, faceZ + nz * 0.12);
    signs.push(sign);
    // Glowing fridge along the back wall.
    if (south) {
      glow.push(box(Math.min(4, e.maxX - e.minX - 1), 1.9, 0.5, (e.minX + e.maxX) / 2, 0.95, e.minZ + 0.3, 0x2aa7c9));
      glow.push(box(Math.min(3.8, e.maxX - e.minX - 1.2), 1.6, 0.05, (e.minX + e.maxX) / 2, 1.0, e.minZ + 0.57, 0x9ff6ff));
    } else {
      glow.push(box(0.5, 1.9, Math.min(4, e.maxZ - e.minZ - 1), e.maxX - 0.3, 0.95, (e.minZ + e.maxZ) / 2, 0x2aa7c9));
      glow.push(box(0.05, 1.6, Math.min(3.8, e.maxZ - e.minZ - 1.2), e.maxX - 0.57, 1.0, (e.minZ + e.maxZ) / 2, 0x9ff6ff));
    }
  }

  update(state: GameState, time: number): void {
    const n = Math.min(MAX_DRINKS, state.pickups.length);
    for (let i = 0; i < n; i++) {
      const p = state.pickups[i];
      const bob = 0.1 + Math.sin(time * 3 + p.id) * 0.07;
      this.q.setFromAxisAngle(this.up, time * 1.8 + p.id);
      this.p.set(p.pos.x, bob, p.pos.z);
      this.s.set(1, 1, 1);
      this.m4.compose(this.p, this.q, this.s);
      this.cans.setMatrixAt(i, this.m4);
      const pulse = 1 + Math.sin(time * 4 + p.id) * 0.15;
      this.s.set(pulse, 1, pulse);
      this.p.set(p.pos.x, DECAL_Y, p.pos.z);
      this.q.identity();
      this.m4.compose(this.p, this.q, this.s);
      this.glows.setMatrixAt(i, this.m4);
    }
    this.cans.count = n; this.glows.count = n;
    this.cans.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.texture?.dispose();
    this.group.removeFromParent();
  }
}
