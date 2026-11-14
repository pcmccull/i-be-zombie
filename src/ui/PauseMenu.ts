// Pause menu overlay (Esc, toggled by Game). Callbacks only; it never touches game state.
export interface PauseCallbacks {
  onContinue?: () => void;
  onSave?: () => void;
  /** Called only after the player confirms the second step. */
  onResetSave?: () => void;
  onToggleMute?: () => void;
}

const CONTROLS: [string, string][] = [
  ['W A S D / Shift', 'Move / sprint'],
  ['Mouse (captured) or RMB-drag', 'Orbit camera; C recenter, V look back, Z/X turn, wheel zoom'],
  ['LMB', 'Alpha attack (bite; 3-hit claw combo with Alpha Claws)'],
  ['RMB on target', 'Horde attack order (Ctrl+RMB: split target)'],
  ['RMB on ground', 'Horde move order'],
  ['Space', 'Rally / regroup'],
  ['G', 'Recall: everyone follows'],
  ['Q E R F', 'Activate equipped ability slot'],
  ['M', 'World map (click to set waypoint)'],
  ['Tab / F3', 'Controls help / debug overlay'],
  ['Esc', 'This menu'],
];

export class PauseMenu {
  readonly element: HTMLDivElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly confirmBox: HTMLDivElement;
  private readonly msgEl: HTMLDivElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly yesBtn: HTMLButtonElement;
  private readonly noBtn: HTMLButtonElement;
  private _visible = false;
  private callbacks: PauseCallbacks = {};
  private msgTimer: number | null = null;

  private readonly onContinue = (): void => this.callbacks.onContinue?.();
  private readonly onSave = (): void => this.callbacks.onSave?.();
  private readonly onMute = (): void => this.callbacks.onToggleMute?.();
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
        <div class="ibz-pause-buttons">
          <button type="button" class="ibz-btn" data-ref="continue">Continue</button>
          <button type="button" class="ibz-btn" data-ref="save">Save</button>
          <button type="button" class="ibz-btn" data-ref="mute">Sound: On</button>
          <button type="button" class="ibz-btn ibz-btn-danger" data-ref="reset">Reset Save</button>
        </div>
        <div class="ibz-pause-confirm" data-ref="confirm">
          <div>Erase your saved progress and restart the world?</div>
          <button type="button" class="ibz-btn ibz-btn-danger" data-ref="yes">Yes, erase</button>
          <button type="button" class="ibz-btn" data-ref="no">Cancel</button>
        </div>
        <div class="ibz-pause-msg" data-ref="msg"></div>
        <table class="ibz-help-table ibz-pause-controls"><tbody>${rows}</tbody></table>
      </div>`;
    parent.appendChild(this.element);
    const q = <T extends HTMLElement>(r: string): T => this.element.querySelector(`[data-ref="${r}"]`) as T;
    this.continueBtn = q('continue');
    this.saveBtn = q('save');
    this.muteBtn = q('mute');
    this.resetBtn = q('reset');
    this.confirmBox = q('confirm');
    this.msgEl = q('msg');
    this.yesBtn = q('yes');
    this.noBtn = q('no');
    this.continueBtn.addEventListener('click', this.onContinue);
    this.saveBtn.addEventListener('click', this.onSave);
    this.muteBtn.addEventListener('click', this.onMute);
    this.resetBtn.addEventListener('click', this.onReset);
    this.yesBtn.addEventListener('click', this.onYes);
    this.noBtn.addEventListener('click', this.onNo);
  }

  get visible(): boolean {
    return this._visible;
  }

  setCallbacks(cb: PauseCallbacks): void {
    this.callbacks = cb;
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'Sound: Off' : 'Sound: On';
  }

  show(): void {
    this._visible = true;
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
    this.saveBtn.removeEventListener('click', this.onSave);
    this.muteBtn.removeEventListener('click', this.onMute);
    this.resetBtn.removeEventListener('click', this.onReset);
    this.yesBtn.removeEventListener('click', this.onYes);
    this.noBtn.removeEventListener('click', this.onNo);
    this.callbacks = {};
    this.element.remove();
  }
}
