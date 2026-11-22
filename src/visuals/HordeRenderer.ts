import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { diveProgress, diveStartTime } from '../systems/NestTravelSystem';
import type { GameEvent, ZombieAgent, NestTravel } from '../core/types';
import {
  animateZombie,
  createAnimInput,
  createAnimState,
  type ZombieAnimState,
} from './zombieAnimation';
import {
  ACCESSORY_BONE,
  ACCESSORY_HB,
  BODY_FLAG,
  BONE,
  composeBones,
  createBoneMatrices,
  createZombieBodyMaterial,
  createZombieMaterial,
  getAccessoryGeometries,
  getHordePartGeometries,
  HORDE_PARTS,
  PAIRED_PARTS,
  SILHOUETTE_ACCESSORIES,
  type HordePart,
} from './zombieModel';
import { BONE_ROW_FLOATS, BoneTexture } from '../graphics/characters/InstancedSkinning';
import { bodyGeometry } from '../graphics/characters/CharacterFactory';
import { HB, HUMANOID_BONE_COUNT, ZOMBIE_BODY_SHAPES, type BodyShapeId } from '../graphics/characters/characterTypes';
import { BODY_SHAPES, bindInverses, poseToBoneMatrices, type BodyShape } from '../graphics/characters/humanoidRig';
import { QUALITY_PRESETS, type QualityProfile } from '../graphics/performance/GraphicsQuality';
import { ACCESSORY_KINDS, TILE, zombieProfile, type AccessoryKind, type ZombieProfile } from './zombieProfiles';
import { createPose, type ZombiePose } from './zombieRig';
import { asGroundDecal, DECAL_STEP, DECAL_Y } from '../world/groundLevels';

const TWO_PI = Math.PI * 2;

/**
 * Feature flag (VP2-T009 -> T014 sign-off): true = one skinned body mesh per (shape x LOD); false = the old 15 rigid
 * parts per zombie (kept compiling as the fallback; the constructor option `{ skinned }` overrides per instance).
 */
export const USE_SKINNED_HORDE = true;

/** Cache layout per zombie (floats): skin matrices | head matrix (scaled) | chest matrix (scaled), all character space. */
const CACHE_HEAD = BONE_ROW_FLOATS;
const CACHE_CHEST = BONE_ROW_FLOATS + 16;
const CACHE_FLOATS = BONE_ROW_FLOATS + 32;
/** Head accessories / hats were authored for the old (smaller) head: scale them with the new head. */
const HEAD_ACC_SCALE = 1.12;
/** Seconds a stronghold-capture celebration lasts, and how far from the Alpha followers join in. */
const CELEBRATE_SECONDS = 4.5;
const CELEBRATE_RADIUS = 32;
const SHAPE_INDEX: Record<BodyShapeId, number> = { average: 0, tallSkinny: 1, shortRound: 2, heavy: 3, lanky: 4, alpha: 0 };
const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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

/** Marks the first `n` instances of a per-instance attribute for upload. */
function touch(a: THREE.InstancedBufferAttribute, n: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}

/** out[16] = a[16] * b[16] (column-major 4x4, alloc-free). */
function mul4(a: Float32Array, ao: number, b: Float32Array, bo: number, out: Float32Array, oo: number): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2], b3 = b[bo + c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[oo + c * 4 + r] = a[ao + r] * b0 + a[ao + 4 + r] * b1 + a[ao + 8 + r] * b2 + a[ao + 12 + r] * b3;
    }
  }
}

/** skin[i] = world[i] * bindInverse[i] for all 21 bones. */
function skinMatrices(world: Float32Array, bindInv: Float32Array, out: Float32Array): void {
  for (let i = 0; i < HUMANOID_BONE_COUNT; i++) mul4(world, i * 16, bindInv, i * 16, out, i * 16);
}

/** dst = src with columns 0/1/2 scaled (a scale applied in the bone's local frame). */
function copyScaled(src: Float32Array, so: number, dst: Float32Array, dof: number, sx: number, sy: number, sz: number): void {
  for (let k = 0; k < 3; k++) {
    dst[dof + k] = src[so + k] * sx; dst[dof + 4 + k] = src[so + 4 + k] * sy; dst[dof + 8 + k] = src[so + 8 + k] * sz;
  }
  dst[dof + 3] = dst[dof + 7] = dst[dof + 11] = 0;
  dst[dof + 12] = src[so + 12]; dst[dof + 13] = src[so + 13]; dst[dof + 14] = src[so + 14]; dst[dof + 15] = 1;
}

/** Renderer-side per-zombie record (profile + animation state); never part of GameState. */
interface Entry {
  profile: ZombieProfile;
  anim: ZombieAnimState;
  brute: boolean;
  converted: boolean;
  lastHitFlash: number;
  /** Sim time this follower started its nest-teleport dive; -1 = not diving. */
  diveAt: number;
  hitFromX: number;
  hitFromZ: number;
  seenFrame: number;
  accTints: number[];
  /** Skinned path: body LOD with hysteresis, cached character-space matrices, deferred animation ticks. */
  lod: 0 | 1;
  cache: Float32Array | null;
  cacheOk: boolean;
  pendingDt: number;
  pendingHit: boolean;
  pendHitX: number;
  pendHitZ: number;
}

interface PartMesh {
  mesh: THREE.InstancedMesh;
  tile: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  count: number;
}

/** One skinned body draw (shape x LOD): a Mesh over an InstancedBufferGeometry (see InstancedSkinning.ts). */
interface BodyMesh {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  row: THREE.InstancedBufferAttribute;
  root: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  skin: THREE.InstancedBufferAttribute;
  shirt: THREE.InstancedBufferAttribute;
  pants: THREE.InstancedBufferAttribute;
  shoe: THREE.InstancedBufferAttribute;
  count: number;
}

interface AccMesh {
  mesh: THREE.InstancedMesh;
  count: number;
}

export class HordeRenderer {
  readonly group: THREE.Group;

  private readonly maxInstances: number;
  private readonly skinned: boolean;
  private readonly parts: Record<HordePart, PartMesh> | null;
  private readonly bodies: Map<string, BodyMesh> = new Map();
  private readonly bodyList: BodyMesh[] = [];
  private readonly boneTex: BoneTexture | null;
  private readonly bodyMaterial: THREE.MeshStandardMaterial | null;
  private readonly accessories: Record<AccessoryKind, AccMesh>;
  private readonly partMaterial: THREE.MeshStandardMaterial | null;
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
  // Skinned path scratch (alloc-free): world bone matrices, per-shape mutable BodyShape copies + bind inverses.
  private readonly worldScratch = new Float32Array(BONE_ROW_FLOATS);
  private readonly shapes = {} as Record<BodyShapeId, BodyShape>;
  private readonly bindInv = {} as Record<BodyShapeId, Float32Array>;
  private readonly matA = new THREE.Matrix4();
  private readonly matB = new THREE.Matrix4();
  private quality: Pick<QualityProfile, 'characterLod0Distance' | 'boneUpdateTiers'> = QUALITY_PRESETS.high;
  private clock = 0;
  private celebrateStart = -1;
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
  private nestTravel: NestTravel | null = null;
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
  /** Skinned bodies drawn at body LOD0 / LOD1 last update. */
  readonly bodyLodCounts: [number, number] = [0, 0];
  /** Zombies whose bones were recomputed last update (rest reused their cached matrices). */
  boneUpdates = 0;
  /** Draw calls this renderer issues (skinned bodies + accessories + shadow + marker), as of the last update. */
  bodyDraws = 0;
  /** CPU time of the last update() (ms), exponentially smoothed. */
  updateMs = 0;
  /** World head-bone matrices of the zombies drawn last update (slot per drawn zombie, looked up by id). */
  private readonly headMats: Float32Array;
  private readonly headSlot = new Map<number, number>();

  constructor(maxInstances = 220, options: { skinned?: boolean } = {}) {
    this.maxInstances = maxInstances;
    this.skinned = options.skinned ?? USE_SKINNED_HORDE;
    this.headMats = new Float32Array(maxInstances * 16);
    this.group = new THREE.Group();
    this.group.name = 'HordeRenderer';

    this.accMaterial = createZombieMaterial({ instanced: true });
    this.partMaterial = this.skinned ? null : createZombieMaterial({ instanced: true });
    this.boneTex = this.skinned ? new BoneTexture(maxInstances) : null;
    this.bodyMaterial = this.boneTex ? createZombieBodyMaterial(this.boneTex) : null;
    if (this.boneTex) this.createBodies(maxInstances);

    const parts = {} as Record<HordePart, PartMesh>;
    const partGeos = this.skinned ? null : getHordePartGeometries();
    for (const part of this.skinned ? [] : HORDE_PARTS) {
      const cap = PAIRED_PARTS.has(part) ? maxInstances * 2 : maxInstances;
      // Each InstancedMesh needs its own geometry object for the per-instance attributes.
      const geo = partGeos![part].clone();
      const tile = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      const skin = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      tile.setUsage(THREE.DynamicDrawUsage);
      skin.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTile', tile);
      geo.setAttribute('aSkin', skin);
      const m = new THREE.InstancedMesh(geo, this.partMaterial!, cap);
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
    this.parts = this.skinned ? null : parts;

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
    asGroundDecal(this.shadowMat);
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
    asGroundDecal(this.markerMat);
    this.markerMesh = new THREE.InstancedMesh(this.markerGeo, this.markerMat, maxInstances);
    this.markerMesh.frustumCulled = false;
    this.markerMesh.count = 0;
    this.markerMesh.setColorAt(0, this.colorWhite);
    this.markerMesh.name = 'HordeFollowerMarkers';
    this.group.add(this.markerMesh);
  }

  /** Creates the shape x LOD skinned draws (<= 10 body draw calls). */
  private createBodies(maxInstances: number): void {
    for (const shape of ZOMBIE_BODY_SHAPES) {
      this.shapes[shape] = { ...BODY_SHAPES[shape] };
      this.bindInv[shape] = bindInverses(BODY_SHAPES[shape]);
      for (const lod of [0, 1] as const) {
        const base = bodyGeometry(shape, lod);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.getAttribute(name));
        const inst = (size: number): THREE.InstancedBufferAttribute => {
          const a = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * size), size);
          a.setUsage(THREE.DynamicDrawUsage);
          return a;
        };
        const row = inst(1), root = inst(4), look = inst(4), skin = inst(3), shirt = inst(3), pants = inst(3), shoe = inst(3);
        geo.setAttribute('aBoneRow', row);
        geo.setAttribute('aRoot', root);
        geo.setAttribute('aLook', look);
        geo.setAttribute('aSkin', skin);
        geo.setAttribute('aShirt', shirt);
        geo.setAttribute('aPants', pants);
        geo.setAttribute('aShoe', shoe);
        geo.instanceCount = 0;
        const mesh = new THREE.Mesh(geo, this.bodyMaterial!);
        mesh.frustumCulled = false;
        mesh.castShadow = false; // skinned bodies use blob shadows (no skinned depth material); see InstancedSkinning.ts
        mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.name = `HordeBody_${shape}_${lod}`;
        this.group.add(mesh);
        const bm: BodyMesh = { mesh, geo, row, root, look, skin, shirt, pants, shoe, count: 0 };
        this.bodies.set(`${shape}:${lod}`, bm);
        this.bodyList.push(bm);
      }
    }
  }

  /** Graphics quality profile for body LOD distance + bone-update tiers (Game calls this when it changes presets). */
  setQuality(q: Pick<QualityProfile, 'characterLod0Distance' | 'boneUpdateTiers'>): void { this.quality = q; }

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

  /**
   * World matrix of zombie `id`'s animated head bone from the last update() (scale included), written into `out`.
   * False when that zombie was not drawn. Lets overlays (companion hats) ride the head like built-in accessories.
   */
  headMatrixOf(id: number, out: THREE.Matrix4): boolean {
    const slot = this.headSlot.get(id);
    if (slot === undefined) return false;
    out.fromArray(this.headMats, slot * 16);
    return true;
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
      } else if (ev.type === 'strongholdCaptured') {
        this.celebrateStart = this.clock;
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
        diveAt: -1,
        hitFromX: 0,
        hitFromZ: 0,
        seenFrame: this.frame,
        accTints: [],
        lod: 0,
        cache: null,
        cacheOk: false,
        pendingDt: 0,
        pendingHit: false,
        pendHitX: 0,
        pendHitZ: 0,
      };
      this.fillAccTints(e);
      this.table.set(z.id, e);
    } else if (e.brute !== brute || e.converted !== z.isConverted) {
      // Brute Evolution (or conversion): new body, same animation state (no pop in the gait).
      e.profile = zombieProfile(z.id, { isConverted: z.isConverted, brute, variant: z.variant });
      e.brute = brute;
      e.converted = z.isConverted;
      e.cacheOk = false;
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
    const pm = this.parts![part];
    const i = pm.count++;
    pm.mesh.setMatrixAt(i, this.bones[bone]);
    pm.mesh.setColorAt(i, tint);
    pm.tile.setX(i, tile);
    pm.skin.setXYZ(i, skin.r, skin.g, skin.b);
  }

  /**
   * @param time sim time (s); @param dt real frame delta (s) for animation (defaults to the sim-time delta).
   */
  /** Nest teleport in progress (GameState.nestTravel): followers play their dive into the hole. */
  setNestTravel(travel: NestTravel | null): void { this.nestTravel = travel; }

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
    this.clock += animDt;
    const skinned = this.skinned;
    const celebrating = skinned && this.celebrateStart >= 0 && this.clock - this.celebrateStart < CELEBRATE_SECONDS;
    if (!celebrating) this.celebrateStart = -1;
    const [boneT0, boneT1] = this.quality.boneUpdateTiers;
    const lod0Dist = this.quality.characterLod0Distance;
    this.boneUpdates = 0;
    this.bodyLodCounts[0] = this.bodyLodCounts[1] = 0;

    if (this.parts) for (const p of HORDE_PARTS) this.parts[p].count = 0;
    for (let i = 0; i < this.bodyList.length; i++) this.bodyList[i].count = 0;
    for (const k of ACCESSORY_KINDS) this.accessories[k].count = 0;
    this.headSlot.clear();

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
      let dist = 0;
      if (this.hasCamera) {
        const d2 = (ix - this.camX) ** 2 + this.camY * this.camY * 0.25 + (iz - this.camZ) ** 2;
        detail = d2 < LOD_NEAR * LOD_NEAR ? 0 : d2 < LOD_MID * LOD_MID ? 1 : 2;
        dist = Math.sqrt(d2);
      } else if (this.hasFocus) {
        dist = Math.hypot(ix - this.focusX, iz - this.focusZ);
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
      inp.emerge = false;
      inp.dive = -1;
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
      } else if (z.emergeTimer > 1e-9) {
        // Nest spawn crawling up out of the ground (extra stagger time = still buried).
        inp.anim = 'rise';
        inp.emerge = true;
        inp.riseT = Math.max(0, 1 - z.emergeTimer / Math.max(0.01, BALANCE.respawn.emergeTime));
      }
      const travel = this.nestTravel;
      if (travel && z.state === 'follower' && z.hp > 0) {
        entry.diveAt = diveStartTime(travel, z.pos, entry.diveAt, time);
        inp.dive = diveProgress(entry.diveAt, time);
      } else entry.diveAt = -1;
      inp.mode = z.state === 'follower' ? (z.engageTarget ? 'attack' : 'follow') : 'ambient';
      inp.engaged = z.state === 'follower' && z.engageTarget !== null;
      inp.cooldown = z.attackCooldown;
      inp.fast = z.state === 'follower' && (rushActive || (frenzyOn && this.frenzyCohort.has(z.id)));
      inp.attackPhase = 'none';
      inp.attackStyle = -1;
      inp.stun = 0;
      inp.detail = detail;
      inp.celebrate = -1;
      if (celebrating && z.state === 'follower' && this.leaderAlive) {
        const cdx = ix - this.leaderX;
        const cdz = iz - this.leaderZ;
        if (cdx * cdx + cdz * cdz < CELEBRATE_RADIUS * CELEBRATE_RADIUS) inp.celebrate = this.clock - this.celebrateStart;
      }
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

      // --- Skeleton ----------------------------------------------------------
      this.posVec.set(ix, sinkY + z.elevation, iz);
      this.euler.set(0, facing, 0, 'XYZ');
      this.quat.setFromEuler(this.euler);
      this.rootMatrix.compose(this.posVec, this.quat, this.unitScale);
      let body: BodyMesh | null = null;
      let bodyIdx = 0;
      if (skinned) {
        // Body LOD (hysteresis +-8 %) and bone-update tier (stagger by id). The root (position / yaw) is applied in
        // the shader from aRoot every frame, so zombies whose bones are reused still move smoothly.
        const shapeId: BodyShapeId = prof.bodyShape === 'alpha' ? 'average' : prof.bodyShape;
        const lodNow = entry.lod;
        if (lodNow === 0 && dist > lod0Dist * 1.08) entry.lod = 1;
        else if (lodNow === 1 && dist < lod0Dist * 0.92) entry.lod = 0;
        this.bodyLodCounts[entry.lod]++;
        const period = dist < boneT0 ? 1 : dist < boneT1 ? 2 : 4;
        const tick = period === 1 || !entry.cacheOk || (this.frame + z.id) % period === 0;
        if (!entry.cache) entry.cache = new Float32Array(CACHE_FLOATS);
        const cache = entry.cache;
        if (tick) {
          inp.dt = animDt + entry.pendingDt;
          if (entry.pendingHit) {
            if (!inp.hitImpulse) { inp.hitFromX = entry.pendHitX; inp.hitFromZ = entry.pendHitZ; }
            inp.hitImpulse = true;
          }
          entry.pendingDt = 0;
          entry.pendingHit = false;
          animateZombie(entry.anim, prof, inp, this.pose);
          const bs = this.shapes[shapeId];
          const base = BODY_SHAPES[shapeId];
          bs.scale = entry.brute ? prof.scale : prof.scale * base.scale;
          bs.width = prof.width * base.width;
          poseToBoneMatrices(this.pose, bs, IDENTITY16, this.worldScratch, 0);
          skinMatrices(this.worldScratch, this.bindInv[shapeId], cache);
          // Head / chest frames (accessories, companion hats) with the shape's head / torso scale baked in.
          const hsc = HEAD_ACC_SCALE * base.headScale;
          copyScaled(this.worldScratch, HB.head * 16, cache, CACHE_HEAD, hsc, hsc, hsc);
          copyScaled(this.worldScratch, HB.chest * 16, cache, CACHE_CHEST, base.torsoWidth * 1.1, 1, base.torsoDepth * 1.1);
          entry.cacheOk = true;
          this.boneUpdates++;
        } else {
          entry.pendingDt += animDt;
          if (hitEdge) { entry.pendingHit = true; entry.pendHitX = inp.hitFromX; entry.pendHitZ = inp.hitFromZ; }
        }
        body = this.bodyList[SHAPE_INDEX[shapeId] * 2 + entry.lod];
        bodyIdx = body.count++;
        const row = count - 1;
        this.boneTex!.data.set(cache.subarray(0, BONE_ROW_FLOATS), row * BONE_ROW_FLOATS);
        this.matA.fromArray(cache, CACHE_HEAD);
        this.matB.multiplyMatrices(this.rootMatrix, this.matA);
        this.matB.toArray(this.headMats, row * 16);
        body.row.setX(bodyIdx, row);
        body.root.setXYZW(bodyIdx, ix, sinkY + z.elevation, iz, facing);
      } else {
        animateZombie(entry.anim, prof, inp, this.pose);
        composeBones(this.pose, this.rootMatrix, prof.scale, prof.width, this.bones);
        this.bones[BONE.head].toArray(this.headMats, (count - 1) * 16);
      }
      this.headSlot.set(z.id, count - 1);

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
      if (body) {
        const flags = (look.shorts ? BODY_FLAG.shorts : 0) | (look.tornLeg === 1 ? BODY_FLAG.tornL : 0)
          | (look.tornLeg === -1 ? BODY_FLAG.tornR : 0) | (longSleeves ? BODY_FLAG.longSleeves : 0)
          | (look.sleeves === 'none' ? BODY_FLAG.noSleeves : 0);
        body.look.setXYZW(bodyIdx, look.torsoTile, look.pantsTile, look.skinTile, flags);
        body.skin.setXYZ(bodyIdx, skin.r, skin.g, skin.b);
        body.shirt.setXYZ(bodyIdx, this.colorShirt.r, this.colorShirt.g, this.colorShirt.b);
        body.pants.setXYZ(bodyIdx, this.colorPants.r, this.colorPants.g, this.colorPants.b);
        body.shoe.setXYZ(bodyIdx, this.colorShoe.r, this.colorShoe.g, this.colorShoe.b);
      } else {
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
      }
      for (let a = 0; a < look.accessories.length; a++) {
        const kind = look.accessories[a];
        if (detail === 2 && !SILHOUETTE_ACCESSORIES.has(kind)) continue;
        const am = this.accessories[kind];
        const i = am.count++;
        if (body) {
          this.matA.fromArray(entry.cache!, ACCESSORY_HB[kind] === HB.head ? CACHE_HEAD : CACHE_CHEST);
          this.matB.multiplyMatrices(this.rootMatrix, this.matA);
          am.mesh.setMatrixAt(i, this.matB);
        } else am.mesh.setMatrixAt(i, this.bones[ACCESSORY_BONE[kind]]);
        this.colorAcc.setHex(entry.accTints[a] ?? 0xffffff);
        if (z.hitFlash > 0) this.colorAcc.lerp(this.colorWhite, Math.min(1, z.hitFlash * 7.5));
        if (flashBoost > 0) this.colorAcc.multiplyScalar(1 + flashBoost);
        am.mesh.setColorAt(i, this.colorAcc);
      }

      // Blob shadow under every non-dead zombie
      const scale = prof.scale;
      if (z.state !== 'dead' && inp.dive < 0.7) { // a zombie that dove into a nest is underground: no shadow
        this.posVec.set(ix, DECAL_Y, iz);
        this.quat.identity();
        this.discScale.setScalar(scale * prof.width);
        this.discMatrix.compose(this.posVec, this.quat, this.discScale);
        this.shadowMesh.setMatrixAt(shadowIdx++, this.discMatrix);
      }

      // Pale-green (or rush orange-red) ground marker ring under follower zombies
      if (z.state === 'follower') {
        this.posVec.set(ix, DECAL_Y + DECAL_STEP, iz);
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
    let draws = 0;
    for (let bi = 0; bi < this.bodyList.length; bi++) {
      const b = this.bodyList[bi];
      const n = b.count;
      b.geo.instanceCount = n;
      b.mesh.visible = n > 0;
      if (n === 0) continue;
      draws++;
      touch(b.row, n); touch(b.root, n); touch(b.look, n); touch(b.skin, n);
      touch(b.shirt, n); touch(b.pants, n); touch(b.shoe, n);
    }
    if (this.boneTex) this.boneTex.markRows(count);
    if (this.parts) for (const p of HORDE_PARTS) {
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

    for (const k of ACCESSORY_KINDS) if (this.accessories[k].count > 0) draws++;
    this.bodyDraws = draws + (shadowIdx > 0 ? 1 : 0) + (markerIdx > 0 ? 1 : 0);
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
    this.partMaterial?.dispose();
    this.bodyMaterial?.dispose();
    this.boneTex?.dispose();
    this.accMaterial.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    if (this.parts) {
      for (const part of HORDE_PARTS) {
        this.parts[part].mesh.geometry.dispose();
        this.parts[part].mesh.dispose();
      }
    }
    for (const b of this.bodyList) b.geo.dispose();
    this.bodies.clear();
    this.bodyList.length = 0;
    for (const k of ACCESSORY_KINDS) this.accessories[k].mesh.dispose();
    this.shadowMesh.dispose();
    this.markerMesh.dispose();
    this.table.clear();
    this.group.clear();
  }
}
