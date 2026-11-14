import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { BALANCE } from '../config/balance';
import { createSave } from '../persistence/saveSchema';
import { SaveStore } from '../persistence/SaveStore';
import { Simulation } from '../sim/Simulation';
import { HUD, structureHudLabel } from '../ui/HUD';
import { Effects } from '../visuals/Effects';
import { EntityRenderer } from '../visuals/EntityRenderer';
import { HordeRenderer } from '../visuals/HordeRenderer';
import { HealthBars } from '../visuals/HealthBars';
import { CheckpointVisual } from '../world/Checkpoint';
import { CityDistrict } from '../world/CityDistrict';
import { Landmarks } from '../world/Landmarks';
import { NestMarkers } from '../world/NestMarkers';
import { buildDistrictLayout } from '../world/districtLayout';
import { chunkIdAt } from '../world/worldQueries';
import { InputController } from './InputController';
import { ThirdPersonCamera } from './ThirdPersonCamera';
import type { StorageLike } from './contracts';
import { emptyInput, type AbilityId, type TargetRef, type Vec2, type WorldSave } from './types';
import {
  approachAngle,
  approachOccluderOpacity,
  shouldReleaseLock,
  shouldRequestLock,
} from './cameraMath';

/** Minimum wall-clock gap between autosaves. */
const AUTOSAVE_MIN_MS = 2000;
/** Leader distance (m) at which a map waypoint counts as reached. */
const WAYPOINT_ARRIVE_M = 5;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // storage disabled / SecurityError
  }
}

interface OccluderEntry { object: THREE.Object3D; chunk: number }

export class Game {
  public readonly sim: Simulation;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly cameraRig: ThirdPersonCamera;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.25, 520);
  private readonly city: CityDistrict;
  private readonly checkpoint: CheckpointVisual;
  private readonly landmarks: Landmarks;
  private readonly nests: NestMarkers;
  private readonly entities: EntityRenderer;
  private readonly horde: HordeRenderer;
  private readonly healthBars = new HealthBars();
  private readonly effects: Effects;
  private readonly audio = new AudioSystem();
  private readonly hud: HUD;
  private readonly input: InputController;
  private readonly store = new SaveStore(browserStorage());
  private readonly sun: THREE.DirectionalLight;
  private readonly extraOccluders = new THREE.Group();
  /** Live occluder list shared with camera + picking: only entries whose chunk is currently loaded. */
  private readonly occluders: THREE.Object3D[] = [];
  private readonly occluderEntries: OccluderEntry[] = [];
  private occluderSignature = '';
  private readonly gateOccluder: THREE.Mesh;
  private checkpointOccluder: THREE.Mesh | null = null;
  private readonly waypointMarker: THREE.Mesh;
  private waypoint: Vec2 | null = null;
  private pendingEquip: { slot: number; ability: AbilityId | null } | null = null;
  private readonly focus = new THREE.Vector3();
  private readonly marker = new THREE.Vector3();
  private readonly extraMarkers: THREE.Vector3[] = [];
  private readonly extraMarkerView: THREE.Vector3[] = [];
  private readonly targeted: TargetRef[] = [];
  private readonly targetedStructureIds: number[] = [];
  private readonly continuousInput = emptyInput();
  private running = false;
  private disposed = false;
  private frameId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private smoothFps = 60;
  private frameMs = 16;
  private showDebug = false;
  private suspended = false;
  private seed: number;
  private lastSaveAt = -1e9;
  private savePending = false;
  private loadedChunkCount = 0;

  constructor(private readonly container: HTMLElement, private readonly hudRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    const sky = 0x8ea9bd;
    this.scene.background = new THREE.Color(sky);
    // Fog hides the chunk load edge (chunks load within BALANCE.chunks.loadRadius = 150 m of the leader).
    this.scene.fog = new THREE.Fog(sky, 120, 330);
    const hemisphere = new THREE.HemisphereLight(0xdbe8f4, 0x5c574f, 0.78);
    hemisphere.position.set(0, 80, 0);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.45);
    this.sun.position.set(-70, 115, 65);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { near: 10, far: 310, left: -135, right: 135, top: 115, bottom: -115 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    // Boot: whole open world as data, optional save.
    const layout = buildDistrictLayout();
    const save = this.store.load();
    this.seed = save?.seed ?? BALANCE.sim.seed;
    this.sim = new Simulation(layout, this.seed, save);
    this.city = new CityDistrict(layout);
    this.checkpoint = new CheckpointVisual(layout);
    this.landmarks = new Landmarks(layout);
    this.nests = new NestMarkers(null, layout);
    this.entities = new EntityRenderer(this.scene);
    this.horde = new HordeRenderer();
    this.scene.add(this.city.group, this.checkpoint.group, this.landmarks.group, this.nests.group, this.horde.group,
      this.healthBars.group, this.extraOccluders);
    this.effects = new Effects(this.scene);
    this.effects.setWorld(layout);
    this.hud = new HUD(hudRoot);
    // HUD has no pass-through option. Its restart buttons explicitly enable pointer
    // events, so leave them clickable while the overlays allow canvas interaction.
    for (const overlay of hudRoot.querySelectorAll<HTMLElement>('.ibz-overlay')) overlay.style.pointerEvents = 'none';
    this.hud.setWorld(layout, { firstRun: !save });
    this.hud.showIntro();
    this.hud.setMuted(this.audio.muted);

    this.checkpoint.group.traverse(object => {
      if (object instanceof THREE.Mesh && object.name === 'CheckpointStatic') this.checkpointOccluder = object;
    });
    // City exposes building proxies only. Add render-free authored prop volumes (per chunk, so unloaded chunks drop out).
    for (const occluder of this.city.occluders) {
      this.occluderEntries.push({ object: occluder, chunk: chunkIdAt(layout, { x: occluder.position.x, z: occluder.position.z }) });
    }
    const proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
    const proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    for (const collider of layout.colliders) {
      if (!collider.blocksSight || ['building', 'wall', 'tower', 'gate', 'breakable'].includes(collider.kind)) continue;
      const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial);
      const cx = (collider.minX + collider.maxX) / 2;
      const cz = (collider.minZ + collider.maxZ) / 2;
      proxy.position.set(cx, collider.height / 2, cz);
      proxy.scale.set(collider.maxX - collider.minX, collider.height, collider.maxZ - collider.minZ);
      proxy.visible = false; // Raycaster intentionally intersects invisible proxies.
      if (collider.tag?.startsWith('bus-shell-')) {
        const busPick = this.landmarks.pickMeshFor('bus');
        if (busPick) proxy.userData.pickTarget = busPick;
      }
      this.extraOccluders.add(proxy);
      this.occluderEntries.push({ object: proxy, chunk: chunkIdAt(layout, { x: cx, z: cz }) });
    }
    const gate = this.sim.state.gate;
    this.gateOccluder = new THREE.Mesh(proxyGeometry, proxyMaterial);
    this.gateOccluder.position.set(gate.center.x, 1.5, gate.center.z);
    this.gateOccluder.scale.set(gate.rect.maxX - gate.rect.minX, 3, gate.rect.maxZ - gate.rect.minZ);
    this.gateOccluder.visible = false;
    this.gateOccluder.userData.pickTarget = this.checkpoint.gatePickMesh;
    this.extraOccluders.add(this.gateOccluder);
    this.occluderEntries.push({ object: this.gateOccluder, chunk: chunkIdAt(layout, { x: gate.center.x, z: gate.center.z }) });
    // Merged checkpoint compound and landmark shells are few and large: always candidates.
    if (this.checkpointOccluder) this.occluderEntries.push({ object: this.checkpointOccluder, chunk: -1 });
    for (const shell of this.landmarks.shellOccluders) this.occluderEntries.push({ object: shell, chunk: -1 });

    // Waypoint pillar (set from the world map).
    this.waypointMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 14, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
    );
    this.waypointMarker.visible = false;
    this.waypointMarker.name = 'WaypointMarker';
    this.scene.add(this.waypointMarker);

    this.cameraRig = new ThirdPersonCamera(this.camera, this.occluders);
    this.cameraRig.setBounds(layout.bounds);
    this.input = new InputController(this.renderer.domElement, {
      camera: this.camera,
      pickables: () => [...this.entities.pickables, this.checkpoint.gatePickMesh, ...this.landmarks.pickMeshes],
      occluders: this.occluders,
      onOrbit: (dx, dy) => this.cameraRig.addOrbit(dx, dy),
      onZoom: delta => this.cameraRig.addZoom(delta),
      isModal: () => this.isModal(),
      onUiKey: key => this.hud.isNestPanelVisible && this.hud.handleNestKey(key),
      onLockLost: () => {
        // Browser Esc / alt-tab released the mouse: show the pause menu instead of silently dropping control.
        if (!this.hud.introVisible && !this.hud.isHelpVisible && !this.isModal()) this.openPause();
      },
      onKey: action => {
        switch (action) {
          case 'recenter': this.cameraRig.recenter(); break;
          case 'help':
            this.hud.toggleHelp();
            if (this.hud.isHelpVisible) this.input.exitPointerLock();
            break;
          case 'debug': this.showDebug = !this.showDebug; break;
          case 'mute': this.toggleMute(); break;
          case 'map': this.toggleMap(); break;
          case 'pause': this.togglePause(); break;
        }
      },
      onFirstGesture: () => { this.audio.unlock(); this.hud.hideIntro(); },
      canLock: () =>
        shouldRequestLock({
          isLocked: this.input.isLocked,
          phase: this.sim.state.phase,
          helpVisible: this.hud.isHelpVisible,
          modalOpen: this.isModal(),
        }),
    });
    // The cursor stays free so the horde can be directed by pointing and clicking; drag (or Z/X) orbits the camera.
    this.hud.onRestart(() => this.restart());
    this.hud.onWaypoint(p => { this.waypoint = p; });
    this.hud.onEquip((slot, ability) => { this.pendingEquip = { slot, ability }; });
    this.hud.setPauseCallbacks({
      onContinue: () => this.closePause(),
      onSave: () => this.hud.notifyPause(this.saveNow() ? 'Saved' : 'Save failed'),
      onResetSave: () => this.resetSave(),
      onToggleMute: () => this.toggleMute(),
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
    this.scene.updateMatrixWorld(true);
    this.resetCamera();
    this.syncVisuals(0, 0);
    this.updateHud();
    (window as unknown as { __game?: Game }).__game = this;
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = null;
    this.frameId = requestAnimationFrame(this.frame);
  }

  debugCamera = () => this.cameraRig.debugCamera();

  /** Fresh run on the default seed (the stored save is left alone; use resetSave to erase it). */
  restart(): void {
    if (this.disposed) return;
    this.seed = BALANCE.sim.seed;
    this.sim.reset(this.seed, null);
    this.effects.reset();
    this.entities.reset();
    this.audio.reset();
    this.hud.reset();
    this.hud.setWorld(this.sim.ctx.layout, { firstRun: true });
    this.hud.setMuted(this.audio.muted);
    this.input.clear();
    this.pendingEquip = null;
    this.waypoint = null;
    this.accumulator = 0;
    this.lastTime = null;
    this.savePending = false;
    this.entities.setHovered(null);
    this.entities.setTargeted([]);
    this.checkpoint.setGateHighlight(false);
    this.landmarks.reset();
    this.landmarks.setHighlight(null);
    this.occluderSignature = '';
    this.resetCamera();
    this.hud.hideIntro();
    this.hudRoot.querySelector('[data-ref="toast"]')?.classList.remove('is-visible');
    this.syncVisuals(0, 0);
    this.updateHud();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.hud.dispose();
    this.audio.dispose();
    // The provided renderers do not release character part geometries.
    const characterGeometry = new Set<THREE.BufferGeometry>();
    this.scene.traverse(object => {
      if (object.name === 'LeaderRig' || object.name === 'GuardRig') {
        object.children[0]?.traverse(part => {
          if (part instanceof THREE.Mesh) characterGeometry.add(part.geometry);
        });
      } else if (object instanceof THREE.Mesh && object.name.startsWith('HordePart_')) characterGeometry.add(object.geometry);
    });
    this.effects.dispose();
    this.city.dispose();
    this.checkpoint.dispose();
    this.landmarks.dispose();
    this.nests.dispose();
    this.entities.dispose();
    this.horde.dispose();
    this.healthBars.dispose();
    for (const geometry of characterGeometry) geometry.dispose();
    this.gateOccluder.geometry.dispose();
    (this.gateOccluder.material as THREE.Material).dispose();
    this.waypointMarker.geometry.dispose();
    (this.waypointMarker.material as THREE.Material).dispose();
    this.extraOccluders.clear();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    const debugWindow = window as unknown as { __game?: Game };
    if (debugWindow.__game === this) delete debugWindow.__game;
  }

  // --- menus / persistence -------------------------------------------------------------------

  private isModal(): boolean { return this.hud.isPauseVisible || this.hud.isMapVisible; }

  private openPause(): void {
    this.hud.showPause();
    this.input.exitPointerLock();
    this.input.clear();
    this.hud.setMuted(this.audio.muted);
  }

  private closePause(): void {
    this.hud.hidePause();
    this.input.clear();
    this.lastTime = null;
    this.accumulator = 0;
  }

  private togglePause(): void {
    if (this.hud.isMapVisible) { this.hud.hideMap(); return; }
    if (this.hud.isPauseVisible) this.closePause();
    else this.openPause();
  }

  private toggleMap(): void {
    if (this.hud.isPauseVisible) return;
    this.hud.toggleMap();
    if (this.hud.isMapVisible) { this.input.exitPointerLock(); this.input.clear(); }
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMuted(this.audio.muted);
  }

  /** Writes the current state to localStorage. Returns false when storage is unavailable or rejects the save. */
  private saveNow(): boolean {
    const save: WorldSave = createSave(this.sim.state, this.seed, Date.now());
    const ok = this.store.save(save);
    if (ok) { this.lastSaveAt = performance.now(); this.savePending = false; }
    return ok;
  }

  /** Throttled autosave: at most one write per AUTOSAVE_MIN_MS, deferred writes flush on a later frame. */
  private flushAutosave(): void {
    if (!this.savePending || performance.now() - this.lastSaveAt < AUTOSAVE_MIN_MS) return;
    this.saveNow();
  }

  private resetSave(): void {
    this.store.clear();
    this.restart();
    this.closePause();
  }

  // --- frame ---------------------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.frameId = null;
    const paused = this.hud.isPauseVisible;
    const dt = paused || this.suspended || document.hidden || this.lastTime === null
      ? 0 : THREE.MathUtils.clamp((now - this.lastTime) / 1000, 0, BALANCE.sim.maxFrameDt);
    if (this.lastTime !== null) this.frameMs += ((now - this.lastTime) - this.frameMs) * 0.1;
    this.lastTime = now;
    if (dt > 0) this.smoothFps += (1 / dt - this.smoothFps) * (1 - Math.exp(-3 * dt));
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= BALANCE.sim.fixedDt && steps < BALANCE.sim.maxStepsPerFrame) {
      if (steps === 0) {
        const input = this.input.buildSimInput(this.cameraRig.yaw);
        if (this.pendingEquip) { input.equip = this.pendingEquip; this.pendingEquip = null; }
        this.continuousInput.moveForward = input.moveForward;
        this.continuousInput.moveRight = input.moveRight;
        this.continuousInput.cameraYaw = input.cameraYaw;
        this.continuousInput.sprint = input.sprint;
        this.sim.step(BALANCE.sim.fixedDt, input);
      } else this.sim.step(BALANCE.sim.fixedDt, this.continuousInput);
      this.accumulator -= BALANCE.sim.fixedDt;
      steps++;
    }
    if (steps === BALANCE.sim.maxStepsPerFrame) this.accumulator = 0;
    const alpha = this.accumulator / BALANCE.sim.fixedDt;
    const state = this.sim.state;
    if (shouldReleaseLock({
      isLocked: this.input.isLocked, phase: state.phase, helpVisible: this.hud.isHelpVisible, modalOpen: this.isModal(),
    })) this.input.exitPointerLock();
    const events = this.sim.drainEvents();
    for (const event of events) if (event.type === 'autosave') this.savePending = true;
    this.effects.consume(events, state);
    this.audio.consume(events, state);
    this.hud.consume(events);
    this.entities.consume(events);
    this.horde.consume(events, state.zombies);
    this.flushAutosave();
    const leader = state.leader;
    this.focus.set(leader.prevPos.x + (leader.pos.x - leader.prevPos.x) * alpha, 1.4,
      leader.prevPos.z + (leader.pos.z - leader.prevPos.z) * alpha);
    this.syncVisuals(alpha, dt);
    const facingDelta = approachAngle(leader.prevFacing, leader.facing, Math.PI) - leader.prevFacing;
    this.cameraRig.setLook(this.input.cameraTurn, this.input.lookBack);
    const hits = this.cameraRig.update(dt, this.focus, leader.prevFacing + facingDelta * alpha,
      state.phase === 'playing' && Math.hypot(leader.vel.x, leader.vel.z) > 0.15, this.effects.takeShake());
    this.city.setOccluderFade(hits, dt);
    this.landmarks.setOccluderFade(hits, dt);
    this.fadeCheckpoint(hits, dt);
    this.input.updateHover();
    const hovered = this.input.hovered;
    this.targeted.length = 0;
    this.targetedStructureIds.length = 0;
    if (state.order.type === 'attack') this.targeted.push(state.order.target);
    for (const squad of state.squads) this.targeted.push(squad.target);
    for (const t of this.targeted) {
      if (t.kind === 'structure') this.targetedStructureIds.push(t.id);
    }
    this.entities.setHovered(hovered);
    this.entities.setTargeted(this.targeted);
    this.checkpoint.setGateHighlight(hovered?.kind === 'gate' || this.targeted.some(t => t.kind === 'gate'));
    this.landmarks.setHighlight(hovered?.kind === 'structure' ? hovered.id : null, this.targetedStructureIds);
    // Refresh indicators after this frame's camera/hover raycast.
    this.entities.update(state, alpha, state.time, 0);
    this.healthBars.update(state, alpha, this.camera);
    this.updateWaypoint(leader.pos);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.frame);
  };

  private syncVisuals(alpha: number, dt: number): void {
    const state = this.sim.state;
    const layout = this.sim.ctx.layout;
    const fx = this.focus.x;
    const fz = this.focus.z;
    // Streaming first: chunk listeners (landmarks, checkpoint, nests) sync visibility inside this call.
    this.loadedChunkCount = this.city.updateStreaming({ x: fx, z: fz }).loaded;
    this.syncOccluders();
    // Keep the shadow frustum centered on the focus so shadows work across the whole world.
    this.sun.position.set(fx - 70, 115, fz + 65);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.target.updateMatrixWorld();
    this.city.update(dt, state.time);
    this.landmarks.update(state, dt, state.time);
    this.checkpoint.update(state.gate, dt, state.time);
    this.nests.update(state, layout, dt);
    this.horde.setView(fx, fz, state.progression.frenzyTimeLeft);
    this.horde.update(state.zombies, alpha, state.time, state.abilities.rushTimeLeft > 0);
    this.entities.setView(fx, fz);
    this.entities.update(state, alpha, state.time, dt);
    let target: TargetRef | null = null;
    if (state.order.type === 'attack') target = this.sim.ctx.nav.effectiveTarget ?? state.order.target;
    this.effects.setOrderMarker(this.markerFor(target, this.marker) ? this.marker : null);
    // Each extra selected target (split horde) gets its own marker; duplicates of the gate or same structure collapse.
    let extra = 0;
    for (const squad of state.squads) {
      const t = this.sim.ctx.nav.squads.get(squad.id)?.effectiveTarget ?? squad.target;
      const slot = this.extraMarkers[extra] ?? (this.extraMarkers[extra] = new THREE.Vector3());
      const duplicateGate = t.kind === 'gate' && target?.kind === 'gate';
      const duplicateStructure = t.kind === 'structure' && target?.kind === 'structure' && t.id === target.id;
      if (this.markerFor(t, slot) && !duplicateGate && !duplicateStructure) extra++;
    }
    this.extraMarkerView.length = 0;
    for (let i = 0; i < extra; i++) this.extraMarkerView.push(this.extraMarkers[i]);
    this.effects.setExtraOrderMarkers(this.extraMarkerView);
    this.effects.update(dt, state, alpha);
    this.scene.updateMatrixWorld(true);
  }

  /** Rebuilds the shared occluder list when the loaded chunk set (or gate state) changes; breakables sync every frame. */
  private syncOccluders(): void {
    const loaded = this.city.loadedChunkIds;
    let sig = this.sim.state.gate.destroyed ? 'g' : '';
    for (const id of loaded) sig += id + ',';
    if (sig !== this.occluderSignature) {
      this.occluderSignature = sig;
      this.occluders.length = 0;
      const gateDestroyed = this.sim.state.gate.destroyed;
      for (const entry of this.occluderEntries) {
        if (entry.object === this.gateOccluder && gateDestroyed) continue;
        if (entry.chunk < 0 || loaded.has(entry.chunk)) this.occluders.push(entry.object);
      }
    }
    this.landmarks.syncOccluders(this.occluders, this.sim.state);
  }

  private updateWaypoint(leaderPos: Vec2): void {
    const wp = this.waypoint;
    if (wp && Math.hypot(wp.x - leaderPos.x, wp.z - leaderPos.z) < WAYPOINT_ARRIVE_M) this.waypoint = null;
    const active = this.waypoint;
    this.waypointMarker.visible = active !== null;
    if (active) this.waypointMarker.position.set(active.x, 7, active.z);
  }

  private markerFor(target: TargetRef | null, out: THREE.Vector3): boolean {
    const state = this.sim.state;
    if (target?.kind === 'gate' && !state.gate.destroyed) {
      out.set(state.gate.center.x, 1.5, state.gate.center.z);
      return true;
    }
    if (target?.kind === 'structure') {
      const structState = state.structures?.find(s => s.id === target.id);
      if (structState) {
        if (!structState.destroyed && structState.hp > 0) {
          out.set(structState.center.x, 1.5, structState.center.z);
          return true;
        }
        return false;
      }
      const structDef = this.sim.ctx.layout.structures?.find(s => s.id === target.id);
      if (structDef) {
        out.set((structDef.rect.minX + structDef.rect.maxX) / 2, 1.5, (structDef.rect.minZ + structDef.rect.maxZ) / 2);
        return true;
      }
    }
    if (target?.kind === 'guard') {
      const guardId = target.id;
      const guard = state.guards.find(g => g.id === guardId && g.state !== 'DEAD' && g.hp > 0);
      if (guard) { out.set(guard.pos.x, guard.elevation + 2.2, guard.pos.z); return true; }
    }
    return false;
  }

  private updateHud(): void {
    const target = this.input.hovered;
    let hoverLabel: string | null = null;
    if (target?.kind === 'gate') {
      hoverLabel = 'GATE';
    } else if (target?.kind === 'guard') {
      const guard = this.sim.state.guards.find(g => g.id === target.id);
      hoverLabel = guard?.role === 'civilian' ? 'CIVILIAN' : guard?.role === 'police' ? 'POLICE' : 'SOLDIER';
    } else if (target?.kind === 'structure') {
      const structState = this.sim.state.structures?.find(s => s.id === target.id);
      const structDef = structState ?? this.sim.ctx.layout.structures?.find(s => s.id === target.id);
      hoverLabel = structDef ? structureHudLabel(structDef.kind) : 'STRUCTURE';
    }
    this.hud.update(this.sim.state, {
      fps: this.smoothFps, drawCalls: this.renderer.info.render.calls, showDebug: this.showDebug,
      hoverLabel,
      pointerLocked: this.input.isLocked,
      waypoint: this.waypoint,
      frameMs: this.frameMs,
      loadedChunks: this.loadedChunkCount,
    });
  }

  private resetCamera(): void {
    const leader = this.sim.state.leader;
    this.focus.set(leader.pos.x, 1.4, leader.pos.z);
    this.cameraRig.reset(leader.facing, this.focus);
  }

  private fadeCheckpoint(hits: Set<THREE.Object3D>, dt: number): void {
    if (!this.checkpointOccluder) return;
    let blocked = hits.has(this.checkpointOccluder);
    for (const hit of hits) if (hit.userData.checkpointBuilding) blocked = true;
    // Tents, walls and towers share this rendered material. Fade the merged mesh
    // together so a tent proxy never fades an unused CityDistrict material.
    const material = this.checkpointOccluder.material as THREE.MeshLambertMaterial;
    material.opacity = approachOccluderOpacity(material.opacity, blocked, dt);
    const transparent = material.opacity < 1;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.needsUpdate = true;
    }
    material.depthWrite = !transparent;
  }

  private resetClock(): void { this.input.clear(); this.lastTime = null; this.accumulator = 0; }
  private readonly onBlur = (): void => { this.suspended = true; this.resetClock(); };
  private readonly onFocus = (): void => { this.suspended = document.hidden; this.resetClock(); };
  private readonly onVisibility = (): void => { this.suspended = document.hidden || !document.hasFocus(); this.resetClock(); };
  private readonly onResize = (): void => {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
  };
}
