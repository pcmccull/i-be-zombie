// [3D] Collected brains (biomass) pop out of the body / structure / stronghold they came from and fly into the Alpha,
// leaving a twinkly trail, then burst into a small happy sparkle when they land. Render-only: driven by `biomassGain`
// events (their `pos`) and the interpolated Alpha position. One InstancedMesh, fixed pool.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameEvent } from '../core/types';
import type { VFXManager } from '../graphics/vfx/VFXManager';
import { BRAIN_FLY_S, BRAIN_STAGGER_S, brainCount, brainFlightAt, type BrainFlightPoint } from './brainPickupMath';

const POOL = 40;
const TRAIL_EVERY_S = 0.05;
/** Brains from farther away than this (m) are not drawn (a gain far off still counts; the HUD shows it). */
const MAX_SOURCE_DIST = 90;

interface Brain {
  active: boolean;
  /** Seconds until launch (stagger), then flight time. */
  delay: number; t: number; trail: number;
  sx: number; sz: number; side: number; spin: number;
}

function brainGeometry(): THREE.BufferGeometry {
  // Two squashed lobes + a small brain stem: reads as a cartoon brain from game distance.
  const lobe = (x: number) => {
    const g = new THREE.IcosahedronGeometry(0.17, 1);
    g.scale(0.85, 0.8, 1.15);
    g.translate(x, 0, 0);
    return g;
  };
  const stem = new THREE.CylinderGeometry(0.045, 0.06, 0.12, 5);
  stem.translate(0, -0.13, -0.05);
  const merged = mergeGeometries([lobe(-0.085), lobe(0.085), stem.toNonIndexed()], false);
  merged.computeVertexNormals();
  return merged;
}

export class BrainPickups {
  private readonly mesh: THREE.InstancedMesh;
  private readonly brains: Brain[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly pt: BrainFlightPoint = { x: 0, y: 0, z: 0, scale: 1 };
  private readonly payload = { x: 0, y: 0, z: 0 };
  private disposed = false;

  constructor(scene: THREE.Scene, private readonly vfx: VFXManager) {
    const base = brainGeometry();
    const material = new THREE.MeshLambertMaterial({ color: 0xff9fbd, emissive: 0x8a2f4a, flatShading: true });
    material.userData.noVisionHaze = true;
    this.mesh = new THREE.InstancedMesh(base, material, POOL);
    this.mesh.name = 'Brain pickups';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 10;
    this.mesh.userData.noVisionHaze = true;
    scene.add(this.mesh);
    for (let i = 0; i < POOL; i++) this.brains.push({ active: false, delay: 0, t: 0, trail: 0, sx: 0, sz: 0, side: 0, spin: 0 });
  }

  /** Spawn brains for every positioned `biomassGain` near the Alpha. */
  consume(events: readonly GameEvent[], leaderX: number, leaderZ: number): void {
    if (this.disposed) return;
    for (const ev of events) {
      if (ev.type !== 'biomassGain' || !ev.pos || !(ev.amount > 0)) continue;
      if ((ev.pos.x - leaderX) ** 2 + (ev.pos.z - leaderZ) ** 2 > MAX_SOURCE_DIST ** 2) continue;
      const n = brainCount(ev.amount);
      for (let k = 0; k < n; k++) {
        const b = this.brains.find(x => !x.active);
        if (!b) return;
        b.active = true; b.delay = k * BRAIN_STAGGER_S; b.t = 0; b.trail = 0;
        b.sx = ev.pos.x; b.sz = ev.pos.z;
        b.side = n === 1 ? 0.5 : -1 + (2 * k) / (n - 1);
        b.spin = (k % 2 ? -1 : 1) * (5 + k);
      }
    }
  }

  /** Advance flights toward the interpolated Alpha (x, z). */
  update(dt: number, leaderX: number, leaderZ: number): void {
    if (this.disposed) return;
    const step = Math.max(0, Math.min(0.1, dt));
    let count = 0;
    for (const b of this.brains) {
      if (!b.active) continue;
      if (b.delay > 0) { b.delay -= step; if (b.delay > 0) continue; }
      b.t += step;
      const u = b.t / BRAIN_FLY_S;
      const p = brainFlightAt(u, b.sx, b.sz, leaderX, leaderZ, b.side, this.pt);
      if (u >= 1) {
        b.active = false;
        this.payload.x = leaderX; this.payload.y = 1.6; this.payload.z = leaderZ;
        this.vfx.emit('brains.collect', this.payload);
        continue;
      }
      b.trail -= step;
      if (b.trail <= 0) {
        b.trail = TRAIL_EVERY_S;
        this.payload.x = p.x; this.payload.y = p.y; this.payload.z = p.z;
        this.vfx.emit('brains.trail', this.payload);
      }
      const d = this.dummy;
      d.position.set(p.x, p.y + Math.sin(b.t * 18) * 0.04, p.z);
      d.rotation.set(0.25, b.t * b.spin, Math.sin(b.t * 9) * 0.3);
      d.scale.setScalar(p.scale * 2.1);
      d.updateMatrix();
      this.mesh.setMatrixAt(count++, d.matrix);
    }
    this.mesh.count = count;
    if (count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    for (const b of this.brains) b.active = false;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
