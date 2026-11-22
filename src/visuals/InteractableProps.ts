// [3D] Generated interactables (trash cans, fire hydrants) — docs/11_cityupgrade.md §2.6.
// Parked cars / warning signs / barriers are ordinary layout props drawn by CityDistrict; the cans and hydrants that
// createInitialState adds beside benches and streetlights are drawn here: 2 instanced meshes (+ lids). A triggered prop
// reads as such while its cooldown runs (can tipped over, hydrant knocked crooked), then stands back up (reversible).
import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { GameState, WorldInteractable } from '../core/types';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class InteractableProps {
  readonly root = new THREE.Group();
  private readonly cans: THREE.InstancedMesh;
  private readonly lids: THREE.InstancedMesh;
  private readonly hydrants: THREE.InstancedMesh;
  /** Indices into state.interactables (stable per layout; the Simulation is rebuilt on load/restart). */
  private readonly canIdx: number[] = [];
  private readonly hydrantIdx: number[] = [];
  private lastSig = '';

  constructor(scene: THREE.Scene, state: GameState) {
    this.root.name = 'InteractableProps';
    state.interactables.forEach((i, k) => {
      if (i.kind === 'trashCan') this.canIdx.push(k);
      else if (i.kind === 'fireHydrant') this.hydrantIdx.push(k);
    });
    const canGeo = new THREE.CylinderGeometry(0.32, 0.27, 0.9, 8);
    canGeo.translate(0, 0.45, 0);
    const lidGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 8);
    lidGeo.translate(0, 0.94, 0);
    const hydGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.75, 7);
    hydGeo.translate(0, 0.375, 0);
    const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    this.cans = new THREE.InstancedMesh(canGeo, flat(0x2f6b4f), Math.max(1, this.canIdx.length));
    this.lids = new THREE.InstancedMesh(lidGeo, flat(0x3c4652), Math.max(1, this.canIdx.length));
    this.hydrants = new THREE.InstancedMesh(hydGeo, flat(0xd83b2f), Math.max(1, this.hydrantIdx.length));
    this.cans.count = this.lids.count = this.canIdx.length;
    this.hydrants.count = this.hydrantIdx.length;
    for (const mesh of [this.cans, this.lids, this.hydrants]) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances span the whole city
      this.root.add(mesh);
    }
    scene.add(this.root);
    this.update(state);
  }

  /** Cheap: only rewrites matrices when some prop's knocked-over state changed. */
  update(state: GameState): void {
    let sig = '';
    const knocked = (i: WorldInteractable) => state.time - i.lastTriggeredAt < Math.min(i.cooldown, BALANCE.city.interactableTriggerCooldown);
    const items = state.interactables;
    for (const k of this.canIdx) if (items[k] && knocked(items[k])) sig += `c${k},`;
    for (const k of this.hydrantIdx) if (items[k] && knocked(items[k])) sig += `h${k},`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.canIdx.forEach((idx, k) => {
      const item = items[idx];
      if (!item) return;
      const down = knocked(item);
      const yaw = (item.id * 1.7) % (Math.PI * 2);
      _e.set(down ? Math.PI / 2 : 0, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(item.pos.x, down ? 0.3 : 0, item.pos.z);
      _m.compose(_p, _q, _s);
      this.cans.setMatrixAt(k, _m);
      // The lid rolls off a little when the can goes over.
      if (down) _p.set(item.pos.x + Math.sin(yaw) * 1.2, 0.05 - 0.9, item.pos.z + Math.cos(yaw) * 1.2);
      _m.compose(_p, down ? _q.identity() : _q, _s);
      this.lids.setMatrixAt(k, _m);
    });
    this.hydrantIdx.forEach((idx, k) => {
      const item = items[idx];
      if (!item) return;
      const down = knocked(item);
      _e.set(down ? 0.35 : 0, (item.id * 0.9) % (Math.PI * 2), down ? 0.2 : 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(item.pos.x, 0, item.pos.z);
      _m.compose(_p, _q, _s);
      this.hydrants.setMatrixAt(k, _m);
    });
    this.cans.instanceMatrix.needsUpdate = true;
    this.lids.instanceMatrix.needsUpdate = true;
    this.hydrants.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.cans, this.lids, this.hydrants]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.root.removeFromParent();
  }
}
