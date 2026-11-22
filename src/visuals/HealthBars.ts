import * as THREE from 'three';
import type { GameState } from '../core/types';
import { isIdentified } from '../systems/AwarenessSystem';

/**
 * Camera-facing overhead health bars for every living, damaged character (horde zombies, humans).
 * Bars are hidden at full health. Two InstancedMeshes (background + fill) => 2 draw calls total.
 * The fill is anchored at the bar's left edge and scaled by hp/maxHp, colored by remaining health.
 */
const BAR_W = 0.9;
const BAR_H = 0.11;
const BORDER = 0.035;

export class HealthBars {
  readonly group = new THREE.Group();

  private readonly bgGeo: THREE.PlaneGeometry;
  private readonly fillGeo: THREE.PlaneGeometry;
  private readonly bgMat: THREE.MeshBasicMaterial;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly bg: THREE.InstancedMesh;
  private readonly fill: THREE.InstancedMesh;

  private readonly camQuat = new THREE.Quaternion();
  private readonly camRight = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private count = 0;
  private visionGating = false;

  constructor(private readonly maxBars = 260) {
    this.group.name = 'HealthBars';
    this.bgGeo = new THREE.PlaneGeometry(1, 1);
    // Fill spans x in [0, 1] so scaling x shrinks it toward the left edge.
    this.fillGeo = new THREE.PlaneGeometry(1, 1);
    this.fillGeo.translate(0.5, 0, 0);

    this.bgMat = new THREE.MeshBasicMaterial({
      color: 0x14181e, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, fog: false,
    });
    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, fog: false,
    });

    this.bg = new THREE.InstancedMesh(this.bgGeo, this.bgMat, maxBars);
    this.fill = new THREE.InstancedMesh(this.fillGeo, this.fillMat, maxBars);
    this.fill.setColorAt(0, this.color.setHex(0xffffff));
    for (const m of [this.bg, this.fill]) {
      m.frustumCulled = false;
      m.count = 0;
      m.castShadow = false;
      m.receiveShadow = false;
    }
    // Both are transparent; renderOrder guarantees the fill draws on top of its background.
    this.bg.renderOrder = 20;
    this.fill.renderOrder = 21;
    this.group.add(this.bg, this.fill);
  }

  /** Gate human health bars by AwarenessSystem.isIdentified (default false for legacy layout). */
  setVisionGating(enabled: boolean): void {
    this.visionGating = enabled;
  }

  /** Call after the camera has been positioned for this frame. */
  update(state: GameState, alpha: number, camera: THREE.Camera): void {
    camera.getWorldQuaternion(this.camQuat);
    this.camRight.set(1, 0, 0).applyQuaternion(this.camQuat);
    this.count = 0;

    for (const z of state.zombies) {
      if (z.state === 'dead' || z.state === 'rising' || z.hp <= 0 || z.hp >= z.maxHp) continue;
      this.addBar(
        z.prevPos.x + (z.pos.x - z.prevPos.x) * alpha, z.elevation + 2.05,
        z.prevPos.z + (z.pos.z - z.prevPos.z) * alpha,
        z.hp / z.maxHp, 0.8, false,
      );
    }

    for (const g of state.guards) {
      if (g.state === 'DEAD' || g.hp <= 0 || g.hp >= g.maxHp) continue;
      if (this.visionGating && !isIdentified(state, g.id)) continue;
      this.addBar(
        g.prevPos.x + (g.pos.x - g.prevPos.x) * alpha, g.elevation + 2.2,
        g.prevPos.z + (g.pos.z - g.prevPos.z) * alpha,
        g.hp / g.maxHp, 1.0, true,
      );
    }

    this.bg.count = this.count;
    this.fill.count = this.count;
    this.bg.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.bg.dispose();
    this.fill.dispose();
    this.bgGeo.dispose();
    this.fillGeo.dispose();
    this.bgMat.dispose();
    this.fillMat.dispose();
    this.group.clear();
  }

  private addBar(x: number, y: number, z: number, fracRaw: number, size: number, human: boolean): void {
    if (this.count >= this.maxBars) return;
    const i = this.count++;
    const frac = Math.min(1, Math.max(0, fracRaw));
    const w = BAR_W * size;
    const h = BAR_H * size;

    // Background (centered, slightly larger for a border).
    this.pos.set(x, y, z);
    this.scale.set(w + BORDER * 2, h + BORDER * 2, 1);
    this.matrix.compose(this.pos, this.camQuat, this.scale);
    this.bg.setMatrixAt(i, this.matrix);

    // Fill: start at the left edge of the inner area (camera-right axis), width scaled by health.
    this.pos.set(x, y, z).addScaledVector(this.camRight, -w / 2);
    this.scale.set(Math.max(0.0001, w * frac), h, 1);
    this.matrix.compose(this.pos, this.camQuat, this.scale);
    this.fill.setMatrixAt(i, this.matrix);

    if (human) {
      this.color.setHex(frac > 0.55 ? 0xe0782a : frac > 0.28 ? 0xf2a62c : 0xe83b2c);
    } else {
      this.color.setHex(frac > 0.55 ? 0x7ee852 : frac > 0.28 ? 0xe8d84a : 0xe83b2c);
    }
    this.fill.setColorAt(i, this.color);
  }
}
