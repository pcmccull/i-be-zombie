// Touch overlay (todos #7): a left virtual stick plus action buttons. DOM only, callbacks only — it never touches
// game state. Game creates it, enables it on touch devices, polls readStick() through InputController and feeds
// setSlots() with the owned ability slots. ARCHITECTURE.md §TD-2.
import './hudTheme.css';
import './touch.css';
import { BALANCE } from '../config/balance';
import { ABILITIES } from '../content/abilities';
import { clampKnob, createStickOutput, stickFromOffset, type StickOutput } from '../core/touchMath';
import type { AbilityId } from '../core/types';
import { abilityIcon, icon } from './hudIcons';

function slotAbilityId(name: string): AbilityId | null {
  for (const id of Object.keys(ABILITIES) as AbilityId[]) {
    if (ABILITIES[id].name === name) return id;
  }
  return null;
}

export interface TouchSlotView {
  key: string;
  name: string;
  /** SlotView.kind from uiHelpers ('ready' | 'cooldown' | 'active' | 'nobiomass' | 'passive' | 'empty'). */
  kind: string;
  /** 0..1 cooldown sweep. */
  remainingFrac: number;
}

type Cb = () => void;
type ButtonId = 'attack' | 'follow' | 'map' | 'pause' | 'recenter' | 'use';

export class TouchControls {
  private readonly el: HTMLDivElement;
  private readonly stickEl: HTMLDivElement;
  private readonly knobEl: HTMLDivElement;
  private readonly slotsEl: HTMLDivElement;
  private readonly listeners = new AbortController();
  private readonly cbs: Record<ButtonId, Cb[]> = { attack: [], follow: [], map: [], pause: [], recenter: [], use: [] };
  private readonly abilityCbs: ((slot: number) => void)[] = [];
  private readonly stick = createStickOutput();
  private readonly knob = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private stickCx = 0;
  private stickCy = 0;
  private enabled = false;
  private slotKeys: string[] = [];
  private slotNames: string[] = [];
  private slotEls: HTMLButtonElement[] = [];

  constructor(private readonly root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ibz-touch';
    this.el.innerHTML = `
      <div class="ibz-touch-stick" data-ref="stick"><div class="ibz-touch-knob" data-ref="knob"></div></div>
      <div class="ibz-touch-top">
        <button type="button" class="ibz-touch-btn is-small" data-btn="pause" aria-label="Pause">${icon('pause', 's')}</button>
        <button type="button" class="ibz-touch-btn is-small" data-btn="map" aria-label="Map">${icon('map', 's')}</button>
        <button type="button" class="ibz-touch-btn is-small" data-btn="recenter" aria-label="Recenter camera">${icon('camera', 's')}</button>
      </div>
      <div class="ibz-touch-actions">
        <div class="ibz-touch-slots" data-ref="slots"></div>
        <div class="ibz-touch-row">
          <button type="button" class="ibz-touch-btn" data-btn="follow" aria-label="Horde follow">${icon('recall', 's')}<span>FOLLOW</span></button>
          <button type="button" class="ibz-touch-btn is-use" data-btn="use" aria-label="Use (vehicle, drain, prop)" hidden>${icon('bolt', 's')}<span>USE</span></button>
        </div>
        <button type="button" class="ibz-touch-btn is-attack" data-btn="attack" aria-label="Attack">${icon('bite', 'l')}<span>ATTACK</span></button>
      </div>`;
    this.stickEl = this.el.querySelector('[data-ref="stick"]') as HTMLDivElement;
    this.knobEl = this.el.querySelector('[data-ref="knob"]') as HTMLDivElement;
    this.slotsEl = this.el.querySelector('[data-ref="slots"]') as HTMLDivElement;
    this.stickEl.style.setProperty('--ibz-stick-r', `${BALANCE.touch.stickRadius}px`);

    const signal = this.listeners.signal;
    this.el.addEventListener('pointerdown', this.onButtonDown, { signal });
    this.stickEl.addEventListener('pointerdown', this.onStickDown, { signal });
    window.addEventListener('pointermove', this.onStickMove, { signal });
    window.addEventListener('pointerup', this.onStickUp, { signal });
    window.addEventListener('pointercancel', this.onStickUp, { signal });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    root.appendChild(this.el);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.el.classList.add('is-enabled');
    document.body.classList.add('ibz-touch-active');
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.releaseStick();
    this.el.classList.remove('is-enabled');
    document.body.classList.remove('ibz-touch-active');
  }

  isEnabled(): boolean { return this.enabled; }

  /** Release the stick (blur, visibility change, modal): no stuck movement. */
  reset(): void { this.releaseStick(); }

  /** Current stick state (zero when disabled or untouched). */
  readStick(out: StickOutput): StickOutput {
    out.moveForward = this.enabled ? this.stick.moveForward : 0;
    out.moveRight = this.enabled ? this.stick.moveRight : 0;
    out.sprint = this.enabled && this.stick.sprint;
    out.mag = this.enabled ? this.stick.mag : 0;
    return out;
  }

  /** True when (clientX, clientY) is on a visible touch control (InputController ignores such touches). */
  containsPoint(clientX: number, clientY: number): boolean {
    if (!this.enabled) return false;
    const hit = document.elementFromPoint(clientX, clientY);
    return hit !== null && this.el.contains(hit) && hit !== this.el;
  }

  onAttack(cb: Cb): void { this.cbs.attack.push(cb); }
  onFollow(cb: Cb): void { this.cbs.follow.push(cb); }
  /** docs/11_cityupgrade.md §6: touch twin of V (mount, storm drain, props). */
  onUse(cb: Cb): void { this.cbs.use.push(cb); }
  /** Show USE only when V would do something here (hudModel.interactPrompt). */
  setUseVisible(v: boolean): void {
    const b = this.el.querySelector('[data-btn="use"]') as HTMLButtonElement | null;
    if (b && b.hidden === v) b.hidden = !v;
  }
  onMap(cb: Cb): void { this.cbs.map.push(cb); }
  onPause(cb: Cb): void { this.cbs.pause.push(cb); }
  onRecenter(cb: Cb): void { this.cbs.recenter.push(cb); }
  onAbility(cb: (slot: number) => void): void { this.abilityCbs.push(cb); }

  /** Owned ability slots only; [] hides the strip. Rebuilds DOM only when slots/names change. */
  setSlots(views: readonly TouchSlotView[]): void {
    let changed = views.length !== this.slotKeys.length;
    for (let i = 0; !changed && i < views.length; i++) {
      changed = views[i].key !== this.slotKeys[i] || views[i].name !== this.slotNames[i];
    }
    if (changed) {
      this.slotKeys = views.map((v) => v.key);
      this.slotNames = views.map((v) => v.name);
      this.slotsEl.innerHTML = '';
      this.slotEls = views.map((v, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ibz-touch-btn is-slot';
        b.dataset.slot = String(i);
        b.innerHTML = `<span class="ibz-touch-sweep"></span><span class="ibz-touch-key">${v.key}</span><span class="ibz-touch-ico">${icon(abilityIcon(slotAbilityId(v.name)), 's')}</span><span class="ibz-touch-name"></span>`;
        (b.querySelector('.ibz-touch-name') as HTMLSpanElement).textContent = v.name;
        this.slotsEl.appendChild(b);
        return b;
      });
    }
    for (let i = 0; i < views.length; i++) {
      const b = this.slotEls[i];
      const v = views[i];
      if (!b) continue;
      const kindClass = `is-${v.kind}`;
      if (b.dataset.kind !== kindClass) {
        if (b.dataset.kind) b.classList.remove(b.dataset.kind);
        b.classList.add(kindClass);
        b.dataset.kind = kindClass;
      }
      const sweep = b.firstElementChild as HTMLSpanElement;
      const h = `${Math.round(Math.max(0, Math.min(1, v.remainingFrac)) * 100)}%`;
      if (sweep.style.height !== h) sweep.style.height = h;
    }
    this.slotsEl.classList.toggle('is-hidden', views.length === 0);
  }

  dispose(): void {
    this.disable();
    this.listeners.abort();
    this.el.remove();
    for (const k of Object.keys(this.cbs) as ButtonId[]) this.cbs[k].length = 0;
    this.abilityCbs.length = 0;
  }

  // -------------------------------------------------------------------------

  private readonly onButtonDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const btn = (e.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null;
    if (!btn || !this.el.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('is-pressed');
    window.setTimeout(() => btn.classList.remove('is-pressed'), 140);
    if (btn.dataset.slot !== undefined) {
      const slot = Number(btn.dataset.slot);
      for (const cb of this.abilityCbs) cb(slot);
      return;
    }
    const id = btn.dataset.btn as ButtonId | undefined;
    if (id && this.cbs[id]) for (const cb of this.cbs[id]) cb();
  };

  private readonly onStickDown = (e: PointerEvent): void => {
    if (!this.enabled || this.stickPointer !== null) return;
    e.preventDefault();
    e.stopPropagation();
    this.stickPointer = e.pointerId;
    const r = this.stickEl.getBoundingClientRect();
    this.stickCx = r.left + r.width / 2;
    this.stickCy = r.top + r.height / 2;
    this.stickEl.classList.add('is-active');
    this.updateStick(e.clientX, e.clientY);
  };

  private readonly onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    e.preventDefault();
    this.updateStick(e.clientX, e.clientY);
  };

  private readonly onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.releaseStick();
  };

  private updateStick(x: number, y: number): void {
    const t = BALANCE.touch;
    const dx = x - this.stickCx;
    const dy = y - this.stickCy;
    stickFromOffset(dx, dy, t.stickRadius, t.deadZone, t.sprintThreshold, this.stick);
    clampKnob(dx, dy, t.stickRadius, this.knob);
    this.knobEl.style.transform = `translate(${this.knob.x.toFixed(1)}px, ${this.knob.y.toFixed(1)}px)`;
    this.stickEl.classList.toggle('is-sprint', this.stick.sprint);
  }

  private releaseStick(): void {
    this.stickPointer = null;
    this.stick.moveForward = 0; this.stick.moveRight = 0; this.stick.sprint = false; this.stick.mag = 0;
    this.knobEl.style.transform = '';
    this.stickEl.classList.remove('is-active', 'is-sprint');
  }
}
