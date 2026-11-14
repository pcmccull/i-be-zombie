import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type {
  AnimAction,
  EntityId,
  GameEvent,
  GameState,
  GuardAgent,
  TargetRef,
} from '../core/types';
import {
  applyPose,
  computePose,
  createGuardRig,
  createLeaderRig,
  LEADER_GLOW,
  type CharacterRig,
  type Pose,
  type PoseParams,
} from './LowPolyCharacters';

const TWO_PI = Math.PI * 2;

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a) % TWO_PI) + TWO_PI;
  diff = ((diff + Math.PI) % TWO_PI) - Math.PI;
  return a + diff * t;
}

interface GuardVisualEntry {
  id: EntityId;
  rig: CharacterRig;
  pickProxy: THREE.Mesh;
  factionDisc: THREE.Mesh;
  targetRing: THREE.Mesh;
  hoverRing: THREE.Mesh;
}

export class EntityRenderer {
  readonly pickables: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly rootGroup: THREE.Group;
  private readonly leaderRig: CharacterRig;
  private readonly leaderOuterRing: THREE.Mesh;
  private readonly leaderInnerRing: THREE.Mesh;
  private readonly leaderOuterRingMat: THREE.MeshBasicMaterial;
  private readonly leaderInnerRingMat: THREE.MeshBasicMaterial;

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
  private hoveredGuardId: EntityId | null = null;
  private readonly targetedGuardIds = new Set<EntityId>();

  // Shared geometries & materials for guard indicators and pick proxies
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
    kind: 'leader',
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

    // 1. Leader Rig + Pulsing Ground Highlight Rings
    this.leaderRig = createLeaderRig();
    for (const m of this.leaderRig.materials) {
      this.disposableMaterials.push(m);
    }
    this.rootGroup.add(this.leaderRig.root);

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
    this.leaderOuterRing.position.y = 0.03;
    this.leaderRig.root.add(this.leaderOuterRing);

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
    this.leaderInnerRing.position.y = 0.034;
    this.leaderRig.root.add(this.leaderInnerRing);

    // 2. Shared Guard Indicator Geometries & Materials
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
  }

  consume(events: readonly GameEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'conversionStart' || ev.type === 'converted') {
        this.convertedGuardIds.add(ev.guardId);
      } else if (ev.type === 'leaderRespawned') {
        this.leaderRiseTime = 0;
        this.leaderWasAlive = true;
      }
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
    this.updateGuards(state, alpha, time);
  }

  setHovered(target: TargetRef | null): void {
    this.hoveredGuardId = target && target.kind === 'guard' ? target.id : null;
  }

  /** All selected attack targets (the horde may be split across several). */
  setTargeted(targets: readonly TargetRef[]): void {
    this.targetedGuardIds.clear();
    for (const t of targets) if (t.kind === 'guard') this.targetedGuardIds.add(t.id);
  }

  dispose(): void {
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

    for (const entry of this.guardsMap.values()) {
      this.disposeGuardEntry(entry, false);
    }
    this.guardsMap.clear();

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
    entry.pickProxy.visible = false;
    entry.pickProxy.userData.target = null;
    entry.pickProxy.position.y = -1000;
    this.rootGroup.remove(entry.rig.root);
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

    this.leaderRig.root.position.set(lx, 0, lz);
    this.leaderRig.root.rotation.y = facing;

    // Death fall + respawn rise are driven by renderer-side timers (leader.animTime is not reset on death)
    if (!leader.alive) {
      if (this.leaderWasAlive) this.leaderDeadTime = 0;
      this.leaderDeadTime += dt;
    } else if (!this.leaderWasAlive) {
      this.leaderRiseTime = 0;
    }
    this.leaderWasAlive = leader.alive;
    if (leader.alive && this.leaderRiseTime < BALANCE.conversion.riseDuration) this.leaderRiseTime += dt;
    const rising = leader.alive && this.leaderRiseTime < BALANCE.conversion.riseDuration;

    let anim: AnimAction = !leader.alive ? 'dead' : rising ? 'rise' : leader.anim;
    let animTime = !leader.alive ? this.leaderDeadTime : rising ? this.leaderRiseTime : leader.animTime;
    const attacking = leader.alive && !rising && (leader.attackPhase === 'windup' || leader.attackPhase === 'recovery');
    if (attacking && anim === 'attack') anim = 'idle'; // legacy clip would fight the phase overlay
    if (attacking) {
      const step = leader.comboStep;
      const windup = step <= 0 ? BALANCE.alpha.biteWindup : BALANCE.alpha.clawWindup;
      const recovery =
        step <= 0
          ? BALANCE.alpha.biteRecovery
          : BALANCE.alpha.clawRecovery[Math.min(step, BALANCE.alpha.clawRecovery.length) - 1];
      const dur = Math.max(0.01, leader.attackPhase === 'windup' ? windup : recovery);
      this.scratchParams.attackT = 1 - Math.max(0, Math.min(1, leader.attackTimer / dur));
    } else {
      this.scratchParams.attackT = 0;
    }
    this.scratchParams.attackPhase = attacking ? leader.attackPhase : 'ready';
    this.scratchParams.comboStep = leader.comboStep;
    this.scratchParams.hitStun = leader.alive && !rising ? leader.hitStun : 0;
    this.scratchParams.stagger = 0;
    this.scratchParams.kind = 'leader';
    this.scratchParams.anim = anim;
    this.scratchParams.animTime = animTime;
    this.scratchParams.speed = speed;
    this.scratchParams.time = time;
    this.scratchParams.phase = 0;
    this.scratchParams.guardState = undefined;
    computePose(this.scratchParams, this.scratchPose);
    applyPose(this.leaderRig, this.scratchPose);

    // Hit flash emissive > frenzy glow > subtle Alpha glow
    const frenzy = state.progression.frenzyTimeLeft > 0;
    const leaderMat = this.leaderRig.materials[0] as THREE.MeshLambertMaterial | undefined;
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

  private updateGuards(state: GameState, alpha: number, time: number): void {
    const activeIds = this.activeGuardIds;
    activeIds.clear();

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
          entry.rig.root.visible = false;
          entry.pickProxy.visible = false;
          entry.pickProxy.userData.target = null;
          entry.pickProxy.position.y = -1000;
        }
        continue;
      }
      if (!entry) {
        entry = this.createGuardEntry(g, i);
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
      if (isDead) {
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

      if (hideCorpse) {
        entry.rig.root.visible = false;
        entry.pickProxy.visible = false;
        entry.pickProxy.userData.target = null;
        entry.pickProxy.position.set(gx, -1000, gz);
        continue;
      }

      entry.rig.root.visible = true;
      entry.rig.root.position.set(gx, g.elevation + sinkOffset, gz);
      entry.rig.root.rotation.y = facing;

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
      this.scratchParams.phase = (g.id * 1.73) % TWO_PI;
      this.scratchParams.guardState = g.state;
      computePose(this.scratchParams, this.scratchPose);
      applyPose(entry.rig, this.scratchPose);

      const isHovered = !isDead && this.hoveredGuardId === g.id;
      const isTargeted = !isDead && this.targetedGuardIds.has(g.id);

      // Hit flash or hover emissive outline
      const guardMat = entry.rig.materials[0] as THREE.MeshLambertMaterial | undefined;
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

      // Pick proxy & ground markers
      if (isDead) {
        entry.pickProxy.visible = false;
        entry.pickProxy.userData.target = null;
        entry.pickProxy.position.set(gx, -1000, gz);
        entry.factionDisc.visible = false;
        entry.targetRing.visible = false;
        entry.hoverRing.visible = false;
      } else {
        entry.pickProxy.visible = true;
        entry.pickProxy.position.set(gx, g.elevation + 1.05, gz);
        if (!entry.pickProxy.userData.target) {
          entry.pickProxy.userData.target = { kind: 'guard', id: g.id };
        }

        entry.factionDisc.visible = true;
        entry.hoverRing.visible = isHovered;
        entry.targetRing.visible = isTargeted;
        if (isTargeted) {
          const ringPulse = 1.0 + 0.12 * Math.sin(time * 8.0);
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

  private createGuardEntry(g: GuardAgent, index: number): GuardVisualEntry {
    const role = g.role ?? 'soldier';
    const post = g.post ?? 'checkpoint';
    const rig = createGuardRig(index, role, post);
    // Guard rig materials are owned by the entry (disposeGuardEntry), not by disposableMaterials,
    // so respawning civilians cannot grow that list.
    this.rootGroup.add(rig.root);

    // Subtle ground marker disc under human (orange for soldiers, neutral cream for civilians)
    const factionDisc = new THREE.Mesh(
      this.factionDiscGeo,
      role === 'civilian' ? this.civilianDiscMat : this.factionDiscMat,
    );
    factionDisc.position.y = 0.025;
    rig.root.add(factionDisc);

    // Red ground ring when targeted
    const targetRing = new THREE.Mesh(this.targetRingGeo, this.targetRingMat);
    targetRing.position.y = 0.032;
    targetRing.visible = false;
    rig.root.add(targetRing);

    // Amber ring when hovered
    const hoverRing = new THREE.Mesh(this.hoverRingGeo, this.hoverRingMat);
    hoverRing.position.y = 0.03;
    hoverRing.visible = false;
    rig.root.add(hoverRing);

    // Invisible raycast pick proxy
    const pickProxy = new THREE.Mesh(this.pickGeo, this.pickMat);
    pickProxy.name = `GuardPickProxy_${g.id}`;
    pickProxy.userData.target = { kind: 'guard', id: g.id };
    this.rootGroup.add(pickProxy);
    this.pickables.push(pickProxy);

    return {
      id: g.id,
      rig,
      pickProxy,
      factionDisc,
      targetRing,
      hoverRing,
    };
  }
}

