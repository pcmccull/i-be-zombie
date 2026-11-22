// [3D] Warm Miami daytime lighting baseline (docs/8_visual_polish.md §6).
// Sun (only shadow caster) + sky/ground hemisphere + a cool, shadowless bounce fill from the opposite side so
// shaded faces keep form instead of going flat grey. Shadow map size follows the quality preset; the shadow
// frustum follows the focus so shadows work across the whole world (casters: buildings, leader, guards, palms).
import * as THREE from 'three';
import type { QualityProfile } from '../performance/GraphicsQuality';

/** Sun offset from the focus (m): south-west, high afternoon sun (long-ish but readable shadows). */
const SUN_OFFSET = new THREE.Vector3(-70, 112, 62);

export class LightingController {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  private shadowSize = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.hemisphere = new THREE.HemisphereLight(0xd8efff, 0x7a6a4c, 0.78);
    this.hemisphere.position.set(0, 80, 0);
    this.sun = new THREE.DirectionalLight(0xffe7c2, 1.55);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { near: 10, far: 310, left: -135, right: 135, top: 115, bottom: -115 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.fill = new THREE.DirectionalLight(0xbcd8ff, 0.28);
    this.fill.castShadow = false;
    this.fill.position.set(60, 40, -50);
    scene.add(this.hemisphere, this.sun, this.sun.target, this.fill, this.fill.target);
    this.setShadowSize(2048);
  }

  private setShadowSize(size: number): void {
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      // Re-allocate the shadow map at the new size on the next render.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  setQuality(p: QualityProfile): void {
    this.setShadowSize(p.shadowMapSize);
  }

  /** Keep the sun + fill (and the shadow frustum) centred on the focus. */
  follow(x: number, z: number): void {
    this.sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(x + 60, 40, z - 50);
    this.fill.target.position.set(x, 0, z);
    this.fill.target.updateMatrixWorld();
  }

  /** Shadow casters currently enabled in the scene (diagnostics). */
  countShadowCasters(): number {
    let n = 0;
    this.scene.traverseVisible((o) => {
      if (o.castShadow && (o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }

  dispose(): void {
    this.sun.shadow.dispose();
    this.scene.remove(this.hemisphere, this.sun, this.sun.target, this.fill, this.fill.target);
  }
}
