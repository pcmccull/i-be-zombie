import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { AnimAction, ZombieAgent } from '../core/types';
import {
  composeZombiePartMatrix,
  computePose,
  getZombiePartGeometries,
  WALKER_VARIANTS,
  ZOMBIE_PART_NAMES,
  type Pose,
  type PoseParams,
  type ZombiePartName,
} from './LowPolyCharacters';

const TWO_PI = Math.PI * 2;

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a) % TWO_PI) + TWO_PI;
  diff = ((diff + Math.PI) % TWO_PI) - Math.PI;
  return a + diff * t;
}

function scaleFromId(id: number): number {
  const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return 0.92 + (h & 0xffff) / 0xffff * 0.16;
}

export class HordeRenderer {
  readonly group: THREE.Group;

  private readonly maxInstances: number;
  private readonly partMeshes: Record<ZombiePartName, THREE.InstancedMesh>;
  private readonly partMaterial: THREE.MeshLambertMaterial;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly shadowGeo: THREE.BufferGeometry;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly markerMesh: THREE.InstancedMesh;
  private readonly markerGeo: THREE.BufferGeometry;
  private readonly markerMat: THREE.MeshBasicMaterial;

  // Pre-allocated scratch objects for zero-allocation update loop
  private readonly rootMatrix = new THREE.Matrix4();
  private readonly partMatrix = new THREE.Matrix4();
  private readonly discMatrix = new THREE.Matrix4();
  private readonly posVec = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly discScale = new THREE.Vector3(1, 1, 1);

  private readonly colorSkin = new THREE.Color();
  private readonly colorShirt = new THREE.Color();
  private readonly colorPants = new THREE.Color();
  private readonly colorAcc = new THREE.Color();
  private readonly colorMarker = new THREE.Color();
  private readonly colorWhite = new THREE.Color(0xffffff);
  private readonly colorRush = new THREE.Color(0xff4a1c);
  private readonly colorFollowerBoost = new THREE.Color(0x88cc58);
  private readonly colorAmbientMute = new THREE.Color(0x6d736e);
  private readonly colorRecruitGen0 = new THREE.Color(0xc8ff47);
  private readonly colorRecruitCascade = new THREE.Color(0x5effb8);
  private readonly colorRecruitDeepCascade = new THREE.Color(0xffe84a);

  private readonly pose: Pose = {
    bodyY: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    headPitch: 0,
    headYaw: 0,
    armLPitch: 0,
    armRPitch: 0,
    armLRoll: 0,
    armRRoll: 0,
    legLPitch: 0,
    legRPitch: 0,
    lunge: 0,
    deathTilt: 0,
  };

  private readonly poseParams: PoseParams = {
    kind: 'walker',
    anim: 'idle',
    animTime: 0,
    speed: 0,
    time: 0,
    phase: 0,
  };

  constructor(maxInstances = 220) {
    this.maxInstances = maxInstances;
    this.group = new THREE.Group();
    this.group.name = 'HordeRenderer';

    this.partMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });

    const partGeos = getZombiePartGeometries();
    const meshes = {} as Record<ZombiePartName, THREE.InstancedMesh>;

    for (const part of ZOMBIE_PART_NAMES) {
      const m = new THREE.InstancedMesh(partGeos[part], this.partMaterial, maxInstances);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      m.setColorAt(0, this.colorWhite);
      m.name = `HordePart_${part}`;
      this.group.add(m);
      meshes[part] = m;
    }
    this.partMeshes = meshes;

    // Cheap instanced blob shadow disc under every non-dead zombie
    this.shadowGeo = new THREE.CircleGeometry(0.42, 10);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x12161c,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, maxInstances);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.count = 0;
    this.shadowMesh.name = 'HordeBlobShadows';
    this.group.add(this.shadowMesh);

    // Pale-green follower ground marker ring/disc under follower zombies
    this.markerGeo = new THREE.RingGeometry(0.36, 0.5, 12);
    this.markerGeo.rotateX(-Math.PI / 2);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.markerMesh = new THREE.InstancedMesh(this.markerGeo, this.markerMat, maxInstances);
    this.markerMesh.frustumCulled = false;
    this.markerMesh.count = 0;
    this.markerMesh.setColorAt(0, this.colorWhite);
    this.markerMesh.name = 'HordeFollowerMarkers';
    this.group.add(this.markerMesh);
  }

  update(
    zombies: readonly ZombieAgent[],
    alpha: number,
    time: number,
    rushActive: boolean,
  ): void {
    const count = Math.min(zombies.length, this.maxInstances);
    let shadowIdx = 0;
    let markerIdx = 0;

    const corpseFadeStart = Math.max(0, BALANCE.walker.corpseFadeTime - 1.5);

    for (let i = 0; i < count; i++) {
      const z = zombies[i];

      const ix = z.prevPos.x + (z.pos.x - z.prevPos.x) * alpha;
      const iz = z.prevPos.z + (z.pos.z - z.prevPos.z) * alpha;
      const facing = lerpAngle(z.prevFacing, z.facing, alpha);
      const speed = Math.hypot(z.vel.x, z.vel.z);
      const phase = (z.id * 2.39996) % TWO_PI;
      const scale = scaleFromId(z.id);

      let anim: AnimAction = z.anim;
      let sinkY = 0;
      if (z.state === 'dead') {
        anim = 'dead';
        if (z.stateTime > corpseFadeStart) {
          const fadeT = Math.min(1, (z.stateTime - corpseFadeStart) / 1.5);
          sinkY = -fadeT * 0.65;
        }
      } else if (z.state === 'rising') {
        anim = 'rise';
      }

      this.poseParams.kind = 'walker';
      this.poseParams.anim = anim;
      this.poseParams.animTime = z.animTime;
      this.poseParams.speed = speed;
      this.poseParams.time = time;
      this.poseParams.phase = phase;
      computePose(this.poseParams, this.pose);

      // Root world transform
      this.posVec.set(ix, sinkY + z.elevation, iz);
      this.euler.set(0, facing, 0, 'XYZ');
      this.quat.setFromEuler(this.euler);
      this.rootMatrix.compose(this.posVec, this.quat, this.unitScale);

      // Variant colors & state tinting
      const variant = WALKER_VARIANTS[Math.abs(z.variant) % WALKER_VARIANTS.length];
      this.colorSkin.setHex(variant.skin);
      this.colorShirt.setHex(z.isConverted ? 0x2c3e66 : variant.shirt);
      this.colorPants.setHex(z.isConverted ? 0x25324f : variant.pants);
      this.colorAcc.setHex(z.isConverted ? 0xe0782a : variant.accessory);

      if (z.state === 'follower') {
        // Followers get a slightly brighter/greener tint
        this.colorSkin.lerp(this.colorFollowerBoost, 0.22);
        this.colorShirt.multiplyScalar(1.08);
        if (rushActive) {
          const pulse = 0.36 + 0.2 * Math.sin(time * 14 + phase);
          this.colorSkin.lerp(this.colorRush, pulse);
          this.colorShirt.lerp(this.colorRush, pulse * 0.85);
          this.colorAcc.lerp(this.colorRush, pulse);
        }
      } else if (z.state === 'ambient') {
        // Ambient zombies slightly grayer/muted
        this.colorSkin.lerp(this.colorAmbientMute, 0.3);
        this.colorShirt.lerp(this.colorAmbientMute, 0.25);
      }

      if ((z.recruitFlash ?? 0) > 0) {
        const boostDur = Math.max(0.01, BALANCE.horde.recruitBoostTime);
        const normFlash = Math.min(1, z.recruitFlash / boostDur);
        const flashAmt = Math.min(1, Math.pow(normFlash, 1.4) * 0.85);
        const flashCol =
          (z.recruitGen ?? 0) >= 2
            ? this.colorRecruitDeepCascade
            : (z.recruitGen ?? 0) >= 1
              ? this.colorRecruitCascade
              : this.colorRecruitGen0;
        this.colorSkin.lerp(flashCol, flashAmt);
        this.colorShirt.lerp(flashCol, flashAmt * 0.78);
        this.colorPants.lerp(flashCol, flashAmt * 0.45);
        this.colorAcc.lerp(flashCol, flashAmt * 0.85);
      }

      if (z.hitFlash > 0) {
        const flashAmt = Math.min(1, z.hitFlash * 7.5);
        this.colorSkin.lerp(this.colorWhite, flashAmt);
        this.colorShirt.lerp(this.colorWhite, flashAmt);
        this.colorPants.lerp(this.colorWhite, flashAmt);
        this.colorAcc.lerp(this.colorWhite, flashAmt);
      }

      for (let pIdx = 0; pIdx < ZOMBIE_PART_NAMES.length; pIdx++) {
        const partName = ZOMBIE_PART_NAMES[pIdx];
        const instMesh = this.partMeshes[partName];
        composeZombiePartMatrix(partName, this.rootMatrix, this.pose, scale, this.partMatrix);
        instMesh.setMatrixAt(i, this.partMatrix);

        let partColor = this.colorShirt;
        if (partName === 'head' || partName === 'armL' || partName === 'armR') {
          partColor = this.colorSkin;
        } else if (partName === 'pelvis' || partName === 'legL' || partName === 'legR') {
          partColor = this.colorPants;
        } else if (partName === 'accessory') {
          partColor = this.colorAcc;
        }
        instMesh.setColorAt(i, partColor);
      }

      // Blob shadow under every non-dead zombie
      if (z.state !== 'dead') {
        this.posVec.set(ix, 0.018, iz);
        this.quat.identity();
        this.discScale.setScalar(scale);
        this.discMatrix.compose(this.posVec, this.quat, this.discScale);
        this.shadowMesh.setMatrixAt(shadowIdx++, this.discMatrix);
      }

      // Pale-green (or rush orange-red) ground marker ring under follower zombies
      if (z.state === 'follower') {
        this.posVec.set(ix, 0.026, iz);
        this.quat.identity();
        const ringScale = rushActive
          ? scale * (1.08 + 0.1 * Math.sin(time * 12 + phase))
          : scale;
        this.discScale.setScalar(ringScale);
        this.discMatrix.compose(this.posVec, this.quat, this.discScale);
        this.markerMesh.setMatrixAt(markerIdx, this.discMatrix);
        this.colorMarker.setHex(rushActive ? 0xff5a24 : 0x7ee852);
        this.markerMesh.setColorAt(markerIdx, this.colorMarker);
        markerIdx++;
      }
    }

    for (let pIdx = 0; pIdx < ZOMBIE_PART_NAMES.length; pIdx++) {
      const partName = ZOMBIE_PART_NAMES[pIdx];
      const instMesh = this.partMeshes[partName];
      instMesh.count = count;
      instMesh.instanceMatrix.needsUpdate = true;
      if (instMesh.instanceColor) {
        instMesh.instanceColor.needsUpdate = true;
      }
    }

    this.shadowMesh.count = shadowIdx;
    this.shadowMesh.instanceMatrix.needsUpdate = true;

    this.markerMesh.count = markerIdx;
    this.markerMesh.instanceMatrix.needsUpdate = true;
    if (this.markerMesh.instanceColor) {
      this.markerMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.partMaterial.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    for (const part of ZOMBIE_PART_NAMES) {
      this.partMeshes[part].dispose();
    }
    this.shadowMesh.dispose();
    this.markerMesh.dispose();
    this.group.clear();
  }
}
