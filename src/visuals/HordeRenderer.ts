import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { GameEvent, ZombieAgent } from '../core/types';
import {
  animateZombie,
  createAnimInput,
  createAnimState,
  type ZombieAnimState,
} from './zombieAnimation';
import {
  ACCESSORY_BONE,
  BONE,
  composeBones,
  createBoneMatrices,
  createZombieMaterial,
  getAccessoryGeometries,
  getHordePartGeometries,
  HORDE_PARTS,
  PAIRED_PARTS,
  SILHOUETTE_ACCESSORIES,
  type HordePart,
} from './zombieModel';
import { ACCESSORY_KINDS, TILE, zombieProfile, type AccessoryKind, type ZombieProfile } from './zombieProfiles';
import { createPose, type ZombiePose } from './zombieRig';

const TWO_PI = Math.PI * 2;

/** Camera distance (m) below which zombies get full detail / medium detail; beyond = far LOD. */
const LOD_NEAR = 22;
const LOD_MID = 46;

const TIE_TINTS = [0x8a1e2a, 0x1e3a6a, 0x2a4a2a, 0x5a3a6a, 0x9a6a1a];
const HARDHAT_TINTS = [0xf2c21a, 0xf08a1c, 0xf4f4ee];
const FLAP_TINTS = [0x6a4a32, 0x3a4a5a, 0x5a5a3a];

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a) % TWO_PI) + TWO_PI;
  diff = ((diff + Math.PI) % TWO_PI) - Math.PI;
  return a + diff * t;
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** Renderer-side per-zombie record (profile + animation state); never part of GameState. */
interface Entry {
  profile: ZombieProfile;
  anim: ZombieAnimState;
  brute: boolean;
  converted: boolean;
  lastHitFlash: number;
  hitFromX: number;
  hitFromZ: number;
  seenFrame: number;
  accTints: number[];
}

interface PartMesh {
  mesh: THREE.InstancedMesh;
  tile: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  count: number;
}

interface AccMesh {
  mesh: THREE.InstancedMesh;
  count: number;
}

export class HordeRenderer {
  readonly group: THREE.Group;

  private readonly maxInstances: number;
  private readonly parts: Record<HordePart, PartMesh>;
  private readonly accessories: Record<AccessoryKind, AccMesh>;
  private readonly partMaterial: THREE.MeshStandardMaterial;
  private readonly accMaterial: THREE.MeshStandardMaterial;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly shadowGeo: THREE.BufferGeometry;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly markerMesh: THREE.InstancedMesh;
  private readonly markerGeo: THREE.BufferGeometry;
  private readonly markerMat: THREE.MeshBasicMaterial;

  // Pre-allocated scratch objects for the zero-allocation update loop
  private readonly rootMatrix = new THREE.Matrix4();
  private readonly discMatrix = new THREE.Matrix4();
  private readonly bones = createBoneMatrices();
  private readonly posVec = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly discScale = new THREE.Vector3(1, 1, 1);
  private readonly pose: ZombiePose = createPose();
  private readonly animInput = createAnimInput();

  private readonly colorSkin = new THREE.Color();
  private readonly colorShirt = new THREE.Color();
  private readonly colorPants = new THREE.Color();
  private readonly colorShoe = new THREE.Color();
  private readonly colorAcc = new THREE.Color();
  private readonly colorMarker = new THREE.Color();
  private readonly colorWhite = new THREE.Color(0xffffff);
  private readonly colorRush = new THREE.Color(0xff4a1c);
  private readonly colorFollowerBoost = new THREE.Color(0x9ad06a);
  private readonly colorAmbientMute = new THREE.Color(0x7a807a);
  private readonly colorRecruitGen0 = new THREE.Color(0xc8ff47);
  private readonly colorRecruitCascade = new THREE.Color(0x5effb8);
  private readonly colorRecruitDeepCascade = new THREE.Color(0xffe84a);
  private readonly colorFrenzy = new THREE.Color(0xff2a1a);
  private readonly colorBruteSkin = new THREE.Color(0x4f6650);
  private readonly colorBruteShirt = new THREE.Color(0x4a3f44);
  private readonly colorBrutePants = new THREE.Color(0x34363b);

  private readonly table = new Map<number, Entry>();
  private frame = 0;
  private lastSimTime = -1;
  private stalled = 0;

  private ambientMask: { x: number; z: number; radius: number } | null = null;
  // Render-radius culling + frenzy view state (set by setView before update)
  private hasFocus = false;
  private focusX = 0;
  private focusZ = 0;
  private cullRadius2 = BALANCE.population.activeRadius * BALANCE.population.activeRadius;
  private frenzyTimeLeft = 0;
  private readonly frenzyCohort = new Set<number>();
  private camX = 0;
  private camY = 30;
  private camZ = 0;
  private hasCamera = false;
  private leaderX = 0;
  private leaderZ = 0;
  private leaderAlive = false;
  // Recent shots this frame (for directional hit reactions).
  private readonly shots: { fx: number; fz: number; tx: number; tz: number }[] = [];

  /** Zombies actually drawn last update (after culling). */
  drawnCount = 0;
  /** Zombies per LOD tier last update (near, mid, far). */
  readonly lodCounts: [number, number, number] = [0, 0, 0];
  /** CPU time of the last update() (ms), exponentially smoothed. */
  updateMs = 0;

  constructor(maxInstances = 220) {
    this.maxInstances = maxInstances;
    this.group = new THREE.Group();
    this.group.name = 'HordeRenderer';

    this.partMaterial = createZombieMaterial({ instanced: true });
    this.accMaterial = createZombieMaterial({ instanced: true });

    const partGeos = getHordePartGeometries();
    const parts = {} as Record<HordePart, PartMesh>;
    for (const part of HORDE_PARTS) {
      const cap = PAIRED_PARTS.has(part) ? maxInstances * 2 : maxInstances;
      // Each InstancedMesh needs its own geometry object for the per-instance attributes.
      const geo = partGeos[part].clone();
      const tile = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      const skin = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      tile.setUsage(THREE.DynamicDrawUsage);
      skin.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTile', tile);
      geo.setAttribute('aSkin', skin);
      const m = new THREE.InstancedMesh(geo, this.partMaterial, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      m.setColorAt(0, this.colorWhite);
      m.name = `HordePart_${part}`;
      this.group.add(m);
      parts[part] = { mesh: m, tile, skin, count: 0 };
    }
    this.parts = parts;

    const accGeos = getAccessoryGeometries();
    const acc = {} as Record<AccessoryKind, AccMesh>;
    for (const kind of ACCESSORY_KINDS) {
      const m = new THREE.InstancedMesh(accGeos[kind], this.accMaterial, maxInstances);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      m.setColorAt(0, this.colorWhite);
      m.name = `HordeAccessory_${kind}`;
      this.group.add(m);
      acc[kind] = { mesh: m, count: 0 };
    }
    this.accessories = acc;

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

    // Pale-green follower ground marker ring under follower zombies
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

  /**
   * Per-frame view context (call before update). Zombies farther than `radius` (default
   * BALANCE.population.activeRadius) from (focusX, focusZ), and dormant ones, are not drawn.
   * `frenzyTimeLeft` is state.progression.frenzyTimeLeft.
   */
  setView(focusX: number, focusZ: number, frenzyTimeLeft: number, radius: number = BALANCE.population.activeRadius): void {
    this.hasFocus = true;
    this.focusX = focusX;
    this.focusZ = focusZ;
    this.cullRadius2 = radius * radius;
    this.frenzyTimeLeft = frenzyTimeLeft;
    if (frenzyTimeLeft <= 0 && this.frenzyCohort.size > 0) this.frenzyCohort.clear();
  }

  /** Camera position for the distance LOD (near: full secondary motion + face details; far: lean). */
  setCamera(x: number, y: number, z: number): void {
    this.hasCamera = true;
    this.camX = x;
    this.camY = y;
    this.camZ = z;
  }

  /** Followers glance at the Alpha now and then (restless crowd awareness). */
  setLeader(x: number, z: number, alive: boolean): void {
    this.leaderX = x;
    this.leaderZ = z;
    this.leaderAlive = alive;
  }

  /**
   * Opening cinematic: ambient zombies farther than `radius` from (x, z) are not drawn, so the city reads as
   * "full of life" until the reveal. Pass null to draw everything again.
   */
  setAmbientMask(mask: { x: number; z: number; radius: number } | null): void {
    this.ambientMask = mask;
  }

  /** Snapshots the buffed follower cohort on frenzyStart; records shot directions for hit reactions. */
  consume(events: readonly GameEvent[], zombies: readonly ZombieAgent[]): void {
    this.shots.length = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'frenzyStart') {
        this.frenzyCohort.clear();
        const r2 = ev.radius * ev.radius;
        for (let k = 0; k < zombies.length; k++) {
          const z = zombies[k];
          if (z.state !== 'follower') continue;
          const dx = z.pos.x - ev.pos.x;
          const dz = z.pos.z - ev.pos.z;
          if (dx * dx + dz * dz <= r2) this.frenzyCohort.add(z.id);
        }
      } else if (ev.type === 'frenzyEnd') {
        this.frenzyCohort.clear();
      } else if (ev.type === 'shot' && ev.hit && this.shots.length < 32) {
        this.shots.push({ fx: ev.from.x, fz: ev.from.z, tx: ev.to.x, tz: ev.to.z });
      } else if (ev.type === 'damage' && ev.target.kind === 'zombie') {
        const entry = this.table.get(ev.target.id);
        if (!entry) continue;
        let best = 2.25;
        for (const s of this.shots) {
          const d2 = (s.tx - ev.pos.x) ** 2 + (s.tz - ev.pos.z) ** 2;
          if (d2 < best) {
            best = d2;
            entry.hitFromX = s.fx - ev.pos.x;
            entry.hitFromZ = s.fz - ev.pos.z;
          }
        }
      }
    }
  }

  private entryFor(z: ZombieAgent): Entry {
    let e = this.table.get(z.id);
    const brute = z.brute === true;
    if (!e) {
      const profile = zombieProfile(z.id, { isConverted: z.isConverted, brute, variant: z.variant });
      e = {
        profile,
        anim: createAnimState(),
        brute,
        converted: z.isConverted,
        lastHitFlash: z.hitFlash,
        hitFromX: 0,
        hitFromZ: 0,
        seenFrame: this.frame,
        accTints: [],
      };
      this.fillAccTints(e);
      this.table.set(z.id, e);
    } else if (e.brute !== brute || e.converted !== z.isConverted) {
      // Brute Evolution (or conversion): new body, same animation state (no pop in the gait).
      e.profile = zombieProfile(z.id, { isConverted: z.isConverted, brute, variant: z.variant });
      e.brute = brute;
      e.converted = z.isConverted;
      this.fillAccTints(e);
    }
    e.seenFrame = this.frame;
    return e;
  }

  private fillAccTints(e: Entry): void {
    const look = e.profile.look;
    const s = e.profile.seed;
    e.accTints = look.accessories.map((k) => {
      switch (k) {
        case 'hairShort':
        case 'hairMop': return look.hairTint;
        case 'policeCap': return 0x2a3858;
        case 'hardHat': return HARDHAT_TINTS[s % HARDHAT_TINTS.length];
        case 'helmet': return 0xffffff;
        case 'tie': return TIE_TINTS[(s >>> 3) % TIE_TINTS.length];
        case 'vest': return 0xffffff;
        case 'flap': return FLAP_TINTS[(s >>> 5) % FLAP_TINTS.length];
        default: return 0xffffff;
      }
    });
  }

  private pushPart(part: HordePart, bone: number, tile: number, tint: THREE.Color, skin: THREE.Color): void {
    const pm = this.parts[part];
    const i = pm.count++;
    pm.mesh.setMatrixAt(i, this.bones[bone]);
    pm.mesh.setColorAt(i, tint);
    pm.tile.setX(i, tile);
    pm.skin.setXYZ(i, skin.r, skin.g, skin.b);
  }

  /**
   * @param time sim time (s); @param dt real frame delta (s) for animation (defaults to the sim-time delta).
   */
  update(
    zombies: readonly ZombieAgent[],
    alpha: number,
    time: number,
    rushActive: boolean,
    dt?: number,
  ): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.frame++;
    // Animation clock: real frame time while the sim advances; frozen when paused (sim time stalls > 0.1 s).
    const simDelta = this.lastSimTime < 0 ? 0 : time - this.lastSimTime;
    const frameDt = Math.min(0.1, Math.max(0, dt ?? simDelta));
    if (simDelta > 1e-6) this.stalled = 0; else this.stalled += frameDt;
    this.lastSimTime = time;
    const animDt = this.stalled > 0.1 ? 0 : frameDt;

    for (const p of HORDE_PARTS) this.parts[p].count = 0;
    for (const k of ACCESSORY_KINDS) this.accessories[k].count = 0;

    let count = 0;
    let shadowIdx = 0;
    let markerIdx = 0;
    this.lodCounts[0] = this.lodCounts[1] = this.lodCounts[2] = 0;
    const frenzyOn = this.frenzyTimeLeft > 0;
    const frenzyFade = frenzyOn ? Math.min(1, this.frenzyTimeLeft / 1.0) : 0;
    const corpseFadeStart = Math.max(0, BALANCE.walker.corpseFadeTime - 1.5);
    const riseDur = Math.max(0.01, BALANCE.conversion.riseDuration);
    const inp = this.animInput;

    for (let zi = 0; zi < zombies.length && count < this.maxInstances; zi++) {
      const z = zombies[zi];
      if (z.dormant) continue;
      const mask = this.ambientMask;
      if (mask && (z.state === 'ambient' || z.state === 'dead')) {
        const mdx = z.pos.x - mask.x;
        const mdz = z.pos.z - mask.z;
        if (mdx * mdx + mdz * mdz > mask.radius * mask.radius) continue;
      }
      if (this.hasFocus) {
        const cdx = z.pos.x - this.focusX;
        const cdz = z.pos.z - this.focusZ;
        if (cdx * cdx + cdz * cdz > this.cullRadius2) continue;
      }
      count++;

      const entry = this.entryFor(z);
      const prof = entry.profile;
      const look = prof.look;
      const ix = z.prevPos.x + (z.pos.x - z.prevPos.x) * alpha;
      const iz = z.prevPos.z + (z.pos.z - z.prevPos.z) * alpha;
      const facing = lerpAngle(z.prevFacing, z.facing, alpha);
      const speed = Math.hypot(z.vel.x, z.vel.z);
      const phase = (z.id * 2.39996) % TWO_PI;
      const brute = entry.brute;

      // LOD tier from camera distance.
      let detail: 0 | 1 | 2 = 0;
      if (this.hasCamera) {
        const d2 = (ix - this.camX) ** 2 + this.camY * this.camY * 0.25 + (iz - this.camZ) ** 2;
        detail = d2 < LOD_NEAR * LOD_NEAR ? 0 : d2 < LOD_MID * LOD_MID ? 1 : 2;
      }
      this.lodCounts[detail]++;

      // --- Animation input -------------------------------------------------
      let sinkY = 0;
      inp.dt = animDt;
      inp.speed = speed;
      inp.facing = facing;
      inp.anim = z.anim;
      inp.animTime = z.animTime;
      inp.deadTime = 0;
      inp.riseT = 0;
      if (z.state === 'dead') {
        inp.anim = 'dead';
        inp.deadTime = z.stateTime;
        if (z.stateTime > corpseFadeStart) {
          const fadeT = Math.min(1, (z.stateTime - corpseFadeStart) / 1.5);
          sinkY = -fadeT * 0.65;
        }
      } else if (z.state === 'rising') {
        inp.anim = 'rise';
        inp.riseT = z.stateTime / riseDur;
      }
      inp.mode = z.state === 'follower' ? (z.engageTarget ? 'attack' : 'follow') : 'ambient';
      inp.engaged = z.state === 'follower' && z.engageTarget !== null;
      inp.cooldown = z.attackCooldown;
      inp.fast = z.state === 'follower' && (rushActive || (frenzyOn && this.frenzyCohort.has(z.id)));
      inp.attackPhase = 'none';
      inp.attackStyle = -1;
      inp.stun = 0;
      inp.detail = detail;
      const hitEdge = z.hitFlash > entry.lastHitFlash + 1e-4;
      entry.lastHitFlash = z.hitFlash;
      inp.hitImpulse = hitEdge && z.state !== 'dead';
      if (hitEdge) {
        // World hit-source direction → character space (x = left, z = forward).
        const s = Math.sin(facing);
        const c = Math.cos(facing);
        inp.hitFromX = entry.hitFromX * c - entry.hitFromZ * s;
        inp.hitFromZ = entry.hitFromX * s + entry.hitFromZ * c;
        entry.hitFromX = entry.hitFromZ = 0;
      }
      inp.lookYaw = NaN;
      if (z.state === 'follower' && this.leaderAlive) {
        inp.lookYaw = wrapAngle(Math.atan2(this.leaderX - ix, this.leaderZ - iz) - facing);
      }
      animateZombie(entry.anim, prof, inp, this.pose);

      // --- Skeleton ----------------------------------------------------------
      this.posVec.set(ix, sinkY + z.elevation, iz);
      this.euler.set(0, facing, 0, 'XYZ');
      this.quat.setFromEuler(this.euler);
      this.rootMatrix.compose(this.posVec, this.quat, this.unitScale);
      composeBones(this.pose, this.rootMatrix, prof.scale, prof.width, this.bones);

      // --- Colours (part tints) & state tinting ---------------------------------
      this.colorSkin.setHex(look.skin);
      this.colorShirt.setHex(look.torsoTint);
      this.colorPants.setHex(look.pantsTint);
      this.colorShoe.setHex(look.shoeTint);

      if (z.state === 'follower') {
        this.colorSkin.lerp(this.colorFollowerBoost, 0.12);
        if (rushActive) {
          const pulse = 0.3 + 0.18 * Math.sin(time * 14 + phase);
          this.colorSkin.lerp(this.colorRush, pulse);
          this.colorShirt.lerp(this.colorRush, pulse * 0.6);
        }
        if (frenzyOn && this.frenzyCohort.has(z.id)) {
          const pulse = (0.28 + 0.12 * Math.sin(time * 12 + phase)) * frenzyFade;
          this.colorSkin.lerp(this.colorFrenzy, pulse);
          this.colorShirt.lerp(this.colorFrenzy, pulse * 0.6);
        }
      } else if (z.state === 'ambient') {
        this.colorSkin.lerp(this.colorAmbientMute, 0.22);
        this.colorShirt.lerp(this.colorAmbientMute, 0.18);
      }
      if (brute && z.state !== 'dead') {
        this.colorSkin.lerp(this.colorBruteSkin, 0.6);
        this.colorShirt.lerp(this.colorBruteShirt, 0.55);
        this.colorPants.lerp(this.colorBrutePants, 0.55);
        if (frenzyOn && this.frenzyCohort.has(z.id)) this.colorSkin.lerp(this.colorFrenzy, 0.18 * frenzyFade);
      }
      let flashBoost = 0;
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
        flashBoost = flashAmt * 0.6;
      }
      if (z.hitFlash > 0) {
        const flashAmt = Math.min(1, z.hitFlash * 7.5);
        this.colorSkin.lerp(this.colorWhite, flashAmt);
        this.colorShirt.lerp(this.colorWhite, flashAmt);
        this.colorPants.lerp(this.colorWhite, flashAmt);
        this.colorShoe.lerp(this.colorWhite, flashAmt);
        flashBoost = Math.max(flashBoost, flashAmt * 1.6);
      }
      if (flashBoost > 0) {
        // Textures multiply the tint, so a flash must overdrive it (linear colour > 1) to read as a flash.
        const k = 1 + flashBoost;
        this.colorSkin.multiplyScalar(k);
        this.colorShirt.multiplyScalar(k);
        this.colorPants.multiplyScalar(k);
        this.colorShoe.multiplyScalar(k);
      }

      // --- Instances -------------------------------------------------------------
      const skin = this.colorSkin;
      const longSleeves = look.sleeves === 'long';
      this.pushPart('head', BONE.head, look.skinTile, skin, skin);
      if (detail < 2) this.pushPart('jaw', BONE.jaw, look.skinTile, skin, skin);
      this.pushPart('torso', BONE.spine, look.torsoTile, this.colorShirt, skin);
      this.pushPart('pelvis', BONE.hips, look.pantsTile, this.colorPants, skin);
      for (let side = 0; side < 2; side++) {
        const left = side === 0;
        const ua = left ? BONE.upperArmL : BONE.upperArmR;
        const fa = left ? BONE.forearmL : BONE.forearmR;
        const th = left ? BONE.thighL : BONE.thighR;
        const sh = left ? BONE.shinL : BONE.shinR;
        const ft = left ? BONE.footL : BONE.footR;
        if (longSleeves) this.pushPart('upperArm', ua, look.torsoTile, this.colorShirt, skin);
        else this.pushPart('upperArm', ua, look.skinTile, skin, skin);
        if (look.sleeves !== 'none') this.pushPart('sleeve', ua, look.torsoTile, this.colorShirt, skin);
        if (longSleeves) this.pushPart('forearm', fa, look.torsoTile, this.colorShirt, skin);
        else this.pushPart('forearm', fa, look.skinTile, skin, skin);
        this.pushPart('thigh', th, look.pantsTile, this.colorPants, skin);
        const torn = look.tornLeg === (left ? 1 : -1);
        if (look.shorts) this.pushPart('shin', sh, look.skinTile, skin, skin);
        else if (torn) this.pushPart('shin', sh, TILE.skinRot, skin, skin);
        else this.pushPart('shin', sh, look.pantsTile, this.colorPants, skin);
        this.pushPart('foot', ft, TILE.leather, this.colorShoe, skin);
      }
      for (let a = 0; a < look.accessories.length; a++) {
        const kind = look.accessories[a];
        if (detail === 2 && !SILHOUETTE_ACCESSORIES.has(kind)) continue;
        const am = this.accessories[kind];
        const i = am.count++;
        am.mesh.setMatrixAt(i, this.bones[ACCESSORY_BONE[kind]]);
        this.colorAcc.setHex(entry.accTints[a] ?? 0xffffff);
        if (z.hitFlash > 0) this.colorAcc.lerp(this.colorWhite, Math.min(1, z.hitFlash * 7.5));
        if (flashBoost > 0) this.colorAcc.multiplyScalar(1 + flashBoost);
        am.mesh.setColorAt(i, this.colorAcc);
      }

      // Blob shadow under every non-dead zombie
      const scale = prof.scale;
      if (z.state !== 'dead') {
        this.posVec.set(ix, 0.018, iz);
        this.quat.identity();
        this.discScale.setScalar(scale * prof.width);
        this.discMatrix.compose(this.posVec, this.quat, this.discScale);
        this.shadowMesh.setMatrixAt(shadowIdx++, this.discMatrix);
      }

      // Pale-green (or rush orange-red) ground marker ring under follower zombies
      if (z.state === 'follower') {
        this.posVec.set(ix, 0.026, iz);
        this.quat.identity();
        const frenzied = frenzyOn && this.frenzyCohort.has(z.id);
        const ringScale = rushActive || frenzied ? scale * (1.08 + 0.1 * Math.sin(time * 12 + phase)) : scale;
        this.discScale.setScalar(ringScale);
        this.discMatrix.compose(this.posVec, this.quat, this.discScale);
        this.markerMesh.setMatrixAt(markerIdx, this.discMatrix);
        this.colorMarker.setHex(rushActive || frenzied ? 0xff5a24 : brute ? 0xd9a441 : 0x7ee852);
        this.markerMesh.setColorAt(markerIdx, this.colorMarker);
        markerIdx++;
      }
    }

    this.drawnCount = count;
    for (const p of HORDE_PARTS) {
      const pm = this.parts[p];
      pm.mesh.count = pm.count;
      pm.mesh.instanceMatrix.needsUpdate = true;
      if (pm.mesh.instanceColor) pm.mesh.instanceColor.needsUpdate = true;
      pm.tile.needsUpdate = true;
      pm.skin.needsUpdate = true;
    }
    for (const k of ACCESSORY_KINDS) {
      const am = this.accessories[k];
      am.mesh.count = am.count;
      am.mesh.instanceMatrix.needsUpdate = true;
      if (am.mesh.instanceColor) am.mesh.instanceColor.needsUpdate = true;
    }

    this.shadowMesh.count = shadowIdx;
    this.shadowMesh.instanceMatrix.needsUpdate = true;

    this.markerMesh.count = markerIdx;
    this.markerMesh.instanceMatrix.needsUpdate = true;
    if (this.markerMesh.instanceColor) {
      this.markerMesh.instanceColor.needsUpdate = true;
    }

    // Drop side-table entries for zombies gone for a while (removed corpses, restarts).
    if (this.frame % 120 === 0) {
      for (const [id, e] of this.table) if (this.frame - e.seenFrame > 600) this.table.delete(id);
    }
    if (t0) this.updateMs += (performance.now() - t0 - this.updateMs) * 0.1;
  }

  dispose(): void {
    this.partMaterial.dispose();
    this.accMaterial.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    for (const part of HORDE_PARTS) {
      this.parts[part].mesh.geometry.dispose();
      this.parts[part].mesh.dispose();
    }
    for (const k of ACCESSORY_KINDS) this.accessories[k].mesh.dispose();
    this.shadowMesh.dispose();
    this.markerMesh.dispose();
    this.table.clear();
    this.group.clear();
  }
}
