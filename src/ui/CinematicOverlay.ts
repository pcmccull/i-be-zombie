// Cinematic overlay (docs/4_intro_scene.md): black fade, letterbox, subtitles, Skip Intro, start prompt and the
// first tutorial objective card. DOM only; Game drives it. Lives beside (not inside) the HUD container so the
// gameplay HUD can be hidden while this stays visible.
import './intro.css';

export class CinematicOverlay {
  readonly element: HTMLDivElement;
  private readonly fadeEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly startEl: HTMLDivElement;
  private readonly startHintEl: HTMLDivElement;
  private readonly objectiveEl: HTMLDivElement;
  private subtitle = '';
  private fade = -1;
  private objectiveTimer: number | null = null;
  private skipCb: (() => void) | null = null;
  private startCb: (() => void) | null = null;

  private readonly onSkipClick = (e: Event): void => { e.stopPropagation(); this.skipCb?.(); };
  private readonly onStartClick = (e: Event): void => { e.stopPropagation(); this.startCb?.(); };

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'ibz-cine';
    el.innerHTML = `
      <div class="ibz-cine-bar ibz-cine-bar-top"></div>
      <div class="ibz-cine-bar ibz-cine-bar-bottom"></div>
      <div class="ibz-cine-fade" data-ref="fade"></div>
      <div class="ibz-cine-subtitle" data-ref="subtitle" aria-live="polite"></div>
      <button type="button" class="ibz-cine-skip" data-ref="skip">Skip Intro <span>Esc</span></button>
      <div class="ibz-cine-start" data-ref="start">
        <h1 class="ibz-cine-title">I BE ZOMBIE</h1>
        <div class="ibz-cine-start-hint" data-ref="startHint">Loading…</div>
      </div>
      <div class="ibz-cine-objective" data-ref="objective">
        <div class="ibz-cine-objective-tag">NEW OBJECTIVE</div>
        <div class="ibz-cine-objective-title" data-ref="objTitle"></div>
        <div class="ibz-cine-objective-text" data-ref="objText"></div>
      </div>`;
    parent.appendChild(el);
    this.element = el;
    const q = <T extends HTMLElement>(r: string): T => el.querySelector(`[data-ref="${r}"]`) as T;
    this.fadeEl = q('fade');
    this.subtitleEl = q('subtitle');
    this.skipBtn = q('skip');
    this.startEl = q('start');
    this.startHintEl = q('startHint');
    this.objectiveEl = q('objective');
    this.skipBtn.addEventListener('click', this.onSkipClick);
    this.skipBtn.addEventListener('pointerdown', e => e.stopPropagation());
    this.startEl.addEventListener('pointerdown', this.onStartClick);
  }

  onSkip(cb: () => void): void { this.skipCb = cb; }
  onStart(cb: () => void): void { this.startCb = cb; }

  /** Cinematic mode on: letterbox bars + subtitle area. */
  setActive(on: boolean): void {
    this.element.classList.toggle('is-active', on);
    if (!on) { this.setSubtitle(''); this.setSkipVisible(false); }
  }

  /** Black start screen (LOADING). `ready` switches the hint from Loading… to the begin prompt. */
  showStart(ready: boolean, touch: boolean): void {
    this.startEl.classList.add('is-visible');
    this.startHintEl.textContent = ready ? (touch ? 'Tap to begin' : 'Click or press any key to begin') : 'Loading…';
    this.startEl.classList.toggle('is-ready', ready);
    this.setFade(1);
  }

  hideStart(): void { this.startEl.classList.remove('is-visible'); }

  /** 0 = fully visible scene, 1 = black. */
  setFade(alpha: number): void {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
    if (a === this.fade) return;
    this.fade = a;
    this.fadeEl.style.opacity = String(a);
    this.fadeEl.style.display = a <= 0 ? 'none' : 'block';
  }

  setSubtitle(text: string): void {
    if (text === this.subtitle) return;
    this.subtitle = text;
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.toggle('is-visible', text.length > 0);
  }

  setSkipVisible(on: boolean): void { this.skipBtn.classList.toggle('is-visible', on); }

  showObjective(title: string, text: string, ms = 12000): void {
    (this.objectiveEl.querySelector('[data-ref="objTitle"]') as HTMLElement).textContent = title;
    (this.objectiveEl.querySelector('[data-ref="objText"]') as HTMLElement).textContent = text;
    this.objectiveEl.classList.add('is-visible');
    if (this.objectiveTimer !== null) window.clearTimeout(this.objectiveTimer);
    this.objectiveTimer = window.setTimeout(() => this.hideObjective(), ms);
  }

  hideObjective(): void {
    this.objectiveEl.classList.remove('is-visible');
    if (this.objectiveTimer !== null) window.clearTimeout(this.objectiveTimer);
    this.objectiveTimer = null;
  }

  get objectiveVisible(): boolean { return this.objectiveEl.classList.contains('is-visible'); }

  dispose(): void {
    this.hideObjective();
    this.skipBtn.removeEventListener('click', this.onSkipClick);
    this.startEl.removeEventListener('pointerdown', this.onStartClick);
    this.element.remove();
  }
}
