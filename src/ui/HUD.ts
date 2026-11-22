// Gameplay HUD (HUD-T002). DOM/CSS overlay driven by GameState + events; every element only writes the DOM when its
// view-model signature changes. Decisions live in hudModel.ts / uiHelpers.ts (pure, unit-tested); this file renders.
import './hudTheme.css';
import './hud.css';
import './hudOpenWorld.css';
import './hudPanels.css';
import { BALANCE } from '../config/balance';
import type {
  AbilityId,
  CompanionId,
  CosmeticSlot,
  TraitId,
  DistrictId,
  DistrictLayout,
  GameEvent,
  GamePhase,
  GameState,
  HideoutId,
  PlayerVehicleKind,
  StructureKind,
  StructureState,
  TargetRef,
  Vec2,
} from '../core/types';
import { districtMeta } from '../content/districts';
import { ABILITIES, SLOT_KEYS } from '../content/abilities';
import { visionCost } from '../systems/ProgressionSystem';
import { getDistrictAt } from '../world/worldQueries';
import { DebugOverlay } from './DebugOverlay';
import { CollectionPanel, type CollectionCallbacks } from './CollectionPanel';
import { Minimap } from './Minimap';
import { NestPanel } from './NestPanel';
import { PauseMenu, type PauseCallbacks } from './PauseMenu';
import { WorldMap } from './WorldMap';
import { abilityIcon, icon, type IconName } from './hudIcons';
import {
  bannerForEvent,
  chipsSignature,
  contextActions,
  contextSignature,
  damageSourceFor,
  drinkNearby,
  eyesightLabel,
  hordeBanner,
  hordeMilestone,
  hordeStrengthView,
  hordeView,
  hudContext,
  objectiveView,
  primaryAttackView,
  recruitPopup,
  statusChips,
  type BannerSpec,
  type HudContext,
  type ObjectiveView,
} from './hudModel';
import {
  abilitySlotView,
  bruteCount,
  cueScreenAngle,
  districtName,
  followerCap,
  nearbyEquipNest,
  recallHint,
  threatPipCount,
  toastDedupe,
  toastForEvent,
  visibleSlotCount,
  type SlotKind,
  type ToastSpec,
} from './uiHelpers';

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
  /** Camera view yaw (same convention as the sim): orients the directional damage indicator. */
  cameraYaw?: number;
}


export function structureHudLabel(kind: StructureKind): string {
  switch (kind) {
    case 'busDoor': return 'BUS DOOR';
    case 'alleyGate': return 'ALLEY GATE';
    case 'storeDoor': return 'STORE DOOR';
    case 'stationDoor': return 'STATION DOOR';
    case 'securityShutter': return 'SECURITY SHUTTER';
    case 'shopDoor': return 'SHOP DOOR';
    case 'penGate':
    default: return 'PEN GATE';
  }
}

function structureBarTitle(kind: StructureKind): string {
  switch (kind) {
    case 'busDoor': return 'Bus Door';
    case 'alleyGate': return 'Alley Gate';
    case 'storeDoor': return 'Store Door';
    case 'stationDoor': return 'Station Door';
    case 'securityShutter': return 'Security Shutter';
    case 'shopDoor': return 'Shop Door (drinks)';
    case 'penGate':
    default: return 'Pen Gate';
  }
}

const keyCaps = (keys: string): string =>
  keys.split(' ').map((k) => (k === '/' || k === '+' || k === '&' ? `<em>${k}</em>` : `<span class="hz-key${k.length > 3 ? ' is-mouse' : ''}">${k}</span>`)).join('');

function helpRows(openWorld: boolean): string {
  const rows: [string, string][] = openWorld
    ? [
        ['W A S D', 'Move relative to the camera'],
        ['Shift', 'Sprint while stamina lasts'],
        ['LMB', 'Alpha attack: bite (3-hit claw combo with Alpha Claws)'],
        ['RMB', 'On a target: horde attack order (hold E + RMB adds / removes a split target). On the ground: move order'],
        ['Space / G', 'Recall: the whole horde comes back and follows you (Shift + RMB too)'],
        ['Q T R F', 'Mutation slots (Rush from the suburb checkpoint, then Frenzy, Claws, Brutes)'],
        ['1 - 4', 'At an active nest: pick a slot, [ ] cycles mutations'],
        ['M', 'World map: click to set / clear a waypoint'],
        ['Esc', 'Pause menu: save, settings, reset'],
        ['C V Z X', 'Recenter, look back, turn camera (drag + wheel also work)'],
        ['Tab', 'Toggle this panel (also expands the objective)'],
        ['F3', 'Debug overlay'],
      ]
    : [
        ['W A S D', 'Move leader relative to camera'],
        ['Shift', 'Sprint while stamina allows'],
        ['LMB', 'Select / unselect target - the horde splits across selected targets'],
        ['RMB', 'Recall horde to follow the leader'],
        ['Space', 'Horde Rush (+45% speed, +25% attack rate)'],
        ['C V Z X', 'Recenter, look back, rotate camera'],
        ['Tab', 'Toggle this controls panel'],
        ['F3', 'Performance debug stats'],
        ['N', 'Mute / unmute audio'],
        ['R', 'Restart (on win / loss screen)'],
      ];
  return rows.map(([k, v]) => `<tr><td>${keyCaps(k)}</td><td>${v}</td></tr>`).join('');
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

/** Restart a one-shot CSS animation class. */
function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const TOAST_ICON: Record<ToastSpec['kind'], IconName> = { good: 'check', warn: 'warning', info: 'star' };

interface SlotEls {
  root: HTMLDivElement;
  face: HTMLDivElement;
  name: HTMLSpanElement;
  cd: HTMLSpanElement;
  cost: HTMLSpanElement;
  sweep: HTMLDivElement;
  abilityId: AbilityId | null | undefined;
  kind: SlotKind | '';
  sig: string;
  denied: boolean;
}

export class HUD {
  private readonly root: HTMLElement;
  private readonly container: HTMLDivElement;
  private readonly play: HTMLDivElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly slotEls: SlotEls[] = [];
  private readonly dmgArcs: HTMLDivElement[] = [];
  private dmgArcNext = 0;
  private readonly debugOverlay: DebugOverlay;
  private readonly timers = new Set<number>();
  private readonly toastTimers = new Set<number>();
  private readonly toastByEl = new Map<HTMLElement, number>();
  private savedTimer: number | null = null;
  private readonly coarsePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  private _introVisible = true;
  private helpVisible = false;
  private helpSeen = false;

  // Open world (null layout = legacy single-district mode)
  private layout: DistrictLayout | null = null;
  private minimap: Minimap | null = null;
  private worldMap: WorldMap | null = null;
  private pauseMenu: PauseMenu | null = null;
  private nestPanel: NestPanel | null = null;
  private collectionPanel: CollectionPanel | null = null;
  private cityStripEl: HTMLDivElement | null = null;
  private cityBrainsEl: HTMLSpanElement | null = null;
  private cityAlertEl: HTMLSpanElement | null = null;
  private collectionCallbacks: Partial<CollectionCallbacks> = {};
  private readonly buySlotCallbacks: (() => void)[] = [];
  private readonly buyVisionCallbacks: (() => void)[] = [];
  private readonly buyTraitCallbacks: ((id: TraitId) => void)[] = [];
  private readonly waypointCallbacks: ((p: Vec2 | null) => void)[] = [];
  private readonly nestTeleportCallbacks: ((nestId: string) => void)[] = [];
  private readonly equipCallbacks: ((slot: number, ability: AbilityId | null) => void)[] = [];
  private readonly restartCallbacks: (() => void)[] = [];
  private readonly introDismissCallbacks: (() => void)[] = [];
  private pendingPauseCallbacks: PauseCallbacks = {};
  private muted = false;
  private readonly deniedUntilMs: number[] = [0, 0, 0, 0];

  /** Last state seen by update(); consume() runs before update() each frame. */
  private lastState: GameState | null = null;
  private prevSimTime = -1;
  private prevPhase: GamePhase = 'playing';
  private s: Record<string, string | number | boolean | null> = {};

  // feedback state
  private lastCameraYaw = 0;
  private lastDamageSource: Vec2 | null = null;
  private lastDamageSourceMs = -1e9;
  private lastDamageMs = -1e9;
  private lastRecruitMs = -1e9;
  private lastSwingMs = -1e9;
  private prevFollowerCount: number | null = null;
  private bestFollowers = 0;
  private gainAccum = 0;
  private gainWindowEndMs = 0;
  private lossAccum = 0;
  private lossWindowEndMs = 0;
  private popupBurst = 0;
  private popupStartMs = -1e9;
  private popupShown = false;
  private bioAccum = 0;
  private bioWindowEndMs = 0;
  private bannerQueue: BannerSpec[] = [];
  private bannerBusyUntilMs = 0;
  private readonly bannerKeys = new Set<string>();
  private bannerCount = 0;
  private objExpandUntilMs = 0;
  private objCelebrateUntilMs = 0;
  private objStepSig = '';
  private obj: ObjectiveView | null = null;
  private lastObjMs = -1e9;
  private lastCtxMs = -1e9;
  private prevDistrictId: DistrictId | null = null;
  private districtBannerUntilMs = 0;
  private tipPoorSightShown = false;
  private tipUpgradeAffordableShown = false;
  private arriveTimer: number | null = null;
  private cinematic = false;
  private helpHintUntilMs = 0;

  private readonly onIntroClick = (): void => {
    this.hideIntro();
    // This pointerdown is a real user gesture, so listeners may capture the mouse here ("click to begin").
    for (const cb of this.introDismissCallbacks) cb();
  };

  private readonly onRestartClick = (): void => {
    for (const cb of this.restartCallbacks) cb();
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = '';
    this.container = document.createElement('div');
    this.container.className = 'ibz-hud';
    this.container.dataset.ctx = 'explore';
    this.container.innerHTML = `
      <div class="hz-play" data-ref="play">
        <div class="hz-vignette" data-ref="vignette"></div>
        <div class="hz-dmg-layer" data-ref="dmgLayer"></div>

        <div class="hz-char ibz-top-left" data-ref="char">
          <div class="hz-portrait" data-ref="portrait">${icon('zombie', 'l')}</div>
          <div class="hz-char-body">
            <div class="hz-strength-head">
              ${icon('horde', 's', 'hz-strength-ico')}
              <span class="hz-strength-label">HORDE STRENGTH</span>
              <span class="hz-strength-num" data-ref="strengthNum">6 / 6</span>
            </div>
            <div class="hz-char-row">
              <div class="hz-meter hz-meter-strength" data-ref="strengthMeter">
                <div class="hz-meter-lag" data-ref="strengthLag"></div>
                <div class="hz-meter-fill" data-ref="strengthFill"></div>
                <div class="hz-meter-core" data-ref="strengthCore"></div>
                <div class="hz-meter-ticks"></div>
              </div>
            </div>
            <div class="hz-char-row hz-char-row-stam">
              ${icon('bolt', 's', 'hz-row-ico')}
              <div class="hz-meter hz-meter-stam" data-ref="stamMeter"><div class="hz-meter-fill" data-ref="stamFill"></div></div>
            </div>
            <div class="hz-char-foot">
              <span class="hz-chip hz-bio ibz-ow-only" data-ref="bio">${icon('brain', 's')}<b data-ref="bioVal">0</b><span class="hz-float hz-bio-float" data-ref="bioFloat"></span></span>
              <span class="hz-chip hz-eyes ibz-ow-only" data-ref="eyes">${icon('eye', 's')}<span data-ref="eyesVal">Eyes</span></span>
              <span class="hz-status" data-ref="status"></span>
            </div>
          </div>
        </div>

        <div class="ibz-top-center">
          <div class="hz-objective ibz-ow-only" data-ref="obj">
            <div class="hz-obj-head">
              <span class="hz-obj-ico" data-ref="objIco">${icon('star')}</span>
              <div class="hz-obj-text">
                <div class="hz-obj-title" data-ref="objTitle"></div>
                <div class="hz-obj-sub" data-ref="objSub"></div>
              </div>
              <div class="hz-obj-count" data-ref="objCount"></div>
            </div>
            <div class="hz-obj-track" data-ref="objTrack"><div class="hz-obj-fill" data-ref="objFill"></div></div>
            <div class="hz-obj-details" data-ref="objDetails"></div>
          </div>
          <div class="hz-objective ibz-legacy-only is-legacy">
            <div class="hz-obj-head">
              <span class="hz-obj-ico">${icon('fort')}</span>
              <div class="hz-obj-text">
                <div class="hz-obj-title">Capture the checkpoint</div>
                <div class="hz-obj-sub" data-ref="legacySub">Free the bus horde</div>
              </div>
              <div class="hz-obj-count" data-ref="guards"></div>
            </div>
          </div>
          <div class="hz-target-bar" data-ref="gateBar">
            ${icon('gate', 's')}
            <span class="hz-target-name" data-ref="gateLabel">Checkpoint Gate</span>
            <div class="hz-meter hz-meter-target"><div class="hz-meter-fill" data-ref="gateFill"></div>
              <span class="hz-meter-text" data-ref="gateVal"></span></div>
          </div>
          <div class="hz-district-banner" data-ref="districtBanner">
            <div class="hz-district-kicker">Now entering</div>
            <div class="hz-district-name" data-ref="districtName"></div>
            <div class="hz-district-pips" data-ref="districtPips"></div>
            <div class="hz-district-threat" data-ref="districtThreat"></div>
          </div>
          <div class="hz-toast-stack" data-ref="toastStack"></div>
        </div>

        <div class="hz-minimap-slot ibz-ow-only" data-ref="mapSlot"></div>

        <div class="hz-banner" data-ref="banner">
          <div class="hz-banner-burst"></div>
          <div class="hz-banner-ico" data-ref="bannerIco"></div>
          <div class="hz-banner-title" data-ref="bannerTitle"></div>
          <div class="hz-banner-sub" data-ref="bannerSub"></div>
          <div class="hz-banner-quip" data-ref="bannerQuip"></div>
        </div>
        <div class="hz-pop" data-ref="pop"></div>
        <div class="hz-last-brain" data-ref="lastBrain">
          <div class="hz-last-brain-text" data-ref="lastBrainText"></div>
        </div>
        <div class="hz-hitmark" data-ref="hitmark"></div>
        <div class="hz-target-label" data-ref="hoverLabel"></div>
        <div class="ibz-crosshair" data-ref="crosshair"></div>

        <div class="hz-horde ibz-bottom-left" data-ref="horde">
          <div class="hz-horde-ico" data-ref="hordeIco">${icon('horde', 'l')}</div>
          <div class="hz-horde-main">
            <div class="hz-horde-label">Your horde</div>
            <div class="hz-horde-count"><b data-ref="hordeNum">0</b><span data-ref="hordeCap">/ 40</span></div>
            <div class="hz-horde-capbar"><div data-ref="hordeCapFill"></div></div>
          </div>
          <span class="hz-float hz-horde-gain" data-ref="hordeGain"></span>
          <span class="hz-float hz-horde-loss" data-ref="hordeLoss"></span>
          <div class="hz-horde-chips">
            <span class="hz-chip hz-order" data-ref="order"><span data-ref="orderIco"></span><span data-ref="orderText">Following</span></span>
            <span class="hz-chip is-yellow hz-brutes" data-ref="brutes">${icon('brute', 's')}<b data-ref="brutesVal">0</b></span>
            <span class="hz-chip is-coral hz-capflash" data-ref="capFlash">Horde full!</span>
          </div>
          <div class="hz-recall-hint" data-ref="recallHint"></div>
        </div>

        <div class="hz-abilities ibz-bottom-center" data-ref="abilities">
          <div class="hz-ab hz-ab-primary" data-ref="abPrimary">
            <div class="hz-ab-face" data-ref="abPrimaryFace">${icon('bite', 'l')}</div>
            <div class="hz-ab-sweep" data-ref="abPrimarySweep"></div>
            <span class="hz-ab-combo" data-ref="abCombo"></span>
            <span class="hz-ab-key"><span class="hz-key is-mouse">LMB</span></span>
            <span class="hz-ab-name" data-ref="abPrimaryName">Bite</span>
          </div>
          <div class="hz-ab hz-ab-util ibz-legacy-only" data-ref="abRush">
            <div class="hz-ab-face">${icon('rush')}</div>
            <div class="hz-ab-sweep" data-ref="abRushSweep"></div>
            <span class="hz-ab-cd" data-ref="abRushCd"></span>
            <span class="hz-ab-key"><span class="hz-key is-mouse">Space</span></span>
            <span class="hz-ab-name">Rush</span>
          </div>
          <div class="hz-ab hz-ab-util ibz-ow-only" data-ref="abRecall">
            <div class="hz-ab-face">${icon('recall')}</div>
            <span class="hz-ab-key"><span class="hz-key is-mouse">Space</span></span>
            <span class="hz-ab-name">Recall</span>
          </div>
          <div class="hz-slots ibz-ow-only" data-ref="slots"></div>
        </div>

        <div class="hz-context ibz-bottom-right" data-ref="context"></div>
        <div class="hz-help-hint" data-ref="helpHint"><span class="hz-key">Tab</span> Controls</div>
        <div class="hz-saved" data-ref="savedTick">${icon('check', 's')} Saved</div>
      </div>

      <div class="ibz-help-panel" data-ref="helpPanel">
        <h3 class="ibz-help-title">Controls &amp; commands</h3>
        <table class="ibz-help-table"><tbody>${helpRows(false)}</tbody></table>
      </div>

      <div class="ibz-overlay is-visible" data-ref="introOverlay"><div class="ibz-modal"></div></div>

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
    for (const node of this.container.querySelectorAll<HTMLElement>('[data-ref]')) this.el[node.dataset.ref!] = node;
    this.play = this.el.play as HTMLDivElement;

    this.setIntroContent(true, false);
    this.el.introOverlay.addEventListener('pointerdown', this.onIntroClick);
    this.el.victoryBtn.addEventListener('click', this.onRestartClick);
    this.el.defeatBtn.addEventListener('click', this.onRestartClick);

    const keys = SLOT_KEYS;
    for (let i = 0; i < 4; i++) {
      const root = document.createElement('div');
      root.className = 'hz-ab hz-slot is-empty';
      root.innerHTML = `<div class="hz-ab-face"></div><div class="hz-ab-sweep"></div><span class="hz-ab-cd"></span>
        <span class="hz-ab-cost"></span><span class="hz-ab-key"><span class="hz-key">${keys[i]}</span></span><span class="hz-ab-name"></span>`;
      this.el.slots.appendChild(root);
      this.slotEls.push({
        root,
        face: root.querySelector('.hz-ab-face') as HTMLDivElement,
        name: root.querySelector('.hz-ab-name') as HTMLSpanElement,
        cd: root.querySelector('.hz-ab-cd') as HTMLSpanElement,
        cost: root.querySelector('.hz-ab-cost') as HTMLSpanElement,
        sweep: root.querySelector('.hz-ab-sweep') as HTMLDivElement,
        abilityId: undefined,
        kind: 'empty', // matches the initial is-empty class so the first transition removes it
        sig: '',
        denied: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      const arc = document.createElement('div');
      arc.className = 'hz-dmg-arc';
      this.el.dmgLayer.appendChild(arc);
      this.dmgArcs.push(arc);
    }
    this.debugOverlay = new DebugOverlay(this.container);
  }

  // ---------------------------------------------------------------------------
  // Open-world API (T013). All optional: without setWorld() the HUD behaves as the legacy single-district HUD.
  // ---------------------------------------------------------------------------

  /**
   * Switch the HUD to open-world mode and (re)bind it to the world layout. Call once after the Simulation exists
   * and again after any restart/reset-with-new-simulation. `firstRun` = no save was loaded (full onboarding card).
   */
  setWorld(layout: DistrictLayout, opts: { firstRun?: boolean } = {}): void {
    this.layout = layout;
    this.container.classList.add('is-open-world');
    if (!this.minimap) {
      this.minimap = new Minimap(this.el.mapSlot, layout);
      this.worldMap = new WorldMap(this.container, layout);
      this.worldMap.onClose(() => this.hideMap());
      this.worldMap.onWaypoint((p) => {
        for (const cb of this.waypointCallbacks) cb(p);
      });
      this.worldMap.onTeleport((id) => {
        for (const cb of this.nestTeleportCallbacks) cb(id);
      });
      this.nestPanel = new NestPanel(this.play); // gameplay layer: hidden under pause / map / cinematic
      this.nestPanel.onEquip((slot, ability) => {
        for (const cb of this.equipCallbacks) cb(slot, ability);
      });
      this.nestPanel.onBuySlot(() => {
        for (const cb of this.buySlotCallbacks) cb();
      });
      this.nestPanel.onBuyVision(() => {
        for (const cb of this.buyVisionCallbacks) cb();
      });
      this.nestPanel.onBuyTrait((id) => {
        for (const cb of this.buyTraitCallbacks) cb(id);
      });
      this.pauseMenu = new PauseMenu(this.container);
      this.pauseMenu.setCallbacks(this.pendingPauseCallbacks);
      this.pauseMenu.setMuted(this.muted);
      this.collectionPanel = new CollectionPanel(this.container, {
        onEquipCosmetic: (s, id) => this.collectionCallbacks.onEquipCosmetic?.(s, id),
        onBuyReward: id => this.collectionCallbacks.onBuyReward?.(id),
        onToggleCompanion: id => this.collectionCallbacks.onToggleCompanion?.(id),
        onSummonVehicle: k => this.collectionCallbacks.onSummonVehicle?.(k),
        onFastTravelHideout: id => this.collectionCallbacks.onFastTravelHideout?.(id),
        onClose: () => this.hideCollection(),
      });
      if (!this.cityStripEl) {
        // docs/11_cityupgrade.md §2.3/§4.1.H: Brains + subtle district alert badge + collection button.
        const strip = document.createElement('div');
        strip.className = 'ibz-ow-only hz-city';

        const brains = document.createElement('span');
        brains.className = 'hz-city-brains';
        const alertBadge = document.createElement('span');
        alertBadge.className = 'hz-city-alert';
        const colBtn = document.createElement('button');
        colBtn.className = 'hz-city-btn';
        colBtn.title = 'Collection (I)';
        colBtn.innerHTML = `<span class="hz-key">I</span>${icon('star', 's')}<span>Collection</span>`;
        colBtn.onclick = () => this.toggleCollection();

        strip.append(brains, alertBadge, colBtn);
        this.play.appendChild(strip);
        this.cityStripEl = strip;
        this.cityBrainsEl = brains;
        this.cityAlertEl = alertBadge;
      }
    } else {
      this.minimap.setLayout(layout);
      this.worldMap?.setLayout(layout);
    }
    this.prevDistrictId = null;
    this.districtBannerUntilMs = 0;
    this.objStepSig = '';
    this.lastObjMs = -1e9;
    this.s = {};
    this.setIntroContent(opts.firstRun !== false, true);
    (this.el.helpPanel.querySelector('tbody') as HTMLElement).innerHTML = helpRows(true);
  }

  get isOpenWorld(): boolean {
    return this.layout !== null;
  }

  onWaypoint(cb: (p: Vec2 | null) => void): void { this.waypointCallbacks.push(cb); }
  /** Nest teleport map: the player picked destination nest `nestId`. */
  onNestTeleport(cb: (nestId: string) => void): void { this.nestTeleportCallbacks.push(cb); }
  onEquip(cb: (slot: number, ability: AbilityId | null) => void): void { this.equipCallbacks.push(cb); }
  onBuySlot(cb: () => void): void { this.buySlotCallbacks.push(cb); }
  onBuyVision(cb: () => void): void { this.buyVisionCallbacks.push(cb); }
  onBuyTrait(cb: (id: TraitId) => void): void { this.buyTraitCallbacks.push(cb); }

  /** Mount container for SenseIndicators (inside the gameplay layer, so it hides under modals and cinematics). */
  get senseRoot(): HTMLElement {
    return this.play;
  }

  setPauseCallbacks(cb: PauseCallbacks): void {
    this.pendingPauseCallbacks = cb;
    this.pauseMenu?.setCallbacks(cb);
  }

  get isPauseVisible(): boolean { return this.pauseMenu?.visible ?? false; }

  showPause(): void {
    this.worldMap?.hide();
    this.pauseMenu?.show();
  }

  hidePause(): void { this.pauseMenu?.hide(); }

  togglePause(): void {
    if (this.isPauseVisible) this.hidePause();
    else this.showPause();
  }

  notifyPause(msg: string): void { this.pauseMenu?.notify(msg); }

  setMuted(m: boolean): void {
    this.muted = m;
    this.pauseMenu?.setMuted(m);
  }

  /** GraphicsQuality reduced-motion toggle: kills HUD transitions/animations (OS preference is honored in CSS too). */
  setReducedMotion(on: boolean): void {
    document.documentElement.classList.toggle('hz-reduced-motion', on);
  }

  get isMapVisible(): boolean { return this.worldMap?.visible ?? false; }

  showMap(): void {
    if (this.isPauseVisible) return;
    this.worldMap?.show();
  }

  hideMap(): void { this.worldMap?.hide(); }

  /** V at an active nest: open the world map in nest teleport mode. */
  showTeleportMap(fromNestId: string): void {
    if (this.isPauseVisible) return;
    this.worldMap?.showTeleport(fromNestId);
  }

  toggleMap(): void {
    if (this.isMapVisible) this.hideMap();
    else this.showMap();
  }

  get isNestPanelVisible(): boolean { return this.nestPanel?.visible ?? false; }

  handleNestKey(key: string): boolean { return this.nestPanel?.handleKey(key) ?? false; }

  setCollectionCallbacks(cb: Partial<CollectionCallbacks>): void {
    this.collectionCallbacks = cb;
  }

  get isCollectionVisible(): boolean { return this.collectionPanel?.isVisible ?? false; }

  showCollection(): void {
    if (this.isPauseVisible) return;
    this.worldMap?.hide();
    this.collectionPanel?.setVisible(true, this.lastState ?? undefined);
  }

  hideCollection(): void {
    this.collectionPanel?.setVisible(false);
  }

  toggleCollection(): void {
    if (this.isCollectionVisible) this.hideCollection();
    else this.showCollection();
  }

  get isModalOpen(): boolean { return this.isPauseVisible || this.isMapVisible || this.isCollectionVisible || this._introVisible; }

  showSaved(): void {
    this.el.savedTick.classList.add('is-visible');
    if (this.savedTimer !== null) window.clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      this.el.savedTick.classList.remove('is-visible');
      this.savedTimer = null;
    }, 1400);
  }

  private setIntroContent(firstRun: boolean, openWorld: boolean): void {
    const modal = this.el.introOverlay.querySelector('.ibz-modal');
    if (!modal) return;
    const keys = (k: string, label: string): string => `<div>${keyCaps(k)}<span>${label}</span></div>`;
    if (!openWorld) {
      modal.innerHTML = `<h1 class="ibz-modal-title">I BE ZOMBIE</h1>
        <p class="ibz-modal-pitch">You are the undead alpha in a quarantined city district. Break open the bus, locked alley,
          store and police pen, build outbreak momentum, breach the checkpoint gate and convert the defenders.</p>
        <div class="ibz-intro-keys">${keys('W A S D', 'Move')}${keys('Shift', 'Sprint')}${keys('LMB', 'Select target')}
          ${keys('RMB', 'Recall to follow')}${keys('Space', 'Horde rush')}</div>
        <div class="ibz-begin-prompt">Move or click to begin</div>`;
      return;
    }
    modal.innerHTML = firstRun
      ? `<h1 class="ibz-modal-title">I BE ZOMBIE</h1>
          <p class="ibz-modal-pitch">You are the Alpha, alone on the beach. Walk into the nest by the bus to raise a horde of
            ${BALANCE.openWorld.firstNestHorde} (+${BALANCE.openWorld.followersPerNest} for every stronghold nest you take), then overrun the city.</p>
          <div class="ibz-intro-keys">${keys('W A S D', 'Move')}${keys('Shift', 'Sprint')}${keys('LMB', 'Bite & claw')}
            ${keys('RMB', 'Horde attack / move')}${keys('Space', 'Recall horde')}${keys('Q T R F', 'Mutations')}
            ${keys('M', 'World map')}${keys('Esc', 'Pause & save')}</div>
          <div class="ibz-begin-prompt">Move or click to begin</div>`
      : `<h1 class="ibz-modal-title">I BE ZOMBIE</h1>
          <p class="ibz-modal-pitch">Your conquest continues. Your nests are waiting.</p>
          <div class="ibz-begin-prompt">Move or click to continue</div>`;
  }

  get introVisible(): boolean { return this._introVisible; }
  get isHelpVisible(): boolean { return this.helpVisible; }

  showIntro(): void {
    if (!this._introVisible) {
      this._introVisible = true;
      this.el.introOverlay.classList.add('is-visible');
    }
  }

  hideIntro(): void {
    if (this._introVisible) {
      this._introVisible = false;
      this.el.introOverlay.classList.remove('is-visible');
    }
  }

  /** Opening cinematic: hide the whole gameplay HUD; on exit the panels slide back in. */
  setCinematic(on: boolean): void {
    const was = this.cinematic;
    this.cinematic = on;
    this.container.classList.toggle('is-cinematic', on);
    if (on) {
      this.hideIntro();
      if (this.helpVisible) this.toggleHelp();
      this.worldMap?.hide();
      this.clearToasts();
      this.clearBanner();
    } else if (was) {
      this.container.classList.add('is-arriving');
      if (this.arriveTimer !== null) window.clearTimeout(this.arriveTimer);
      this.arriveTimer = window.setTimeout(() => {
        this.container.classList.remove('is-arriving');
        this.arriveTimer = null;
      }, 1400);
      this.helpHintUntilMs = performance.now() + 45000;
    }
  }

  toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    if (this.helpVisible) this.helpSeen = true;
    this.el.helpPanel.classList.toggle('is-visible', this.helpVisible);
  }

  onIntroDismissed(cb: () => void): void { this.introDismissCallbacks.push(cb); }
  onRestart(cb: () => void): void { this.restartCallbacks.push(cb); }

  reset(): void {
    this.prevFollowerCount = null;
    this.bestFollowers = 0;
    this.gainAccum = 0;
    this.lossAccum = 0;
    this.popupBurst = 0;
    this.popupShown = false;
    this.bioAccum = 0;
    this.lastDamageSource = null;
    this.lastDamageMs = -1e9;
    this.lastRecruitMs = -1e9;
    this.lastSwingMs = -1e9;
    this.objExpandUntilMs = 0;
    this.objCelebrateUntilMs = 0;
    this.objStepSig = '';
    this.obj = null;
    this.lastObjMs = -1e9;
    this.bannerKeys.clear();
    this.clearBanner();
    this.clearToasts();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    for (const k of ['hordeGain', 'hordeLoss', 'bioFloat', 'pop', 'hitmark', 'vignette', 'strengthMeter', 'lastBrain', 'portrait']) {
      this.el[k].className = this.el[k].className.split(' ').filter((c) => !c.startsWith('is-')).join(' ');
    }
    this.helpVisible = false;
    this.el.helpPanel.classList.remove('is-visible');
    this.prevDistrictId = null;
    this.districtBannerUntilMs = 0;
    this.s = {};
    this.minimap?.invalidate();
    this.worldMap?.hide();
    this.pauseMenu?.hide();
    for (let i = 0; i < 4; i++) {
      this.deniedUntilMs[i] = 0;
      this.slotEls[i].sig = '';
      this.slotEls[i].abilityId = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  consume(events: readonly GameEvent[]): void {
    const nowMs = performance.now();
    const st = this.lastState;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (st) {
        const src = damageSourceFor(ev, st.leader.pos);
        if (src) {
          this.lastDamageSource = src;
          this.lastDamageSourceMs = nowMs;
        }
      }
      const banner = bannerForEvent(ev, this.bannerCount);
      if (banner) this.queueBanner(banner);

      switch (ev.type) {
        case 'orderChanged':
          if (ev.order.type === 'follow') this.showToast('Horde is following you', 'info');
          else if (ev.order.type === 'move') this.showToast('Horde moving out', 'info');
          else if ((st?.squads.length ?? 0) > 0) this.showToast(`Horde split: ${st!.squads.length + 1} targets`, 'info');
          else this.showToast(`Sic 'em: ${this.describeTargetLabel(ev.order.target).toLowerCase()}`, 'info');
          break;
        case 'hordeUnlocked':
          // The HORDE UNLOCKED banner covers it: the granted horde fills the cap, so skip the MAXIMUM HORDE milestone.
          this.bestFollowers = Math.max(this.bestFollowers, ev.count);
          break;
        case 'capReached':
          if (followerCap(this.layout, this.lastState) <= 0) this.showToast('No horde yet: walk into the nest by the bus to raise one', 'warn');
          else this.showToast(`Horde is full (${followerCap(this.layout, this.lastState)})`, 'warn');
          break;
        case 'gateDestroyed':
          break; // banner
        case 'structureDestroyed':
          this.showToast(`${structureBarTitle(ev.kind)} smashed!`, 'good');
          break;
        case 'converted':
          if (!this.layout) this.showToast('Human converted to the horde!', 'good');
          break;
        case 'rushStart':
          if (!this.layout) this.showToast('Horde rush!', 'good');
          break;
        case 'frenzyStart':
          this.showToast('Horde frenzy!', 'good');
          break;
        case 'bruteEvolved':
          this.showToast('A follower bulks up into a Brute', 'good');
          break;
        case 'autosave':
          this.showSaved();
          break;
        case 'attackSwing':
          if (ev.hit) {
            this.lastSwingMs = nowMs;
            retrigger(this.el.hitmark, 'is-hit');
          }
          break;
        case 'biomassGain':
          if (this.layout && ev.amount > 0) {
            this.bioAccum = nowMs <= this.bioWindowEndMs ? this.bioAccum + ev.amount : ev.amount;
            this.bioWindowEndMs = nowMs + 700;
            this.el.bioFloat.textContent = `+${Math.round(this.bioAccum)}`;
            retrigger(this.el.bioFloat, 'is-show');
            retrigger(this.el.bio, 'is-pop');
          }
          break;
        case 'objectiveComplete':
          this.objCelebrateUntilMs = nowMs + 1100;
          this.objExpandUntilMs = Math.max(this.objExpandUntilMs, nowMs + 4000);
          this.lastObjMs = -1e9;
          break;
        case 'hordeStrengthChanged':
          if (ev.delta < 0) retrigger(this.el.strengthMeter, 'is-hit');
          else if (ev.delta > 0) retrigger(this.el.strengthMeter, 'is-gain');
          break;
        case 'sharedDamage':
          this.lastDamageMs = nowMs;
          retrigger(this.el.strengthMeter, 'is-hit');
          retrigger(this.el.vignette, 'is-hit');
          retrigger(this.el.portrait, 'is-hurt');
          if (st && this.lastDamageSource && nowMs - this.lastDamageSourceMs < 400) {
            const angle = cueScreenAngle(st.leader.pos, this.lastDamageSource, this.lastCameraYaw);
            const arc = this.dmgArcs[this.dmgArcNext];
            this.dmgArcNext = (this.dmgArcNext + 1) % this.dmgArcs.length;
            arc.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`;
            retrigger(arc, 'is-show');
            this.lastDamageSource = null;
          }
          break;
        case 'lastBrainStart':
          retrigger(this.el.lastBrain, 'is-enter');
          retrigger(this.el.vignette, 'is-hit');
          break;
        case 'lastBrainEnd':
          if (ev.outcome === 'recovered') {
            retrigger(this.el.strengthMeter, 'is-gain');
            retrigger(this.el.lastBrain, 'is-end-good');
          } else {
            retrigger(this.el.lastBrain, 'is-end-bad');
          }
          break;
        case 'abilityDenied':
          this.flashDenied(ev.abilityId);
          break;
        default:
          break;
      }
      if (ev.type === 'strongholdCaptured') {
        this.objCelebrateUntilMs = nowMs + 1100;
        this.lastObjMs = -1e9;
        continue; // banner covers it; abilityUnlocked still toasts where to equip
      }
      if (this.layout || ev.type === 'abilityDenied') {
        const t = toastForEvent(ev, st);
        if (t) this.pushToast(t);
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

  // ---------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------

  /** Write `value` into the cache slot `key`; true when it changed. */
  private changed(key: string, value: string | number | boolean | null): boolean {
    if (this.s[key] === value) return false;
    this.s[key] = value;
    return true;
  }

  private setText(key: string, text: string): void {
    if (this.changed(`t:${key}`, text)) this.el[key].textContent = text;
  }

  private setClass(key: string, cls: string, on: boolean): void {
    if (this.changed(`c:${key}:${cls}`, on)) this.el[key].classList.toggle(cls, on);
  }

  private setScale(key: string, frac: number): void {
    const v = Math.round(frac * 400) / 400;
    if (this.changed(`x:${key}`, v)) this.el[key].style.transform = `scaleX(${v})`;
  }

  update(state: GameState, extras: HudExtras): void {
    const nowMs = performance.now();
    if (this.prevSimTime >= 0 && state.time < this.prevSimTime) this.reset();
    this.prevSimTime = state.time;
    this.lastState = state;
    const playing = state.phase === 'playing' && !this._introVisible;

    this.setClass('play', 'is-modal', this.isPauseVisible || this.isMapVisible || this.isCollectionVisible);

    if (this.layout && this.cityBrainsEl && this.cityAlertEl) {
      const brains = state.rewards.brains;
      if (this.changed('cityBrains', brains)) {
        this.cityBrainsEl.innerHTML = `${icon('brain', 's')}<b>${brains}</b><span>Brains</span>`;
      }
      const dId = getDistrictAt(this.layout, state.leader.pos);
      const alert = state.districts[dId]?.alert ?? 'normal';
      if (this.changed('cityAlert', alert)) {
        const label: Record<string, string> = {
          normal: 'Calm', concerned: 'Concerned', panic: 'Panic', lockdown: 'Lockdown', overrun: 'Overrun',
        };
        this.cityAlertEl.className = `hz-city-alert is-${alert}`;
        this.cityAlertEl.innerHTML = `${icon(alert === 'overrun' ? 'zombie' : alert === 'normal' ? 'eye' : 'warning', 's')}<span>${label[alert] ?? alert}</span>`;
        this.cityAlertEl.title = `District alert: ${label[alert] ?? alert}`;
      }
    }
    if (this.collectionPanel?.isVisible) {
      this.collectionPanel.render(state);
    }

    this.updateCharacter(state, extras, nowMs);
    this.updateHorde(state, nowMs);
    this.updateAbilities(state, nowMs);
    this.updateCenter(state, extras, nowMs, playing);
    this.updateGateOrStructureBar(state);
    if (this.layout) this.updateOpenWorld(state, extras, nowMs);
    else this.updateLegacy(state);

    // Context emphasis
    const ctx: HudContext = hudContext(state, (nowMs - this.lastDamageMs) / 1000, (nowMs - this.lastRecruitMs) / 1000,
      (nowMs - this.lastSwingMs) / 1000);
    if (this.changed('ctx', ctx)) this.container.dataset.ctx = ctx;

    // Banners
    this.pumpBanner(nowMs, playing);

    // F3 debug overlay
    this.debugOverlay.setVisible(extras.showDebug);
    if (extras.showDebug) {
      this.debugOverlay.update(state, {
        fps: extras.fps, frameMs: extras.frameMs, drawCalls: extras.drawCalls, loadedChunks: extras.loadedChunks,
        districtId: this.layout ? getDistrictAt(this.layout, state.leader.pos) : undefined,
      });
    }

    this.updateOverlays(state);
  }

  private updateCharacter(state: GameState, extras: HudExtras, nowMs: number): void {
    this.lastCameraYaw = extras.cameraYaw ?? 0;
    const sv = hordeStrengthView(state);
    this.setText('strengthNum', sv.text);
    this.setScale('strengthFill', sv.frac);
    this.setScale('strengthLag', sv.frac);
    this.setScale('strengthCore', sv.coreFrac);
    this.setClass('strengthMeter', 'is-low', sv.level === 'low');
    this.setClass('strengthMeter', 'is-critical', sv.level === 'critical');
    this.setClass('strengthMeter', 'is-last-brain', sv.level === 'lastBrain');
    this.setClass('vignette', 'is-low', sv.level === 'low' && state.phase === 'playing');
    this.setClass('vignette', 'is-critical', (sv.level === 'critical' || sv.level === 'lastBrain') && state.phase === 'playing');
    this.setClass('vignette', 'is-last-brain', sv.level === 'lastBrain' && state.phase === 'playing');

    const showLastBrain = sv.level === 'lastBrain' && state.phase === 'playing';
    this.setClass('lastBrain', 'is-active', showLastBrain);
    this.setText('lastBrainText', showLastBrain ? sv.countdownText : '');

    if (this.lastDamageSource && nowMs - this.lastDamageSourceMs < 400 && nowMs - this.lastDamageMs < 200) {
      const angle = cueScreenAngle(state.leader.pos, this.lastDamageSource, this.lastCameraYaw);
      const arc = this.dmgArcs[this.dmgArcNext];
      this.dmgArcNext = (this.dmgArcNext + 1) % this.dmgArcs.length;
      arc.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`;
      retrigger(arc, 'is-show');
      this.lastDamageSource = null;
    }

    const stam = Math.max(0, Math.min(1, state.leader.stamina / BALANCE.leader.staminaMax));
    this.setScale('stamFill', stam);
    this.setClass('stamMeter', 'is-exhausted', state.leader.exhausted);
    this.setClass('stamMeter', 'is-full', stam >= 0.999);

    const chips = statusChips(state);
    if (this.changed('chips', chipsSignature(chips))) {
      this.el.status.innerHTML = chips
        .map((c) => `<span class="hz-chip is-${c.tone}${c.frac >= 0 ? ' is-timed' : ''}" style="--f:${c.frac >= 0 ? c.frac.toFixed(2) : 1}">${icon(c.icon, 's')}<span>${c.label}</span></span>`)
        .join('');
    }
  }

  private updateHorde(state: GameState, nowMs: number): void {
    const cap = followerCap(this.layout, state);
    const count = state.followerCount;
    if (this.prevFollowerCount === null) {
      this.prevFollowerCount = count;
      this.bestFollowers = count;
    } else if (count > this.prevFollowerCount) {
      const gained = count - this.prevFollowerCount;
      this.prevFollowerCount = count;
      this.lastRecruitMs = nowMs;
      this.gainAccum = nowMs <= this.gainWindowEndMs ? this.gainAccum + gained : gained;
      this.gainWindowEndMs = nowMs + 650;
      this.el.hordeGain.textContent = `+${this.gainAccum}`;
      retrigger(this.el.hordeGain, 'is-show');
      retrigger(this.el.hordeNum, 'is-pop');
      retrigger(this.el.hordeIco, 'is-bounce');
      // Center popup for bigger bursts: one element, text grows while the burst continues.
      if (nowMs - this.popupStartMs > 650) {
        this.popupStartMs = nowMs;
        this.popupBurst = 0;
        this.popupShown = false;
      }
      this.popupBurst += gained;
      const pop = recruitPopup(this.popupBurst);
      if (pop && state.phase === 'playing') {
        this.el.pop.textContent = pop.text;
        this.el.pop.dataset.tier = String(pop.tier);
        if (!this.popupShown) {
          this.popupShown = true;
          retrigger(this.el.pop, 'is-show');
        }
      }
      const m = hordeMilestone(this.bestFollowers, count, cap);
      if (m !== null && this.layout && state.phase === 'playing') this.queueBanner(hordeBanner(m, cap, this.bannerCount));
      this.bestFollowers = Math.max(this.bestFollowers, count);
    } else if (count < this.prevFollowerCount) {
      const lost = this.prevFollowerCount - count;
      this.prevFollowerCount = count;
      this.lossAccum = nowMs <= this.lossWindowEndMs ? this.lossAccum + lost : lost;
      this.lossWindowEndMs = nowMs + 650;
      this.el.hordeLoss.textContent = `-${this.lossAccum}`;
      retrigger(this.el.hordeLoss, 'is-show');
      retrigger(this.el.horde, 'is-loss');
    }

    const hv = hordeView(state, cap, state.order.type === 'attack' ? this.describeTargetLabel(state.order.target).toLowerCase() : '');
    this.setText('hordeNum', `${count}`);
    this.setText('hordeCap', `/ ${cap}`);
    this.setScale('hordeCapFill', hv.fill);
    this.setClass('horde', 'is-full', hv.full);
    if (this.changed('orderMode', `${hv.mode}|${hv.tone}`)) {
      this.el.orderIco.innerHTML = icon(hv.icon, 's');
      this.el.order.className = `hz-chip hz-order is-${hv.tone}`;
    }
    this.setText('orderText', hv.label);

    const brutes = this.layout ? bruteCount(state) : 0;
    this.setText('brutesVal', `${brutes}`);
    this.setClass('brutes', 'is-visible', brutes > 0);
    // No 'Horde full!' before the first nest (cap 0): the capReached toast explains where to raise the horde.
    this.setClass('capFlash', 'is-visible', state.capReachedFlash > 0 && followerCap(this.layout, state) > 0);

    const hint = this.layout ? recallHint(state, this.coarsePointer) : null;
    this.setText('recallHint', hint ?? '');
    this.setClass('recallHint', 'is-visible', hint !== null);
  }

  private updateAbilities(state: GameState, nowMs: number): void {
    const pa = primaryAttackView(state);
    if (this.changed('paIcon', pa.icon)) {
      this.el.abPrimaryFace.innerHTML = icon(pa.icon, 'l');
      this.el.abPrimaryName.textContent = pa.name;
    }
    this.setClass('abPrimary', 'is-busy', pa.busy);
    const paDeg = Math.round(pa.frac * 360);
    if (this.changed('paDeg', paDeg)) this.el.abPrimarySweep.style.setProperty('--cd', `${paDeg}deg`);
    this.setText('abCombo', pa.combo > 0 ? '•'.repeat(pa.combo) : '');

    const away = state.followerCount > 0 && (state.order.type !== 'follow' || state.squads.length > 0);
    this.setClass('abRecall', 'is-idle', !away);

    if (!this.layout) {
      const rushActive = state.abilities.rushTimeLeft > 0.01;
      const rushCd = state.abilities.rushCooldown;
      const frac = rushActive ? state.abilities.rushTimeLeft / BALANCE.rush.duration : rushCd > 0.01 ? rushCd / BALANCE.rush.cooldown : 0;
      const deg = Math.round(Math.max(0, Math.min(1, frac)) * 360);
      if (this.changed('rushDeg', deg)) this.el.abRushSweep.style.setProperty('--cd', `${deg}deg`);
      this.setClass('abRush', 'is-active', rushActive);
      this.setClass('abRush', 'is-cooldown', !rushActive && rushCd > 0.01);
      this.setText('abRushCd', !rushActive && rushCd > 0.01 ? `${Math.ceil(rushCd)}` : '');
      return;
    }

    // Mutation slots Q T R F (only owned slots are shown; strip hidden at 0)
    const owned = visibleSlotCount(state);
    if (this.changed('owned', owned)) {
      this.el.slots.classList.toggle('is-hidden-slots', owned === 0);
      for (let i = 0; i < this.slotEls.length; i++) this.slotEls[i].root.classList.toggle('is-unowned', i >= owned);
    }
    for (let i = 0; i < owned; i++) {
      const v = abilitySlotView(state, i);
      const el = this.slotEls[i];
      if (el.abilityId !== v.abilityId) {
        el.abilityId = v.abilityId;
        el.face.innerHTML = v.abilityId ? icon(abilityIcon(v.abilityId), 'l') : `<span class="hz-ab-plus">+</span>`;
        el.name.textContent = v.abilityId ? v.name : 'Empty';
        el.root.title = v.abilityId ? ABILITIES[v.abilityId].description : 'Empty slot - equip a mutation at a nest';
      }
      const deg = Math.round(v.remainingFrac * 360);
      const cdText = v.kind === 'cooldown' ? `${Math.ceil(v.seconds)}` : v.kind === 'active' ? `${Math.ceil(v.seconds)}` : '';
      const costText = v.kind === 'nobiomass' ? `${v.cost}` : v.cost > 0 && v.kind === 'ready' ? `${v.cost}` : '';
      const sig = `${v.kind}|${deg}|${cdText}|${costText}`;
      if (sig !== el.sig) {
        el.sig = sig;
        el.sweep.style.setProperty('--cd', `${deg}deg`);
        el.cd.textContent = cdText;
        el.cost.innerHTML = costText ? `${icon('brain', 's')}${costText}` : '';
        if (v.kind !== el.kind) {
          if (el.kind) el.root.classList.remove(`is-${el.kind}`);
          if ((el.kind === 'cooldown' || el.kind === 'nobiomass') && v.kind === 'ready') retrigger(el.root, 'is-ready-flash');
          if (v.kind === 'active') retrigger(el.root, 'is-activated');
          el.kind = v.kind;
          el.root.classList.add(`is-${v.kind}`);
        }
      }
      const denied = nowMs < this.deniedUntilMs[i];
      if (denied !== el.denied) {
        el.denied = denied;
        el.root.classList.toggle('is-denied', denied);
      }
    }
  }

  private updateCenter(state: GameState, extras: HudExtras, nowMs: number, playing: boolean): void {
    // Hover target label
    const hover = extras.hoverLabel;
    if (this.changed('hover', hover)) {
      if (hover) {
        const isHuman = hover === 'SOLDIER' || hover === 'POLICE' || hover === 'CIVILIAN';
        this.el.hoverLabel.innerHTML = `${icon(isHuman ? 'human' : hover === 'GATE' ? 'gate' : 'target', 's')}<span>${hover.toLowerCase()}</span>${
          this.layout ? '<span class="hz-key is-mouse">RMB</span>' : ''}`;
      }
      this.el.hoverLabel.classList.toggle('is-visible', !!hover);
    }
    const locked = Boolean(extras.pointerLocked);
    this.setClass('crosshair', 'is-visible', locked && playing && !this.helpVisible);
    this.setClass('crosshair', 'is-target', !!hover);

    // Contextual actions (bottom-right), 4 Hz
    const hoverChanged = this.changed('ctxHover', hover);
    if (!hoverChanged && nowMs - this.lastCtxMs <= 250) {
      this.setClass('helpHint', 'is-visible', playing && !this.helpSeen && nowMs < this.helpHintUntilMs);
      return;
    }
    this.lastCtxMs = nowMs;
    const actions = this.layout && playing
      ? contextActions(state, {
        hoverLabel: hover, drinkNearby: drinkNearby(state), layout: this.layout,
      })
      : [];
    if (this.changed('ctxSig', contextSignature(actions))) {
      this.el.context.innerHTML = actions
        .map((a) => `<div class="hz-ctx is-${a.tone}">${a.keys.map((k) => `<span class="hz-key${k.length > 2 ? ' is-mouse' : ''}">${k}</span>`).join('')}<span class="hz-ctx-label">${a.label}</span>${icon(a.icon, 's')}</div>`)
        .join('');
    }
    this.setClass('helpHint', 'is-visible', playing && !this.helpSeen && nowMs < this.helpHintUntilMs);
  }

  private updateOverlays(state: GameState): void {
    const respawnVisible = this.layout !== null && state.phase === 'respawning';
    if (this.changed('respawnVis', respawnVisible)) {
      this.el.respawnOverlay.classList.toggle('is-visible', respawnVisible);
      if (respawnVisible) {
        this.hideIntro();
        this.worldMap?.hide();
        const nest = this.layout?.nests.find((n) => n.id === state.activeNestId);
        const where = nest ? districtName(nest.districtId) : 'your nest';
        this.el.respawnSub.textContent = `The horde remembers. You will rise again at the ${where} nest.`;
      }
    }
    if (respawnVisible) this.setText('respawnCount', `${Math.max(0, Math.ceil(state.leader.respawnTimer))}`);

    if (state.phase !== this.prevPhase) {
      this.prevPhase = state.phase;
      const vic = state.phase === 'victory';
      const def = state.phase === 'defeat';
      if (vic) this.el.victoryStats.innerHTML = this.buildStatsHtml(state);
      if (def) this.el.defeatStats.innerHTML = this.buildStatsHtml(state);
      if (vic || def) this.hideIntro();
      this.el.victoryOverlay.classList.toggle('is-visible', vic);
      this.el.defeatOverlay.classList.toggle('is-visible', def);
    }
  }

  dispose(): void {
    this.clearToasts();
    this.clearBanner();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    if (this.savedTimer !== null) window.clearTimeout(this.savedTimer);
    this.savedTimer = null;
    if (this.arriveTimer !== null) window.clearTimeout(this.arriveTimer);
    this.arriveTimer = null;
    this.minimap?.dispose();
    this.worldMap?.dispose();
    this.pauseMenu?.dispose();
    this.nestPanel?.dispose();
    this.debugOverlay.dispose();
    this.waypointCallbacks.length = 0;
    this.nestTeleportCallbacks.length = 0;
    this.equipCallbacks.length = 0;
    this.buySlotCallbacks.length = 0;
    this.buyVisionCallbacks.length = 0;
    this.buyTraitCallbacks.length = 0;
    this.el.introOverlay.removeEventListener('pointerdown', this.onIntroClick);
    this.el.victoryBtn.removeEventListener('click', this.onRestartClick);
    this.el.defeatBtn.removeEventListener('click', this.onRestartClick);
    this.restartCallbacks.length = 0;
    this.introDismissCallbacks.length = 0;
    document.documentElement.classList.remove('hz-reduced-motion');
    this.root.innerHTML = '';
  }

  private updateOpenWorld(state: GameState, extras: HudExtras, nowMs: number): void {
    const layout = this.layout;
    if (!layout) return;

    this.setText('bioVal', `${Math.floor(state.progression.biomass)}`);
    const eyes = eyesightLabel(state);
    this.setText('eyesVal', eyes.name);

    this.updateObjective(state, nowMs);

    // District-entered banner with threat-tier pips
    const curDistrict = getDistrictAt(layout, state.leader.pos);
    if (this.prevDistrictId === null) {
      this.prevDistrictId = curDistrict;
    } else if (curDistrict !== this.prevDistrictId) {
      this.prevDistrictId = curDistrict;
      const meta = districtMeta(curDistrict);
      const filled = threatPipCount(meta.threatTier);
      this.el.districtName.textContent = meta.name;
      let pipsHtml = '';
      for (let i = 0; i < 5; i++) pipsHtml += `<span class="hz-pip${i < filled ? ' is-filled' : ''}"></span>`;
      pipsHtml += `<span class="hz-pip-label">Threat ${filled}/5</span>`;
      this.el.districtPips.innerHTML = pipsHtml;
      this.el.districtThreat.textContent = meta.threat;
      this.districtBannerUntilMs = nowMs + 3800;
    }
    this.setClass('districtBanner', 'is-visible', nowMs < this.districtBannerUntilMs && state.phase === 'playing' && !this._introVisible);

    // Humorous one-time eyesight tips (per HUD session, no persistence)
    if (state.phase === 'playing' && !this._introVisible) {
      if (!this.tipPoorSightShown && state.progression.visionTier === 1) {
        this.tipPoorSightShown = true;
        this.showToast('Rotten Eyes: past 18 m is a blur. Trust ears and nose.', 'info');
      } else if (!this.tipUpgradeAffordableShown && !this.nestPanel?.visible) {
        const vCost = visionCost(state);
        if (vCost !== null && state.progression.biomass >= vCost) {
          this.tipUpgradeAffordableShown = true;
          this.showToast('Enough brains for better eyes! Buy Eyesight at a nest.', 'good');
        }
      }
    }

    this.minimap?.update(state, extras.waypoint ?? null, this.obj?.target ?? null, nowMs);
    if (this.worldMap?.visible) this.worldMap.update(state, extras.waypoint ?? null, nowMs);
    this.nestPanel?.update(state, nearbyEquipNest(state, layout) !== null);
  }

  private updateObjective(state: GameState, nowMs: number): void {
    if (nowMs - this.lastObjMs >= 250) {
      this.lastObjMs = nowMs;
      const v = objectiveView(this.layout, state);
      this.obj = v;
      if (v.stepSig !== this.objStepSig) {
        if (this.objStepSig !== '') this.objExpandUntilMs = Math.max(this.objExpandUntilMs, nowMs + 4500);
        else this.objExpandUntilMs = nowMs + 6000; // first look at the objective: show the steps once
        this.objStepSig = v.stepSig;
      }
      if (this.changed('objSig', v.sig)) {
        const ico: IconName = v.kind === 'stronghold' ? 'fort' : v.kind === 'nest' ? 'nest' : v.kind === 'complete' ? 'check' : 'pin';
        if (this.changed('objIcoName', ico)) this.el.objIco.innerHTML = icon(ico);
        this.el.objTitle.textContent = v.title;
        this.el.objSub.textContent = v.sub;
        this.el.objCount.textContent = v.total > 0 ? `${v.done} / ${v.total}` : '';
        this.el.obj.classList.toggle('is-contested', v.contested);
        this.el.obj.classList.toggle('has-progress', v.total > 0);
        let partial = 0;
        for (const r of v.rows) if (!r.done) { partial = r.progress; break; }
        const frac = v.total > 0 ? Math.min(1, (v.done + partial) / v.total) : 0;
        this.el.objFill.style.transform = `scaleX(${frac.toFixed(3)})`;
        this.el.objTrack.style.setProperty('--segs', String(Math.max(1, v.total)));
        let html = '';
        if (v.kind === 'stronghold') {
          html += `<div class="hz-obj-meta">${v.contested ? '<span class="hz-chip is-coral">Contested</span>' : ''}<span>Defense tier ${v.tier}</span></div>`;
          for (const r of v.rows) {
            html += `<div class="hz-obj-row${r.done ? ' is-done' : ''}">${r.done ? icon('check', 's') : '<span class="hz-obj-dot"></span>'}
              <span class="hz-obj-label">${r.label}</span>
              <span class="hz-obj-bar"><span style="transform:scaleX(${r.progress.toFixed(3)})"></span></span></div>`;
          }
          html += `<div class="hz-obj-reward">${icon('star', 's')}${v.reward}</div>`;
        } else if (v.kind === 'nest') {
          html += `<div class="hz-obj-reward">${icon('horde', 's')}${v.reward}</div>`;
        }
        this.el.objDetails.innerHTML = html;
      }
    }
    const expanded = (this.obj?.kind === 'stronghold' || this.obj?.kind === 'nest') && (nowMs < this.objExpandUntilMs || this.helpVisible);
    this.setClass('obj', 'is-expanded', expanded);
    this.setClass('obj', 'is-celebrate', nowMs < this.objCelebrateUntilMs);
    this.setClass('obj', 'is-empty', this.obj === null || this.obj.kind === 'none');
  }

  private updateLegacy(state: GameState): void {
    this.setText('legacySub', this.chooseObjectiveText(state));
    let alive = 0;
    for (const g of state.guards) if ((g.post ?? 'checkpoint') === 'checkpoint' && g.state !== 'DEAD' && g.hp > 0) alive++;
    this.setText('guards', `${alive} / ${BALANCE.guard.count}`);
  }

  private chooseObjectiveText(state: GameState): string {
    if (state.gate.destroyed) return 'Eliminate the guards';
    const structures = state.structures;
    if (structures && structures.length > 0) {
      const busDoor = structures.find((s) => s.kind === 'busDoor');
      const penGate = structures.find((s) => s.kind === 'penGate');
      const storeDoor = structures.find((s) => s.kind === 'storeDoor');
      const alleyGate = structures.find((s) => s.kind === 'alleyGate');
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
    const isTargetSelected = (pred: (t: TargetRef) => boolean): boolean => {
      if (state.order.type === 'attack' && pred(state.order.target)) return true;
      for (let i = 0; i < state.squads.length; i++) if (pred(state.squads[i].target)) return true;
      return false;
    };
    const gateTargeted = isTargetSelected((t) => t.kind === 'gate');
    let activeStruct: StructureState | null = null;
    if (state.structures && state.structures.length > 0) {
      for (let i = 0; i < state.structures.length; i++) {
        const s = state.structures[i];
        if (s.destroyed) continue;
        const targeted = isTargetSelected(
          (t) => (t.kind === 'structure' && t.id === s.id) ||
            (t.kind === 'guard' && state.guards.some((g) => g.id === t.id && g.shelter === s.id)),
        );
        if (targeted || s.hitFlash > 0) {
          activeStruct = s;
          break;
        }
      }
      if (!activeStruct && !gateTargeted && !this.layout) {
        for (let i = 0; i < state.structures.length; i++) {
          const s = state.structures[i];
          if (!s.destroyed && s.hp < s.maxHp) {
            activeStruct = s;
            break;
          }
        }
      }
    }
    const showGate = !activeStruct && !state.gate.destroyed && !this.layout && (state.gate.hp < state.gate.maxHp || gateTargeted);
    const showBar = !!activeStruct || showGate;
    this.setClass('gateBar', 'is-visible', showBar);
    if (!showBar) return;
    const label = activeStruct ? structureBarTitle(activeStruct.kind) : 'Checkpoint Gate';
    const curHp = activeStruct ? activeStruct.hp : state.gate.hp;
    const maxHp = activeStruct ? activeStruct.maxHp : state.gate.maxHp;
    this.setText('gateLabel', label);
    this.setText('gateVal', `${Math.max(0, Math.ceil(curHp))} / ${maxHp}`);
    this.setScale('gateFill', Math.max(0, Math.min(1, curHp / Math.max(1, maxHp))));
    if (activeStruct && activeStruct.hitFlash > 0 && this.changed('gateHit', Math.round(state.time * 4))) retrigger(this.el.gateBar, 'is-hit');
  }

  private describeTargetLabel(target: TargetRef): string {
    if (target.kind === 'gate') return 'GATE';
    if (target.kind === 'structure') {
      const s = this.lastState?.structures?.find((st) => st.id === target.id);
      return s ? structureHudLabel(s.kind) : 'BARRIER';
    }
    if (target.kind === 'guard') {
      const g = this.lastState?.guards.find((gd) => gd.id === target.id);
      return g?.role === 'civilian' ? 'CIVILIAN' : 'GUARD';
    }
    if (target.kind === 'vehicle') return 'CAR';
    return 'TARGET';
  }

  // ---------------------------------------------------------------------------
  // Banners
  // ---------------------------------------------------------------------------

  private queueBanner(b: BannerSpec): void {
    if (this.bannerKeys.has(b.key)) return;
    this.bannerKeys.add(b.key);
    this.bannerCount++;
    if (this.bannerQueue.length >= 3) this.bannerQueue.shift();
    this.bannerQueue.push(b);
  }

  private pumpBanner(nowMs: number, playing: boolean): void {
    if (!playing || this.cinematic || this.isModalOpen || nowMs < this.bannerBusyUntilMs || this.bannerQueue.length === 0) return;
    const b = this.bannerQueue.shift()!;
    const el = this.el.banner;
    el.className = `hz-banner is-${b.tone}`;
    this.el.bannerIco.innerHTML = icon(b.icon, 'l');
    this.el.bannerTitle.textContent = b.title;
    this.el.bannerSub.textContent = b.sub;
    this.el.bannerQuip.textContent = b.quip;
    retrigger(el, 'is-show');
    this.bannerBusyUntilMs = nowMs + 3000;
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      el.classList.remove('is-show');
    }, 2800);
    this.timers.add(id);
  }

  private clearBanner(): void {
    this.bannerQueue.length = 0;
    this.bannerBusyUntilMs = 0;
    this.el.banner?.classList.remove('is-show');
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------

  private showToast(msg: string, kind: ToastSpec['kind'] = 'info'): void {
    this.pushToast({ text: msg, kind });
  }

  private pushToast(spec: ToastSpec): void {
    const stack = this.el.toastStack;
    const life = this.layout ? 3600 : 1800;
    const kids = stack.children;
    const texts: (string | null)[] = [];
    for (let i = 0; i < kids.length; i++) texts.push((kids[i] as HTMLElement).dataset.text ?? null);
    const dup = toastDedupe(texts, spec.text);
    if (dup !== 'add') {
      const node = kids[dup] as HTMLElement;
      const old = this.toastByEl.get(node);
      if (old !== undefined) {
        window.clearTimeout(old);
        this.toastTimers.delete(old);
      }
      retrigger(node, 'is-pulse');
      this.armToast(node, life);
      return;
    }
    const el = document.createElement('div');
    el.className = `hz-toast is-${spec.kind}`;
    el.dataset.text = spec.text;
    el.innerHTML = `${icon(TOAST_ICON[spec.kind], 's')}<span></span>`;
    (el.lastElementChild as HTMLElement).textContent = spec.text;
    stack.appendChild(el);
    while (stack.childElementCount > 3) {
      const old = stack.firstElementChild as HTMLElement | null;
      if (!old) break;
      const tid = this.toastByEl.get(old);
      if (tid !== undefined) {
        window.clearTimeout(tid);
        this.toastTimers.delete(tid);
        this.toastByEl.delete(old);
      }
      old.remove();
    }
    this.armToast(el, life);
  }

  private armToast(el: HTMLElement, life: number): void {
    const id = window.setTimeout(() => {
      this.toastTimers.delete(id);
      el.classList.add('is-leaving');
      const rid = window.setTimeout(() => {
        this.toastTimers.delete(rid);
        this.toastByEl.delete(el);
        el.remove();
      }, 260);
      this.toastTimers.add(rid);
      this.toastByEl.set(el, rid);
    }, life);
    this.toastTimers.add(id);
    this.toastByEl.set(el, id);
  }

  private clearToasts(): void {
    for (const id of this.toastTimers) window.clearTimeout(id);
    this.toastTimers.clear();
    this.toastByEl.clear();
    if (this.el.toastStack) this.el.toastStack.innerHTML = '';
  }

  private buildStatsHtml(state: GameState): string {
    const cell = (label: string, val: string | number): string =>
      `<div class="ibz-stat-cell"><div class="ibz-stat-label">${label}</div><div class="ibz-stat-val">${val}</div></div>`;
    return cell('Surviving followers', state.followerCount) + cell('Outbreak spread', state.stats.cascadeRecruits ?? 0) +
      cell('Conversions', state.stats.conversions) + cell('Barriers broken', state.stats.structuresDestroyed ?? 0) +
      cell('Horde losses', state.stats.losses) + cell('Time elapsed', formatTime(state.time));
  }
}
