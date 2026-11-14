import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { BALANCE } from '../config/balance';
import { Simulation } from '../sim/Simulation';
import { HUD } from '../ui/HUD';
import { Effects } from '../visuals/Effects';
import { EntityRenderer } from '../visuals/EntityRenderer';
import { HordeRenderer } from '../visuals/HordeRenderer';
import { CheckpointVisual } from '../world/Checkpoint';
import { CityDistrict } from '../world/CityDistrict';
import { InputController } from './InputController';
import { ThirdPersonCamera } from './ThirdPersonCamera';
import { emptyInput, type TargetRef } from './types';
import { approachAngle } from './cameraMath';

export class Game {
  public readonly sim: Simulation;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly cameraRig: ThirdPersonCamera;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.25, 450);
  private readonly city: CityDistrict;
  private readonly checkpoint: CheckpointVisual;
  private readonly entities: EntityRenderer;
  private readonly horde: HordeRenderer;
  private readonly effects: Effects;
  private readonly audio = new AudioSystem();
  private readonly hud: HUD;
  private readonly input: InputController;
  private readonly sun: THREE.DirectionalLight;
  private readonly extraOccluders = new THREE.Group();
  private readonly occluders: THREE.Object3D[];
  private readonly gateOccluder: THREE.Mesh;
  private readonly focus = new THREE.Vector3();
  private readonly marker = new THREE.Vector3();
  private readonly continuousInput = emptyInput();
  private running = false;
  private disposed = false;
  private frameId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private smoothFps = 60;
  private showDebug = false;
  private suspended = false;

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
    this.scene.fog = new THREE.Fog(sky, 95, 290);
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
    this.scene.add(this.sun);

    this.sim = new Simulation();
    const layout = this.sim.ctx.layout;
    this.city = new CityDistrict(layout);
    this.checkpoint = new CheckpointVisual(layout);
    this.entities = new EntityRenderer(this.scene);
    this.horde = new HordeRenderer();
    this.scene.add(this.city.group, this.checkpoint.group, this.horde.group, this.extraOccluders);
    this.effects = new Effects(this.scene);
    this.hud = new HUD(hudRoot);
    this.hud.showIntro();
    // HUD has no pass-through option. Its restart buttons explicitly enable pointer
    // events, so leave them clickable while the overlays allow canvas interaction.
    for (const overlay of hudRoot.querySelectorAll<HTMLElement>('.ibz-overlay')) overlay.style.pointerEvents = 'none';
    this.occluders = [...this.city.occluders];
    this.checkpoint.group.traverse(object => {
      if (object instanceof THREE.Mesh && object.name === 'CheckpointStatic') this.occluders.push(object);
    });
    // City exposes building proxies only. Add render-free authored prop volumes.
    const proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
    const proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    for (const collider of layout.colliders) {
      if (!collider.blocksSight || ['building', 'wall', 'tower', 'gate'].includes(collider.kind)) continue;
      const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial);
      proxy.position.set((collider.minX + collider.maxX) / 2, collider.height / 2, (collider.minZ + collider.maxZ) / 2);
      proxy.scale.set(collider.maxX - collider.minX, collider.height, collider.maxZ - collider.minZ);
      proxy.visible = false; // Raycaster intentionally intersects invisible proxies.
      this.extraOccluders.add(proxy);
      this.occluders.push(proxy);
    }
    const gate = this.sim.state.gate;
    this.gateOccluder = new THREE.Mesh(proxyGeometry, proxyMaterial);
    this.gateOccluder.position.set(gate.center.x, 1.5, gate.center.z);
    this.gateOccluder.scale.set(gate.rect.maxX - gate.rect.minX, 3, gate.rect.maxZ - gate.rect.minZ);
    this.gateOccluder.visible = false;
    this.extraOccluders.add(this.gateOccluder);
    this.occluders.push(this.gateOccluder);
    this.cameraRig = new ThirdPersonCamera(this.camera, this.occluders);
    this.input = new InputController(this.renderer.domElement, {
      camera: this.camera,
      pickables: () => [...this.entities.pickables, this.checkpoint.gatePickMesh],
      occluders: this.occluders,
      onOrbit: (dx, dy) => this.cameraRig.addOrbit(dx, dy),
      onZoom: delta => this.cameraRig.addZoom(delta),
      onGroundPing: point => { if (this.sim.state.phase === 'playing') this.effects.ping(point); },
      onKey: action => {
        switch (action) {
          case 'recenter': this.cameraRig.recenter(); break;
          case 'help': this.hud.toggleHelp(); break;
          case 'debug': this.showDebug = !this.showDebug; break;
          case 'mute': this.audio.setMuted(!this.audio.muted); break;
          case 'restart': if (this.sim.state.phase !== 'playing') this.restart(); break;
        }
      },
      onFirstGesture: () => { this.audio.unlock(); this.hud.hideIntro(); },
    });
    this.hud.onRestart(() => this.restart());
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

  restart(): void {
    if (this.disposed) return;
    this.sim.reset();
    this.effects.reset();
    this.entities.reset();
    this.input.clear();
    this.accumulator = 0;
    this.lastTime = null;
    this.entities.setHovered(null);
    this.entities.setTargeted(null);
    this.checkpoint.setGateHighlight(false);
    this.updateGateOccluder();
    this.resetCamera();
    this.hud.hideIntro();
    // HUD lacks a reset API for its transient toast; hide stale battle feedback.
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
    this.entities.dispose();
    this.horde.dispose();
    for (const geometry of characterGeometry) geometry.dispose();
    this.gateOccluder.geometry.dispose();
    (this.gateOccluder.material as THREE.Material).dispose();
    this.extraOccluders.clear();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    const debugWindow = window as unknown as { __game?: Game };
    if (debugWindow.__game === this) delete debugWindow.__game;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.frameId = null;
    const dt = this.suspended || document.hidden || this.lastTime === null
      ? 0 : THREE.MathUtils.clamp((now - this.lastTime) / 1000, 0, BALANCE.sim.maxFrameDt);
    this.lastTime = now;
    if (dt > 0) this.smoothFps += (1 / dt - this.smoothFps) * (1 - Math.exp(-3 * dt));
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= BALANCE.sim.fixedDt && steps < BALANCE.sim.maxStepsPerFrame) {
      if (steps === 0) {
        const input = this.input.buildSimInput(this.cameraRig.yaw);
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
    const events = this.sim.drainEvents();
    this.effects.consume(events, state);
    this.audio.consume(events);
    this.hud.consume(events);
    this.entities.consume(events);
    this.updateGateOccluder();
    this.syncVisuals(alpha, dt);
    const leader = state.leader;
    this.focus.set(leader.prevPos.x + (leader.pos.x - leader.prevPos.x) * alpha, 1.4,
      leader.prevPos.z + (leader.pos.z - leader.prevPos.z) * alpha);
    const facingDelta = approachAngle(leader.prevFacing, leader.facing, Math.PI) - leader.prevFacing;
    const hits = this.cameraRig.update(dt, this.focus, leader.prevFacing + facingDelta * alpha,
      state.phase === 'playing' && Math.hypot(leader.vel.x, leader.vel.z) > 0.15, this.effects.takeShake());
    this.city.setOccluderFade(hits);
    this.input.updateHover();
    const hovered = this.input.hovered;
    const targeted = state.order.type === 'attack' ? state.order.target : null;
    this.entities.setHovered(hovered);
    this.entities.setTargeted(targeted);
    this.checkpoint.setGateHighlight(hovered?.kind === 'gate' || targeted?.kind === 'gate');
    // Refresh indicators after this frame's camera/hover raycast.
    this.entities.update(state, alpha, state.time, 0);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.frame);
  };

  private syncVisuals(alpha: number, dt: number): void {
    const state = this.sim.state;
    this.city.update(dt, state.time);
    this.checkpoint.update(state.gate, dt, state.time);
    this.entities.update(state, alpha, state.time, dt);
    this.horde.update(state.zombies, alpha, state.time, state.abilities.rushTimeLeft > 0);
    let target: TargetRef | null = null;
    if (state.order.type === 'attack') target = this.sim.ctx.nav.effectiveTarget ?? state.order.target;
    if (target?.kind === 'gate' && !state.gate.destroyed) {
      this.marker.set(state.gate.center.x, 1.5, state.gate.center.z);
      this.effects.setOrderMarker(this.marker);
    } else if (target?.kind === 'guard') {
      const guardId = target.id;
      const guard = state.guards.find(g => g.id === guardId && g.state !== 'DEAD' && g.hp > 0);
      if (guard) {
        this.marker.set(guard.pos.x, guard.elevation + 2.2, guard.pos.z);
        this.effects.setOrderMarker(this.marker);
      } else this.effects.setOrderMarker(null);
    } else this.effects.setOrderMarker(null);
    this.effects.update(dt, state);
    this.scene.updateMatrixWorld(true);
  }

  private updateHud(): void {
    const target = this.input.hovered;
    this.hud.update(this.sim.state, {
      fps: this.smoothFps, drawCalls: this.renderer.info.render.calls, showDebug: this.showDebug,
      hoverLabel: target?.kind === 'gate' ? 'GATE' : target?.kind === 'guard' ? 'GUARD' : null,
    });
  }

  private resetCamera(): void {
    const leader = this.sim.state.leader;
    this.focus.set(leader.pos.x, 1.4, leader.pos.z);
    this.cameraRig.reset(leader.facing, this.focus);
  }

  private updateGateOccluder(): void {
    const index = this.occluders.indexOf(this.gateOccluder);
    if (this.sim.state.gate.destroyed) {
      if (index !== -1) this.occluders.splice(index, 1);
    } else if (index === -1) this.occluders.push(this.gateOccluder);
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
