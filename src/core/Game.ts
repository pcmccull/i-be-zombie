import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { IntroAudio } from '../audio/IntroAudio';
import { TouristVoices } from '../audio/TouristVoices';
import { buildIntroScript, FIRST_OBJECTIVE, type IntroScript } from '../content/intro';
import { BALANCE } from '../config/balance';
import { createSave } from '../persistence/saveSchema';
import { SaveStore } from '../persistence/SaveStore';
import { Simulation } from '../sim/Simulation';
import { CinematicOverlay } from '../ui/CinematicOverlay';
import { enterFullscreen } from '../ui/fullscreen';
import { HUD, structureHudLabel } from '../ui/HUD';
import { TouchControls, type TouchSlotView } from '../ui/TouchControls';
import { abilitySlotView, visibleSlotCount } from '../ui/uiHelpers';
import { Effects } from '../visuals/Effects';
import { CityVisuals } from '../visuals/CityVisuals';
import { interactPrompt } from '../ui/hudModel';
import { InteractableProps } from '../visuals/InteractableProps';
import { CityEventProps } from '../visuals/CityEventProps';
import { EntityRenderer } from '../visuals/EntityRenderer';
import { spawnCityEvent, setDistrictAlert } from '../systems/CityActivityDirector';
import { addBrains, grantReward } from '../systems/RewardSystem';
import type { DistrictAlert, DistrictId, DynamicEventKind } from './types';
import { HordeRenderer } from '../visuals/HordeRenderer';
import { HealthBars } from '../visuals/HealthBars';
import { CheckpointVisual } from '../world/Checkpoint';
import { CityDistrict } from '../world/CityDistrict';
import { Landmarks } from '../world/Landmarks';
import { NestMarkers } from '../world/NestMarkers';
import { TropicalScenery } from '../world/TropicalScenery';
import { ShopScenery } from '../world/ShopScenery';
import { VehicleRenderer } from '../visuals/VehicleRenderer';
import { TrafficSignals } from '../world/TrafficSignals';
import { setTrafficEnabled } from '../systems/TrafficSystem';
import { BoundaryScenery } from '../world/BoundaryScenery';
import { VisionFog, type VisionFogQuality } from '../visuals/VisionFog';
import { LightingController } from '../graphics/lighting/LightingController';
import { BrainPickups } from '../visuals/BrainPickups';
import { VFXManager } from '../graphics/vfx/VFXManager';
import { PostProcessingPipeline } from '../graphics/postfx/PostProcessingPipeline';
import { GraphicsDiagnostics } from '../graphics/performance/GraphicsDiagnostics';
import {
  QUALITY_PRESETS, defaultGraphicsSettings, loadGraphicsSettings, nextQuality, saveGraphicsSettings, shakeScale,
  type GraphicsSettings, type QualityProfile,
} from '../graphics/performance/GraphicsQuality';
import { parseBenchmarkParam, spawnBenchmark, type BenchmarkKind } from '../graphics/performance/benchmark';
import {
  disposeSurfaceDetail, setFoliageWind, setSurfaceDetailCamera, setSurfaceDetailEnabled,
} from '../graphics/materials/SurfaceDetail';
import { mulberry32 } from '../utils/rng';
import { SenseIndicators } from '../ui/SenseIndicators';
import { canTarget } from '../systems/AwarenessSystem';
import { buildDistrictLayout } from '../world/districtLayout';
import { chunkIdAt } from '../world/worldQueries';
import { CinematicController } from './CinematicController';
import { activeCue, advanceScriptClock, createPose, narrationTimeScale } from './cinematicMath';
import { beginLeaderEmerge } from '../entities/ZombieLeader';
import { cinematicInputLock, shouldPlayIntro, transitionFlow, type GameFlowState } from './gameFlow';
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
/** Longest the black start screen waits for the narration to buffer before offering to begin anyway. */
const INTRO_LOAD_TIMEOUT_MS = 4000;
/** Fade-from-black after a replayed intro restores the saved conquest. */
const RESTORE_FADE_S = 0.9;
const EMPTY_HITS: Set<THREE.Object3D> = new Set();
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

/** Default far plane (intro cinematic / no vision limit). */
const CAMERA_FAR = 520;
/** 0.5 m (was 0.25): doubles depth precision against ground-layer z-fighting; the boom never gets closer than 4 m. */
const CAMERA_NEAR = 0.5;
/** Extra far-plane slack (m) for tall geometry (skyline, palms) whose base is just inside the vision limit. */
const FAR_PLANE_MARGIN = 40;

export class Game {
  public readonly sim: Simulation;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly cameraRig: ThirdPersonCamera;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, CAMERA_NEAR, CAMERA_FAR);
  private readonly city: CityDistrict;
  private readonly checkpoint: CheckpointVisual;
  private readonly landmarks: Landmarks;
  private readonly nests: NestMarkers;
  private readonly entities: EntityRenderer;
  private readonly cityVisuals: CityVisuals;
  private readonly interactableProps: InteractableProps;
  private readonly cityEventProps: CityEventProps;
  private readonly horde: HordeRenderer;
  private readonly healthBars = new HealthBars();
  private readonly effects: Effects;
  private readonly audio = new AudioSystem();
  private readonly hud: HUD;
  private readonly input: InputController;
  private readonly store = new SaveStore(browserStorage());
  // --- visual polish (docs/8_visual_polish.md): lighting, post, quality presets, diagnostics, benchmark ---
  private readonly lighting: LightingController;
  private readonly vfx: VFXManager;
  private readonly brains: BrainPickups;
  private readonly post: PostProcessingPipeline;
  private readonly gfxDiag: GraphicsDiagnostics;
  private graphics: GraphicsSettings;
  private quality: QualityProfile;
  private readonly benchmark: BenchmarkKind;
  private windClock = 0;
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
  private pendingBuySlot = false;
  private touch!: TouchControls;
  private touchActive = false;
  private readonly touchSlotViews: TouchSlotView[] = [];
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
  private lastFrameMs = 0;
  private showDebug = false;
  private suspended = false;
  private seed: number;
  private lastSaveAt = -1e9;
  private savePending = false;
  private loadedChunkCount = 0;
  // --- opening cinematic (docs/4_intro_scene.md) ---
  /** Central flow state: gameplay input is enabled only in PLAYING. */
  private flow: GameFlowState = 'LOADING';
  private readonly scenery: TropicalScenery;
  // todos #10b/#12: simulated traffic + corner shops (render-only mirrors of state.vehicles / pickups)
  private readonly vehicles: VehicleRenderer;
  /** Traffic lights / stop signs / stop lines (bulbs follow the sim's signal clock). */
  private readonly signals: TrafficSignals;
  private readonly shops: ShopScenery;
  // --- expanded world: boundary scenery, zombie-vision haze, sense cues (docs/5_expand_world.md) ---
  private readonly boundaryScenery: BoundaryScenery | null;
  private readonly visionFog: VisionFog;
  private visionQuality: VisionFogQuality = 'high';
  private senseIndicators!: SenseIndicators;
  private visionPatchFrame = 0;
  private readonly cinematic: CinematicController;
  private readonly cineOverlay: CinematicOverlay;
  private readonly introAudio = new IntroAudio();
  private readonly touristVoices = new TouristVoices();
  private readonly intro: IntroScript;
  private introClock = 0;
  private introExiting = false;
  private narrationStarted = false;
  private musicStage = 0;
  private loadingSince = 0;
  private autoBeginIntro = false;
  /** In-memory conquest to restore after a replayed intro (null = the intro starts a new game). */
  private replayRestore: WorldSave | null = null;
  /** Start the Alpha's climb out of the ground on the next player gesture (continued save). */
  private emergePending = false;
  private restoreFade = 0;
  private objectiveWatch = false;
  private gameplayMusicOn = false;

  constructor(private readonly container: HTMLElement, private readonly hudRoot: HTMLElement) {
    this.touchActive = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.graphics = loadGraphicsSettings(browserStorage(),
      defaultGraphicsSettings(this.touchActive, window.devicePixelRatio || 1, prefersReducedMotion));
    this.quality = QUALITY_PRESETS[this.graphics.quality];
    this.benchmark = parseBenchmarkParam(window.location.search);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    const sky = 0x93cdea; // bright tropical sky
    this.scene.background = new THREE.Color(sky);
    // Fog hides the chunk load edge (chunks load within BALANCE.chunks.loadRadius = 150 m of the leader).
    this.scene.fog = new THREE.Fog(sky, 120, 330);
    this.lighting = new LightingController(this.scene);
    this.post = new PostProcessingPipeline(this.renderer, this.scene, this.camera);

    // Boot: whole open world as data, optional save.
    const layout = buildDistrictLayout();
    const save = this.store.load();
    this.seed = save?.seed ?? BALANCE.sim.seed;
    this.sim = new Simulation(layout, this.seed, save);
    // ?bench=1|2: reproducible benchmark population around the Alpha (debug only; never autosaved).
    if (this.benchmark) spawnBenchmark(this.sim.state, this.sim.ctx.collision, mulberry32(0xbe7c4), this.benchmark,
      layout.strongholds.length > 0);
    // The old decorative one-corner traffic light props are replaced by TrafficSignals in the open world.
    this.city = new CityDistrict(layout.strongholds.length > 0
      ? { ...layout, props: layout.props.filter(p => p.kind !== 'trafficLight') } : layout);
    this.checkpoint = new CheckpointVisual(layout);
    this.landmarks = new Landmarks(layout);
    this.nests = new NestMarkers(null, layout);
    this.entities = new EntityRenderer(this.scene);
    this.cityVisuals = new CityVisuals(this.scene, layout);
    this.cityEventProps = new CityEventProps(this.scene);
    this.interactableProps = new InteractableProps(this.scene, this.sim.state);
    this.horde = new HordeRenderer();
    // Companion hats ride the animated head bone (horde.update runs before cityVisuals.update each frame).
    this.cityVisuals.setHeadLookup((id, out) => this.horde.headMatrixOf(id, out));
    this.scenery = new TropicalScenery(layout);
    this.vehicles = new VehicleRenderer();
    this.signals = new TrafficSignals(layout);
    this.shops = new ShopScenery(layout);
    const openWorld = layout.strongholds.length > 0;
    this.boundaryScenery = openWorld ? new BoundaryScenery(this.scene, layout) : null;
    this.visionQuality = this.touchActive || (window.devicePixelRatio || 1) <= 1 ? 'low' : 'high';
    this.visionFog = new VisionFog(this.visionQuality);
    this.entities.setVisionGating(openWorld);
    this.healthBars.setVisionGating(openWorld);
    this.intro = buildIntroScript(layout);
    this.scene.add(this.city.group, this.checkpoint.group, this.landmarks.group, this.nests.group, this.horde.group,
      this.healthBars.group, this.extraOccluders, this.scenery.group);
    this.scene.add(this.vehicles.group, this.shops.group, this.signals.group);
    this.effects = new Effects(this.scene);
    this.effects.setWorld(layout);
    this.vfx = new VFXManager(this.scene, this.quality, this.graphics);
    this.brains = new BrainPickups(this.scene, this.vfx);
    this.vfx.setWorld(layout);
    this.hud = new HUD(hudRoot);
    this.gfxDiag = new GraphicsDiagnostics(hudRoot); // after HUD: it rebuilds hudRoot
    // HUD has no pass-through option. Its restart buttons explicitly enable pointer
    // events, so leave them clickable while the overlays allow canvas interaction.
    for (const overlay of hudRoot.querySelectorAll<HTMLElement>('.ibz-overlay')) overlay.style.pointerEvents = 'none';
    this.hud.setWorld(layout, { firstRun: !save });
    this.senseIndicators = new SenseIndicators(this.hud.senseRoot);
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
    this.cinematic = new CinematicController(this.camera);
    this.cineOverlay = new CinematicOverlay(hudRoot);
    this.cineOverlay.onStart(() => this.tryBeginIntro());
    this.cineOverlay.onSkip(() => this.skipIntro());
    this.cameraRig.setBounds(layout.bounds);
    this.input = new InputController(this.renderer.domElement, {
      camera: this.camera,
      pickables: () => [...this.entities.pickables, this.checkpoint.gatePickMesh, ...this.landmarks.pickMeshes,
        ...this.vehicles.pickables],
      occluders: this.occluders,
      onOrbit: (dx, dy) => this.cameraRig.addOrbit(dx, dy),
      onZoom: delta => this.cameraRig.addZoom(delta),
      isModal: () => this.isModal(),
      onUiKey: key => this.hud.isNestPanelVisible && this.hud.handleNestKey(key),
      onLockLost: () => {
        // Browser Esc / alt-tab released the mouse: show the pause menu instead of silently dropping control.
        if (this.flow === 'PLAYING' && !this.hud.introVisible && !this.hud.isHelpVisible && !this.isModal()) this.openPause();
      },
      onKey: action => this.handleKeyAction(action),
      onFirstGesture: () => this.onGesture(),
      inputLocked: () => cinematicInputLock(this.flow),
      onLockedKey: code => this.onIntroKey(code),
      // EW vision gate: unidentified humans are neither hoverable nor pickable (the sim also converts such orders to moves).
      targetAllowed: t => {
        if (t.kind === 'vehicle') {
          // A car past the vision limit is hidden in the haze: not pickable either.
          const v = this.sim.state.vehicles.find(c => c.id === t.id), lead = this.sim.state.leader.pos;
          const limit = this.visionFog.hiddenBeyond;
          return !!v && (!Number.isFinite(limit) || (v.pos.x - lead.x) ** 2 + (v.pos.z - lead.z) ** 2 < limit * limit);
        }
        return !this.sim.ctx.layout.strongholds.length || t.kind !== 'guard' || canTarget(this.sim.state, t.id);
      },
      canLock: () =>
        this.flow === 'PLAYING' && shouldRequestLock({
          isLocked: this.input.isLocked,
          phase: this.sim.state.phase,
          helpVisible: this.hud.isHelpVisible,
          modalOpen: this.isModal(),
        }),
    });
    // The cursor stays free so the horde can be directed by pointing and clicking; drag (or Z/X) orbits the camera.
    this.hud.onRestart(() => this.restart());
    this.hud.onWaypoint(p => { this.waypoint = p; });
    // Nest teleport pick: close the map first (it clears input), then queue the one-step sim edge.
    this.hud.onNestTeleport(id => { this.hud.hideMap(); this.input.queueNestTeleport(id); });
    this.hud.onEquip((slot, ability) => { this.pendingEquip = { slot, ability }; });
    this.hud.onBuySlot(() => { this.pendingBuySlot = true; });
    this.hud.onBuyVision(() => this.input.queueBuyVision());
    this.hud.onBuyTrait((id) => this.input.queueBuyTrait(id));
    // Touch overlay: created once, shown on coarse-pointer devices or after the first touch.
    this.touch = new TouchControls(hudRoot);
    this.input.setTouchSource(this.touch);
    this.touch.onAttack(() => this.input.queueAttack());
    this.touch.onFollow(() => this.input.queueCommand({ type: 'follow' }));
    this.touch.onUse(() => this.input.queueInteract());
    this.touch.onAbility(slot => this.input.queueAbility(slot));
    this.touch.onMap(() => this.handleKeyAction('map'));
    this.touch.onPause(() => this.handleKeyAction('pause'));
    this.touch.onRecenter(() => this.handleKeyAction('recenter'));
    if (this.touchActive) this.touch.enable();
    window.addEventListener('pointerdown', this.onTouchProbe, { capture: true });
    this.hud.setPauseCallbacks({
      onContinue: () => this.closePause(),
      onSave: () => this.hud.notifyPause(this.saveNow() ? 'Saved' : 'Save failed'),
      onResetSave: () => this.resetSave(),
      onToggleMute: () => this.toggleMute(),
      onReplayIntro: () => this.replayIntro(),
      getVisionQuality: () => this.visionQuality,
      onToggleVisionQuality: () => {
        this.visionQuality = this.visionQuality === 'high' ? 'low' : 'high';
        this.visionFog.setQuality(this.visionQuality);
      },
      getGraphics: () => this.graphics,
      onCycleGraphicsQuality: () => this.setGraphics({ ...this.graphics, quality: nextQuality(this.graphics.quality) }),
      onToggleReducedMotion: () => this.setGraphics({ ...this.graphics, reducedMotion: !this.graphics.reducedMotion }),
    });
    this.hud.setCollectionCallbacks({
      onEquipCosmetic: (slot, rewardId) => this.input.queueEquipCosmetic(slot, rewardId),
      onBuyReward: rewardId => this.input.queueBuyReward(rewardId),
      onToggleCompanion: id => this.input.queueToggleCompanion(id),
      onSummonVehicle: kind => this.input.queueSummonVehicle(kind),
      onFastTravelHideout: id => this.input.queueFastTravelHideout(id),
    });
    window.addEventListener('keydown', this.onCollectionKey);
    this.applyGraphics();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
    this.scene.updateMatrixWorld(true);
    this.visionFog.patchScene(this.scene);
    this.resetCamera();
    if (shouldPlayIntro({ hasSave: save !== null })) this.enterIntroLoading(null);
    else {
      this.flow = transitionFlow(this.flow, 'PLAYING');
      // Returning player: the Alpha waits underground at its last nest and climbs out once the player takes control.
      this.emergePending = true;
      this.entities.setLeaderBuried(true);
    }
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
    this.emergePending = false;
    this.effects.reset();
    this.vfx.reset();
    this.brains.reset();
    this.entities.reset();
    this.audio.reset();
    this.touristVoices.reset(this.sim.state.time);
    this.hud.reset();
    this.hud.setWorld(this.sim.ctx.layout, { firstRun: true });
    this.hud.setMuted(this.audio.muted);
    this.input.clear();
    this.pendingEquip = null;
    this.pendingBuySlot = false;
    this.waypoint = null;
    this.accumulator = 0;
    this.lastTime = null;
    this.savePending = false;
    this.entities.setHovered(null);
    this.entities.setTargeted([]);
    this.checkpoint.setGateHighlight(false);
    this.landmarks.reset();
    this.landmarks.setHighlight(null);
    this.scenery.resetTraffic();
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
    window.removeEventListener('pointerdown', this.onTouchProbe, { capture: true });
    window.removeEventListener('keydown', this.onCollectionKey);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.touch.dispose();
    this.hud.dispose();
    this.cineOverlay.dispose();
    this.introAudio.dispose();
    this.touristVoices.dispose();
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
    this.vfx.dispose();
    this.brains.dispose();
    this.city.dispose();
    this.checkpoint.dispose();
    this.landmarks.dispose();
    this.nests.dispose();
    this.entities.dispose();
    this.cityVisuals.dispose();
    this.interactableProps.dispose();
    this.cityEventProps.dispose();
    this.horde.dispose();
    this.healthBars.dispose();
    this.scenery.dispose();
    this.vehicles.dispose();
    this.signals.dispose();
    this.shops.dispose();
    this.boundaryScenery?.dispose();
    this.visionFog.dispose();
    this.senseIndicators.dispose();
    for (const geometry of characterGeometry) geometry.dispose();
    this.gateOccluder.geometry.dispose();
    (this.gateOccluder.material as THREE.Material).dispose();
    this.waypointMarker.geometry.dispose();
    (this.waypointMarker.material as THREE.Material).dispose();
    this.extraOccluders.clear();
    this.lighting.dispose();
    this.post.dispose();
    this.gfxDiag.dispose();
    disposeSurfaceDetail();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    const debugWindow = window as unknown as { __game?: Game };
    if (debugWindow.__game === this) delete debugWindow.__game;
  }

  // --- menus / persistence -------------------------------------------------------------------

  private pixelRatio(): number {
    const cap = Math.min(this.quality.pixelRatioCap, 1.5);
    return Math.min(window.devicePixelRatio || 1, this.touchActive ? Math.min(BALANCE.touch.lowDpr, cap) : cap);
  }

  /** Apply + persist new graphics settings (pause menu). Render-only; never touches the simulation. */
  private setGraphics(next: GraphicsSettings): void {
    this.graphics = next;
    this.quality = QUALITY_PRESETS[next.quality];
    saveGraphicsSettings(browserStorage(), next);
    this.applyGraphics();
  }

  private applyGraphics(): void {
    this.lighting.setQuality(this.quality);
    this.vfx.setQuality(this.quality, this.graphics);
    this.post.setQuality(this.quality, this.graphics);
    setSurfaceDetailEnabled(this.quality.surfaceDetail);
    this.hud.setReducedMotion(this.graphics.reducedMotion);
    this.entities.setReducedMotion(this.graphics.reducedMotion);
    this.onResize();
  }

  private handleKeyAction(action: 'recenter' | 'help' | 'debug' | 'mute' | 'map' | 'pause'): void {
    if (cinematicInputLock(this.flow)) return;
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
  }

  private readonly onTouchProbe = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || this.touchActive) return;
    this.touchActive = true;
    this.touch.enable();
    this.onResize();
  };

  private updateTouchSlots(): void {
    if (!this.touch.isEnabled()) return;
    const state = this.sim.state;
    const n = visibleSlotCount(state);
    const views = this.touchSlotViews;
    views.length = 0;
    for (let i = 0; i < n; i++) {
      const v = abilitySlotView(state, i);
      views.push({ key: v.key, name: v.name, kind: v.kind, remainingFrac: v.remainingFrac });
    }
    this.touch.setSlots(views);
  }

  private isModal(): boolean { return this.hud.isPauseVisible || this.hud.isMapVisible; }

  private openPause(): void {
    if (this.flow !== 'PLAYING') return;
    this.flow = transitionFlow(this.flow, 'PAUSED');
    this.hud.showPause();
    this.input.exitPointerLock();
    this.input.clear();
    this.hud.setMuted(this.audio.muted);
  }

  private closePause(): void {
    if (this.flow === 'PAUSED') this.flow = transitionFlow(this.flow, 'PLAYING');
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

  /** V at an active nest (sim `nestTravelMenu`): pick a destination nest on the world map. */
  private openNestTeleportMap(nestId: string): void {
    if (this.flow !== 'PLAYING' || this.hud.isPauseVisible || this.hud.isMapVisible) return;
    this.hud.showTeleportMap(nestId);
    if (this.hud.isMapVisible) { this.input.exitPointerLock(); this.input.clear(); }
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
    this.hud.setMuted(this.audio.muted);
  }

  /** Writes the current state to localStorage. Returns false when storage is unavailable or rejects the save. */
  private saveNow(): boolean {
    if (this.benchmark) return false; // benchmark populations are never persisted
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
    this.replayRestore = null;
    this.restart();
    this.closePause();
    // A fresh game plays the opening (the confirm click already unlocked audio, so it starts once loaded).
    this.enterIntroLoading(null);
  }

  // --- opening cinematic (docs/4_intro_scene.md) ----------------------------------------------

  /** Debug: jump the running intro to script time `t` (narration follows). */
  debugIntroSeek(t: number): void {
    if (this.flow !== 'INTRO_CINEMATIC' || this.introExiting) return;
    this.introClock = Math.max(0, t);
    const scale = narrationTimeScale(this.intro.narrationDuration, this.introAudio.narrationDuration);
    if (this.narrationStarted) this.introAudio.playNarration((this.introClock - this.intro.narrationStart) * scale);
  }

  get flowState(): GameFlowState { return this.flow; }

  private onGesture(): void {
    this.audio.unlock();
    this.introAudio.bind(this.audio.context, this.audio.output);
    this.touristVoices.bind(this.audio.context, this.audio.output);
    this.hud.hideIntro();
    if (this.emergePending && this.flow === 'PLAYING') {
      this.emergePending = false;
      beginLeaderEmerge(this.sim.ctx);
    }
    // Returning players get the gameplay music as soon as audio is allowed.
    if (this.flow === 'PLAYING' && !this.gameplayMusicOn) {
      this.gameplayMusicOn = true;
      this.introAudio.startGameplay();
    }
  }

  /** LOADING: black screen + begin prompt; the world is built and the narration buffers behind it. */
  private enterIntroLoading(restore: WorldSave | null): void {
    this.flow = 'LOADING';
    this.replayRestore = restore;
    this.introExiting = false;
    this.introClock = 0;
    this.narrationStarted = false;
    this.musicStage = 0;
    this.objectiveWatch = false;
    this.input.exitPointerLock();
    this.input.clear();
    this.hud.setCinematic(true);
    this.touch.disable();
    this.cineOverlay.hideObjective();
    this.cineOverlay.setActive(false);
    this.cineOverlay.showStart(false, this.touchActive);
    this.introAudio.stopMusic();
    this.gameplayMusicOn = false;
    this.introAudio.preload();
    this.scenery.resetTraffic();
    // The opening shows the render-only flyover traffic; simulated cars start when the player takes control.
    if (this.sim) setTrafficEnabled(this.sim.ctx, false);
    this.loadingSince = performance.now();
    // An earlier gesture (Reset Save / Replay Intro click) already unlocked audio: begin once loaded.
    this.autoBeginIntro = this.audio.context?.state === 'running';
    // Park the camera on the opening shot (behind the black fade) and warm up shaders for the streamed area.
    this.cinematic.load(this.intro.keys, this.intro.endTime, this.gameplayPose());
    this.cinematic.apply(0);
    this.city.updateStreaming(this.intro.streamFocus);
    try { this.renderer.compile(this.scene, this.camera); } catch { /* optional warm-up */ }
  }

  private introReady(): boolean {
    return this.introAudio.narrationSettled || performance.now() - this.loadingSince > INTRO_LOAD_TIMEOUT_MS;
  }

  private tryBeginIntro(): void {
    if (this.flow !== 'LOADING' || !this.introReady()) return;
    // Still inside the click / key gesture that started the game, so the browser allows it.
    if (this.cineOverlay.startFullscreen) void enterFullscreen();
    this.audio.unlock();
    this.introAudio.bind(this.audio.context, this.audio.output);
    this.touristVoices.bind(this.audio.context, this.audio.output);
    this.introAudio.setMuted(this.audio.muted);
    this.flow = transitionFlow(this.flow, 'INTRO_CINEMATIC');
    this.input.clear();
    this.cineOverlay.hideStart();
    this.cineOverlay.setActive(true);
    this.introClock = 0;
    // Final key = the exact pose the gameplay camera will take behind the zombie (seamless handoff).
    this.cinematic.load(this.intro.keys, this.intro.endTime, this.gameplayPose());
  }

  private onIntroKey(code: string): void {
    if (this.flow === 'LOADING') {
      if (code === 'KeyF') { this.cineOverlay.toggleFullscreenPref(); return; }
      this.tryBeginIntro();
      return;
    }
    if (this.flow === 'INTRO_CINEMATIC' && (code === 'Escape' || code === 'Enter')) this.skipIntro();
  }

  /** Same safe handoff as the full sequence: blend into the gameplay pose, then unlock (never earlier). */
  private skipIntro(): void {
    if (this.flow !== 'INTRO_CINEMATIC' || this.introExiting || this.introClock < this.intro.skipAvailableAt) return;
    this.introExiting = true;
    this.introAudio.stopNarration();
    this.introAudio.stopMusic();
    this.cineOverlay.setSubtitle('');
    this.cineOverlay.setSkipVisible(false);
    this.cineOverlay.setFade(0);
    this.cinematic.beginExit(this.introClock, this.intro.skipBlend);
  }

  /** Gameplay camera pose behind the leader (computed by the real rig, then the camera is handed back). */
  private gameplayPose() {
    const pose = createPose();
    this.resetCamera();
    const cam = this.camera;
    pose.pos.x = cam.position.x; pose.pos.y = cam.position.y; pose.pos.z = cam.position.z;
    const look = this.cameraRig.lookPoint;
    pose.look.x = look.x; pose.look.y = look.y; pose.look.z = look.z;
    pose.fov = 55;
    return pose;
  }

  /** Advances the cinematic. Returns true while the cinematic owns the camera. */
  private updateIntro(dt: number): boolean {
    const flow = this.flow;
    if (flow === 'LOADING') {
      const ready = this.introReady();
      this.cineOverlay.showStart(ready, this.touchActive);
      this.horde.setAmbientMask({ x: this.sim.state.leader.pos.x, z: this.sim.state.leader.pos.z, radius: 0 });
      this.cinematic.apply(0);
      if (ready && this.autoBeginIntro) this.tryBeginIntro();
      return true;
    }
    if (flow !== 'INTRO_CINEMATIC') return false;
    const s = this.intro;
    const audio = this.introAudio;
    const scale = narrationTimeScale(s.narrationDuration, audio.narrationDuration);
    if (!this.introExiting) {
      if (!this.narrationStarted && this.introClock >= s.narrationStart) {
        this.narrationStarted = true;
        audio.playNarration((this.introClock - s.narrationStart) * scale);
      }
      this.introClock = advanceScriptClock(this.introClock, dt, this.narrationStarted
        ? { playing: audio.narrationPlaying, time: audio.narrationTime, narrationStart: s.narrationStart, scale }
        : null);
      const t = this.introClock;
      if (this.musicStage === 0 && t >= s.music.start) { this.musicStage = 1; audio.startTheme(); }
      if (this.musicStage === 1 && t >= s.music.buildFrom) { this.musicStage = 2; audio.startBuild((s.music.cut - t) * scale); }
      if (this.musicStage === 2 && t >= s.music.cut) { this.musicStage = 3; audio.cutForReveal(); }
      this.cineOverlay.setFade(1 - t / s.fadeIn);
      this.cineOverlay.setSubtitle(activeCue(s.cues, t)?.text ?? '');
      this.cineOverlay.setSkipVisible(t >= s.skipAvailableAt && t < s.keys[s.keys.length - 1].t);
    } else {
      this.introClock += Math.max(0, dt);
    }
    const leader = this.sim.state.leader;
    const ambientRadius = this.introExiting || this.introClock >= s.revealAmbientAt ? s.ambientRadius : 0;
    this.horde.setAmbientMask({ x: leader.pos.x, z: leader.pos.z, radius: ambientRadius });
    this.cinematic.apply(this.introClock);
    if (this.cinematic.isDone(this.introClock)) { this.finishIntro(); return false; }
    return true;
  }

  /** Hand control to the player: gameplay camera, HUD, first objective, cleared input, then PLAYING. */
  private finishIntro(): void {
    this.introExiting = false;
    this.introAudio.stopNarration();
    this.cineOverlay.setActive(false);
    this.cineOverlay.setFade(0);
    this.horde.setAmbientMask(null);
    this.scenery.retireTraffic();
    setTrafficEnabled(this.sim.ctx, true);
    const restore = this.replayRestore;
    this.replayRestore = null;
    if (restore) {
      // Replay was watch-only: bring back the conquest exactly as it was, fading in from black.
      this.sim.reset(restore.seed, restore);
      this.seed = restore.seed;
      this.effects.reset();
      this.vfx.reset();
    this.brains.reset();
      this.entities.reset();
      this.hud.reset();
      this.hud.setWorld(this.sim.ctx.layout, { firstRun: false });
      this.landmarks.reset();
      this.occluderSignature = '';
      this.restoreFade = RESTORE_FADE_S;
      this.cineOverlay.setFade(1);
      beginLeaderEmerge(this.sim.ctx);
    }
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    this.resetCamera();
    this.hud.setCinematic(false);
    this.hud.hideIntro();
    if (this.touchActive) this.touch.enable();
    this.input.clear();
    this.accumulator = 0;
    this.flow = transitionFlow(this.flow, 'PLAYING');
    this.introAudio.startGameplay();
    this.gameplayMusicOn = true;
    if (!restore) {
      this.savePending = true; // the new game exists once the player has control
      this.cineOverlay.showObjective(FIRST_OBJECTIVE.title, this.touchActive ? FIRST_OBJECTIVE.touchText : FIRST_OBJECTIVE.text, 16000);
      this.objectiveWatch = true;
    }
  }

  /** Pause menu "Replay Intro": snapshot the conquest in memory, play the opening on a fresh world, restore after. */
  private replayIntro(): void {
    if (this.flow !== 'PAUSED') return;
    const snapshot = createSave(this.sim.state, this.seed, Date.now());
    this.hud.hidePause();
    this.flow = transitionFlow(this.flow, 'PLAYING');
    this.restart();
    this.enterIntroLoading(snapshot);
  }

  // --- frame ---------------------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.frameId = null;
    const paused = this.hud.isPauseVisible;
    const dt = paused || this.suspended || document.hidden || this.lastTime === null
      ? 0 : THREE.MathUtils.clamp((now - this.lastTime) / 1000, 0, BALANCE.sim.maxFrameDt);
    this.lastFrameMs = this.lastTime !== null && !paused && !document.hidden ? now - this.lastTime : 0;
    if (this.lastTime !== null) this.frameMs += ((now - this.lastTime) - this.frameMs) * 0.1;
    this.lastTime = now;
    if (dt > 0) this.smoothFps += (1 / dt - this.smoothFps) * (1 - Math.exp(-3 * dt));
    // The world only starts living once the opening begins (nothing happens behind the black start screen).
    if (this.flow !== 'LOADING') this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= BALANCE.sim.fixedDt && steps < BALANCE.sim.maxStepsPerFrame) {
      if (steps === 0) {
        const input = this.input.buildSimInput(this.cameraRig.yaw);
        if (this.pendingEquip) { input.equip = this.pendingEquip; this.pendingEquip = null; }
        if (this.pendingBuySlot) { input.buySlot = true; this.pendingBuySlot = false; }
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
    for (const event of events) {
      if (event.type === 'autosave') {
        // Nothing is saved until the player has control (a reload mid-intro replays it), and a replayed intro
        // runs on a throwaway world that must never overwrite the real save.
        if (this.replayRestore === null && !cinematicInputLock(this.flow)) this.savePending = true;
      } else if (event.type === 'nestTravelMenu') {
        this.openNestTeleportMap(event.nestId);
      } else if (this.objectiveWatch && (event.type === 'recruited' || event.type === 'converted')) {
        this.objectiveWatch = false;
        window.setTimeout(() => this.cineOverlay.hideObjective(), 2500);
      }
    }
    const sightEvents = this.effectEventsInSight(events, state.leader.pos);
    this.effects.consume(sightEvents, state);
    this.vfx.consume(sightEvents, state);
    this.brains.consume(sightEvents, state.leader.pos.x, state.leader.pos.z);
    this.audio.consume(events, state, this.cameraRig.viewYaw,
      this.flow === 'PLAYING' && state.phase === 'playing' && !this.suspended);
    this.hud.consume(events);
    this.entities.consume(events);
    this.horde.consume(events, state.zombies);
    this.flushAutosave();
    const leader = state.leader;
    const cinematicCamera = this.updateIntro(dt);
    this.introAudio.update();
    if (this.flow === 'PLAYING' && state.phase === 'playing' && !this.suspended) {
      this.touristVoices.update(state.time, leader.pos, state.guards);
    }
    if (cinematicCamera) {
      // Visual focus (shadows, guard culling) follows what the cinematic camera is looking at.
      const look = this.cinematic.lookTarget;
      this.focus.set(look.x, 1.4, look.z);
    } else {
      this.focus.set(leader.prevPos.x + (leader.pos.x - leader.prevPos.x) * alpha, 1.4,
        leader.prevPos.z + (leader.pos.z - leader.prevPos.z) * alpha);
    }
    this.syncVisuals(alpha, dt);
    const facingDelta = approachAngle(leader.prevFacing, leader.facing, Math.PI) - leader.prevFacing;
    this.cameraRig.setLook(this.input.cameraTurn, this.input.lookBack);
    const shake = this.effects.takeShake() * shakeScale(this.graphics);
    const hits = cinematicCamera ? EMPTY_HITS : this.cameraRig.update(dt, this.focus, leader.prevFacing + facingDelta * alpha,
      state.phase === 'playing' && Math.hypot(leader.vel.x, leader.vel.z) > 0.15, shake);
    if (this.restoreFade > 0) {
      this.restoreFade = Math.max(0, this.restoreFade - dt);
      this.cineOverlay.setFade(this.restoreFade / RESTORE_FADE_S);
    }
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
    this.vehicles.setHighlight(hovered, this.targeted);
    // Refresh indicators after this frame's camera/hover raycast.
    this.entities.update(state, alpha, state.time, 0);
    this.healthBars.update(state, alpha, this.camera);
    this.updateWaypoint(leader.pos);
    this.updateHud();
    // viewYaw: what the camera actually looks along (includes the hold-V look-back), so arrows match the screen.
    this.senseIndicators.update(state, this.cameraRig.viewYaw, dt);
    this.visionFog.update(state, alpha, dt);
    // The opening flyover is not the Alpha's eyesight: no haze while the cinematic owns the camera.
    if (cinematicInputLock(this.flow)) this.visionFog.suspend();
    // Everything past the vision limit is hidden: the haze goes opaque there, so the sky must be the haze colour too.
    const backdrop = this.visionFog.uniforms.uHideBeyond.value > 0 ? BALANCE.vision.hazeColor : 0x93cdea;
    if (this.scene.background instanceof THREE.Color) this.scene.background.setHex(backdrop);
    if (this.scene.fog) this.scene.fog.color.setHex(backdrop);
    this.updateFarPlane();
    // Lazily built rigs / pooled effects add materials after construction: patch new ones cheaply every ~1.5 s.
    if (++this.visionPatchFrame >= 90) { this.visionPatchFrame = 0; this.visionFog.patchScene(this.scene); }
    setSurfaceDetailCamera(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    this.windClock += dt;
    setFoliageWind(this.windClock, this.quality.foliageWind ? (this.graphics.reducedMotion ? 0.4 : 1) : 0);
    // Count calls/triangles for the whole frame (scene + post quads) in one place.
    // Particles: interpolated, culled past the vision limit (no limit while the intro suspends the haze).
    {
      const lead = this.sim.state.leader;
      this.brains.update(dt, lead.prevPos.x + (lead.pos.x - lead.prevPos.x) * alpha, lead.prevPos.z + (lead.pos.z - lead.prevPos.z) * alpha);
    }
    this.vfx.update(dt, this.sim.state, alpha, this.camera, this.focus.x, this.focus.z, this.visionFog.hiddenBeyond);
    this.cityVisuals.update(this.sim.state, this.sim.state.time, this.focus.x, this.focus.z, this.visionFog.hiddenBeyond, alpha);
    this.cityEventProps.update(this.sim.state, this.focus.x, this.focus.z, this.visionFog.hiddenBeyond, this.sim.state.time);
    this.interactableProps.update(this.sim.state);
    if (this.touchActive) this.touch.setUseVisible(interactPrompt(this.sim.state, this.sim.ctx.layout) !== null);
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.post.render();
    this.updateGfxDiagnostics(dt);
    this.frameId = requestAnimationFrame(this.frame);
  };

  /**
   * Nothing past the vision limit is visible, so don't draw it: pull the far plane in to the farthest point that can
   * still be inside the limit (camera→Alpha distance + limit + a margin for tall geometry). Whole meshes past it are
   * frustum-culled; instanced/merged ones are clipped. Restores the default far plane while the haze is suspended.
   */
  private updateFarPlane(): void {
    const limit = this.visionFog.hiddenBeyond;
    let far = CAMERA_FAR;
    if (Number.isFinite(limit)) {
      const c = this.camera.position;
      const u = this.visionFog.uniforms.uVisionCenter.value;
      const dx = c.x - u.x;
      const dz = c.z - u.y;
      far = Math.min(CAMERA_FAR, Math.sqrt(dx * dx + dz * dz) + Math.abs(c.y) + limit + FAR_PLANE_MARGIN);
    }
    if (Math.abs(this.camera.far - far) > 0.5) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Effects skip the haze shader (noVisionHaze), so drop events whose origin is past the vision limit. */
  private effectEventsInSight<E>(events: E[], center: Vec2): E[] {
    const limit = this.visionFog.hiddenBeyond;
    if (!Number.isFinite(limit)) return events;
    const lim2 = limit * limit;
    return events.filter((e) => {
      const ev = e as { from?: Vec2; pos?: Vec2 };
      const p = ev.from ?? ev.pos;
      if (!p) return true;
      const dx = p.x - center.x, dz = p.z - center.z;
      return dx * dx + dz * dz < lim2;
    });
  }

  private syncVisuals(alpha: number, dt: number): void {
    const state = this.sim.state;
    const layout = this.sim.ctx.layout;
    const fx = this.focus.x;
    const fz = this.focus.z;
    // Streaming first: chunk listeners (landmarks, checkpoint, nests) sync visibility inside this call.
    // During the opening, stream one fixed area that covers every shot (no chunk loads mid-glide).
    const streamFocus = cinematicInputLock(this.flow) ? this.intro.streamFocus : { x: fx, z: fz };
    this.loadedChunkCount = this.city.updateStreaming(streamFocus).loaded;
    this.syncOccluders();
    // Keep the shadow frustum centered on the focus so shadows work across the whole world.
    this.lighting.follow(fx, fz);
    this.city.update(dt, state.time);
    this.landmarks.update(state, dt, state.time);
    this.checkpoint.update(state.gate, dt, state.time);
    this.nests.update(state, layout, dt);
    this.horde.setView(fx, fz, state.progression.frenzyTimeLeft);
    this.horde.setCamera(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    const lead = state.leader;
    this.horde.setLeader(lead.prevPos.x + (lead.pos.x - lead.prevPos.x) * alpha,
      lead.prevPos.z + (lead.pos.z - lead.prevPos.z) * alpha, lead.alive);
    this.horde.setNestTravel(state.nestTravel);
    this.horde.update(state.zombies, alpha, state.time, state.abilities.rushTimeLeft > 0, dt);
    this.entities.setView(fx, fz);
    this.entities.update(state, alpha, state.time, dt);
    let target: TargetRef | null = null;
    if (state.order.type === 'attack') target = this.sim.ctx.nav.effectiveTarget ?? state.order.target;
    this.effects.setMarkerCull(lead.prevPos.x + (lead.pos.x - lead.prevPos.x) * alpha,
      lead.prevPos.z + (lead.pos.z - lead.prevPos.z) * alpha, this.visionFog.hiddenBeyond);
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
    this.scenery.update(dt, state, this.camera);
    this.vehicles.setVisible(!cinematicInputLock(this.flow));
    this.vehicles.update(state, alpha, state.time);
    this.signals.update(state.time);
    this.shops.update(state, state.time);
    this.boundaryScenery?.update(state.time);
    this.scene.updateMatrixWorld(true);
  }

  /** Rebuilds the shared occluder list when the loaded chunk set (or gate state) changes; breakables sync every frame. */
  private syncOccluders(): void {
    const loaded = this.city.loadedChunkIds;
    let sig = this.sim.state.gate.destroyed ? 'g' : '';
    for (const id of loaded) sig += id + ',';
    if (sig !== this.occluderSignature) {
      this.occluderSignature = sig;
      this.visionFog.patchScene(this.scene); // new chunk meshes streamed in
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

  /** Attack-order marker position, hidden past the vision limit and never placed on an unidentified human (EW). */
  private markerFor(target: TargetRef | null, out: THREE.Vector3): boolean {
    if (target?.kind === 'guard' && this.sim.ctx.layout.strongholds.length > 0 && !canTarget(this.sim.state, target.id)) return false;
    if (!this.markerPosFor(target, out)) return false;
    const limit = this.visionFog.hiddenBeyond;
    if (!Number.isFinite(limit)) return true;
    const lead = this.sim.state.leader;
    return (out.x - lead.pos.x) ** 2 + (out.z - lead.pos.z) ** 2 < limit * limit;
  }

  private markerPosFor(target: TargetRef | null, out: THREE.Vector3): boolean {
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
    if (target?.kind === 'vehicle') {
      const v = state.vehicles.find(c => c.id === target.id && c.mode !== 'stalled');
      if (v) { out.set(v.pos.x, 2.4, v.pos.z); return true; }
      return false;
    }
    if (target?.kind === 'guard') {
      const guardId = target.id;
      const guard = state.guards.find(g => g.id === guardId && g.state !== 'DEAD' && g.hp > 0);
      if (guard) { out.set(guard.pos.x, guard.elevation + 2.2, guard.pos.z); return true; }
    }
    return false;
  }

  private updateHud(): void {
    this.updateTouchSlots();
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
    } else if (target?.kind === 'vehicle') {
      const v = this.sim.state.vehicles.find(c => c.id === target.id);
      hoverLabel = v?.kind === 'rammer' ? 'HOSTILE DRIVER' : 'CAR';
    }
    this.hud.update(this.sim.state, {
      fps: this.smoothFps, drawCalls: this.renderer.info.render.calls, showDebug: this.showDebug,
      hoverLabel,
      pointerLocked: this.input.isLocked,
      waypoint: this.waypoint,
      frameMs: this.frameMs,
      loadedChunks: this.loadedChunkCount,
      cameraYaw: this.cameraRig.viewYaw,
    });
  }

  /** Debug / profiling: zombie renderer stats (drawn, LOD split, CPU ms per frame). */
  get hordeStats(): { drawn: number; lod: readonly number[]; updateMs: number; drawCalls: number } {
    return { drawn: this.horde.drawnCount, lod: [...this.horde.lodCounts], updateMs: this.horde.updateMs,
      drawCalls: this.renderer.info.render.calls };
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

  private resetClock(): void {
    this.input.clear();
    if (this.suspended) this.touristVoices.pause(); else this.touristVoices.resume();
    this.lastTime = null;
    this.accumulator = 0;
    // The narration must not run on while the cinematic clock is frozen (hidden tab / lost focus).
    if (this.flow === 'INTRO_CINEMATIC' && !this.introExiting) {
      if (this.suspended) this.introAudio.pauseNarration();
      else this.introAudio.resumeNarration();
    }
  }
  private readonly onBlur = (): void => { this.suspended = true; this.resetClock(); };
  private readonly onFocus = (): void => { this.suspended = document.hidden; this.resetClock(); };
  private readonly onVisibility = (): void => { this.suspended = document.hidden || !document.hasFocus(); this.resetClock(); };
  private readonly onResize = (): void => {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(width, height);
    this.post.setSize(width, height, this.renderer.getPixelRatio());
  };

  private shadowCasterCount = 0;
  private shadowCountTimer = 0;

  private updateGfxDiagnostics(dt: number): void {
    if (this.lastFrameMs > 0) this.gfxDiag.pushFrame(this.lastFrameMs);
    this.gfxDiag.setVisible(this.showDebug);
    if (!this.showDebug && !this.benchmark) return;
    this.shadowCountTimer -= dt;
    if (this.shadowCountTimer <= 0) { this.shadowCountTimer = 1; this.shadowCasterCount = this.lighting.countShadowCasters(); }
    const info = this.renderer.info;
    this.gfxDiag.update(dt, {
      quality: this.graphics.quality, reducedMotion: this.graphics.reducedMotion, postfx: this.post.active,
      drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries,
      textures: info.memory.textures, particles: this.vfx.stats().live, particleCap: this.quality.maxParticles,
      shadowCasters: this.shadowCasterCount, zombiesDrawn: this.horde.drawnCount,
      humans: this.sim.state.guards.length, benchmark: this.benchmark,
    });
  }

  /** Debug / benchmark: graphics snapshot (frame-time p50/p95, calls, tris, particles...). */
  get graphicsStats(): ReturnType<GraphicsDiagnostics['snapshot']> {
    return this.gfxDiag.snapshot();
  }

  private readonly onCollectionKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.code !== 'KeyI' || cinematicInputLock(this.flow) || this.hud.isPauseVisible) return;
    if (!this.hud.isCollectionVisible) this.input.exitPointerLock();
    this.hud.toggleCollection();
  };

  /** Developer debug controls (docs/11_cityupgrade.md §11.5). */
  debugSpawnCityEvent(kind: DynamicEventKind): boolean {
    return spawnCityEvent(this.sim.ctx, kind) !== null;
  }

  debugSetDistrictAlert(districtId: DistrictId, alert: DistrictAlert): void {
    setDistrictAlert(this.sim.ctx, districtId, alert);
  }

  debugGrantBrains(amount: number): number {
    addBrains(this.sim.ctx, amount, 'debug');
    return this.sim.state.rewards.brains;
  }

  debugGrantReward(rewardId: string): boolean {
    return grantReward(this.sim.ctx, rewardId);
  }
}
