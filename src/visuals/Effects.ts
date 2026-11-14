import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { EntityId, GameEvent, GameState, Vec3 } from '../core/types';

const MAX_TRACERS = 64;
const MAX_MUZZLES = 32;
const MAX_PARTICLES = 256;
const MAX_RINGS = 36;
const MAX_SWIRLS = 8;
const MAX_ALERTS = 8;

interface TracerSlot {
  active: boolean;
  age: number;
  duration: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
}

interface MuzzleSlot {
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  z: number;
}

interface ParticleSlot {
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  size: number;
  colorHex: number;
}

interface RingSlot {
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  z: number;
  riseSpeed: number;
  startRadius: number;
  endRadius: number;
  colorHex: number;
  thick: boolean;
  brightness: number;
}

interface SwirlSlot {
  active: boolean;
  age: number;
  duration: number;
  x: number;
  z: number;
  group: THREE.Group;
}

interface AlertSlot {
  active: boolean;
  age: number;
  duration: number;
  guardId: EntityId;
  x: number;
  y: number;
  z: number;
  group: THREE.Group;
}

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly rootGroup: THREE.Group;

  // Pooled InstancedMeshes
  private readonly tracerMesh: THREE.InstancedMesh;
  private readonly tracerGeo: THREE.BufferGeometry;
  private readonly tracerMat: THREE.MeshBasicMaterial;
  private readonly tracers: TracerSlot[] = [];
  private nextTracerIdx = 0;

  private readonly muzzleMesh: THREE.InstancedMesh;
  private readonly muzzleGeo: THREE.BufferGeometry;
  private readonly muzzleMat: THREE.MeshBasicMaterial;
  private readonly muzzles: MuzzleSlot[] = [];
  private nextMuzzleIdx = 0;

  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particleGeo: THREE.BufferGeometry;
  private readonly particleMat: THREE.MeshBasicMaterial;
  private readonly particles: ParticleSlot[] = [];
  private nextParticleIdx = 0;

  private readonly ringMesh: THREE.InstancedMesh;
  private readonly ringGeo: THREE.BufferGeometry;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly rings: RingSlot[] = [];
  private nextRingIdx = 0;

  // Pooled Swirl Columns & Guard Alert "!" Icons
  private readonly swirlGeo: THREE.BufferGeometry;
  private readonly swirlMat: THREE.MeshBasicMaterial;
  private readonly swirls: SwirlSlot[] = [];
  private nextSwirlIdx = 0;

  private readonly alertBarGeo: THREE.BufferGeometry;
  private readonly alertDotGeo: THREE.BufferGeometry;
  private readonly alertMat: THREE.MeshBasicMaterial;
  private readonly alerts: AlertSlot[] = [];
  private nextAlertIdx = 0;

  // Persistent Attack Order Marker (world ring + downward chevron)
  private readonly orderMarkerGroup: THREE.Group;
  private readonly orderOuterRing: THREE.Mesh;
  private readonly orderInnerRing: THREE.Mesh;
  private readonly orderChevron: THREE.Group;
  private readonly extraOrderMarkers: THREE.Group[] = [];
  private readonly orderRingGeo: THREE.BufferGeometry;
  private readonly orderInnerGeo: THREE.BufferGeometry;
  private readonly orderChevronGeo: THREE.BufferGeometry;
  private readonly orderMat: THREE.MeshBasicMaterial;

  // Pre-allocated scratch math objects
  private readonly dummyMatrix = new THREE.Matrix4();
  private readonly posVec = new THREE.Vector3();
  private readonly dirVec = new THREE.Vector3();
  private readonly upVec = new THREE.Vector3(0, 0, 1);
  private readonly scaleVec = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly tempColor = new THREE.Color();

  private time = 0;
  private shakeMagnitude = 0;
  private prngState = 0x13579bdf;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'EffectsRoot';
    this.scene.add(this.rootGroup);

    // 1. Tracers InstancedMesh (unit box along +Z from 0..1)
    this.tracerGeo = new THREE.BoxGeometry(0.045, 0.045, 1.0);
    this.tracerGeo.translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe97d,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.tracerMesh = new THREE.InstancedMesh(this.tracerGeo, this.tracerMat, MAX_TRACERS);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    this.rootGroup.add(this.tracerMesh);

    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracers.push({
        active: false,
        age: 0,
        duration: 0.08,
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        toX: 0,
        toY: 0,
        toZ: 0,
      });
    }

    // 2. Muzzle Flashes InstancedMesh
    this.muzzleGeo = new THREE.OctahedronGeometry(0.22, 0);
    this.muzzleMat = new THREE.MeshBasicMaterial({
      color: 0xffd24c,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.muzzleMesh = new THREE.InstancedMesh(this.muzzleGeo, this.muzzleMat, MAX_MUZZLES);
    this.muzzleMesh.frustumCulled = false;
    this.muzzleMesh.count = 0;
    this.rootGroup.add(this.muzzleMesh);

    for (let i = 0; i < MAX_MUZZLES; i++) {
      this.muzzles.push({
        active: false,
        age: 0,
        duration: 0.06,
        x: 0,
        y: 0,
        z: 0,
      });
    }

    // 3. Particles InstancedMesh (sparks, dust puffs, sparkles, debris)
    this.particleGeo = new THREE.OctahedronGeometry(1.0, 0);
    this.particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(
      this.particleGeo,
      this.particleMat,
      MAX_PARTICLES,
    );
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.particleMesh.setColorAt(0, this.tempColor.setHex(0xffffff));
    this.rootGroup.add(this.particleMesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        age: 0,
        duration: 0.4,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 9.8,
        size: 0.12,
        colorHex: 0xffffff,
      });
    }

    // 4. Expanding Rings InstancedMesh (rally, rush, recruit, ping, convert)
    this.ringGeo = new THREE.RingGeometry(0.84, 1.0, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.InstancedMesh(this.ringGeo, this.ringMat, MAX_RINGS * 2);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.count = 0;
    this.ringMesh.setColorAt(0, this.tempColor.setHex(0xffffff));
    this.rootGroup.add(this.ringMesh);

    for (let i = 0; i < MAX_RINGS; i++) {
      this.rings.push({
        active: false,
        age: 0,
        duration: 0.5,
        x: 0,
        y: 0.05,
        z: 0,
        riseSpeed: 0,
        startRadius: 0.3,
        endRadius: 2.0,
        colorHex: 0xffffff,
        thick: false,
        brightness: 1.0,
      });
    }

    // 5. Conversion Swirl Columns Pool (8 pre-built groups)
    this.swirlGeo = new THREE.TorusGeometry(0.55, 0.05, 6, 14);
    this.swirlGeo.rotateX(Math.PI / 2);
    this.swirlMat = new THREE.MeshBasicMaterial({
      color: 0x8ef04e,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });

    for (let i = 0; i < MAX_SWIRLS; i++) {
      const grp = new THREE.Group();
      grp.visible = false;
      for (let r = 0; r < 3; r++) {
        const ring = new THREE.Mesh(this.swirlGeo, this.swirlMat);
        ring.position.y = 0.25 + r * 0.48;
        ring.scale.setScalar(1.0 - r * 0.2);
        grp.add(ring);
      }
      this.rootGroup.add(grp);
      this.swirls.push({
        active: false,
        age: 0,
        duration: BALANCE.conversion.riseDuration,
        x: 0,
        z: 0,
        group: grp,
      });
    }

    // 6. Guard Alert "!" Sprites/Meshes Pool (8 pre-built groups)
    this.alertBarGeo = new THREE.BoxGeometry(0.14, 0.42, 0.14);
    this.alertDotGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    this.alertMat = new THREE.MeshBasicMaterial({ color: 0xff8c24 });

    for (let i = 0; i < MAX_ALERTS; i++) {
      const grp = new THREE.Group();
      grp.visible = false;
      const bar = new THREE.Mesh(this.alertBarGeo, this.alertMat);
      bar.position.y = 0.28;
      const dot = new THREE.Mesh(this.alertDotGeo, this.alertMat);
      dot.position.y = -0.06;
      grp.add(bar, dot);
      this.rootGroup.add(grp);
      this.alerts.push({
        active: false,
        age: 0,
        duration: 1.2,
        guardId: -1,
        x: 0,
        y: 2.6,
        z: 0,
        group: grp,
      });
    }

    // 7. Persistent Attack Order Marker (pulsing red/orange world ring + downward chevron)
    this.orderMarkerGroup = new THREE.Group();
    this.orderMarkerGroup.name = 'AttackOrderMarker';
    this.orderMarkerGroup.visible = false;

    this.orderRingGeo = new THREE.RingGeometry(0.95, 1.22, 24);
    this.orderRingGeo.rotateX(-Math.PI / 2);
    this.orderInnerGeo = new THREE.RingGeometry(0.45, 0.62, 6);
    this.orderInnerGeo.rotateX(-Math.PI / 2);
    this.orderMat = new THREE.MeshBasicMaterial({
      color: 0xff4e22,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.orderOuterRing = new THREE.Mesh(this.orderRingGeo, this.orderMat);
    this.orderOuterRing.position.y = 0.05;
    this.orderInnerRing = new THREE.Mesh(this.orderInnerGeo, this.orderMat);
    this.orderInnerRing.position.y = 0.055;

    this.orderChevron = new THREE.Group();
    this.orderChevron.position.y = 2.6;
    this.orderChevronGeo = new THREE.ConeGeometry(0.38, 0.72, 4);
    this.orderChevronGeo.rotateX(Math.PI);
    const chevronMesh = new THREE.Mesh(this.orderChevronGeo, this.orderMat);
    this.orderChevron.add(chevronMesh);

    this.orderMarkerGroup.add(this.orderOuterRing, this.orderInnerRing, this.orderChevron);
    this.rootGroup.add(this.orderMarkerGroup);
  }

  consume(events: readonly GameEvent[], state: GameState): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'shot': {
          this.spawnTracer(ev.from, ev.to);
          this.spawnMuzzle(ev.from);
          if (ev.hit) {
            this.spawnBurst(ev.to.x, ev.to.y, ev.to.z, 5, 0xffaa33, 3.2, 0.1, 0.22);
          }
          break;
        }
        case 'melee': {
          this.spawnBurst(ev.pos.x, 1.0, ev.pos.z, 5, 0xc4b89b, 2.8, 0.11, 0.28);
          break;
        }
        case 'damage': {
          if (ev.target.kind === 'leader') {
            this.spawnBurst(ev.pos.x, 1.1, ev.pos.z, 9, 0xe83b2c, 4.2, 0.14, 0.35);
            this.requestShake(0.18);
          } else if (ev.target.kind === 'gate') {
            this.spawnBurst(ev.pos.x, 1.4, ev.pos.z, 6, 0xff9933, 3.8, 0.12, 0.3);
          } else if (
            ev.target.kind === 'structure' &&
            !events.some((e) => e.type === 'structureDamaged')
          ) {
            this.spawnBurst(ev.pos.x, 1.35, ev.pos.z, 6, 0xff9933, 3.8, 0.12, 0.3);
          }
          break;
        }
        case 'recruited': {
          const gen = ev.generation ?? 0;
          const col = gen >= 2 ? 0xffe84a : gen >= 1 ? 0x5effb8 : 0xbfff47;
          this.spawnBurst(ev.pos.x, 0.9, ev.pos.z, 8, col, 3.5, 0.12, 0.48, -2.0);
          this.spawnRing(ev.pos.x, 0.1, ev.pos.z, 0.35, 1.65, 0.45, col, 1.6);
          break;
        }
        case 'recruitPulse': {
          const hasRecruits = (ev.recruits ?? 0) > 0;
          const gen = ev.generation ?? 0;
          const col = hasRecruits
            ? gen >= 2
              ? 0xffe84a
              : gen >= 1
                ? 0x5effb8
                : 0xc4ff4d
            : 0x6f9458;
          this.spawnRing(
            ev.pos.x,
            0.06,
            ev.pos.z,
            0.35,
            ev.radius,
            0.45,
            col,
            0,
            hasRecruits,
            hasRecruits ? 1.0 : 0.55,
          );
          break;
        }
        case 'structureDamaged': {
          this.spawnBurst(ev.pos.x, 1.35, ev.pos.z, 6, 0xff9933, 3.8, 0.12, 0.3);
          break;
        }
        case 'structureDestroyed': {
          const col =
            ev.kind === 'storeDoor'
              ? 0x88ccff
              : ev.kind === 'busDoor'
                ? 0xe59824
                : 0xc9b99a;
          this.spawnBurst(ev.pos.x, 1.3, ev.pos.z, 24, col, 6.5, 0.2, 0.65);
          this.spawnBurst(ev.pos.x, 0.9, ev.pos.z, 16, 0x8a8478, 5.0, 0.18, 0.6);
          this.spawnRing(ev.pos.x, 0.08, ev.pos.z, 0.5, 5.5, 0.5, 0xffb347, 0.1, true, 0.9);
          this.requestShake(0.32);
          break;
        }
        case 'released': {
          if ((ev.count ?? 0) > 0) {
            this.spawnBurst(ev.pos.x, 0.85, ev.pos.z, 18, 0xc2b8a3, 4.2, 0.22, 0.65, 2.2);
            this.spawnBurst(ev.pos.x, 0.45, ev.pos.z, 12, 0x948c7c, 3.4, 0.18, 0.55, 1.6);
            this.spawnRing(ev.pos.x, 0.07, ev.pos.z, 0.45, 4.2, 0.48, 0xc9b99a, 0.08, false, 0.8);
            this.requestShake(0.22);
          }
          break;
        }
        case 'rally': {
          this.spawnRing(ev.pos.x, 0.08, ev.pos.z, 0.6, ev.radius, 0.6, 0x9be35a, 0.15);
          this.spawnRing(ev.pos.x, 0.12, ev.pos.z, 0.4, ev.radius * 0.72, 0.5, 0xc4ff82, 0.25);
          break;
        }
        case 'rushStart': {
          const lp = state.leader.pos;
          this.spawnRing(lp.x, 0.08, lp.z, 0.5, 9.0, 0.55, 0xff451c, 0.2);
          this.spawnBurst(lp.x, 1.0, lp.z, 14, 0xff5a24, 5.5, 0.16, 0.45);
          this.requestShake(0.24);
          break;
        }
        case 'gateDestroyed': {
          this.spawnBurst(ev.pos.x, 1.4, ev.pos.z, 36, 0xe0782a, 8.5, 0.24, 0.75);
          this.spawnBurst(ev.pos.x, 1.0, ev.pos.z, 28, 0xa9a294, 6.5, 0.28, 0.85);
          this.spawnRing(ev.pos.x, 0.1, ev.pos.z, 0.8, 11.0, 0.65, 0xffaa44, 0.1);
          this.requestShake(0.6);
          break;
        }
        case 'zombieDied': {
          this.spawnBurst(ev.pos.x, 0.7, ev.pos.z, 8, 0x7d8a74, 2.8, 0.15, 0.45);
          break;
        }
        case 'guardDied': {
          let gy = 0.8;
          for (let gIdx = 0; gIdx < state.guards.length; gIdx++) {
            if (state.guards[gIdx].id === ev.guardId) {
              gy = state.guards[gIdx].elevation + 0.8;
              break;
            }
          }
          this.spawnBurst(ev.pos.x, gy, ev.pos.z, 10, 0xb5ac99, 3.2, 0.16, 0.48);
          break;
        }
        case 'conversionStart': {
          this.spawnSwirl(ev.pos.x, ev.pos.z);
          break;
        }
        case 'converted': {
          this.spawnBurst(ev.pos.x, 1.0, ev.pos.z, 16, 0x8ff542, 4.8, 0.16, 0.6, -1.5);
          this.spawnRing(ev.pos.x, 0.08, ev.pos.z, 0.4, 3.2, 0.55, 0x8ff542, 1.2);
          break;
        }
        case 'guardAlert': {
          let elev = 0;
          let gx = ev.pos.x;
          let gz = ev.pos.z;
          for (let gIdx = 0; gIdx < state.guards.length; gIdx++) {
            if (state.guards[gIdx].id === ev.guardId) {
              elev = state.guards[gIdx].elevation;
              gx = state.guards[gIdx].pos.x;
              gz = state.guards[gIdx].pos.z;
              break;
            }
          }
          this.spawnAlert(ev.guardId, gx, elev + 2.6, gz);
          break;
        }
        default:
          break;
      }
    }
  }

  setOrderMarker(pos: Vec3 | null): void {
    if (!pos) {
      this.orderMarkerGroup.visible = false;
      return;
    }
    this.orderMarkerGroup.visible = true;
    this.orderMarkerGroup.position.set(pos.x, pos.y, pos.z);
  }

  /** Markers for additional selected targets (split horde). Clones share geometry/material. */
  setExtraOrderMarkers(positions: readonly Vec3[]): void {
    while (this.extraOrderMarkers.length < positions.length) {
      const marker = this.orderMarkerGroup.clone(true);
      marker.name = 'AttackOrderMarkerExtra';
      this.rootGroup.add(marker);
      this.extraOrderMarkers.push(marker);
    }
    for (let i = 0; i < this.extraOrderMarkers.length; i++) {
      const marker = this.extraOrderMarkers[i];
      const pos = positions[i];
      marker.visible = !!pos;
      if (pos) marker.position.set(pos.x, pos.y, pos.z);
    }
  }

  ping(pos: Vec3): void {
    this.spawnRing(pos.x, pos.y + 0.04, pos.z, 0.2, 2.1, 0.48, 0xf2f5fa, 0.05);
    this.spawnRing(pos.x, pos.y + 0.05, pos.z, 0.1, 1.1, 0.36, 0xd4e2f0, 0.05);
  }

  update(dt: number, state?: GameState): void {
    this.time += dt;
    this.shakeMagnitude = Math.max(0, this.shakeMagnitude - dt * 1.45);

    // Animate persistent Attack Order Marker
    if (this.orderMarkerGroup.visible) {
      const pulse = 1.0 + 0.16 * Math.sin(this.time * 8.0);
      this.orderOuterRing.scale.setScalar(pulse);
      this.orderInnerRing.rotation.z = this.time * 2.6;
      this.orderChevron.position.y = 2.5 + 0.28 * Math.sin(this.time * 6.5);
      this.orderChevron.rotation.y = this.time * 3.0;
    }
    for (const marker of this.extraOrderMarkers) {
      if (!marker.visible) continue;
      const [outer, inner, chevron] = marker.children;
      outer.scale.setScalar(1.0 + 0.16 * Math.sin(this.time * 8.0));
      inner.rotation.z = this.time * 2.6;
      chevron.position.y = 2.5 + 0.28 * Math.sin(this.time * 6.5);
      chevron.rotation.y = this.time * 3.0;
    }

    // 1. Update Tracers
    let tracerCount = 0;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.duration) {
        t.active = false;
        continue;
      }
      this.posVec.set(t.fromX, t.fromY, t.fromZ);
      this.dirVec.set(t.toX - t.fromX, t.toY - t.fromY, t.toZ - t.fromZ);
      const len = this.dirVec.length();
      if (len > 0.01) {
        this.dirVec.divideScalar(len);
        this.quat.setFromUnitVectors(this.upVec, this.dirVec);
        const fade = 1.0 - t.age / t.duration;
        this.scaleVec.set(fade, fade, len);
        this.dummyMatrix.compose(this.posVec, this.quat, this.scaleVec);
        this.tracerMesh.setMatrixAt(tracerCount++, this.dummyMatrix);
      }
    }
    this.tracerMesh.count = tracerCount;
    this.tracerMesh.instanceMatrix.needsUpdate = true;

    // 2. Update Muzzle Flashes
    let muzzleCount = 0;
    for (let i = 0; i < MAX_MUZZLES; i++) {
      const m = this.muzzles[i];
      if (!m.active) continue;
      m.age += dt;
      if (m.age >= m.duration) {
        m.active = false;
        continue;
      }
      const scale = (1.0 - m.age / m.duration) * 1.35;
      this.posVec.set(m.x, m.y, m.z);
      this.quat.identity();
      this.scaleVec.setScalar(scale);
      this.dummyMatrix.compose(this.posVec, this.quat, this.scaleVec);
      this.muzzleMesh.setMatrixAt(muzzleCount++, this.dummyMatrix);
    }
    this.muzzleMesh.count = muzzleCount;
    this.muzzleMesh.instanceMatrix.needsUpdate = true;

    // 3. Update Particles
    let particleCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.duration) {
        p.active = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.04, p.y + p.vy * dt);
      p.z += p.vz * dt;

      const lifeFrac = 1.0 - p.age / p.duration;
      const s = p.size * lifeFrac;
      this.posVec.set(p.x, p.y, p.z);
      this.quat.identity();
      this.scaleVec.setScalar(s);
      this.dummyMatrix.compose(this.posVec, this.quat, this.scaleVec);
      this.particleMesh.setMatrixAt(particleCount, this.dummyMatrix);
      this.tempColor.setHex(p.colorHex);
      this.particleMesh.setColorAt(particleCount, this.tempColor);
      particleCount++;
    }
    this.particleMesh.count = particleCount;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }

    // 4. Update Expanding Rings
    let ringCount = 0;
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= r.duration) {
        r.active = false;
        continue;
      }
      const u = r.age / r.duration;
      const ease = 1.0 - (1.0 - u) * (1.0 - u);
      const radius = r.startRadius + (r.endRadius - r.startRadius) * ease;
      r.y += r.riseSpeed * dt;

      this.posVec.set(r.x, r.y, r.z);
      this.quat.identity();
      this.scaleVec.set(radius, 1, radius);
      this.dummyMatrix.compose(this.posVec, this.quat, this.scaleVec);
      this.ringMesh.setMatrixAt(ringCount, this.dummyMatrix);
      const fade = (1.0 - u * 0.65) * r.brightness;
      this.tempColor.setHex(r.colorHex).multiplyScalar(fade);
      this.ringMesh.setColorAt(ringCount, this.tempColor);
      ringCount++;

      if (r.thick) {
        const innerRadius = Math.max(0.05, radius * 0.87);
        this.scaleVec.set(innerRadius, 1, innerRadius);
        this.dummyMatrix.compose(this.posVec, this.quat, this.scaleVec);
        this.ringMesh.setMatrixAt(ringCount, this.dummyMatrix);
        this.ringMesh.setColorAt(ringCount, this.tempColor);
        ringCount++;
      }
    }
    this.ringMesh.count = ringCount;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) {
      this.ringMesh.instanceColor.needsUpdate = true;
    }

    // 5. Update Conversion Swirl Columns
    for (let i = 0; i < MAX_SWIRLS; i++) {
      const sw = this.swirls[i];
      if (!sw.active) continue;
      sw.age += dt;
      if (sw.age >= sw.duration) {
        sw.active = false;
        sw.group.visible = false;
        continue;
      }
      sw.group.position.set(sw.x, 0.05 + Math.sin(sw.age * 5.0) * 0.08, sw.z);
      sw.group.rotation.y = sw.age * 4.5;
      const pulse = 0.85 + 0.25 * Math.sin(sw.age * 7.0);
      sw.group.scale.set(pulse, 1.0 + (sw.age / sw.duration) * 0.5, pulse);
    }

    // 6. Update Guard Alert "!" Icons
    for (let i = 0; i < MAX_ALERTS; i++) {
      const al = this.alerts[i];
      if (!al.active) continue;
      al.age += dt;
      if (al.age >= al.duration) {
        al.active = false;
        al.group.visible = false;
        continue;
      }
      if (state) {
        for (let gIdx = 0; gIdx < state.guards.length; gIdx++) {
          const g = state.guards[gIdx];
          if (g.id === al.guardId) {
            al.x = g.pos.x;
            al.y = g.elevation + 2.6;
            al.z = g.pos.z;
            break;
          }
        }
      }
      const bounce = Math.sin(al.age * 14.0) * 0.12 * (1.0 - al.age / al.duration);
      al.group.position.set(al.x, al.y + bounce, al.z);
      al.group.rotation.y = this.time * 3.2;
    }
  }

  takeShake(): number {
    return this.shakeMagnitude;
  }

  reset(): void {
    this.time = 0;
    this.shakeMagnitude = 0;
    this.orderMarkerGroup.visible = false;
    for (let i = 0; i < this.extraOrderMarkers.length; i++) {
      this.extraOrderMarkers[i].visible = false;
    }

    for (let i = 0; i < MAX_TRACERS; i++) this.tracers[i].active = false;
    for (let i = 0; i < MAX_MUZZLES; i++) this.muzzles[i].active = false;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles[i].active = false;
    for (let i = 0; i < MAX_RINGS; i++) this.rings[i].active = false;
    for (let i = 0; i < MAX_SWIRLS; i++) {
      this.swirls[i].active = false;
      this.swirls[i].group.visible = false;
    }
    for (let i = 0; i < MAX_ALERTS; i++) {
      this.alerts[i].active = false;
      this.alerts[i].group.visible = false;
    }

    this.nextTracerIdx = 0;
    this.nextMuzzleIdx = 0;
    this.nextParticleIdx = 0;
    this.nextRingIdx = 0;
    this.nextSwirlIdx = 0;
    this.nextAlertIdx = 0;

    this.tracerMesh.count = 0;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    this.muzzleMesh.count = 0;
    this.muzzleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.count = 0;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
    this.ringMesh.count = 0;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) {
      this.ringMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.reset();
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    this.tracerMesh.dispose();

    this.muzzleGeo.dispose();
    this.muzzleMat.dispose();
    this.muzzleMesh.dispose();

    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.particleMesh.dispose();

    this.ringGeo.dispose();
    this.ringMat.dispose();
    this.ringMesh.dispose();

    this.swirlGeo.dispose();
    this.swirlMat.dispose();
    this.alertBarGeo.dispose();
    this.alertDotGeo.dispose();
    this.alertMat.dispose();

    this.orderRingGeo.dispose();
    this.orderInnerGeo.dispose();
    this.orderChevronGeo.dispose();
    this.orderMat.dispose();

    this.rootGroup.clear();
    this.scene.remove(this.rootGroup);
  }

  private requestShake(amount: number): void {
    if (amount > this.shakeMagnitude) {
      this.shakeMagnitude = amount;
    }
  }

  private rand(): number {
    this.prngState = (Math.imul(this.prngState, 1664525) + 1013904223) >>> 0;
    return (this.prngState & 0xffff) / 0xffff;
  }

  private spawnTracer(from: Vec3, to: Vec3): void {
    const slot = this.tracers[this.nextTracerIdx];
    this.nextTracerIdx = (this.nextTracerIdx + 1) % MAX_TRACERS;
    slot.active = true;
    slot.age = 0;
    slot.duration = 0.08;
    slot.fromX = from.x;
    slot.fromY = from.y;
    slot.fromZ = from.z;
    slot.toX = to.x;
    slot.toY = to.y;
    slot.toZ = to.z;
  }

  private spawnMuzzle(from: Vec3): void {
    const slot = this.muzzles[this.nextMuzzleIdx];
    this.nextMuzzleIdx = (this.nextMuzzleIdx + 1) % MAX_MUZZLES;
    slot.active = true;
    slot.age = 0;
    slot.duration = 0.06;
    slot.x = from.x;
    slot.y = from.y;
    slot.z = from.z;
  }

  private spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    colorHex: number,
    speed: number,
    size: number,
    duration: number,
    gravity = 9.5,
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.nextParticleIdx];
      this.nextParticleIdx = (this.nextParticleIdx + 1) % MAX_PARTICLES;
      const angle = this.rand() * Math.PI * 2;
      const spd = (0.35 + 0.65 * this.rand()) * speed;
      slot.active = true;
      slot.age = 0;
      slot.duration = duration * (0.8 + 0.4 * this.rand());
      slot.x = x + (this.rand() - 0.5) * 0.25;
      slot.y = y + (this.rand() - 0.5) * 0.25;
      slot.z = z + (this.rand() - 0.5) * 0.25;
      slot.vx = Math.cos(angle) * spd;
      slot.vy = (0.4 + 0.8 * this.rand()) * speed * 0.65;
      slot.vz = Math.sin(angle) * spd;
      slot.gravity = gravity;
      slot.size = size;
      slot.colorHex = colorHex;
    }
  }

  private spawnRing(
    x: number,
    y: number,
    z: number,
    startRadius: number,
    endRadius: number,
    duration: number,
    colorHex: number,
    riseSpeed: number,
    thick = false,
    brightness = 1.0,
  ): void {
    const slot = this.rings[this.nextRingIdx];
    this.nextRingIdx = (this.nextRingIdx + 1) % MAX_RINGS;
    slot.active = true;
    slot.age = 0;
    slot.duration = duration;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.startRadius = startRadius;
    slot.endRadius = endRadius;
    slot.colorHex = colorHex;
    slot.riseSpeed = riseSpeed;
    slot.thick = thick;
    slot.brightness = brightness;
  }

  private spawnSwirl(x: number, z: number): void {
    const slot = this.swirls[this.nextSwirlIdx];
    this.nextSwirlIdx = (this.nextSwirlIdx + 1) % MAX_SWIRLS;
    slot.active = true;
    slot.age = 0;
    slot.duration = BALANCE.conversion.riseDuration;
    slot.x = x;
    slot.z = z;
    slot.group.position.set(x, 0.05, z);
    slot.group.visible = true;
  }

  private spawnAlert(guardId: EntityId, x: number, y: number, z: number): void {
    const slot = this.alerts[this.nextAlertIdx];
    this.nextAlertIdx = (this.nextAlertIdx + 1) % MAX_ALERTS;
    slot.active = true;
    slot.age = 0;
    slot.duration = 1.2;
    slot.guardId = guardId;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.group.position.set(x, y, z);
    slot.group.visible = true;
  }
}
