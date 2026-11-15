import './hud.css';
import './hudOpenWorld.css';
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type {
  AbilityId,
  DistrictLayout,
  GameEvent,
  GamePhase,
  GameState,
  MomentumTier,
  StructureKind,
  StructureState,
  TargetRef,
  Vec2,
} from '../core/types';
import { objectiveStatus } from '../systems/ConquestSystem';
import { DebugOverlay } from './DebugOverlay';
import { Minimap } from './Minimap';
import { NestPanel } from './NestPanel';
import { PauseMenu, type PauseCallbacks } from './PauseMenu';
import { WorldMap } from './WorldMap';
import {
  abilitySlotView,
  visibleSlotCount,
  bruteCount,
  districtName,
  followerCap,
  nearbyEquipNest,
  selectObjectiveStronghold,
  strongholdName,
  toastDedupe,
  toastForEvent,
  type ToastSpec,
} from './uiHelpers';
import { ABILITIES } from '../content/abilities';

export interface HudExtras {
  fps: number;
  drawCalls: number;
  showDebug: boolean;
  hoverLabel: string | null;
  pointerLocked?: boolean;
  /** Active map waypoint (Game owns it); drawn on minimap + world map. */
  waypoint?: Vec2 | null;
  /** Last frame time in ms (F3 overlay). */
  frameMs?: number;
  /** Number of render chunks currently loaded (F3 overlay). */
  loadedChunks?: number;
}

const TIER_RANK: Record<MomentumTier, number> = {
  dormant: 0,
  growing: 1,
  full: 2,
};

const TIER_LABEL: Record<MomentumTier, string> = {
  dormant: 'DORMANT',
  growing: 'GROWING OUTBREAK',
  full: 'FULL OUTBREAK',
};

export function structureHudLabel(kind: StructureKind): string {
  switch (kind) {
    case 'busDoor':
      return 'BUS DOOR';
    case 'alleyGate':
      return 'ALLEY GATE';
    case 'storeDoor':
      return 'STORE DOOR';
    case 'stationDoor':
      return 'STATION DOOR';
    case 'securityShutter':
      return 'SECURITY SHUTTER';
    case 'penGate':
    default:
      return 'PEN GATE';
  }
}

function structureBarTitle(kind: StructureKind): string {
  switch (kind) {
    case 'busDoor':
      return 'Bus Door';
    case 'alleyGate':
      return 'Alley Gate';
    case 'storeDoor':
      return 'Store Door';
    case 'stationDoor':
      return 'Station Door';
    case 'securityShutter':
      return 'Security Shutter';
    case 'penGate':
    default:
      return 'Pen Gate';
  }
}

function helpRows(openWorld: boolean): string {
  const rows: [string, string][] = openWorld
    ? [
        ['W A S D / Arrows', 'Move relative to camera'],
        ['Shift', 'Sprint while stamina allows'],
        ['Left-Click', 'Alpha attack: bite (3-hit claw combo with Alpha Claws). First click captures the mouse'],
        ['Right-Click target', 'Horde attack order (Ctrl+RMB adds / removes a split target)'],
        ['Right-Click ground', 'Horde move order (marker; reverts to follow)'],
        ['Space', 'Rally / regroup: pull and recruit nearby walkers'],
        ['G', 'Recall: the whole horde follows you'],
        ['Q E R F', 'Activate the mutation in that slot (Rush from the suburb checkpoint, then Frenzy, Claws, Brutes)'],
        ['Nest', 'Stand near an active nest to change your slot loadout'],
        ['M', 'World map: click to set / clear a waypoint'],
        ['Esc', 'Pause menu: save, reset save, sound'],
        ['Mouse (captured)', 'Orbit & tilt camera; C recenters, V look back, Z / X turn, wheel zooms'],
        ['Tab', 'Toggle this controls panel'],
        ['F3', 'Toggle debug overlay'],
      ]
    : [];
  return rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

export class HUD {
  private readonly root: HTMLElement;
  private readonly container: HTMLDivElement;

  // Top-left elements
  private readonly hpValueEl: HTMLSpanElement;
  private readonly hpFillEl: HTMLDivElement;
  private readonly staminaValueEl: HTMLSpanElement;
  private readonly staminaFillEl: HTMLDivElement;
  private readonly bioValueEl: HTMLSpanElement;
  private readonly trackerEl: HTMLDivElement;
  private readonly bruteEl: HTMLDivElement;
  private readonly slotsEl: HTMLDivElement;
  private readonly slotEls: {
    root: HTMLDivElement;
    name: HTMLSpanElement;
    key: HTMLSpanElement;
    state: HTMLDivElement;
    sweep: HTMLDivElement;
  }[] = [];
  private readonly savedTickEl: HTMLDivElement;
  private readonly respawnOverlayEl: HTMLDivElement;
  private readonly respawnCountEl: HTMLDivElement;
  private readonly respawnSubEl: HTMLDivElement;
  private readonly debugOverlay: DebugOverlay;

  // Top-center elements
  private readonly objectiveSubEl: HTMLDivElement;
  private readonly gateBarEl: HTMLDivElement;
  private readonly gateLabelEl: HTMLSpanElement;
  private readonly gateValueEl: HTMLSpanElement;
  private readonly gateFillEl: HTMLDivElement;
  private readonly toastStackEl: HTMLDivElement;

  // Top-right elements
  private readonly hordeCountEl: HTMLDivElement;
  private readonly hordeFloaterEl: HTMLSpanElement;
  private readonly capFlashEl: HTMLDivElement;
  private readonly momBoxEl: HTMLDivElement;
  private readonly momTierEl: HTMLSpanElement;
  private readonly momValEl: HTMLSpanElement;
  private readonly momFillEl: HTMLDivElement;
  private readonly guardsCountEl: HTMLDivElement;

  // Center hover label & crosshair
  private readonly hoverLabelEl: HTMLDivElement;
  private readonly crosshairEl: HTMLDivElement;
  private readonly captureHintEl: HTMLDivElement;

  // Bottom-left order pill
  private readonly orderPillEl: HTMLDivElement;
  private readonly orderTextEl: HTMLSpanElement;

  // Bottom-center ability cards
  private readonly rallyCardEl: HTMLDivElement;
  private readonly rallyStateEl: HTMLDivElement;
  private readonly rallyFillEl: HTMLDivElement;
  private readonly rushCardEl: HTMLDivElement;
  private readonly rushStateEl: HTMLDivElement;
  private readonly rushFillEl: HTMLDivElement;

  // Bottom-right control reminder
  private readonly bottomRightEl: HTMLDivElement;

  // Help & Overlays
  private readonly helpPanelEl: HTMLDivElement;
  private readonly helpTableBodyEl: HTMLElement;
  private readonly introOverlayEl: HTMLDivElement;
  private readonly victoryOverlayEl: HTMLDivElement;
  private readonly victoryStatsEl: HTMLDivElement;
  private readonly defeatOverlayEl: HTMLDivElement;
  private readonly defeatStatsEl: HTMLDivElement;
  private readonly victoryBtn: HTMLButtonElement;
  private readonly defeatBtn: HTMLButtonElement;

  private _introVisible = true;
  private helpVisible = false;
  private readonly toastTimers = new Set<number>();
  private savedTimer: number | null = null;

  // Open-world state (null layout = legacy single-district mode)
  private layout: DistrictLayout | null = null;
  private minimap: Minimap | null = null;
  private worldMap: WorldMap | null = null;
  private pauseMenu: PauseMenu | null = null;
  private nestPanel: NestPanel | null = null;
  private readonly toastByEl = new Map<HTMLElement, number>();
  private readonly buySlotCallbacks: (() => void)[] = [];
  private prevSlotStripCount = -1;
  private readonly waypointCallbacks: ((p: Vec2 | null) => void)[] = [];
  private readonly equipCallbacks: ((slot: number, ability: AbilityId | null) => void)[] = [];
  private pendingPauseCallbacks: PauseCallbacks = {};
  private muted = false;
  private readonly deniedUntilMs: number[] = [0, 0, 0, 0];
  private readonly prevSlotSig: string[] = ['', '', '', ''];
  private readonly prevSlotDenied: boolean[] = [false, false, false, false];
  private prevBioText = '';
  private prevBruteText = '';
  private prevTrackerSig = '';
  private lastTrackerMs = -1e9;
  private prevRespawnText = '';
  private prevRespawnVisible = false;
  private readonly restartCallbacks: (() => void)[] = [];
  private readonly introDismissCallbacks: (() => void)[] = [];

  // Cached values to avoid redundant DOM writes
  private prevSimTime = -1;
  private prevHpText = '';
  private prevHpPct = -1;
  private prevHpLow = false;
  private prevStamText = '';
  private prevStamPct = -1;
  private prevExhausted = false;
  private prevObjectiveSub = '';
  private prevGateVisible = false;
  private prevGateLabel = '';
  private prevGateText = '';
  private prevGatePct = -1;
  private prevHordeText = '';
  private prevFollowerCount: number | null = null;
  private floaterAccum = 0;
  private floaterWindowEndMs = 0;
  private floaterHideAtMs = 0;
  private hordePopUntilMs = 0;
  private prevCapVisible = false;
  private prevMomPct = -1;
  private prevMomValText = '';
  private prevMomTierClass: MomentumTier = 'dormant';
  private prevMomentumTier: MomentumTier = 'dormant';
  private momGainFlashUntilMs = 0;
  private momTierUpUntilMs = 0;
  private prevMomGainActive = false;
  private prevMomTierUpActive = false;
  private prevGuardsText = '';
  private prevHoverLabel: string | null = null;
  private prevCrosshairVisible = false;
  private prevCrosshairTarget = false;
  private prevCaptureHintVisible = false;
  private prevPointerLocked: boolean | null = null;
  private prevOrderText = '';
  private prevOrderAttack = false;
  /** Last state seen by update(); consume() runs before update() each frame. */
  private lastState: GameState | null = null;
  private prevRallyState = '';
  private prevRallyPct = -1;
  private prevRallyCd = false;
  private prevRushState = '';
  private prevRushPct = -1;
  private prevRushMode = '';
  private prevPhase: GamePhase = 'playing';

  private readonly onIntroClick = (): void => {
    this.hideIntro();
    // This pointerdown is a real user gesture, so listeners may capture the mouse here ("click to begin").
    for (const cb of this.introDismissCallbacks) cb();
  };

  private readonly onRestartClick = (): void => {
    for (const cb of this.restartCallbacks) {
      cb();
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = '';

    this.container = document.createElement('div');
    this.container.className = 'ibz-hud';

    this.container.innerHTML = `
      <div class="ibz-panel ibz-top-left">
        <div class="ibz-bar-row">
          <div class="ibz-bar-header">
            <span class="ibz-bar-label">Leader HP</span>
            <span class="ibz-bar-value" data-ref="hpVal">100 / 100</span>
          </div>
          <div class="ibz-bar-track">
            <div class="ibz-bar-fill ibz-hp-fill" data-ref="hpFill"></div>
          </div>
        </div>
        <div class="ibz-bar-row">
          <div class="ibz-bar-header">
            <span class="ibz-bar-label">Stamina</span>
            <span class="ibz-bar-value" data-ref="stamVal">100%</span>
          </div>
          <div class="ibz-bar-track">
            <div class="ibz-bar-fill ibz-stamina-fill" data-ref="stamFill"></div>
          </div>
        </div>
        <div class="ibz-bar-row ibz-ow-only">
          <div class="ibz-bar-header">
            <span class="ibz-bar-label">Biomass</span>
            <span class="ibz-bar-value" data-ref="bioVal">0</span>
          </div>
        </div>
      </div>

      <div class="ibz-panel ibz-ow-only ibz-tracker" data-ref="tracker"></div>

      <div class="ibz-top-center">
        <div class="ibz-panel ibz-objective-card ibz-legacy-only">
          <div class="ibz-objective-title">CAPTURE THE CHECKPOINT</div>
          <div class="ibz-objective-sub" data-ref="objSub">Free the bus horde</div>
        </div>
        <div class="ibz-panel ibz-gate-bar" data-ref="gateBar">
          <div class="ibz-bar-header">
            <span class="ibz-bar-label" data-ref="gateLabel">Checkpoint Gate</span>
            <span class="ibz-bar-value" data-ref="gateVal">${BALANCE.gate.maxHp} / ${BALANCE.gate.maxHp}</span>
          </div>
          <div class="ibz-bar-track">
            <div class="ibz-bar-fill ibz-gate-fill" data-ref="gateFill"></div>
          </div>
        </div>
        <div class="ibz-toast-stack" data-ref="toastStack"></div>
      </div>

      <div class="ibz-panel ibz-top-right">
        <div class="ibz-horde-row">
          <span class="ibz-horde-floater" data-ref="hordeFloater">+1</span>
          <div class="ibz-horde-count" data-ref="hordeCount">HORDE 5 / 100</div>
        </div>
        <div class="ibz-brutes ibz-ow-only" data-ref="brutes"></div>
        <div class="ibz-cap-flash" data-ref="capFlash">HORDE FULL</div>
        <div class="ibz-momentum-box" data-ref="momBox">
          <div class="ibz-momentum-header">
            <span class="ibz-momentum-tier is-dormant" data-ref="momTier">DORMANT</span>
            <span class="ibz-momentum-val" data-ref="momVal">0%</span>
          </div>
          <div class="ibz-momentum-track">
            <div class="ibz-momentum-fill is-dormant" data-ref="momFill"></div>
          </div>
        </div>
        <div class="ibz-guards-count ibz-legacy-only" data-ref="guardsCount">GUARDS 8 / 8</div>
      </div>

      <div class="ibz-hover-label" data-ref="hoverLabel"></div>
      <div class="ibz-crosshair" data-ref="crosshair"></div>
      <div class="ibz-capture-hint" data-ref="captureHint">Click to capture mouse</div>

      <div class="ibz-bottom-left">
        <div class="ibz-panel ibz-order-pill" data-ref="orderPill">
          <span class="ibz-order-dot"></span>
          <span data-ref="orderText">FOLLOWING</span>
        </div>
      </div>

      <div class="ibz-bottom-center">
        <div class="ibz-panel ibz-ability-card ibz-legacy-only" data-ref="rallyCard">
          <div class="ibz-ability-top">
            <span class="ibz-key-badge">E</span>
            <span class="ibz-ability-name">RALLY</span>
          </div>
          <div class="ibz-ability-state" data-ref="rallyState">READY</div>
          <div class="ibz-ability-cd-fill" data-ref="rallyFill"></div>
        </div>

        <div class="ibz-panel ibz-ability-card ibz-legacy-only" data-ref="rushCard">
          <div class="ibz-ability-top">
            <span class="ibz-key-badge">SPACE</span>
            <span class="ibz-ability-name">RUSH</span>
          </div>
          <div class="ibz-ability-state" data-ref="rushState">READY</div>
          <div class="ibz-ability-cd-fill" data-ref="rushFill"></div>
        </div>

        <div class="ibz-slots ibz-ow-only" data-ref="slots"></div>
      </div>

      <div class="ibz-saved-tick" data-ref="savedTick">SAVED</div>

      <div class="ibz-panel ibz-bottom-right" data-ref="bottomRight">
        Click to capture mouse &middot; WASD move &middot; Shift sprint &middot; LMB select/unselect targets &middot; RMB follow &middot; Drag/Z/X look &middot; V look back &middot; Tab help
      </div>

      <div class="ibz-help-panel" data-ref="helpPanel">
        <h3 class="ibz-help-title">Controls &amp; Commands</h3>
        <table class="ibz-help-table">
          <tbody>
            <tr><td>W A S D / Arrows</td><td>Move leader relative to camera</td></tr>
            <tr><td>Shift</td><td>Sprint while stamina allows</td></tr>
            <tr><td>Left-Click (Unlocked)</td><td>Capture mouse for camera look</td></tr>
            <tr><td>Mouse Move (Captured)</td><td>Orbit &amp; tilt camera (stays where you leave it until C)</td></tr>
            <tr><td>Left-Click Target</td><td>Select / unselect target at centre crosshair (or cursor when unlocked) &mdash; horde splits across selected targets</td></tr>
            <tr><td>Landmarks</td><td>Break the bus door / alley gate / store door / pen gate to free or reach whoever is inside</td></tr>
            <tr><td>Outbreak Momentum</td><td>Recruit, convert, kill soldiers &amp; break barriers to boost recruit radius (+50%) and horde speed (+20%)</td></tr>
            <tr><td>Left-Click Ground</td><td>World ping at centre crosshair (or cursor when unlocked)</td></tr>
            <tr><td>Right-Click</td><td>Recall horde to Follow leader</td></tr>
            <tr><td>Esc</td><td>Release captured mouse</td></tr>
            <tr><td>Left / Right-Drag</td><td>Orbit &amp; tilt camera when mouse is not captured</td></tr>
            <tr><td>Z / X</td><td>Rotate camera left / right</td></tr>
            <tr><td>Hold V</td><td>Look back at your horde</td></tr>
            <tr><td>Mouse Wheel</td><td>Zoom camera (close / tactical view)</td></tr>
            <tr><td>E</td><td>Rally pulse (recruit within 15 m)</td></tr>
            <tr><td>Space</td><td>Horde Rush (+45% speed, +25% attack rate)</td></tr>
            <tr><td>C</td><td>Recenter camera behind leader (resumes auto-follow)</td></tr>
            <tr><td>Tab</td><td>Toggle this controls panel</td></tr>
            <tr><td>F3</td><td>Toggle performance debug stats</td></tr>
            <tr><td>M</td><td>Mute / unmute audio</td></tr>
            <tr><td>R</td><td>Restart game (on win/loss screen)</td></tr>
          </tbody>
        </table>
      </div>

      <div class="ibz-overlay is-visible" data-ref="introOverlay">
        <div class="ibz-modal">
          <h1 class="ibz-modal-title">I BE ZOMBIE</h1>
          <p class="ibz-modal-pitch">
            You are the undead alpha in a quarantined city district.<br/>
            Break open the bus, locked alley, store, and police pen to trigger cascading recruitment,<br/>
            build outbreak momentum, breach the northeast checkpoint gate, and convert the defenders.
          </p>
          <div class="ibz-intro-keys">
            <div><strong>WASD + Shift</strong> Move &amp; Sprint</div>
            <div><strong>Mouse / Wheel / V</strong> Look Around, Zoom, Look Back</div>
            <div><strong>Left-Click</strong> Capture Mouse &amp; Target</div>
            <div><strong>Right-Click</strong> Recall to Follow</div>
            <div><strong>E</strong> Rally Nearby Walkers</div>
            <div><strong>Space</strong> Trigger Horde Rush</div>
          </div>
          <div class="ibz-begin-prompt">Move or click to begin</div>
        </div>
      </div>

      <div class="ibz-overlay ibz-respawn" data-ref="respawnOverlay">
        <div class="ibz-modal is-defeat">
          <h1 class="ibz-modal-title">THE ALPHA FALLS</h1>
          <p class="ibz-modal-pitch" data-ref="respawnSub">The horde remembers. You will rise again at your nest.</p>
          <div class="ibz-respawn-count" data-ref="respawnCount">4</div>
        </div>
      </div>

      <div class="ibz-overlay" data-ref="victoryOverlay">
        <div class="ibz-modal">
          <h1 class="ibz-modal-title">CHECKPOINT OVERRUN</h1>
          <p class="ibz-modal-pitch">The human outpost has fallen to your undead swarm.</p>
          <div class="ibz-stats-grid" data-ref="victoryStats"></div>
          <button type="button" class="ibz-restart-btn" data-ref="victoryBtn">Restart</button>
          <div class="ibz-restart-hint">or press R</div>
        </div>
      </div>

      <div class="ibz-overlay" data-ref="defeatOverlay">
        <div class="ibz-modal is-defeat">
          <h1 class="ibz-modal-title">THE LEADER HAS FALLEN</h1>
          <p class="ibz-modal-pitch">Without you, the horde scatters back into the shadows.</p>
          <div class="ibz-stats-grid" data-ref="defeatStats"></div>
          <button type="button" class="ibz-restart-btn" data-ref="defeatBtn">Restart</button>
          <div class="ibz-restart-hint">or press R</div>
        </div>
      </div>
    `;

    this.root.appendChild(this.container);

    const q = <T extends HTMLElement>(ref: string): T =>
      this.container.querySelector(`[data-ref="${ref}"]`) as T;

    this.hpValueEl = q('hpVal');
    this.hpFillEl = q('hpFill');
    this.staminaValueEl = q('stamVal');
    this.staminaFillEl = q('stamFill');
    this.bioValueEl = q('bioVal');
    this.trackerEl = q('tracker');
    this.bruteEl = q('brutes');
    this.slotsEl = q('slots');
    this.savedTickEl = q('savedTick');
    this.respawnOverlayEl = q('respawnOverlay');
    this.respawnCountEl = q('respawnCount');
    this.respawnSubEl = q('respawnSub');
    this.objectiveSubEl = q('objSub');
    this.gateBarEl = q('gateBar');
    this.gateLabelEl = q('gateLabel');
    this.gateValueEl = q('gateVal');
    this.gateFillEl = q('gateFill');
    this.toastStackEl = q('toastStack');
    this.hordeCountEl = q('hordeCount');
    this.hordeFloaterEl = q('hordeFloater');
    this.capFlashEl = q('capFlash');
    this.momBoxEl = q('momBox');
    this.momTierEl = q('momTier');
    this.momValEl = q('momVal');
    this.momFillEl = q('momFill');
    this.guardsCountEl = q('guardsCount');
    this.hoverLabelEl = q('hoverLabel');
    this.crosshairEl = q('crosshair');
    this.captureHintEl = q('captureHint');
    this.orderPillEl = q('orderPill');
    this.orderTextEl = q('orderText');
    this.rallyCardEl = q('rallyCard');
    this.rallyStateEl = q('rallyState');
    this.rallyFillEl = q('rallyFill');
    this.rushCardEl = q('rushCard');
    this.rushStateEl = q('rushState');
    this.rushFillEl = q('rushFill');
    this.bottomRightEl = q('bottomRight');
    this.helpPanelEl = q('helpPanel');
    this.helpTableBodyEl = this.helpPanelEl.querySelector('tbody') as HTMLElement;
    this.introOverlayEl = q('introOverlay');
    this.victoryOverlayEl = q('victoryOverlay');
    this.victoryStatsEl = q('victoryStats');
    this.defeatOverlayEl = q('defeatOverlay');
    this.defeatStatsEl = q('defeatStats');
    this.victoryBtn = q('victoryBtn');
    this.defeatBtn = q('defeatBtn');

    this.introOverlayEl.addEventListener('pointerdown', this.onIntroClick);
    this.victoryBtn.addEventListener('click', this.onRestartClick);
    this.defeatBtn.addEventListener('click', this.onRestartClick);

    const keys = ['Q', 'E', 'R', 'F'];
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'ibz-panel ibz-slot is-empty';
      el.innerHTML = `<div class="ibz-slot-sweep"></div>
        <div class="ibz-slot-top"><span class="ibz-key-badge">${keys[i]}</span><span class="ibz-slot-name">Empty</span></div>
        <div class="ibz-slot-state">EQUIP AT A NEST</div>`;
      this.slotsEl.appendChild(el);
      this.slotEls.push({
        root: el,
        name: el.querySelector('.ibz-slot-name') as HTMLSpanElement,
        key: el.querySelector('.ibz-key-badge') as HTMLSpanElement,
        state: el.querySelector('.ibz-slot-state') as HTMLDivElement,
        sweep: el.querySelector('.ibz-slot-sweep') as HTMLDivElement,
      });
    }
    this.debugOverlay = new DebugOverlay(this.container);
  }

  // ---------------------------------------------------------------------------
  // Open-world API (T013). All optional: without setWorld() the HUD behaves as the legacy single-district HUD.
  // ---------------------------------------------------------------------------

  /**
   * Switch the HUD to open-world mode and (re)bind it to the world layout. Call once after the Simulation exists
   * and again after any restart/reset-with-new-simulation (layout object may be the same; static map layers are invalidated).
   * `firstRun` = no save was loaded: the intro card shows the full controls onboarding.
   */
  setWorld(layout: DistrictLayout, opts: { firstRun?: boolean } = {}): void {
    this.layout = layout;
    this.container.classList.add('is-open-world');
    if (!this.minimap) {
      this.minimap = new Minimap(this.container, layout);
      this.worldMap = new WorldMap(this.container, layout);
      this.worldMap.onClose(() => this.hideMap());
      this.worldMap.onWaypoint((p) => {
        for (const cb of this.waypointCallbacks) cb(p);
      });
      this.nestPanel = new NestPanel(this.container);
      this.nestPanel.onEquip((slot, ability) => {
        for (const cb of this.equipCallbacks) cb(slot, ability);
      });
      this.nestPanel.onBuySlot(() => {
        for (const cb of this.buySlotCallbacks) cb();
      });
      this.pauseMenu = new PauseMenu(this.container);
      this.pauseMenu.setCallbacks(this.pendingPauseCallbacks);
      this.pauseMenu.setMuted(this.muted);
    } else {
      this.minimap.setLayout(layout);
      this.worldMap?.setLayout(layout);
    }
    this.prevTrackerSig = '';
    this.lastTrackerMs = -1e9;
    this.prevPointerLocked = null;
    this.setIntroContent(opts.firstRun !== false);
    this.helpTableBodyEl.innerHTML = helpRows(true);
  }

  get isOpenWorld(): boolean {
    return this.layout !== null;
  }

  /** Waypoint set/cleared from the world map (null = clear). Game stores it and passes it back via HudExtras.waypoint. */
  onWaypoint(cb: (p: Vec2 | null) => void): void {
    this.waypointCallbacks.push(cb);
  }

  /** Nest panel loadout change request. Game forwards it as SimInput.equip = { slot, ability } on the next step. */
  onEquip(cb: (slot: number, ability: AbilityId | null) => void): void {
    this.equipCallbacks.push(cb);
  }

  /** Nest panel "Buy slot" request. Game forwards it as SimInput.buySlot = true for exactly one step. */
  onBuySlot(cb: () => void): void {
    this.buySlotCallbacks.push(cb);
  }

  /** Pause menu button callbacks (Continue / Save / Reset Save [confirmed] / mute toggle). Safe to call before setWorld. */
  setPauseCallbacks(cb: PauseCallbacks): void {
    this.pendingPauseCallbacks = cb;
    this.pauseMenu?.setCallbacks(cb);
  }

  get isPauseVisible(): boolean {
    return this.pauseMenu?.visible ?? false;
  }

  showPause(): void {
    this.worldMap?.hide();
    this.pauseMenu?.show();
  }

  hidePause(): void {
    this.pauseMenu?.hide();
  }

  togglePause(): void {
    if (this.isPauseVisible) this.hidePause();
    else this.showPause();
  }

  /** Brief message inside the pause menu ("Saved", "Save failed"...). */
  notifyPause(msg: string): void {
    this.pauseMenu?.notify(msg);
  }

  /** Keep the pause menu's mute button label in sync with AudioSystem.muted. */
  setMuted(m: boolean): void {
    this.muted = m;
    this.pauseMenu?.setMuted(m);
  }

  get isMapVisible(): boolean {
    return this.worldMap?.visible ?? false;
  }

  showMap(): void {
    if (this.isPauseVisible) return;
    this.worldMap?.show();
  }

  hideMap(): void {
    this.worldMap?.hide();
  }

  toggleMap(): void {
    if (this.isMapVisible) this.hideMap();
    else this.showMap();
  }

  /** True while the nest loadout panel is on screen (leader near an active nest). */
  get isNestPanelVisible(): boolean {
    return this.nestPanel?.visible ?? false;
  }

  /** Forward a key (event.key) here while isNestPanelVisible: 1-4 select slot, [ ] cycle. Returns true if consumed. */
  handleNestKey(key: string): boolean {
    return this.nestPanel?.handleKey(key) ?? false;
  }

  /** True when any interactive overlay (pause menu, world map, intro) wants the mouse cursor. */
  get isModalOpen(): boolean {
    return this.isPauseVisible || this.isMapVisible || this._introVisible;
  }

  /** Small "SAVED" tick (also shown automatically on the `autosave` event). */
  showSaved(): void {
    this.savedTickEl.classList.add('is-visible');
    if (this.savedTimer !== null) window.clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      this.savedTickEl.classList.remove('is-visible');
      this.savedTimer = null;
    }, 1400);
  }

  private setIntroContent(firstRun: boolean): void {
    const modal = this.introOverlayEl.querySelector('.ibz-modal');
    if (!modal) return;
    modal.innerHTML = firstRun
      ? `<h1 class="ibz-modal-title">I BE ZOMBIE</h1>
          <p class="ibz-modal-pitch">
            You are the Alpha. Infect the suburbs, lead a horde of up to ${BALANCE.openWorld.maxFollowers},
            conquer four human strongholds and take over the city.
          </p>
          <div class="ibz-intro-keys">
            <div><strong>WASD / Shift</strong> Move / sprint</div>
            <div><strong>LMB</strong> Bite &amp; claw (Alpha attack)</div>
            <div><strong>RMB</strong> Horde attack / move order</div>
            <div><strong>Space</strong> Rally the horde</div>
            <div><strong>Q E R F</strong> Mutation slots</div>
            <div><strong>M</strong> World map</div>
            <div><strong>G</strong> Recall horde to follow</div>
            <div><strong>Esc</strong> Pause &amp; save</div>
          </div>
          <div class="ibz-begin-prompt">Move or click to begin</div>`
      : `<h1 class="ibz-modal-title">I BE ZOMBIE</h1>
          <p class="ibz-modal-pitch">Your conquest continues. The horde is waiting at the nest.</p>
          <div class="ibz-begin-prompt">Move or click to continue</div>`;
  }

  get introVisible(): boolean {
    return this._introVisible;
  }

  get isHelpVisible(): boolean {
    return this.helpVisible;
  }

  showIntro(): void {
    if (!this._introVisible) {
      this._introVisible = true;
      this.introOverlayEl.classList.add('is-visible');
    }
  }

  hideIntro(): void {
    if (this._introVisible) {
      this._introVisible = false;
      this.introOverlayEl.classList.remove('is-visible');
    }
  }

  /** Opening cinematic: hide the whole gameplay HUD (the cinematic overlay lives outside this container). */
  setCinematic(on: boolean): void {
    this.container.classList.toggle('is-cinematic', on);
    if (on) {
      this.hideIntro();
      if (this.helpVisible) this.toggleHelp();
      this.worldMap?.hide();
      this.clearToasts();
    }
  }

  toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    this.helpPanelEl.classList.toggle('is-visible', this.helpVisible);
  }

  /** Called when the player clicks the intro overlay to begin (inside the click gesture). */
  onIntroDismissed(cb: () => void): void {
    this.introDismissCallbacks.push(cb);
  }

  onRestart(cb: () => void): void {
    this.restartCallbacks.push(cb);
  }

  reset(): void {
    this.prevMomentumTier = 'dormant';
    this.prevFollowerCount = null;
    this.floaterAccum = 0;
    this.floaterWindowEndMs = 0;
    this.floaterHideAtMs = 0;
    this.hordePopUntilMs = 0;
    this.momGainFlashUntilMs = 0;
    this.momTierUpUntilMs = 0;
    this.hordeCountEl.classList.remove('is-pop');
    this.hordeFloaterEl.classList.remove('is-visible');
    this.momBoxEl.classList.remove('is-gain');
    this.momTierEl.classList.remove('is-tier-up');
    this.prevMomGainActive = false;
    this.prevMomTierUpActive = false;
    this.clearToasts();
    this.helpVisible = false;
    this.helpPanelEl.classList.remove('is-visible');
    this.prevTrackerSig = '';
    this.lastTrackerMs = -1e9;
    this.minimap?.invalidate();
    this.worldMap?.hide();
    this.pauseMenu?.hide();
    for (let i = 0; i < 4; i++) this.deniedUntilMs[i] = 0;
  }

  consume(events: readonly GameEvent[]): void {
    const nowMs = performance.now();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'orderChanged') {
        if (ev.order.type === 'follow') {
          this.showToast('RECALL: FOLLOWING LEADER');
        } else if (ev.order.type === 'move') {
          this.showToast('MOVE ORDER');
        } else if ((this.lastState?.squads.length ?? 0) > 0) {
          this.showToast(`HORDE SPLIT: ${this.lastState!.squads.length + 1} TARGETS`);
        } else {
          this.showToast(`ATTACK ORDER: ${this.describeTargetLabel(ev.order.target)}`);
        }
      } else if (ev.type === 'capReached') {
        this.showToast(`HORDE CAPACITY REACHED (${followerCap(this.layout)})`);
      } else if (ev.type === 'gateDestroyed') {
        this.showToast('CHECKPOINT GATE BREACHED!');
      } else if (ev.type === 'structureDestroyed') {
        this.showToast(`${structureHudLabel(ev.kind)} BREACHED!`);
      } else if (ev.type === 'converted') {
        if (!this.layout) this.showToast('HUMAN CONVERTED TO HORDE!');
      } else if (ev.type === 'rushStart') {
        this.showToast('HORDE RUSH ACTIVATED!');
      } else if (ev.type === 'frenzyStart') {
        this.showToast('HORDE FRENZY!', 'good');
      } else if (ev.type === 'bruteEvolved') {
        this.showToast('A follower evolves into a Brute', 'good');
      } else if (ev.type === 'autosave') {
        this.showSaved();
      } else if (ev.type === 'abilityDenied') {
        this.flashDenied(ev.abilityId);
        const t = toastForEvent(ev);
        if (t) this.pushToast(t);
      } else if (this.layout && ev.type !== 'momentumGain' && ev.type !== 'momentumTier') {
        const t = toastForEvent(ev, this.lastState);
        if (t) this.pushToast(t);
      } else if (ev.type === 'momentumGain') {
        this.momGainFlashUntilMs = nowMs + 420;
      } else if (ev.type === 'momentumTier') {
        const prevRank = TIER_RANK[this.prevMomentumTier] ?? 0;
        const nextRank = TIER_RANK[ev.tier] ?? 0;
        this.prevMomentumTier = ev.tier;
        // Tier-up is toast-free: only animate the tier label on increase
        if (nextRank > prevRank) {
          this.momTierUpUntilMs = nowMs + 650;
        }
      }
    }
  }

  private flashDenied(id: AbilityId | null): void {
    const until = performance.now() + 600;
    const eq = this.lastState?.progression.equipped;
    for (let i = 0; i < 4; i++) {
      const slotId = eq ? (eq[i] ?? null) : null;
      if (id === null ? slotId === null : slotId === id) this.deniedUntilMs[i] = until;
    }
  }

  update(state: GameState, extras: HudExtras): void {
    const nowMs = performance.now();
    if (this.prevSimTime >= 0 && state.time < this.prevSimTime) {
      this.reset();
    }
    this.prevSimTime = state.time;
    this.lastState = state;

    // 1. Leader HP & Stamina
    const hp = Math.max(0, Math.ceil(state.leader.hp));
    const maxHp = state.leader.maxHp;
    const hpText = `${hp} / ${maxHp}`;
    if (hpText !== this.prevHpText) {
      this.prevHpText = hpText;
      this.hpValueEl.textContent = hpText;
    }
    const hpPct = Math.max(
      0,
      Math.min(100, Math.round((state.leader.hp / Math.max(1, maxHp)) * 100)),
    );
    if (hpPct !== this.prevHpPct) {
      this.prevHpPct = hpPct;
      this.hpFillEl.style.width = `${hpPct}%`;
    }
    const hpLow = hpPct <= 30;
    if (hpLow !== this.prevHpLow) {
      this.prevHpLow = hpLow;
      this.hpFillEl.classList.toggle('is-low', hpLow);
    }

    const stamPct = Math.max(
      0,
      Math.min(100, Math.round((state.leader.stamina / BALANCE.leader.staminaMax) * 100)),
    );
    const stamText = state.leader.exhausted ? `EXHAUSTED (${stamPct}%)` : `${stamPct}%`;
    if (stamText !== this.prevStamText) {
      this.prevStamText = stamText;
      this.staminaValueEl.textContent = stamText;
    }
    if (stamPct !== this.prevStamPct) {
      this.prevStamPct = stamPct;
      this.staminaFillEl.style.width = `${stamPct}%`;
    }
    if (state.leader.exhausted !== this.prevExhausted) {
      this.prevExhausted = state.leader.exhausted;
      this.staminaFillEl.classList.toggle('is-exhausted', state.leader.exhausted);
    }

    // 2. Top-Center Objective Status & Gate / Structure HP Bar
    const objSub = this.chooseObjectiveText(state);
    if (objSub !== this.prevObjectiveSub) {
      this.prevObjectiveSub = objSub;
      this.objectiveSubEl.textContent = objSub;
    }

    this.updateGateOrStructureBar(state);

    // 3. Top-Right Horde Counter (with pop + aggregated +N floater)
    if (this.prevFollowerCount === null) {
      this.prevFollowerCount = state.followerCount;
    } else if (state.followerCount > this.prevFollowerCount) {
      const gained = state.followerCount - this.prevFollowerCount;
      this.prevFollowerCount = state.followerCount;
      if (nowMs <= this.floaterWindowEndMs) {
        this.floaterAccum += gained;
      } else {
        this.floaterAccum = gained;
      }
      this.floaterWindowEndMs = nowMs + 500;
      this.floaterHideAtMs = nowMs + 950;
      this.hordeFloaterEl.textContent = `+${this.floaterAccum}`;
      this.hordeFloaterEl.classList.add('is-visible');
      this.hordeCountEl.classList.add('is-pop');
      this.hordePopUntilMs = nowMs + 220;
    } else if (state.followerCount < this.prevFollowerCount) {
      this.prevFollowerCount = state.followerCount;
    }

    if (this.hordePopUntilMs > 0 && nowMs >= this.hordePopUntilMs) {
      this.hordePopUntilMs = 0;
      this.hordeCountEl.classList.remove('is-pop');
    }
    if (this.floaterHideAtMs > 0 && nowMs >= this.floaterHideAtMs) {
      this.floaterHideAtMs = 0;
      this.floaterAccum = 0;
      this.hordeFloaterEl.classList.remove('is-visible');
    }

    const hordeText = `HORDE ${state.followerCount} / ${followerCap(this.layout)}`;
    if (hordeText !== this.prevHordeText) {
      this.prevHordeText = hordeText;
      this.hordeCountEl.textContent = hordeText;
    }

    const capVis = state.capReachedFlash > 0;
    if (capVis !== this.prevCapVisible) {
      this.prevCapVisible = capVis;
      this.capFlashEl.classList.toggle('is-visible', capVis);
    }

    // 3b. Momentum Meter
    const mom = state.momentum ?? { value: 0, idleTime: 0, tier: 'dormant' as MomentumTier, gainFlash: 0 };
    const momPct = Math.max(
      0,
      Math.min(100, Math.round((mom.value / Math.max(1, BALANCE.momentum.max)) * 100)),
    );
    if (momPct !== this.prevMomPct) {
      this.prevMomPct = momPct;
      this.momFillEl.style.width = `${momPct}%`;
    }
    const momValText = `${momPct}%`;
    if (momValText !== this.prevMomValText) {
      this.prevMomValText = momValText;
      this.momValEl.textContent = momValText;
    }

    const tier: MomentumTier = mom.tier ?? 'dormant';
    // Also detect tier increases directly from state in case momentumTier event wasn't emitted
    if (TIER_RANK[tier] > TIER_RANK[this.prevMomentumTier]) {
      this.momTierUpUntilMs = nowMs + 650;
    }
    this.prevMomentumTier = tier;

    if (tier !== this.prevMomTierClass) {
      this.momTierEl.classList.remove(`is-${this.prevMomTierClass}`);
      this.momFillEl.classList.remove(`is-${this.prevMomTierClass}`);
      this.prevMomTierClass = tier;
      this.momTierEl.classList.add(`is-${tier}`);
      this.momFillEl.classList.add(`is-${tier}`);
      this.momTierEl.textContent = TIER_LABEL[tier];
    }

    const gainActive = (mom.gainFlash ?? 0) > 0 || nowMs < this.momGainFlashUntilMs;
    if (gainActive !== this.prevMomGainActive) {
      this.prevMomGainActive = gainActive;
      this.momBoxEl.classList.toggle('is-gain', gainActive);
    }

    const tierUpActive = nowMs < this.momTierUpUntilMs;
    if (tierUpActive !== this.prevMomTierUpActive) {
      this.prevMomTierUpActive = tierUpActive;
      this.momTierEl.classList.toggle('is-tier-up', tierUpActive);
    }

    // 3c. Checkpoint Guards Counter (counts post === 'checkpoint' only)
    let aliveCheckpointGuards = 0;
    for (let i = 0; i < state.guards.length; i++) {
      const g = state.guards[i];
      if ((g.post ?? 'checkpoint') === 'checkpoint' && g.state !== 'DEAD' && g.hp > 0) {
        aliveCheckpointGuards++;
      }
    }
    const guardsText = `GUARDS ${aliveCheckpointGuards} / ${BALANCE.guard.count}`;
    if (guardsText !== this.prevGuardsText) {
      this.prevGuardsText = guardsText;
      this.guardsCountEl.textContent = guardsText;
    }

    // 4. Hover Label, Centre Crosshair & Pointer Lock Hints
    if (extras.hoverLabel !== this.prevHoverLabel) {
      this.prevHoverLabel = extras.hoverLabel;
      if (extras.hoverLabel) {
        this.hoverLabelEl.textContent = extras.hoverLabel;
        this.hoverLabelEl.classList.add('is-visible');
      } else {
        this.hoverLabelEl.classList.remove('is-visible');
      }
    }

    const locked = Boolean(extras.pointerLocked);
    const activePlay = state.phase === 'playing' && !this._introVisible && !this.helpVisible;
    const showCrosshair = locked && activePlay;
    if (showCrosshair !== this.prevCrosshairVisible) {
      this.prevCrosshairVisible = showCrosshair;
      this.crosshairEl.classList.toggle('is-visible', showCrosshair);
    }
    const crosshairTarget = Boolean(extras.hoverLabel);
    if (crosshairTarget !== this.prevCrosshairTarget) {
      this.prevCrosshairTarget = crosshairTarget;
      this.crosshairEl.classList.toggle('is-target', crosshairTarget);
    }

    const showCaptureHint = !locked && activePlay;
    if (showCaptureHint !== this.prevCaptureHintVisible) {
      this.prevCaptureHintVisible = showCaptureHint;
      this.captureHintEl.classList.toggle('is-visible', showCaptureHint);
    }

    if (locked !== this.prevPointerLocked) {
      this.prevPointerLocked = locked;
      this.bottomRightEl.innerHTML = this.layout
        ? locked
          ? 'WASD move &middot; LMB attack &middot; RMB horde order &middot; Space rally &middot; QERF mutations &middot; M map &middot; Esc pause'
          : 'Click to capture mouse &middot; WASD move &middot; LMB attack &middot; RMB horde order &middot; Space rally &middot; QERF mutations &middot; M map &middot; Esc pause'
        : locked
        ? 'WASD move &middot; Shift sprint &middot; Mouse look &middot; LMB select/unselect targets &middot; RMB follow &middot; V look back &middot; Esc to release mouse &middot; Tab help'
        : 'Click to capture mouse &middot; WASD move &middot; Shift sprint &middot; LMB select/unselect targets &middot; RMB follow &middot; Drag/Z/X look &middot; V look back &middot; Tab help';
    }

    // 5. Bottom-Left Order Pill
    let orderText = 'FOLLOWING';
    let isAttack = false;
    if (state.order.type === 'attack') {
      isAttack = true;
      orderText =
        state.squads.length > 0
          ? `ATTACK: ${state.squads.length + 1} TARGETS`
          : `ATTACK: ${this.describeTargetLabel(state.order.target)}`;
    }
    if (orderText !== this.prevOrderText) {
      this.prevOrderText = orderText;
      this.orderTextEl.textContent = orderText;
    }
    if (isAttack !== this.prevOrderAttack) {
      this.prevOrderAttack = isAttack;
      this.orderPillEl.classList.toggle('is-attack', isAttack);
    }

    if (!this.layout) {
    // 6. Bottom-Center Ability Cards (E RALLY & SPACE RUSH)
      const rallyCd = state.abilities.rallyCooldown;
      const rallyOnCd = rallyCd > 0.01;
      const rallyStateText = rallyOnCd ? `${rallyCd.toFixed(1)}s` : 'READY';
      const rallyPct = rallyOnCd
        ? Math.max(0, Math.min(100, Math.round((1 - rallyCd / BALANCE.rally.cooldown) * 100)))
        : 100;
      if (rallyStateText !== this.prevRallyState) {
        this.prevRallyState = rallyStateText;
        this.rallyStateEl.textContent = rallyStateText;
      }
      if (rallyPct !== this.prevRallyPct) {
        this.prevRallyPct = rallyPct;
        this.rallyFillEl.style.transform = `scaleX(${rallyPct / 100})`;
      }
      if (rallyOnCd !== this.prevRallyCd) {
        this.prevRallyCd = rallyOnCd;
        this.rallyCardEl.classList.toggle('is-cooldown', rallyOnCd);
      }

      const rushActive = state.abilities.rushTimeLeft > 0.01;
      const rushCd = state.abilities.rushCooldown;
      let rushMode = 'ready';
      let rushStateText = 'READY';
      let rushPct = 100;
      if (rushActive) {
        rushMode = 'active';
        rushStateText = `ACTIVE ${state.abilities.rushTimeLeft.toFixed(1)}s`;
        rushPct = Math.max(
          0,
          Math.min(100, Math.round((state.abilities.rushTimeLeft / BALANCE.rush.duration) * 100)),
        );
      } else if (rushCd > 0.01) {
        rushMode = 'cd';
        rushStateText = `${rushCd.toFixed(1)}s`;
        rushPct = Math.max(
          0,
          Math.min(100, Math.round((1 - rushCd / BALANCE.rush.cooldown) * 100)),
        );
      }
      if (rushStateText !== this.prevRushState) {
        this.prevRushState = rushStateText;
        this.rushStateEl.textContent = rushStateText;
      }
      if (rushPct !== this.prevRushPct) {
        this.prevRushPct = rushPct;
        this.rushFillEl.style.transform = `scaleX(${rushPct / 100})`;
      }
      if (rushMode !== this.prevRushMode) {
        this.prevRushMode = rushMode;
        this.rushCardEl.classList.toggle('is-active', rushMode === 'active');
        this.rushCardEl.classList.toggle('is-cooldown', rushMode === 'cd');
      }

    }

    // 7. F3 debug overlay + open-world widgets
    this.debugOverlay.setVisible(extras.showDebug);
    if (extras.showDebug) {
      this.debugOverlay.update(state, {
        fps: extras.fps,
        frameMs: extras.frameMs,
        drawCalls: extras.drawCalls,
        loadedChunks: extras.loadedChunks,
      });
    }
    if (this.layout) this.updateOpenWorld(state, extras, nowMs);

    // 8. Respawn overlay (open world) + legacy Victory / Defeat Overlays
    const respawnVisible = this.layout !== null && state.phase === 'respawning';
    if (respawnVisible !== this.prevRespawnVisible) {
      this.prevRespawnVisible = respawnVisible;
      this.respawnOverlayEl.classList.toggle('is-visible', respawnVisible);
      if (respawnVisible) {
        this.hideIntro();
        this.worldMap?.hide();
        const nest = this.layout?.nests.find((n) => n.id === state.activeNestId);
        const where = nest ? districtName(nest.districtId) : 'your nest';
        this.respawnSubEl.textContent = `The horde remembers. You will rise again at the ${where} nest.`;
      }
    }
    if (respawnVisible) {
      const t = `${Math.max(0, Math.ceil(state.leader.respawnTimer))}`;
      if (t !== this.prevRespawnText) {
        this.prevRespawnText = t;
        this.respawnCountEl.textContent = t;
      }
    }

    if (state.phase !== this.prevPhase) {
      this.prevPhase = state.phase;
      if (state.phase === 'victory') {
        this.hideIntro();
        this.victoryStatsEl.innerHTML = this.buildStatsHtml(state);
        this.victoryOverlayEl.classList.add('is-visible');
        this.defeatOverlayEl.classList.remove('is-visible');
      } else if (state.phase === 'defeat') {
        this.hideIntro();
        this.defeatStatsEl.innerHTML = this.buildStatsHtml(state);
        this.defeatOverlayEl.classList.add('is-visible');
        this.victoryOverlayEl.classList.remove('is-visible');
      } else {
        this.victoryOverlayEl.classList.remove('is-visible');
        this.defeatOverlayEl.classList.remove('is-visible');
      }
    }
  }

  dispose(): void {
    this.clearToasts();
    if (this.savedTimer !== null) window.clearTimeout(this.savedTimer);
    this.savedTimer = null;
    this.minimap?.dispose();
    this.worldMap?.dispose();
    this.pauseMenu?.dispose();
    this.nestPanel?.dispose();
    this.debugOverlay.dispose();
    this.waypointCallbacks.length = 0;
    this.equipCallbacks.length = 0;
    this.introOverlayEl.removeEventListener('pointerdown', this.onIntroClick);
    this.victoryBtn.removeEventListener('click', this.onRestartClick);
    this.defeatBtn.removeEventListener('click', this.onRestartClick);
    this.restartCallbacks.length = 0;
    this.introDismissCallbacks.length = 0;
    this.root.innerHTML = '';
  }

  private updateOpenWorld(state: GameState, extras: HudExtras, nowMs: number): void {
    const layout = this.layout;
    if (!layout) return;

    // Biomass + brutes
    const bioText = `${Math.floor(state.progression.biomass)}`;
    if (bioText !== this.prevBioText) {
      this.prevBioText = bioText;
      this.bioValueEl.textContent = bioText;
    }
    const brutes = bruteCount(state);
    const bruteText = brutes > 0 ? `BRUTES ${brutes}` : '';
    if (bruteText !== this.prevBruteText) {
      this.prevBruteText = bruteText;
      this.bruteEl.textContent = bruteText;
    }

    // Ability slots Q E R F (open world: only owned slots are shown; strip hidden at 0)
    const owned = this.layout ? visibleSlotCount(state) : this.slotEls.length;
    if (owned !== this.prevSlotStripCount) {
      this.prevSlotStripCount = owned;
      this.slotsEl.classList.toggle('is-hidden-slots', owned === 0);
      for (let i = 0; i < this.slotEls.length; i++) this.slotEls[i].root.classList.toggle('is-unowned', i >= owned);
    }
    for (let i = 0; i < owned; i++) {
      const v = abilitySlotView(state, i);
      const denied = nowMs < this.deniedUntilMs[i];
      const deg = Math.round(v.remainingFrac * 360);
      const sig = `${v.kind}|${v.name}|${v.caption}|${deg}`;
      const el = this.slotEls[i];
      if (sig !== this.prevSlotSig[i]) {
        this.prevSlotSig[i] = sig;
        el.name.textContent = v.name;
        el.state.textContent = v.caption.toUpperCase();
        el.sweep.style.setProperty('--cd', `${deg}deg`);
        el.root.title = v.abilityId ? ABILITIES[v.abilityId].description : 'Empty slot - equip a mutation at a nest';
        el.root.classList.toggle('is-empty', v.kind === 'empty');
        el.root.classList.toggle('is-cooldown', v.kind === 'cooldown');
        el.root.classList.toggle('is-active', v.kind === 'active');
        el.root.classList.toggle('is-nobiomass', v.kind === 'nobiomass');
      }
      if (denied !== this.prevSlotDenied[i]) {
        this.prevSlotDenied[i] = denied;
        el.root.classList.toggle('is-denied', denied);
      }
    }

    this.updateTracker(state, nowMs);

    this.minimap?.update(state, extras.waypoint ?? null, nowMs);
    if (this.worldMap?.visible) this.worldMap.update(state, extras.waypoint ?? null, nowMs);
    this.nestPanel?.update(state, nearbyEquipNest(state, layout) !== null);
  }

  private updateTracker(state: GameState, nowMs: number): void {
    const layout = this.layout;
    if (!layout || nowMs - this.lastTrackerMs < 250) return;
    this.lastTrackerMs = nowMs;
    const def = selectObjectiveStronghold(layout, state, state.leader.pos);
    let sig = 'none';
    let html = '';
    if (!def) {
      sig = 'all';
      html = '<div class="ibz-tracker-title">All strongholds captured</div><div class="ibz-tracker-sub">The city is yours</div>';
    } else if (!state.districts[def.districtId]?.discovered) {
      sig = 'explore';
      html = '<div class="ibz-tracker-title">Explore the city</div><div class="ibz-tracker-sub">Find a human stronghold to attack</div>';
    } else {
      const sh = state.strongholds.find((x) => x.id === def.id);
      const statuses = objectiveStatus({ state, layout } as unknown as SimContext, def.id);
      sig = `${def.id}|${sh?.contested ? 1 : 0}|${statuses.map((o) => `${o.done ? 1 : 0}${Math.round(o.progress * 100)}`).join(',')}`;
      if (sig !== this.prevTrackerSig) {
        html = `<div class="ibz-tracker-title">${strongholdName(def.id)}</div>
          <div class="ibz-tracker-sub${sh?.contested ? ' is-contested' : ''}">TIER ${def.defenseTier}${sh?.contested ? ' - CONTESTED' : ''} &middot; ${districtName(def.districtId)}</div>`;
        for (const o of statuses) {
          html += `<div class="ibz-obj-row${o.done ? ' is-done' : ''}"><div class="ibz-obj-label">${o.label}</div>
            <div class="ibz-obj-bar"><div style="width:${Math.round(o.progress * 100)}%"></div></div></div>`;
        }
        const reward = def.unlock ? `Unlocks ${ABILITIES[def.unlock].name}` : 'No mutation reward';
        html += `<div class="ibz-tracker-reward">${reward} &middot; +${def.biomassReward} biomass</div>`;
      }
    }
    if (sig === this.prevTrackerSig) return;
    this.prevTrackerSig = sig;
    this.trackerEl.innerHTML = html;
  }

  private chooseObjectiveText(state: GameState): string {
    if (state.gate.destroyed) {
      return 'Eliminate the guards';
    }
    const structures = state.structures;
    if (structures && structures.length > 0) {
      const busDoor = structures.find((s) => s.kind === 'busDoor');
      const penGate = structures.find((s) => s.kind === 'penGate');
      const storeDoor = structures.find((s) => s.kind === 'storeDoor');
      const alleyGate = structures.find((s) => s.kind === 'alleyGate');

      // Suggest the next intact landmark in route order (never skipping ahead because a cascade grew the horde fast);
      // once the horde is clearly assault-sized, point at the gate instead. Suggestions only — nothing is forced.
      if (state.followerCount < 50) {
        if (busDoor && !busDoor.destroyed) return 'Free the bus horde';
        if (penGate && !penGate.destroyed) return 'Break the police barricade';
        if (storeDoor && !storeDoor.destroyed) return 'Raid the store';
        if (alleyGate && !alleyGate.destroyed) return 'Open the locked alley';
      }
      return state.followerCount < 22 ? 'Find zombies' : 'Break the gate';
    }
    return state.followerCount < 15 ? 'Find zombies' : 'Break the gate';
  }

  private updateGateOrStructureBar(state: GameState): void {
    // Check if gate or any intact structure is targeted or damaged
    const isTargetSelected = (pred: (t: TargetRef) => boolean): boolean => {
      if (state.order.type === 'attack' && pred(state.order.target)) return true;
      for (let i = 0; i < state.squads.length; i++) {
        if (pred(state.squads[i].target)) return true;
      }
      return false;
    };

    const gateTargeted = isTargetSelected((t) => t.kind === 'gate');
    let activeStruct: StructureState | null = null;
    if (state.structures && state.structures.length > 0) {
      // 1. Targeted or actively hit structure
      for (let i = 0; i < state.structures.length; i++) {
        const s = state.structures[i];
        if (s.destroyed) continue;
        const targeted = isTargetSelected(
          (t) =>
            (t.kind === 'structure' && t.id === s.id) ||
            (t.kind === 'guard' &&
              state.guards.some((g) => g.id === t.id && g.shelter === s.id)),
        );
        if (targeted || s.hitFlash > 0) {
          activeStruct = s;
          break;
        }
      }
      // 2. Otherwise any damaged intact structure (if gate isn't explicitly targeted)
      if (!activeStruct && !gateTargeted) {
        for (let i = 0; i < state.structures.length; i++) {
          const s = state.structures[i];
          if (!s.destroyed && s.hp < s.maxHp) {
            activeStruct = s;
            break;
          }
        }
      }
    }

    const showGate =
      !activeStruct &&
      !state.gate.destroyed &&
      (state.gate.hp < state.gate.maxHp || gateTargeted);
    const showBar = !!activeStruct || showGate;

    if (showBar !== this.prevGateVisible) {
      this.prevGateVisible = showBar;
      this.gateBarEl.classList.toggle('is-visible', showBar);
    }

    if (showBar) {
      const label = activeStruct ? structureBarTitle(activeStruct.kind) : 'Checkpoint Gate';
      const curHp = activeStruct ? activeStruct.hp : state.gate.hp;
      const maxHp = activeStruct ? activeStruct.maxHp : state.gate.maxHp;

      if (label !== this.prevGateLabel) {
        this.prevGateLabel = label;
        this.gateLabelEl.textContent = label;
      }
      const gHp = Math.max(0, Math.ceil(curHp));
      const gText = `${gHp} / ${maxHp}`;
      if (gText !== this.prevGateText) {
        this.prevGateText = gText;
        this.gateValueEl.textContent = gText;
      }
      const gPct = Math.max(0, Math.min(100, Math.round((curHp / Math.max(1, maxHp)) * 100)));
      if (gPct !== this.prevGatePct) {
        this.prevGatePct = gPct;
        this.gateFillEl.style.width = `${gPct}%`;
      }
    }
  }

  private describeTargetLabel(target: TargetRef): string {
    if (target.kind === 'gate') return 'GATE';
    if (target.kind === 'structure') {
      const s = this.lastState?.structures?.find((st) => st.id === target.id);
      if (s) return structureHudLabel(s.kind);
      return 'BARRIER';
    }
    if (target.kind === 'guard') {
      const g = this.lastState?.guards.find((gd) => gd.id === target.id);
      if (g?.role === 'civilian') return 'CIVILIAN';
      return 'GUARD';
    }
    return 'TARGET';
  }

  private showToast(msg: string, kind: ToastSpec['kind'] = 'info'): void {
    this.pushToast({ text: msg, kind });
  }

  private pushToast(spec: ToastSpec): void {
    const life = this.layout ? 3600 : 1800;
    // Dedupe: never show the same text twice at once; restart the visible toast's timer instead.
    const kids = this.toastStackEl.children;
    const texts: (string | null)[] = [];
    for (let i = 0; i < kids.length; i++) texts.push(kids[i].textContent);
    const dup = toastDedupe(texts, spec.text);
    if (dup !== 'add') {
      const node = kids[dup] as HTMLElement;
      const old = this.toastByEl.get(node);
      if (old !== undefined) {
        window.clearTimeout(old);
        this.toastTimers.delete(old);
      }
      node.classList.remove('is-pulse');
      void node.offsetWidth; // restart the pulse animation
      node.classList.add('is-pulse');
      const rid = window.setTimeout(() => {
        this.toastTimers.delete(rid);
        this.toastByEl.delete(node);
        node.remove();
      }, life);
      this.toastTimers.add(rid);
      this.toastByEl.set(node, rid);
      return;
    }
    const el = document.createElement('div');
    el.className = `ibz-toast is-visible${spec.kind === 'good' ? ' is-good' : spec.kind === 'warn' ? ' is-warn' : ''}`;
    el.textContent = spec.text;
    this.toastStackEl.appendChild(el);
    while (this.toastStackEl.childElementCount > 4) {
      const old = this.toastStackEl.firstElementChild as HTMLElement | null;
      if (!old) break;
      const tid = this.toastByEl.get(old);
      if (tid !== undefined) {
        window.clearTimeout(tid);
        this.toastTimers.delete(tid);
        this.toastByEl.delete(old);
      }
      old.remove();
    }
    const id = window.setTimeout(() => {
      this.toastTimers.delete(id);
      this.toastByEl.delete(el);
      el.remove();
    }, life);
    this.toastTimers.add(id);
    this.toastByEl.set(el, id);
  }

  private clearToasts(): void {
    for (const id of this.toastTimers) window.clearTimeout(id);
    this.toastTimers.clear();
    this.toastByEl.clear();
    this.toastStackEl.innerHTML = '';
  }

  private buildStatsHtml(state: GameState): string {
    return `
      <div class="ibz-stat-cell">
        <div class="ibz-stat-label">Surviving Followers</div>
        <div class="ibz-stat-val">${state.followerCount}</div>
      </div>
      <div class="ibz-stat-cell">
        <div class="ibz-stat-label">Outbreak Spread</div>
        <div class="ibz-stat-val">${state.stats.cascadeRecruits ?? 0}</div>
      </div>
      <div class="ibz-stat-cell">
        <div class="ibz-stat-label">Conversions</div>
        <div class="ibz-stat-val">${state.stats.conversions}</div>
      </div>
      <div class="ibz-stat-cell">
        <div class="ibz-stat-label">Barriers Broken</div>
        <div class="ibz-stat-val">${state.stats.structuresDestroyed ?? 0}</div>
      </div>
      <div class="ibz-stat-cell">
        <div class="ibz-stat-label">Horde Losses</div>
        <div class="ibz-stat-val">${state.stats.losses}</div>
      </div>
      <div class="ibz-stat-cell">
        <div class="ibz-stat-label">Time Elapsed</div>
        <div class="ibz-stat-val">${formatTime(state.time)}</div>
      </div>
    `;
  }
}
