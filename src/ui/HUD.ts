import './hud.css';
import { BALANCE } from '../config/balance';
import type { GameEvent, GamePhase, GameState } from '../core/types';

export interface HudExtras {
  fps: number;
  drawCalls: number;
  showDebug: boolean;
  hoverLabel: string | null;
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
  private readonly gateValueEl: HTMLSpanElement;
  private readonly gateFillEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;

  // Top-right elements
  private readonly hordeCountEl: HTMLDivElement;
  private readonly capFlashEl: HTMLDivElement;
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
  private prevHpText = '';
  private prevHpPct = -1;
  private prevHpLow = false;
  private prevStamText = '';
  private prevStamPct = -1;
  private prevExhausted = false;
  private prevObjectiveSub = '';
  private prevGateVisible = false;
  private prevGateText = '';
  private prevGatePct = -1;
  private prevHordeText = '';
  private prevCapVisible = false;
  private prevGuardsText = '';
  private prevHoverLabel: string | null = null;
  private prevOrderText = '';
  private prevOrderAttack = false;
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
          <div class="ibz-objective-sub" data-ref="objSub">Find zombies</div>
        </div>
        <div class="ibz-panel ibz-gate-bar" data-ref="gateBar">
          <div class="ibz-bar-header">
            <span class="ibz-bar-label">Checkpoint Gate</span>
            <span class="ibz-bar-value" data-ref="gateVal">${BALANCE.gate.maxHp} / ${BALANCE.gate.maxHp}</span>
          </div>
          <div class="ibz-bar-track">
            <div class="ibz-bar-fill ibz-gate-fill" data-ref="gateFill"></div>
          </div>
        </div>
        <div class="ibz-toast" data-ref="toast"></div>
      </div>

      <div class="ibz-panel ibz-top-right">
        <div class="ibz-horde-count" data-ref="hordeCount">HORDE 0 / 100</div>
        <div class="ibz-cap-flash" data-ref="capFlash">HORDE FULL</div>
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
        WASD move &middot; Shift sprint &middot; LMB attack &middot; RMB follow &middot; Tab help
      </div>

      <div class="ibz-help-panel" data-ref="helpPanel">
        <h3 class="ibz-help-title">Controls &amp; Commands</h3>
        <table class="ibz-help-table">
          <tbody>
            <tr><td>W A S D / Arrows</td><td>Move leader relative to camera</td></tr>
            <tr><td>Shift</td><td>Sprint while stamina allows</td></tr>
            <tr><td>Left-Click Target</td><td>Order horde to Attack guard or gate</td></tr>
            <tr><td>Left-Click Ground</td><td>World ping</td></tr>
            <tr><td>Right-Click</td><td>Recall horde to Follow leader</td></tr>
            <tr><td>Right-Drag</td><td>Orbit &amp; tilt camera</td></tr>
            <tr><td>Mouse Wheel</td><td>Zoom camera (close / tactical view)</td></tr>
            <tr><td>E</td><td>Rally pulse (recruit within 15 m)</td></tr>
            <tr><td>Space</td><td>Horde Rush (+45% speed, +25% attack rate)</td></tr>
            <tr><td>C</td><td>Recenter camera behind leader</td></tr>
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
            Roam the streets and alleys to gather wandering zombies into an unstoppable horde,<br/>
            storm the fortified northeast human checkpoint, breach the gate, and convert the defenders.
          </p>
          <div class="ibz-intro-keys">
            <div><strong>WASD + Shift</strong> Move &amp; Sprint</div>
            <div><strong>Right-Drag / Wheel</strong> Orbit &amp; Zoom</div>
            <div><strong>Left-Click</strong> Attack Enemy / Gate</div>
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
    this.gateValueEl = q('gateVal');
    this.gateFillEl = q('gateFill');
    this.toastEl = q('toast');
    this.hordeCountEl = q('hordeCount');
    this.capFlashEl = q('capFlash');
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

  consume(events: readonly GameEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'orderChanged') {
        if (ev.order.type === 'follow') {
          this.showToast('RECALL: FOLLOWING LEADER');
        } else if (ev.order.target.kind === 'gate') {
          this.showToast('ATTACK ORDER: GATE');
        } else if (ev.order.target.kind === 'guard') {
          this.showToast('ATTACK ORDER: GUARD');
        }
      } else if (ev.type === 'capReached') {
        this.showToast('HORDE CAPACITY REACHED (100)');
      } else if (ev.type === 'gateDestroyed') {
        this.showToast('CHECKPOINT GATE BREACHED!');
      } else if (ev.type === 'converted') {
        this.showToast('GUARD CONVERTED TO HORDE!');
      } else if (ev.type === 'rushStart') {
        this.showToast('HORDE RUSH ACTIVATED!');
      }
    }
  }

  update(state: GameState, extras: HudExtras): void {
    // 1. Leader HP & Stamina
    const hp = Math.max(0, Math.ceil(state.leader.hp));
    const maxHp = state.leader.maxHp;
    const hpText = `${hp} / ${maxHp}`;
    if (hpText !== this.prevHpText) {
      this.prevHpText = hpText;
      this.hpValueEl.textContent = hpText;
    }
    const hpPct = Math.max(0, Math.min(100, Math.round((state.leader.hp / Math.max(1, maxHp)) * 100)));
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

    // 2. Top-Center Objective Status & Gate HP Bar
    let objSub = 'Eliminate the guards';
    if (!state.gate.destroyed) {
      objSub = state.followerCount < 15 ? 'Find zombies' : 'Break the gate';
    }
    if (objSub !== this.prevObjectiveSub) {
      this.prevObjectiveSub = objSub;
      this.objectiveSubEl.textContent = objSub;
    }

    const gateTargeted =
      state.order.type === 'attack' && state.order.target.kind === 'gate';
    const showGateBar =
      !state.gate.destroyed && (state.gate.hp < state.gate.maxHp || gateTargeted);
    if (showGateBar !== this.prevGateVisible) {
      this.prevGateVisible = showGateBar;
      this.gateBarEl.classList.toggle('is-visible', showGateBar);
    }
    if (showGateBar) {
      const gHp = Math.max(0, Math.ceil(state.gate.hp));
      const gText = `${gHp} / ${state.gate.maxHp}`;
      if (gText !== this.prevGateText) {
        this.prevGateText = gText;
        this.gateValueEl.textContent = gText;
      }
      const gPct = Math.max(
        0,
        Math.min(100, Math.round((state.gate.hp / Math.max(1, state.gate.maxHp)) * 100)),
      );
      if (gPct !== this.prevGatePct) {
        this.prevGatePct = gPct;
        this.gateFillEl.style.width = `${gPct}%`;
      }
    }

    // 3. Top-Right Horde Counter & Alive Guards
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

    let aliveGuards = 0;
    for (let i = 0; i < state.guards.length; i++) {
      if (state.guards[i].state !== 'DEAD' && state.guards[i].hp > 0) {
        aliveGuards++;
      }
    }
    const guardsText = `GUARDS ${aliveGuards} / ${BALANCE.guard.count}`;
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
        state.order.target.kind === 'gate' ? 'ATTACK: GATE' : 'ATTACK: GUARD';
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
      const debugText = `FPS: ${Math.round(extras.fps)} | Draw Calls: ${extras.drawCalls}\nLive Zombies: ${liveZombies} | Followers: ${state.followerCount}\nGuards Alive: ${aliveGuards}`;
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
        <div class="ibz-stat-label">Conversions</div>
        <div class="ibz-stat-val">${state.stats.conversions}</div>
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
