import './hud.css';
import { BALANCE } from '../config/balance';
import type {
  GameEvent,
  GamePhase,
  GameState,
  MomentumTier,
  StructureKind,
  StructureState,
  TargetRef,
} from '../core/types';

export interface HudExtras {
  fps: number;
  drawCalls: number;
  showDebug: boolean;
  hoverLabel: string | null;
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
    case 'penGate':
    default:
      return 'Pen Gate';
  }
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
  private readonly debugBoxEl: HTMLDivElement;

  // Top-center elements
  private readonly objectiveSubEl: HTMLDivElement;
  private readonly gateBarEl: HTMLDivElement;
  private readonly gateLabelEl: HTMLSpanElement;
  private readonly gateValueEl: HTMLSpanElement;
  private readonly gateFillEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;

  // Top-right elements
  private readonly hordeCountEl: HTMLDivElement;
  private readonly hordeFloaterEl: HTMLSpanElement;
  private readonly capFlashEl: HTMLDivElement;
  private readonly momBoxEl: HTMLDivElement;
  private readonly momTierEl: HTMLSpanElement;
  private readonly momValEl: HTMLSpanElement;
  private readonly momFillEl: HTMLDivElement;
  private readonly guardsCountEl: HTMLDivElement;

  // Center hover label
  private readonly hoverLabelEl: HTMLDivElement;

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

  // Help & Overlays
  private readonly helpPanelEl: HTMLDivElement;
  private readonly introOverlayEl: HTMLDivElement;
  private readonly victoryOverlayEl: HTMLDivElement;
  private readonly victoryStatsEl: HTMLDivElement;
  private readonly defeatOverlayEl: HTMLDivElement;
  private readonly defeatStatsEl: HTMLDivElement;
  private readonly victoryBtn: HTMLButtonElement;
  private readonly defeatBtn: HTMLButtonElement;

  private _introVisible = true;
  private helpVisible = false;
  private toastTimeoutId: number | null = null;
  private readonly restartCallbacks: (() => void)[] = [];

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
  private prevDebugVisible = false;
  private prevDebugText = '';
  private prevPhase: GamePhase = 'playing';

  private readonly onIntroClick = (): void => {
    this.hideIntro();
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
      </div>

      <div class="ibz-debug-box" data-ref="debugBox"></div>

      <div class="ibz-top-center">
        <div class="ibz-panel ibz-objective-card">
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
        <div class="ibz-toast" data-ref="toast"></div>
      </div>

      <div class="ibz-panel ibz-top-right">
        <div class="ibz-horde-row">
          <span class="ibz-horde-floater" data-ref="hordeFloater">+1</span>
          <div class="ibz-horde-count" data-ref="hordeCount">HORDE 5 / 100</div>
        </div>
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
        <div class="ibz-guards-count" data-ref="guardsCount">GUARDS 8 / 8</div>
      </div>

      <div class="ibz-hover-label" data-ref="hoverLabel"></div>

      <div class="ibz-bottom-left">
        <div class="ibz-panel ibz-order-pill" data-ref="orderPill">
          <span class="ibz-order-dot"></span>
          <span data-ref="orderText">FOLLOWING</span>
        </div>
      </div>

      <div class="ibz-bottom-center">
        <div class="ibz-panel ibz-ability-card" data-ref="rallyCard">
          <div class="ibz-ability-top">
            <span class="ibz-key-badge">E</span>
            <span class="ibz-ability-name">RALLY</span>
          </div>
          <div class="ibz-ability-state" data-ref="rallyState">READY</div>
          <div class="ibz-ability-cd-fill" data-ref="rallyFill"></div>
        </div>

        <div class="ibz-panel ibz-ability-card" data-ref="rushCard">
          <div class="ibz-ability-top">
            <span class="ibz-key-badge">SPACE</span>
            <span class="ibz-ability-name">RUSH</span>
          </div>
          <div class="ibz-ability-state" data-ref="rushState">READY</div>
          <div class="ibz-ability-cd-fill" data-ref="rushFill"></div>
        </div>
      </div>

      <div class="ibz-panel ibz-bottom-right">
        WASD move &middot; Shift sprint &middot; LMB select/unselect targets &middot; RMB follow &middot; Drag/Z/X look &middot; V look back &middot; Tab help
      </div>

      <div class="ibz-help-panel" data-ref="helpPanel">
        <h3 class="ibz-help-title">Controls &amp; Commands</h3>
        <table class="ibz-help-table">
          <tbody>
            <tr><td>W A S D / Arrows</td><td>Move leader relative to camera</td></tr>
            <tr><td>Shift</td><td>Sprint while stamina allows</td></tr>
            <tr><td>Left-Click Target</td><td>Select / unselect a guard, civilian, gate, or landmark door &mdash; the horde splits across selected targets</td></tr>
            <tr><td>Landmarks</td><td>Break the bus door / alley gate / store door / pen gate to free or reach whoever is inside</td></tr>
            <tr><td>Outbreak Momentum</td><td>Recruit, convert, kill soldiers &amp; break barriers to boost recruit radius (+50%) and horde speed (+20%)</td></tr>
            <tr><td>Left-Click Ground</td><td>World ping</td></tr>
            <tr><td>Right-Click</td><td>Recall horde to Follow leader</td></tr>
            <tr><td>Left / Right-Drag</td><td>Orbit &amp; tilt camera (stays where you leave it)</td></tr>
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
            <div><strong>Drag / Wheel / V</strong> Look Around, Zoom, Look Back</div>
            <div><strong>Left-Click</strong> Select Targets / Doors</div>
            <div><strong>Right-Click</strong> Recall to Follow</div>
            <div><strong>E</strong> Rally Nearby Walkers</div>
            <div><strong>Space</strong> Trigger Horde Rush</div>
          </div>
          <div class="ibz-begin-prompt">Move or click to begin</div>
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
    this.debugBoxEl = q('debugBox');
    this.objectiveSubEl = q('objSub');
    this.gateBarEl = q('gateBar');
    this.gateLabelEl = q('gateLabel');
    this.gateValueEl = q('gateVal');
    this.gateFillEl = q('gateFill');
    this.toastEl = q('toast');
    this.hordeCountEl = q('hordeCount');
    this.hordeFloaterEl = q('hordeFloater');
    this.capFlashEl = q('capFlash');
    this.momBoxEl = q('momBox');
    this.momTierEl = q('momTier');
    this.momValEl = q('momVal');
    this.momFillEl = q('momFill');
    this.guardsCountEl = q('guardsCount');
    this.hoverLabelEl = q('hoverLabel');
    this.orderPillEl = q('orderPill');
    this.orderTextEl = q('orderText');
    this.rallyCardEl = q('rallyCard');
    this.rallyStateEl = q('rallyState');
    this.rallyFillEl = q('rallyFill');
    this.rushCardEl = q('rushCard');
    this.rushStateEl = q('rushState');
    this.rushFillEl = q('rushFill');
    this.helpPanelEl = q('helpPanel');
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
  }

  get introVisible(): boolean {
    return this._introVisible;
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

  toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    this.helpPanelEl.classList.toggle('is-visible', this.helpVisible);
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
    this.toastEl.classList.remove('is-visible');
  }

  consume(events: readonly GameEvent[]): void {
    const nowMs = performance.now();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'orderChanged') {
        if (ev.order.type === 'follow') {
          this.showToast('RECALL: FOLLOWING LEADER');
        } else if ((this.lastState?.squads.length ?? 0) > 0) {
          this.showToast(`HORDE SPLIT: ${this.lastState!.squads.length + 1} TARGETS`);
        } else {
          this.showToast(`ATTACK ORDER: ${this.describeTargetLabel(ev.order.target)}`);
        }
      } else if (ev.type === 'capReached') {
        this.showToast('HORDE CAPACITY REACHED (100)');
      } else if (ev.type === 'gateDestroyed') {
        this.showToast('CHECKPOINT GATE BREACHED!');
      } else if (ev.type === 'structureDestroyed') {
        this.showToast(`${structureHudLabel(ev.kind)} BREACHED!`);
      } else if (ev.type === 'converted') {
        this.showToast('HUMAN CONVERTED TO HORDE!');
      } else if (ev.type === 'rushStart') {
        this.showToast('HORDE RUSH ACTIVATED!');
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

    const hordeText = `HORDE ${state.followerCount} / ${BALANCE.horde.maxFollowers}`;
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

    // 4. Hover Label
    if (extras.hoverLabel !== this.prevHoverLabel) {
      this.prevHoverLabel = extras.hoverLabel;
      if (extras.hoverLabel) {
        this.hoverLabelEl.textContent = extras.hoverLabel;
        this.hoverLabelEl.classList.add('is-visible');
      } else {
        this.hoverLabelEl.classList.remove('is-visible');
      }
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

    // 7. F3 Debug Panel
    if (extras.showDebug !== this.prevDebugVisible) {
      this.prevDebugVisible = extras.showDebug;
      this.debugBoxEl.classList.toggle('is-visible', extras.showDebug);
    }
    if (extras.showDebug) {
      let liveZombies = 0;
      for (let i = 0; i < state.zombies.length; i++) {
        if (state.zombies[i].state !== 'dead') liveZombies++;
      }
      const debugText = `FPS: ${Math.round(extras.fps)} | Draw Calls: ${extras.drawCalls}\nLive Zombies: ${liveZombies} | Followers: ${state.followerCount}\nCheckpoint Guards Alive: ${aliveCheckpointGuards}`;
      if (debugText !== this.prevDebugText) {
        this.prevDebugText = debugText;
        this.debugBoxEl.innerHTML = debugText.replace(/\n/g, '<br/>');
      }
    }

    // 8. Victory / Defeat Overlays
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
    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
    this.introOverlayEl.removeEventListener('pointerdown', this.onIntroClick);
    this.victoryBtn.removeEventListener('click', this.onRestartClick);
    this.defeatBtn.removeEventListener('click', this.onRestartClick);
    this.restartCallbacks.length = 0;
    this.root.innerHTML = '';
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

  private showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
    }
    this.toastTimeoutId = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this.toastTimeoutId = null;
    }, 1800);
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
