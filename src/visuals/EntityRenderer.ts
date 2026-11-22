import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { diveProgress, diveStartTime } from '../systems/NestTravelSystem';
import type {
  AnimAction,
  CivilianWeapon,
  EntityId,
  GameEvent,
  GameState,
  GuardAgent,
  TargetRef,
} from '../core/types';
import { humanVisual, type HumanVisualMode } from '../core/visionMath';
import { awarenessOf, visionProfile } from '../systems/AwarenessSystem';
import { civilianWeapon } from '../systems/ResistanceSystem';
import { humanProfile, type HumanProfile } from './humanProfiles';
import {
  applyPose,
  computePose,
  createGuardRig,
  type CharacterRig,
  type Pose,
  type PoseParams,
} from './LowPolyCharacters';
import { animateZombie, createAnimInput, createAnimState, type ZombieAnimState } from './zombieAnimation';
import { createZombieHeroRig, LEADER_GLOW } from './zombieModel';
import { createAlphaCharacter, type AlphaCharacter } from '../graphics/characters/CharacterFactory';
import { HumanRenderer } from '../graphics/characters/HumanRenderer';
import { HUMAN_FX, humanLook, humanPoseToZombiePose, type HumanLook } from '../graphics/characters/humanBodyMath';
import { buildCosmeticMesh } from './CosmeticMeshes';
import { alphaProfile, ATTACK_STYLE, TILE } from './zombieProfiles';
import { createPose, type ZombiePose } from './zombieRig';
import { asGroundDecal, DECAL_STEP, DECAL_Y } from '../world/groundLevels';
import { createMachineGun, createTank, disposeHeavy, setHeavyMaterial, setWrecked, type HeavyModel } from './heavyWeaponModels';

/** Alpha combo step → attack key style: bite, right claw, left claw, overhead finisher. */
const ALPHA_STYLE_BY_STEP = [ATTACK_STYLE.bite, ATTACK_STYLE.swipeR, ATTACK_STYLE.swipeL, ATTACK_STYLE.overhead];

const TWO_PI = Math.PI * 2;

/**
 * VP2-T009b: render the Alpha as a real skinned character (`createAlphaCharacter`). Set false to restore the old rigid
 * hero rig (`createZombieHeroRig`) until VP2-T014 signs off.
 */
export const USE_SKINNED_ALPHA = true;
/**
 * VP2-T011: render humans through the shared instanced skeletal path (`HumanRenderer`: ~8 body draws for every human, blocky
 * bevelled-box segments, gear as masked pieces). Set false to restore the old per-rig meshes (`createGuardRig`, ~10 meshes
 * each) until VP2-T014 signs off.
 */
export const USE_SKINNED_HUMANS = true;
/** Humans closer than this (m, to the camera focus) draw the detailed body LOD (hysteresis +-8 %). */
const HUMAN_LOD0_M = 34;
/** Loops of the celebrate clip (1.6 s each) played on a stronghold capture. */
const CELEBRATE_LOOPS = 2;

/** What EntityRenderer needs of whichever Alpha rig is active (skinned character or the legacy hero rig). */
interface LeaderRig {
  /** Carries the visual-only stagger / panic offsets; child of the sim-driven leaderAnchor. */
  root: THREE.Object3D;
  materials: THREE.Material[];
  slots: Record<'hat' | 'glasses' | 'back' | 'hand', THREE.Object3D>;
  apply(pose: ZombiePose): void;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a) % TWO_PI) + TWO_PI;
  diff = ((diff + Math.PI) % TWO_PI) - Math.PI;
  return a + diff * t;
}

interface GuardVisualEntry {
  id: EntityId;
  profile: HumanProfile;
  /** Sim-driven anchor: carries the ground markers + MG model (and, in legacy mode, the rig itself). */
  root: THREE.Group;
  /** Legacy per-rig meshes (null when USE_SKINNED_HUMANS). */
  rig: CharacterRig | null;
  /** Skinned-instance look (null in legacy mode). */
  look: HumanLook | null;
  /** Body LOD of the skinned draw. */
  lod: 0 | 1;
  rigMeshes: THREE.Mesh[];
  /** VP perf: dynamic shadows only for humans near the Alpha (hysteresis band). */
  castsShadow: boolean;
  rigMat: THREE.Material | null;
  isSilhouette: boolean;
  pickProxy: THREE.Mesh;
  factionDisc: THREE.Mesh;
  targetRing: THREE.Mesh;
  hoverRing: THREE.Mesh;
  /** todos #12: civilians re-rig when the resistance hands them a weapon. */
  weapon: CivilianWeapon;
  hitRecoil: number;
  lastHitFlash: number;
  /** Heavy weapon model (mounted MG on the rig / tank in world space), null for ordinary humans. */
  heavy: HeavyModel | null;
}

/** Humans cast dynamic shadows within ON m of the Alpha and stop beyond OFF m (squared). */
const HUMAN_SHADOW_ON_M2 = 22 * 22;
const HUMAN_SHADOW_OFF_M2 = 26 * 26;

export class EntityRenderer {
  readonly pickables: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly rootGroup: THREE.Group;
  private readonly leaderAnchor: THREE.Group;
  private readonly leaderRig: LeaderRig;
  /** Non-null when the skinned Alpha is active (USE_SKINNED_ALPHA). */
  private readonly alphaChar: AlphaCharacter | null = null;
  private celebrateQueued = false;
  private readonly leaderProfile = alphaProfile();
  private leaderAnim: ZombieAnimState = createAnimState();
  private readonly leaderInput = createAnimInput();
  private readonly leaderPose = createPose();
  private leaderLastHitFlash = 0;
  private leaderStagger = 0;
  private leaderStaggerVel = 0;
  private reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  private readonly leaderOuterRing: THREE.Mesh;
  private readonly leaderInnerRing: THREE.Mesh;
  private readonly leaderOuterRingMat: THREE.MeshBasicMaterial;
  private readonly leaderInnerRingMat: THREE.MeshBasicMaterial;

  /** Instanced skinned humans (null with USE_SKINNED_HUMANS = false). */
  private readonly humans: HumanRenderer | null = null;
  private readonly humanPose = createPose();
  private humanLod0 = HUMAN_LOD0_M;
  private readonly guardsMap = new Map<EntityId, GuardVisualEntry>();
  private readonly convertedGuardIds = new Set<EntityId>();
  /** Reused each frame by updateGuards (no per-frame Set allocation). */
  private readonly activeGuardIds = new Set<EntityId>();
  private lastStateTime = -1;
  // Render-radius culling (setView) and leader death/respawn animation timers
  private hasFocus = false;
  private focusX = 0;
  private focusZ = 0;
  private cullRadius2 = BALANCE.population.activeRadius * BALANCE.population.activeRadius;
  private leaderWasAlive = true;
  private leaderDeadTime = 0;
  private leaderRiseTime = 99;
  /** Render the Alpha fully underground (returning player, before the climb-out starts). */
  private leaderBuried = false;
  /** Sim time the Alpha started its nest-teleport dive; -1 = not diving. */
  private leaderDiveAt = -1;
  private readonly equippedCosmetics: Record<'hat' | 'glasses' | 'back' | 'hand', string | null> = {
    hat: null, glasses: null, back: null, hand: null,
  };
  private hoveredGuardId: EntityId | null = null;
  private readonly targetedGuardIds = new Set<EntityId>();
  private visionGating = false;

  // Shared geometries & materials for guard indicators and pick proxies
  private readonly silhouetteMat: THREE.MeshLambertMaterial;
  private readonly pickGeo: THREE.BufferGeometry;
  private readonly pickMat: THREE.MeshBasicMaterial;
  private readonly factionDiscGeo: THREE.BufferGeometry;
  private readonly factionDiscMat: THREE.MeshBasicMaterial;
  private readonly civilianDiscMat: THREE.MeshBasicMaterial;
  private readonly targetRingGeo: THREE.BufferGeometry;
  private readonly targetRingMat: THREE.MeshBasicMaterial;
  private readonly hoverRingGeo: THREE.BufferGeometry;
  private readonly hoverRingMat: THREE.MeshBasicMaterial;

  private readonly sharedGeometries = new Set<THREE.BufferGeometry>();
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  private readonly scratchPose: Pose = {
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

  private readonly scratchParams: PoseParams = {
    kind: 'guard',
    anim: 'idle',
    animTime: 0,
    speed: 0,
    time: 0,
    phase: 0,
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'EntityRendererRoot';
    this.scene.add(this.rootGroup);

    if (USE_SKINNED_HUMANS) {
      this.humans = new HumanRenderer();
      this.rootGroup.add(this.humans.group);
    }

    // 1. Leader Rig + Pulsing Ground Highlight Rings (leaderAnchor owns sim pos/facing; leaderRig.root holds visual-only stagger/panic)
    this.leaderAnchor = new THREE.Group();
    this.leaderAnchor.name = 'LeaderAnchor';
    this.leaderAnchor.userData.noVisionHaze = true;
    this.rootGroup.add(this.leaderAnchor);

    if (USE_SKINNED_ALPHA) {
      // Tourist look on the skinned body: Hawaiian-print jacket tile, short sleeves, khaki cargo shorts.
      const look = { ...this.leaderProfile.look, sleeves: 'short' as const, shorts: true, pantsTile: TILE.khaki,
        pantsTint: 0xd4c298, tornLeg: 0 as const };
      const alpha = createAlphaCharacter(look);
      this.alphaChar = alpha;
      alpha.helper.userData.noVisionHaze = true;
      this.rootGroup.add(alpha.helper);
      const identity = new THREE.Matrix4();
      this.leaderRig = {
        root: alpha.root,
        materials: [alpha.material],
        slots: alpha.slots,
        apply: (pose) => alpha.setPose(pose, identity),
      };
    } else {
      const hero = createZombieHeroRig(this.leaderProfile.look, this.leaderProfile.scale, this.leaderProfile.width);
      this.leaderRig = hero;
      for (const m of hero.materials) {
        this.disposableMaterials.push(m);
      }
    }
    this.leaderRig.root.userData.noVisionHaze = true;
    this.leaderAnchor.add(this.leaderRig.root);

    const outerRingGeo = this.trackGeometry(new THREE.RingGeometry(0.62, 0.84, 24));
    outerRingGeo.rotateX(-Math.PI / 2);
    this.leaderOuterRingMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x4f6b3a,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.leaderOuterRing = new THREE.Mesh(outerRingGeo, this.leaderOuterRingMat);
    this.leaderOuterRing.position.y = DECAL_Y;
    this.leaderAnchor.add(this.leaderOuterRing);

    const innerRingGeo = this.trackGeometry(new THREE.RingGeometry(0.42, 0.58, 24));
    innerRingGeo.rotateX(-Math.PI / 2);
    this.leaderInnerRingMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x9be35a,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.leaderInnerRing = new THREE.Mesh(innerRingGeo, this.leaderInnerRingMat);
    this.leaderInnerRing.position.y = DECAL_Y + DECAL_STEP;
    this.leaderAnchor.add(this.leaderInnerRing);

    // 2. Shared Guard Indicator Geometries & Materials
    this.silhouetteMat = this.trackMaterial(
      new THREE.MeshLambertMaterial({
        color: 0x1b2124,
        flatShading: true,
      }),
    );
    this.pickGeo = this.trackGeometry(new THREE.BoxGeometry(1.3, 2.2, 1.3));
    this.pickMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );

    this.factionDiscGeo = this.trackGeometry(new THREE.RingGeometry(0.35, 0.54, 16));
    this.factionDiscGeo.rotateX(-Math.PI / 2);
    this.factionDiscMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xe0782a,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    this.civilianDiscMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xd6cfc2,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    this.targetRingGeo = this.trackGeometry(new THREE.RingGeometry(0.62, 0.86, 20));
    this.targetRingGeo.rotateX(-Math.PI / 2);
    this.targetRingMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xff3b24,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    this.hoverRingGeo = this.trackGeometry(new THREE.RingGeometry(0.55, 0.72, 20));
    this.hoverRingGeo.rotateX(-Math.PI / 2);
    this.hoverRingMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    // Ground rings/discs: polygon offset so they never z-fight the ground they lie on.
    for (const m of [this.leaderOuterRingMat, this.leaderInnerRingMat, this.factionDiscMat, this.civilianDiscMat,
      this.targetRingMat, this.hoverRingMat]) asGroundDecal(m);
  }

  consume(events: readonly GameEvent[]): void {
    let sharedIncoming = 0;
    let leaderDmgIncoming = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'conversionStart' || ev.type === 'converted') {
        this.convertedGuardIds.add(ev.guardId);
      } else if (ev.type === 'leaderRespawned') {
        this.leaderRiseTime = 0;
        this.leaderWasAlive = true;
        this.leaderStagger = 0;
        this.leaderStaggerVel = 0;
        this.alphaChar?.stop();
      } else if (ev.type === 'strongholdCaptured') {
        this.celebrate();
      } else if (ev.type === 'leaderEmerge') {
        this.leaderBuried = false;
        this.leaderRiseTime = 99; // the climb-out replaces the get-up rise
      } else if (ev.type === 'sharedDamage') {
        sharedIncoming += ev.incoming;
      } else if (ev.type === 'damage' && ev.target.kind === 'leader') {
        leaderDmgIncoming += ev.amount;
      }
    }
    const hitIncoming = sharedIncoming > 0 ? sharedIncoming : leaderDmgIncoming;
    if (hitIncoming > 0) {
      const impulse = Math.max(0.05, Math.min(1, hitIncoming / 25));
      this.leaderStaggerVel += impulse * 9.5;
    }
  }

  reset(): void {
    this.convertedGuardIds.clear();
    this.lastStateTime = -1;
    this.hoveredGuardId = null;
    this.targetedGuardIds.clear();
    this.leaderWasAlive = true;
    this.leaderDeadTime = 0;
    this.leaderRiseTime = 99;
    this.leaderBuried = false;
    this.leaderDiveAt = -1;
    this.leaderAnim = createAnimState();
    this.leaderLastHitFlash = 0;
    this.leaderStagger = 0;
    this.leaderStaggerVel = 0;
    this.leaderRig.root.position.set(0, 0, 0);
    this.leaderRig.root.rotation.set(0, 0, 0);
    this.celebrateQueued = false;
    this.alphaChar?.stop();
  }

  /**
   * Plays the Alpha's authored celebrate clip (skinned Alpha only; skipped under reduced motion). Called internally on
   * `strongholdCaptured`; Game may also call it for other wins (the clip starts on the next frame while the Alpha is alive).
   */
  celebrate(): void {
    if (this.alphaChar && !this.reducedMotion) this.celebrateQueued = true;
  }

  /** F3 graphics panel: show the Alpha's SkeletonHelper (skinned Alpha only). */
  setSkeletonHelperVisible(on: boolean): void {
    this.alphaChar?.setSkeletonHelperVisible(on);
  }

  /** Toggle reduced-motion scaling for visual-only Alpha panic/stagger offsets. */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  /** Hold the Alpha underground (until a leaderEmerge event starts the climb). */
  setLeaderBuried(on: boolean): void { this.leaderBuried = on; }

  /** Gate human visuals/markers/picking by AwarenessSystem (default false for legacy layout). */
  setVisionGating(enabled: boolean): void {
    this.visionGating = enabled;
  }

  /**
   * Render-radius culling: humans farther than `radius` (default BALANCE.population.activeRadius)
   * from the focus (camera target), and dormant humans, are hidden. Call before update().
   */
  setView(focusX: number, focusZ: number, radius: number = BALANCE.population.activeRadius): void {
    this.hasFocus = true;
    this.focusX = focusX;
    this.focusZ = focusZ;
    this.cullRadius2 = radius * radius;
  }

  update(state: GameState, alpha: number, time: number, dt: number): void {
    if (this.lastStateTime >= 0 && state.time < this.lastStateTime) {
      this.convertedGuardIds.clear();
    }
    this.lastStateTime = state.time;

    this.updateLeader(state, alpha, time, dt);
    this.humans?.beginFrame();
    this.updateGuards(state, alpha, time, dt);
    this.humans?.endFrame();
  }

  /** Draw calls the instanced humans issued last frame (bodies + blob shadows); 0 in legacy mode. */
  get humanDrawCalls(): number { return this.humans?.drawCalls ?? 0; }

  /** Detail-LOD distance (m from the camera focus) for skinned humans; Game may feed `characterLod0Distance` here. */
  setHumanLod0Distance(m: number): void { this.humanLod0 = Math.max(4, m); }

  setHovered(target: TargetRef | null): void {
    this.hoveredGuardId = target && target.kind === 'guard' ? target.id : null;
  }

  /** All selected attack targets (the horde may be split across several). */
  setTargeted(targets: readonly TargetRef[]): void {
    this.targetedGuardIds.clear();
    for (const t of targets) if (t.kind === 'guard') this.targetedGuardIds.add(t.id);
  }

  dispose(): void {
    if (this.alphaChar) {
      // The body geometry is the shared bodyGeometry('alpha', 0) cache: only the character's own resources go.
      this.alphaChar.dispose();
    } else {
      this.leaderRig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const geom = obj.geometry as THREE.BufferGeometry | undefined;
          if (geom) {
            geom.dispose();
          }
        }
      });
      for (const m of this.leaderRig.materials) {
        m.dispose();
      }
    }

    for (const entry of this.guardsMap.values()) {
      this.disposeGuardEntry(entry, false);
    }
    this.guardsMap.clear();

    this.humans?.dispose();
    this.pickGeo.dispose();
    this.pickMat.dispose();
    this.factionDiscGeo.dispose();
    this.factionDiscMat.dispose();
    this.civilianDiscMat.dispose();
    this.targetRingGeo.dispose();
    this.targetRingMat.dispose();
    this.hoverRingGeo.dispose();
    this.hoverRingMat.dispose();
    this.leaderOuterRingMat.dispose();
    this.leaderInnerRingMat.dispose();

    for (const g of this.disposableGeometries) {
      g.dispose();
    }
    for (const m of this.disposableMaterials) {
      m.dispose();
    }
    this.disposableGeometries.length = 0;
    this.disposableMaterials.length = 0;
    this.sharedGeometries.clear();
    this.convertedGuardIds.clear();
    this.pickables.length = 0;
    this.rootGroup.clear();
    this.scene.remove(this.rootGroup);
  }

  private trackGeometry<T extends THREE.BufferGeometry>(g: T): T {
    this.sharedGeometries.add(g);
    this.disposableGeometries.push(g);
    return g;
  }

  private trackMaterial<T extends THREE.Material>(m: T): T {
    this.disposableMaterials.push(m);
    return m;
  }

  private disposeGuardEntry(entry: GuardVisualEntry, keepShared: boolean): void {
    if (entry.heavy) { disposeHeavy(entry.heavy); entry.heavy = null; }
    if (entry.rig) {
      entry.rig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const geom = obj.geometry as THREE.BufferGeometry | undefined;
          if (geom && (!keepShared || !this.sharedGeometries.has(geom))) {
            geom.dispose();
          }
        }
      });
      for (const m of entry.rig.materials) {
        m.dispose();
      }
    }
    entry.pickProxy.visible = false;
    entry.pickProxy.userData.target = null;
    entry.pickProxy.position.y = -1000;
    this.rootGroup.remove(entry.root);
    this.rootGroup.remove(entry.pickProxy);
    const pickIdx = this.pickables.indexOf(entry.pickProxy);
    if (pickIdx !== -1) {
      this.pickables.splice(pickIdx, 1);
    }
  }

  private updateLeader(state: GameState, alpha: number, time: number, dt: number): void {
    const leader = state.leader;
    const lx = leader.prevPos.x + (leader.pos.x - leader.prevPos.x) * alpha;
    const lz = leader.prevPos.z + (leader.pos.z - leader.prevPos.z) * alpha;
    const facing = lerpAngle(leader.prevFacing, leader.facing, alpha);
    const speed = Math.hypot(leader.vel.x, leader.vel.z);

    this.leaderAnchor.position.set(lx, leader.elevation, lz);
    this.leaderAnchor.rotation.y = facing;

    // Death fall + respawn rise are driven by renderer-side timers (leader.animTime is not reset on death)
    if (!leader.alive) {
      if (this.leaderWasAlive) this.leaderDeadTime = 0;
      this.leaderDeadTime += dt;
    } else if (!this.leaderWasAlive) {
      this.leaderRiseTime = 0;
    }
    this.leaderWasAlive = leader.alive;
    if (leader.alive && this.leaderRiseTime < BALANCE.conversion.riseDuration) this.leaderRiseTime += dt;
    // Climbing out of the ground (sim emergeTimer), or still buried until the player takes control.
    const emerging = leader.alive && (this.leaderBuried || leader.emergeTimer > 1e-9);
    const rising = emerging || (leader.alive && this.leaderRiseTime < BALANCE.conversion.riseDuration);

    const inp = this.leaderInput;
    const attacking = leader.alive && !rising && (leader.attackPhase === 'windup' || leader.attackPhase === 'recovery');
    inp.dt = dt;
    // Riding a player vehicle: the cart carries the Alpha, so no walk / run gait (idle pose, still turns + attacks).
    const riding = !!state.playerVehicle?.mounted;
    inp.speed = leader.alive && !riding ? speed : 0;
    inp.facing = facing;
    inp.anim = !leader.alive ? 'dead' : rising ? 'rise' : leader.anim === 'attack' ? 'idle' : leader.anim;
    inp.animTime = leader.animTime;
    inp.deadTime = this.leaderDeadTime;
    inp.emerge = emerging;
    inp.riseT = emerging
      ? (this.leaderBuried ? 0 : 1 - leader.emergeTimer / Math.max(0.01, BALANCE.respawn.emergeTime))
      : rising ? this.leaderRiseTime / Math.max(0.01, BALANCE.conversion.riseDuration) : 0;
    // Nest teleport: the Alpha leaps head first into the hole once it reaches it.
    const travel = state.nestTravel;
    this.leaderDiveAt = travel && leader.alive ? diveStartTime(travel, leader.pos, this.leaderDiveAt, time) : -1;
    inp.dive = diveProgress(this.leaderDiveAt, time);
    inp.mode = 'follow';
    inp.engaged = attacking;
    inp.cooldown = 0;
    inp.fast = !riding && (leader.sprinting || state.progression.frenzyTimeLeft > 0);
    if (attacking) {
      const step = leader.comboStep;
      const windup = step <= 0 ? BALANCE.alpha.biteWindup : BALANCE.alpha.clawWindup;
      const recovery =
        step <= 0
          ? BALANCE.alpha.biteRecovery
          : BALANCE.alpha.clawRecovery[Math.min(step, BALANCE.alpha.clawRecovery.length) - 1];
      const dur = Math.max(0.01, leader.attackPhase === 'windup' ? windup : recovery);
      inp.attackPhase = leader.attackPhase === 'windup' ? 'windup' : 'recovery';
      inp.attackT = 1 - Math.max(0, Math.min(1, leader.attackTimer / dur));
      inp.attackStyle = ALPHA_STYLE_BY_STEP[Math.max(0, Math.min(3, step))];
    } else {
      inp.attackPhase = 'none';
      inp.attackT = 0;
      inp.attackStyle = -1;
    }
    inp.stun = leader.alive && !rising ? Math.min(1, leader.hitStun / Math.max(0.01, BALANCE.alpha.hitStunTime)) : 0;
    inp.hitImpulse = leader.alive && leader.hitFlash > this.leaderLastHitFlash + 1e-4;
    inp.hitFromX = 0;
    inp.hitFromZ = 0;
    this.leaderLastHitFlash = leader.hitFlash;
    inp.lookYaw = NaN;
    inp.detail = 0;
    animateZombie(this.leaderAnim, this.leaderProfile, inp, this.leaderPose);
    if (this.alphaChar) {
      if (this.celebrateQueued) {
        this.celebrateQueued = false;
        if (leader.alive && !rising && !this.reducedMotion) this.alphaChar.play('celebrate', CELEBRATE_LOOPS);
      } else if (!leader.alive || rising) this.alphaChar.stop();
      this.alphaChar.update(dt);
    }
    this.leaderRig.apply(this.leaderPose);

    // Visual-only Alpha stagger spring + Last Brain panic pose, layered after animateZombie on leaderRig.root.
    if (!leader.alive) {
      this.leaderStagger = 0;
      this.leaderStaggerVel = 0;
    } else if (dt > 0) {
      const stepDt = Math.min(dt, 0.05);
      const accel = -256 * this.leaderStagger - 27.2 * this.leaderStaggerVel;
      this.leaderStaggerVel += accel * stepDt;
      this.leaderStagger = Math.max(0, Math.min(1, this.leaderStagger + this.leaderStaggerVel * stepDt));
    }
    const lastBrainPanic = state.horde.lastBrain.active && leader.alive && state.phase === 'playing';
    let pitch = -0.42 * this.leaderStagger;
    let roll = 0;
    let offX = 0;
    let offY = 0;
    const offZ = -0.18 * this.leaderStagger;
    if (lastBrainPanic) {
      const amp = this.reducedMotion ? 0.4 : 1.0;
      pitch += (0.14 * Math.sin(time * 5.2) + 0.06 * Math.sin(time * 8.7)) * amp;
      roll += (0.18 * Math.sin(time * 4.1 + 0.7) + 0.07 * Math.cos(time * 7.3)) * amp;
      offY += Math.abs(Math.sin(time * 4.1)) * 0.04 * amp;
      if (!this.reducedMotion) {
        pitch += 0.045 * Math.sin(time * 13.5 * TWO_PI) + 0.025 * Math.sin(time * 15.7 * TWO_PI);
        roll += 0.055 * Math.cos(time * 12.1 * TWO_PI) + 0.025 * Math.sin(time * 16.0 * TWO_PI);
        offX += 0.035 * Math.sin(time * 14.3 * TWO_PI);
      }
    }
    this.leaderRig.root.position.set(offX, offY, offZ);
    this.leaderRig.root.rotation.set(pitch, 0, roll, 'XYZ');

    this.syncLeaderCosmetics(state.rewards.equippedCosmeticIdsBySlot);

    // Hit flash emissive > frenzy glow > subtle Alpha glow
    const frenzy = state.progression.frenzyTimeLeft > 0;
    const leaderMat = this.leaderRig.materials[0] as THREE.MeshStandardMaterial | undefined;
    if (leaderMat) {
      if (leader.hitFlash > 0) {
        leaderMat.emissive.setHex(0xaa5544);
      } else if (frenzy) {
        leaderMat.emissive.setHex(Math.sin(time * 10) > 0 ? 0x6a1208 : 0x4a0c06);
      } else {
        leaderMat.emissive.setHex(LEADER_GLOW);
      }
    }

    // Pulsing dark-green ground highlight ring (flashes fiery orange during Frenzy / legacy Rush)
    const rushActive = frenzy || state.abilities.rushTimeLeft > 0;
    const pulse = 1.0 + 0.08 * Math.sin(time * (rushActive ? 10.0 : 4.2));
    this.leaderOuterRing.scale.setScalar(pulse);
    this.leaderInnerRing.scale.setScalar(1.0 - 0.06 * Math.sin(time * 4.2));
    this.leaderInnerRingMat.color.setHex(rushActive ? 0xff5a24 : 0x9be35a);
    this.leaderOuterRing.visible = leader.alive;
    this.leaderInnerRing.visible = leader.alive;
  }

  private syncLeaderCosmetics(equipped: Record<'hat' | 'glasses' | 'back' | 'hand', string | null>): void {
    for (const slot of ['hat', 'glasses', 'back', 'hand'] as const) {
      const next = equipped[slot] ?? null;
      if (this.equippedCosmetics[slot] === next) continue;
      this.equippedCosmetics[slot] = next;
      const mount = this.leaderRig.slots[slot];
      while (mount.children.length > 0) {
        const child = mount.children[0];
        mount.remove(child);
        child.traverse(o => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
            else o.material.dispose();
          }
        });
      }
      if (next) {
        const mesh = buildCosmeticMesh(next);
        if (mesh) mount.add(mesh);
      }
    }
  }

  private updateGuards(state: GameState, alpha: number, time: number, dt: number): void {
    const activeIds = this.activeGuardIds;
    activeIds.clear();

    const deadOrRespawning = !state.leader.alive || state.phase === 'respawning';
    const activeProfile = this.visionGating ? visionProfile(deadOrRespawning ? 1 : state.vision.tier) : null;

    for (let i = 0; i < state.guards.length; i++) {
      const g = state.guards[i];
      activeIds.add(g.id);

      // Render-radius culling: dormant or far humans are not drawn (rigs are created lazily on first show)
      let culled = g.dormant === true;
      if (!culled && this.hasFocus) {
        const cdx = g.pos.x - this.focusX;
        const cdz = g.pos.z - this.focusZ;
        culled = cdx * cdx + cdz * cdz > this.cullRadius2;
      }
      let entry = this.guardsMap.get(g.id);
      if (culled) {
        if (entry) {
          entry.root.visible = false;
          entry.pickProxy.visible = false;
          entry.pickProxy.userData.target = null;
          entry.pickProxy.position.y = -1000;
        }
        continue;
      }
      const weapon = g.state === 'DEAD' || g.hp <= 0 ? entry?.weapon ?? 'none' : civilianWeapon(state, g);
      if (entry && entry.weapon !== weapon) {
        this.disposeGuardEntry(entry, true);
        this.guardsMap.delete(g.id);
        entry = undefined;
      }
      if (!entry) {
        entry = this.createGuardEntry(g, i, weapon);
        this.guardsMap.set(g.id, entry);
      }

      const gx = g.prevPos.x + (g.pos.x - g.prevPos.x) * alpha;
      const gz = g.prevPos.z + (g.pos.z - g.prevPos.z) * alpha;
      const facing = lerpAngle(g.prevFacing, g.facing, alpha);
      const speed = Math.hypot(g.vel.x, g.vel.z);
      const isDead = g.state === 'DEAD' || g.hp <= 0;

      // Check whether dead guard should be hidden (converted or faded after 20 s)
      let hideCorpse = false;
      let sinkOffset = 0;
      if (isDead && g.heavy === 'tank') {
        // The hull stays as a wreck (its collider keeps blocking).
      } else if (isDead) {
        if (this.convertedGuardIds.has(g.id)) {
          hideCorpse = true;
        } else if (g.deathTime !== null) {
          const deathAge = state.time - g.deathTime;
          if (deathAge > 20.0) {
            hideCorpse = true;
          } else if (deathAge > 18.5) {
            sinkOffset = -((deathAge - 18.5) / 1.5) * 0.65;
          }
        }
      } else {
        this.convertedGuardIds.delete(g.id);
      }

      let visual: HumanVisualMode = 'full';
      if (activeProfile) {
        const vdx = g.pos.x - state.leader.pos.x;
        const vdz = g.pos.z - state.leader.pos.z;
        visual = humanVisual(awarenessOf(state, g.id), Math.hypot(vdx, vdz), activeProfile);
      }

      if (entry.heavy?.kind === 'tank') entry.heavy.root.visible = !(hideCorpse || visual === 'hidden');
      if (hideCorpse || visual === 'hidden') {
        entry.root.visible = false;
        entry.pickProxy.visible = false;
        entry.pickProxy.userData.target = null;
        entry.pickProxy.position.set(gx, -1000, gz);
        continue;
      }

      const wantSilhouette = visual === 'silhouette';
      if (wantSilhouette !== entry.isSilhouette) {
        if (entry.rig && entry.rigMat) {
          const mat = wantSilhouette ? this.silhouetteMat : entry.rigMat;
          for (let m = 0; m < entry.rigMeshes.length; m++) {
            entry.rigMeshes[m].material = mat;
          }
        }
        if (entry.heavy) setHeavyMaterial(entry.heavy, wantSilhouette ? this.silhouetteMat : entry.heavy.material);
        entry.isSilhouette = wantSilhouette;
      }

      entry.root.visible = true;
      // Spec §6/§7: only nearby important characters cast dynamic shadows (each rig is ~10 meshes, and every caster
      // costs a second draw in the shadow pass). Hysteresis avoids flicker at the boundary; silhouettes never cast.
      {
        const sdx = gx - state.leader.pos.x;
        const sdz = gz - state.leader.pos.z;
        const d2 = sdx * sdx + sdz * sdz;
        const want = !wantSilhouette && (entry.castsShadow ? d2 < HUMAN_SHADOW_OFF_M2 : d2 < HUMAN_SHADOW_ON_M2);
        if (want !== entry.castsShadow) {
          // Skinned humans use a blob shadow instead (see HumanRenderer); only legacy rigs have shadow-map casters.
          if (entry.rig) for (let m = 0; m < entry.rigMeshes.length; m++) entry.rigMeshes[m].castShadow = want;
          entry.castsShadow = want;
        }
      }
      entry.root.position.set(gx, g.elevation + sinkOffset, gz);
      entry.root.rotation.y = facing;
      if (entry.heavy) {
        setWrecked(entry.heavy, isDead);
        if (entry.heavy.kind === 'tank') {
          const hull = g.hullFacing ?? 0;
          entry.heavy.root.position.set(gx, 0, gz);
          entry.heavy.root.rotation.y = hull;
          if (!isDead) entry.heavy.turret!.rotation.y = facing - hull;
          // Cannon recoil on a fresh shot (anim 'attack').
          entry.heavy.barrel.position.z = 2.55 - (g.anim === 'attack' && g.animTime < 0.25 && !isDead ? 0.4 * (1 - g.animTime / 0.25) : 0);
          const mat = entry.heavy.material;
          mat.emissive.setHex(!isDead && g.hitFlash > 0 ? 0x555555 : 0x000000);
        }
      }

      if (!isDead && g.hitFlash > entry.lastHitFlash + 1e-4) {
        entry.hitRecoil = 0.2;
      } else if (entry.hitRecoil > 0) {
        entry.hitRecoil = Math.max(0, entry.hitRecoil - dt);
      }
      entry.lastHitFlash = g.hitFlash;

      const anim: AnimAction = isDead ? 'dead' : g.anim;
      const role = g.role ?? 'soldier';
      const post = g.post ?? 'checkpoint';
      this.scratchParams.kind =
        role === 'civilian' ? 'civilian' : role === 'police' || post === 'barricade' ? 'police' : 'guard';
      this.scratchParams.attackPhase = undefined;
      this.scratchParams.hitStun = 0;
      this.scratchParams.stagger = isDead ? 0 : g.staggerTime ?? 0;
      this.scratchParams.anim = anim;
      this.scratchParams.animTime = g.animTime;
      this.scratchParams.speed = speed;
      this.scratchParams.time = time;
      this.scratchParams.phase = entry.profile.phaseOffset;
      this.scratchParams.cadenceScale = entry.profile.cadenceScale;
      this.scratchParams.guardState = g.state;
      this.scratchParams.weapon = entry.weapon;
      this.scratchParams.panic = !isDead && role === 'civilian' && g.state === 'RETREAT';
      this.scratchParams.alert = !isDead && role !== 'civilian' && g.state === 'ALERT';
      this.scratchParams.hitRecoil = isDead ? 0 : entry.hitRecoil / 0.2;
      computePose(this.scratchParams, this.scratchPose);
      const isHovered = !isDead && !wantSilhouette && this.hoveredGuardId === g.id;
      const isTargeted = !isDead && !wantSilhouette && this.targetedGuardIds.has(g.id);

      if (entry.look && this.humans) {
        // Skinned path: pose -> 21 bones, LOD with hysteresis, per-instance flash code (hit / hover / target / silhouette).
        if (entry.heavy?.kind !== 'tank') {
          humanPoseToZombiePose(this.scratchPose, anim === 'climb', this.humanPose);
          const fdx = gx - (this.hasFocus ? this.focusX : state.leader.pos.x);
          const fdz = gz - (this.hasFocus ? this.focusZ : state.leader.pos.z);
          const dist = Math.hypot(fdx, fdz);
          if (entry.lod === 0 && dist > this.humanLod0 * 1.08) entry.lod = 1;
          else if (entry.lod === 1 && dist < this.humanLod0 * 0.92) entry.lod = 0;
          const fx = wantSilhouette ? HUMAN_FX.silhouette
            : g.hitFlash > 0 ? HUMAN_FX.hit : isHovered ? HUMAN_FX.hover : isTargeted ? HUMAN_FX.target : HUMAN_FX.none;
          this.humans.add(entry.look, this.humanPose, gx, g.elevation + sinkOffset, gz, facing, entry.lod, fx,
            entry.castsShadow && !wantSilhouette && !isDead);
        }
      } else if (entry.rig) {
        applyPose(entry.rig, this.scratchPose);
      }

      // Hit flash or hover emissive outline (identified humans only; legacy rig material)
      if (entry.rig && !wantSilhouette && entry.heavy?.kind !== 'tank') {
        const guardMat = entry.rig.materials[0] as THREE.MeshStandardMaterial | undefined;
        if (guardMat) {
          if (g.hitFlash > 0) {
            guardMat.emissive.setHex(0x999999);
          } else if (isHovered) {
            guardMat.emissive.setHex(0x55280c);
          } else if (isTargeted) {
            guardMat.emissive.setHex(0x3a1208);
          } else {
            guardMat.emissive.setHex(0x000000);
          }
        }
      }

      // Pick proxy & ground markers
      if (isDead || wantSilhouette) {
        entry.pickProxy.visible = false;
        entry.pickProxy.userData.target = null;
        entry.pickProxy.position.set(gx, -1000, gz);
        entry.factionDisc.visible = false;
        entry.targetRing.visible = false;
        entry.hoverRing.visible = false;
      } else {
        entry.pickProxy.visible = true;
        entry.pickProxy.position.set(gx, g.elevation + 1.05, gz);
        if (entry.heavy?.kind === 'tank') entry.pickProxy.scale.set(2.6, 1.1, 2.6);
        if (!entry.pickProxy.userData.target) {
          entry.pickProxy.userData.target = { kind: 'guard', id: g.id };
        }

        entry.factionDisc.visible = true;
        entry.hoverRing.visible = isHovered;
        entry.targetRing.visible = isTargeted;
        if (isTargeted) {
          const ringPulse = (1.0 + 0.12 * Math.sin(time * 8.0)) * (entry.heavy?.kind === 'tank' ? 4.2 : 1);
          entry.targetRing.scale.setScalar(ringPulse);
        }

        // Health bars are drawn by HealthBars (only once damaged).
      }
    }

    // Clean up any guard rigs no longer in state.guards (e.g. after a reset with new IDs)
    for (const [id, entry] of this.guardsMap.entries()) {
      if (!activeIds.has(id)) {
        this.disposeGuardEntry(entry, true);
        this.guardsMap.delete(id);
      }
    }
  }

  private createGuardEntry(g: GuardAgent, _index: number, weapon: CivilianWeapon = 'none'): GuardVisualEntry {
    const role = g.role ?? 'soldier';
    const post = g.post ?? 'checkpoint';
    const profile = humanProfile(g.id, role, post, weapon);
    const skinned = this.humans !== null;
    const rig = skinned ? null : createGuardRig(profile);
    const look = skinned ? humanLook(profile) : null;
    const rigMeshes: THREE.Mesh[] = [];
    // The anchor carries ground markers + the MG model; legacy mode puts the whole rig on it.
    const root: THREE.Group = rig ? rig.root : new THREE.Group();
    if (!rig) root.name = 'GuardAnchor';
    rig?.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) rigMeshes.push(obj);
    });
    const rigMat = rig ? rig.materials[0] : null;
    // Guard rig materials are owned by the entry (disposeGuardEntry), not by disposableMaterials,
    // so respawning civilians cannot grow that list.
    this.rootGroup.add(root);

    // Subtle ground marker disc under human (orange for soldiers, neutral cream for civilians)
    const factionDisc = new THREE.Mesh(
      this.factionDiscGeo,
      role === 'civilian' ? this.civilianDiscMat : this.factionDiscMat,
    );
    factionDisc.position.y = DECAL_Y;
    root.add(factionDisc);

    // Red ground ring when targeted
    const targetRing = new THREE.Mesh(this.targetRingGeo, this.targetRingMat);
    targetRing.position.y = DECAL_Y + DECAL_STEP * 2;
    targetRing.visible = false;
    root.add(targetRing);

    // Amber ring when hovered
    const hoverRing = new THREE.Mesh(this.hoverRingGeo, this.hoverRingMat);
    hoverRing.position.y = DECAL_Y + DECAL_STEP;
    hoverRing.visible = false;
    root.add(hoverRing);

    // Heavy weapons: the gunner keeps the rig with a tripod MG in front; a tank crew is hidden inside its hull.
    let heavy: HeavyModel | null = null;
    if (g.heavy === 'mg') {
      heavy = createMachineGun();
      root.add(heavy.root);
    } else if (g.heavy === 'tank') {
      heavy = createTank();
      this.rootGroup.add(heavy.root);
      for (const mesh of rigMeshes) mesh.visible = false;
      factionDisc.scale.setScalar(4.2);
      targetRing.scale.setScalar(4.2);
      hoverRing.scale.setScalar(4.2);
    }

    // Invisible raycast pick proxy
    const pickProxy = new THREE.Mesh(this.pickGeo, this.pickMat);
    pickProxy.name = `GuardPickProxy_${g.id}`;
    pickProxy.userData.target = { kind: 'guard', id: g.id };
    this.rootGroup.add(pickProxy);
    this.pickables.push(pickProxy);

    return {
      id: g.id,
      profile,
      root,
      rig,
      look,
      lod: 0,
      rigMeshes,
      castsShadow: true,
      rigMat,
      isSilhouette: false,
      pickProxy,
      factionDisc,
      targetRing,
      hoverRing,
      weapon,
      hitRecoil: 0,
      lastHitFlash: g.hitFlash,
      heavy,
    };
  }
}

