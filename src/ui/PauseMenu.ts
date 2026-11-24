// Pause menu overlay (Esc, toggled by Game). Callbacks only; it never touches game state.
import './hudTheme.css';
import './hudPanels.css';
import { icon } from './hudIcons';
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen, saveFullscreenPref } from './fullscreen';

export interface PauseCallbacks {
  onContinue?: () => void;
  onOpenMap?: () => void;
  onSave?: () => void;
  /** Called only after the player confirms the second step. */
  onResetSave?: () => void;
  onToggleMute?: () => void;
  /** Watch the opening cinematic again (the current conquest is restored afterwards). */
  onReplayIntro?: () => void;
  /** EW vision haze quality toggle (Low = haze only, High = haze + desaturation). */
  onToggleVisionQuality?: () => void;
  getVisionQuality?: () => 'low' | 'high';
  /** VP graphics preset (low/medium/high) + reduced motion (docs/8_visual_polish.md). */
  getGraphics?: () => { quality: 'low' | 'medium' | 'high'; reducedMotion: boolean };
  onCycleGraphicsQuality?: () => void;
  onToggleReducedMotion?: () => void;
}

const CONTROLS: [string, string][] = [
  ['<span class="hz-key">W</span><span class="hz-key">A</span><span class="hz-key">S</span><span class="hz-key">D</span><span class="ibz-key-sep">+</span><span class="hz-key">Shift</span>', 'Move / sprint'],
  [`<span class="hz-key is-mouse">${icon('mouseL', 's')} Drag</span><span class="ibz-key-sep">/</span><span class="hz-key is-mouse">${icon('mouseR', 's')} Drag</span>`, 'Orbit camera; C recenter, V look back, Z/X turn, wheel zoom'],
  [`<span class="hz-key is-mouse">${icon('mouseL', 's')} LMB</span>`, 'Alpha attack (bite; 3-hit claw combo with Alpha Claws)'],
  [`<span class="hz-key is-mouse">${icon('mouseR', 's')} RMB</span><span class="ibz-key-sub">on target</span>`, 'Horde attack order (hold E + RMB: split target)'],
  [`<span class="hz-key is-mouse">${icon('mouseR', 's')} RMB</span><span class="ibz-key-sub">on ground</span>`, 'Horde move order'],
  ['<span class="hz-key">Space</span> <span class="hz-key">G</span>', 'Recall: everyone comes back and follows'],
  ['<span class="hz-key">Q</span><span class="hz-key">T</span><span class="hz-key">R</span><span class="hz-key">F</span>', 'Activate equipped ability slot'],
  ['<span class="hz-key">M</span>', 'World map (click to set waypoint)'],
  ['<span class="hz-key">Tab</span><span class="ibz-key-sep">/</span><span class="hz-key">F3</span>', 'Controls help / debug overlay'],
  ['<span class="hz-key">Esc</span>', 'This menu'],
];

export class PauseMenu {
  readonly element: HTMLDivElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly confirmBox: HTMLDivElement;
  private readonly msgEl: HTMLDivElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly mapBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly yesBtn: HTMLButtonElement;
  private readonly noBtn: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly visionBtn: HTMLButtonElement;
  private readonly gfxBtn: HTMLButtonElement;
  private readonly motionBtn: HTMLButtonElement;
  private readonly fsBtn: HTMLButtonElement;
  private readonly fsLabel: HTMLSpanElement;
  private readonly muteLabel: HTMLSpanElement;
  private readonly visionLabel: HTMLSpanElement;
  private readonly gfxLabel: HTMLSpanElement;
  private readonly motionLabel: HTMLSpanElement;
  private _visible = false;
  private callbacks: PauseCallbacks = {};
  private msgTimer: number | null = null;

  private readonly onContinue = (): void => this.callbacks.onContinue?.();
  private readonly onOpenMap = (): void => this.callbacks.onOpenMap?.();
  private readonly onSave = (): void => this.callbacks.onSave?.();
  private readonly onMute = (): void => this.callbacks.onToggleMute?.();
  private readonly onReplay = (): void => this.callbacks.onReplayIntro?.();
  private readonly onVision = (): void => { this.callbacks.onToggleVisionQuality?.(); this.refreshVision(); };
  private readonly onGfx = (): void => { this.callbacks.onCycleGraphicsQuality?.(); this.refreshGraphics(); };
  private readonly onMotion = (): void => { this.callbacks.onToggleReducedMotion?.(); this.refreshGraphics(); };
  private readonly onFullscreen = (): void => {
    const want = !isFullscreen();
    saveFullscreenPref(want); // also the title screen's "Start in full screen" choice next time
    void (want ? enterFullscreen() : exitFullscreen()).then(() => this.refreshFullscreen());
  };
  private readonly onFsChange = (): void => this.refreshFullscreen();
  private readonly onReset = (): void => this.setConfirm(true);
  private readonly onNo = (): void => this.setConfirm(false);
  private readonly onYes = (): void => {
    this.setConfirm(false);
    this.callbacks.onResetSave?.();
  };

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ibz-overlay ibz-pause';
    const rows = CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    this.element.innerHTML = `
      <div class="ibz-modal ibz-pause-modal">
        <h1 class="ibz-modal-title">PAUSED</h1>
        <p class="ibz-modal-pitch ibz-pause-pitch">Catch your breath, Alpha. The beach isn&rsquo;t going anywhere.</p>
        <div class="ibz-pause-buttons">
          <button type="button" class="ibz-btn" data-ref="continue"><span class="ibz-btn-ico">${icon('rush', 's')}</span><span class="ibz-btn-label">Continue</span></button>
          <button type="button" class="ibz-btn" data-ref="map"><span class="ibz-btn-ico">${icon('map', 's')}</span><span class="ibz-btn-label">World Map</span></button>
          <button type="button" class="ibz-btn" data-ref="save"><span class="ibz-btn-ico">${icon('check', 's')}</span><span class="ibz-btn-label">Save</span></button>
          <button type="button" class="ibz-btn" data-ref="mute"><span class="ibz-btn-ico">${icon('sound', 's')}</span><span class="ibz-btn-label">Sound: On</span></button>
          <button type="button" class="ibz-btn" data-ref="replay"><span class="ibz-btn-ico">${icon('camera', 's')}</span><span class="ibz-btn-label">Replay Intro</span></button>
          <button type="button" class="ibz-btn" data-ref="fs"><span class="ibz-btn-ico">${icon('fullscreen', 's')}</span><span class="ibz-btn-label">Full screen: Off</span></button>
          <button type="button" class="ibz-btn" data-ref="vision"><span class="ibz-btn-ico">${icon('eye', 's')}</span><span class="ibz-btn-label">Vision quality: High</span></button>
          <button type="button" class="ibz-btn" data-ref="gfx"><span class="ibz-btn-ico">${icon('star', 's')}</span><span class="ibz-btn-label">Graphics: High</span></button>
          <button type="button" class="ibz-btn" data-ref="motion"><span class="ibz-btn-ico">${icon('move', 's')}</span><span class="ibz-btn-label">Reduced motion: Off</span></button>
          <button type="button" class="ibz-btn ibz-btn-danger" data-ref="reset"><span class="ibz-btn-ico">${icon('warning', 's')}</span><span class="ibz-btn-label">Reset Save</span></button>
        </div>
        <div class="ibz-pause-confirm" data-ref="confirm">
          <div>Erase your saved progress and restart the world?</div>
          <button type="button" class="ibz-btn ibz-btn-small ibz-btn-danger" data-ref="yes"><span class="ibz-btn-label">Yes, erase</span></button>
          <button type="button" class="ibz-btn ibz-btn-small" data-ref="no"><span class="ibz-btn-label">Cancel</span></button>
        </div>
        <div class="ibz-pause-msg" data-ref="msg"></div>
        <div class="ibz-pause-section-title">Controls</div>
        <table class="ibz-help-table ibz-pause-controls"><tbody>${rows}</tbody></table>
      </div>`;
    parent.appendChild(this.element);
    const q = <T extends HTMLElement>(r: string): T => this.element.querySelector(`[data-ref="${r}"]`) as T;
    const lbl = (btn: HTMLButtonElement): HTMLSpanElement => btn.querySelector('.ibz-btn-label') as HTMLSpanElement;
    this.continueBtn = q('continue');
    this.mapBtn = q('map');
    this.saveBtn = q('save');
    this.muteBtn = q('mute');
    this.resetBtn = q('reset');
    this.confirmBox = q('confirm');
    this.msgEl = q('msg');
    this.yesBtn = q('yes');
    this.noBtn = q('no');
    this.replayBtn = q('replay');
    this.visionBtn = q('vision');
    this.gfxBtn = q('gfx');
    this.motionBtn = q('motion');
    this.fsBtn = q('fs');
    this.fsLabel = lbl(this.fsBtn);
    this.muteLabel = lbl(this.muteBtn);
    this.visionLabel = lbl(this.visionBtn);
    this.gfxLabel = lbl(this.gfxBtn);
    this.motionLabel = lbl(this.motionBtn);
    this.continueBtn.addEventListener('click', this.onContinue);
    this.mapBtn.addEventListener('click', this.onOpenMap);
    this.saveBtn.addEventListener('click', this.onSave);
    this.muteBtn.addEventListener('click', this.onMute);
    this.resetBtn.addEventListener('click', this.onReset);
    this.yesBtn.addEventListener('click', this.onYes);
    this.noBtn.addEventListener('click', this.onNo);
    this.replayBtn.addEventListener('click', this.onReplay);
    this.visionBtn.addEventListener('click', this.onVision);
    this.gfxBtn.addEventListener('click', this.onGfx);
    this.motionBtn.addEventListener('click', this.onMotion);
    this.fsBtn.addEventListener('click', this.onFullscreen);
    document.addEventListener('fullscreenchange', this.onFsChange);
  }

  get visible(): boolean {
    return this._visible;
  }

  setCallbacks(cb: PauseCallbacks): void {
    this.callbacks = cb;
  }

  setMuted(muted: boolean): void {
    this.muteLabel.textContent = muted ? 'Sound: Off' : 'Sound: On';
  }

  private refreshGraphics(): void {
    const g = this.callbacks.getGraphics?.();
    if (g) {
      this.gfxLabel.textContent = `Graphics: ${g.quality[0].toUpperCase()}${g.quality.slice(1)}`;
      this.motionLabel.textContent = `Reduced motion: ${g.reducedMotion ? 'On' : 'Off'}`;
    }
    this.gfxBtn.hidden = !this.callbacks.onCycleGraphicsQuality;
    this.motionBtn.hidden = !this.callbacks.onToggleReducedMotion;
  }

  private refreshFullscreen(): void {
    this.fsBtn.hidden = !fullscreenSupported();
    this.fsLabel.textContent = `Full screen: ${isFullscreen() ? 'On' : 'Off'}`;
  }

  private refreshVision(): void {
    const q = this.callbacks.getVisionQuality?.();
    if (q) this.visionLabel.textContent = q === 'low' ? 'Vision quality: Low' : 'Vision quality: High';
    this.visionBtn.hidden = !this.callbacks.onToggleVisionQuality;
  }

  show(): void {
    this._visible = true;
    this.mapBtn.hidden = !this.callbacks.onOpenMap;
    this.refreshVision();
    this.refreshGraphics();
    this.refreshFullscreen();
    this.setConfirm(false);
    this.element.classList.add('is-visible');
  }

  hide(): void {
    this._visible = false;
    this.setConfirm(false);
    this.element.classList.remove('is-visible');
  }

  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }

  /** Short status line, e.g. "Saved". */
  notify(msg: string): void {
    this.msgEl.textContent = msg;
    if (this.msgTimer !== null) window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => {
      this.msgEl.textContent = '';
      this.msgTimer = null;
    }, 2200);
  }

  private setConfirm(on: boolean): void {
    this.confirmBox.classList.toggle('is-visible', on);
    this.resetBtn.disabled = on;
  }

  dispose(): void {
    if (this.msgTimer !== null) window.clearTimeout(this.msgTimer);
    this.continueBtn.removeEventListener('click', this.onContinue);
    this.mapBtn.removeEventListener('click', this.onOpenMap);
    this.saveBtn.removeEventListener('click', this.onSave);
    this.muteBtn.removeEventListener('click', this.onMute);
    this.resetBtn.removeEventListener('click', this.onReset);
    this.yesBtn.removeEventListener('click', this.onYes);
    this.noBtn.removeEventListener('click', this.onNo);
    this.replayBtn.removeEventListener('click', this.onReplay);
    this.visionBtn.removeEventListener('click', this.onVision);
    this.gfxBtn.removeEventListener('click', this.onGfx);
    this.motionBtn.removeEventListener('click', this.onMotion);
    this.fsBtn.removeEventListener('click', this.onFullscreen);
    document.removeEventListener('fullscreenchange', this.onFsChange);
    this.callbacks = {};
    this.element.remove();
  }
}
