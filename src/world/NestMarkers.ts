import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { DistrictLayout, GameState, NestDef } from '../core/types';
import { isNestActiveIn } from '../systems/nests';
import { onLayoutChunksChanged } from './CityDistrict';
import { chunkIdAt } from './worldQueries';
import { asGroundDecal, DECAL_STEP, DECAL_Y } from './groundLevels';

const COLOR_MOUND = 0x4f7a3c;
const COLOR_MOUND_DIM = 0x4a5048;
const COLOR_GLOW = 0x7dff6a;

interface NestVisual {
  def: NestDef;
  /** Walk-in nest: a pulsing claim ring (claimRadius) beckons until the Alpha walks in. */
  claimRing: THREE.Mesh | null;
  claimMat: THREE.MeshBasicMaterial | null;
  id: string;
  chunkId: number;
  strongholdId: string | null;
  x: number;
  z: number;
  group: THREE.Group;
  moundMat: THREE.MeshLambertMaterial;
  glowMat: THREE.MeshBasicMaterial;
  glowMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  active: boolean;
}

/** Organic green nest mounds with pulsing glow; dim until active; equip-radius ring near the leader. */
export class NestMarkers {
  readonly group = new THREE.Group();
  private readonly nests: NestVisual[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly unsubscribe: () => void;
  private time = 0;

  constructor(scene: THREE.Object3D | null, layout: DistrictLayout) {
    this.group.name = 'NestMarkers';
    scene?.add(this.group);

    const moundGeom = this.track(new THREE.IcosahedronGeometry(1.6, 0));
    moundGeom.scale(1, 0.55, 1);
    const knobGeom = this.track(new THREE.IcosahedronGeometry(0.6, 0));
    const glowGeom = this.track(new THREE.IcosahedronGeometry(0.7, 1));
    const ringGeom = this.track(new THREE.RingGeometry(BALANCE.nest.equipRadius - 0.25, BALANCE.nest.equipRadius, 48));
    ringGeom.rotateX(-Math.PI / 2);

    for (const def of layout.nests) {
      const group = new THREE.Group();
      group.position.set(def.pos.x, 0, def.pos.z);
      const moundMat = this.track(new THREE.MeshLambertMaterial({ color: COLOR_MOUND_DIM, flatShading: true }));
      const mound = new THREE.Mesh(moundGeom, moundMat);
      mound.position.y = 0.2;
      group.add(mound);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const knob = new THREE.Mesh(knobGeom, moundMat);
        knob.position.set(Math.sin(a) * 1.7, 0.15, Math.cos(a) * 1.7);
        knob.scale.setScalar(0.7 + (i % 2) * 0.3);
        group.add(knob);
      }
      const glowMat = this.track(
        new THREE.MeshBasicMaterial({ color: COLOR_GLOW, transparent: true, opacity: 0.2, depthWrite: false }),
      );
      const glowMesh = new THREE.Mesh(glowGeom, glowMat);
      glowMesh.position.y = 1.1;
      group.add(glowMesh);
      const ringMat = this.track(
        new THREE.MeshBasicMaterial({
          color: COLOR_GLOW,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      asGroundDecal(ringMat);
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.position.y = DECAL_Y;
      ringMesh.visible = false;
      group.add(ringMesh);
      let claimRing: THREE.Mesh | null = null, claimMat: THREE.MeshBasicMaterial | null = null;
      if (def.claim) {
        claimMat = this.track(new THREE.MeshBasicMaterial({
          color: COLOR_GLOW, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
        }));
        const claimGeom = this.track(new THREE.RingGeometry(BALANCE.nest.claimRadius - 0.35, BALANCE.nest.claimRadius, 40));
        claimGeom.rotateX(-Math.PI / 2);
        asGroundDecal(claimMat);
        claimRing = new THREE.Mesh(claimGeom, claimMat);
        claimRing.position.y = DECAL_Y + DECAL_STEP;
        group.add(claimRing);
      }
      this.group.add(group);
      this.nests.push({
        def,
        claimRing,
        claimMat,
        id: def.id,
        chunkId: chunkIdAt(layout, def.pos),
        strongholdId: def.strongholdId,
        x: def.pos.x,
        z: def.pos.z,
        group,
        moundMat,
        glowMat,
        glowMesh,
        ringMesh,
        ringMat,
        active: false,
      });
    }

    this.unsubscribe = onLayoutChunksChanged(layout, (loaded) => this.syncVisibleChunks(loaded));
  }

  setChunkVisible(chunkId: number, visible: boolean): void {
    for (const n of this.nests) if (n.chunkId === chunkId) n.group.visible = visible;
  }

  syncVisibleChunks(loaded: ReadonlySet<number>): void {
    for (const n of this.nests) n.group.visible = loaded.has(n.chunkId);
  }

  update(state: GameState, _layout: DistrictLayout, dt: number): void {
    this.time += dt;
    const lx = state.leader.pos.x;
    const lz = state.leader.pos.z;
    const r2 = BALANCE.nest.equipRadius * BALANCE.nest.equipRadius;
    for (const n of this.nests) {
      const active = isNestActiveIn(state, n.def);
      if (active !== n.active) {
        n.active = active;
        n.moundMat.color.setHex(active ? COLOR_MOUND : COLOR_MOUND_DIM);
      }
      // An unclaimed walk-in nest beckons: fast bright pulse + a breathing claim ring.
      const beckon = !active && !!n.def.claim;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * (active ? 2.6 : beckon ? 4 : 0.8) + n.x * 0.1);
      n.glowMat.opacity = active ? 0.35 + 0.35 * pulse : beckon ? 0.45 + 0.4 * pulse : 0.06 + 0.04 * pulse;
      n.glowMesh.scale.setScalar(active ? 1 + 0.25 * pulse : beckon ? 1.1 + 0.45 * pulse : 0.7);
      if (n.claimRing && n.claimMat) {
        n.claimRing.visible = beckon;
        if (beckon) { n.claimMat.opacity = 0.3 + 0.45 * pulse; n.claimRing.scale.setScalar(0.92 + 0.12 * pulse); }
      }
      const dx = lx - n.x;
      const dz = lz - n.z;
      const near = active && dx * dx + dz * dz <= r2;
      n.ringMesh.visible = near;
      if (near) n.ringMat.opacity = 0.35 + 0.25 * pulse;
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.group.removeFromParent();
    this.group.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.nests.length = 0;
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(o: T): T {
    if ((o as THREE.BufferGeometry).isBufferGeometry) this.geometries.push(o as THREE.BufferGeometry);
    else this.materials.push(o as THREE.Material);
    return o;
  }
}
