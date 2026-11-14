// F3 debug overlay. Game supplies renderer-side numbers (fps, frame ms, draw calls, loaded chunks);
// sim-side counts (active/dormant humans + zombies, followers, district states, phase) come from GameState.
import type { GameState } from '../core/types';
import { buildDebugLines, type DebugStats } from './uiHelpers';

export class DebugOverlay {
  readonly element: HTMLDivElement;
  private visible = false;
  private prevText = '';

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ibz-debug-overlay';
    parent.appendChild(this.element);
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.element.classList.toggle('is-visible', v);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(state: GameState, stats: DebugStats): void {
    if (!this.visible) return;
    const text = buildDebugLines(state, stats).join('\n');
    if (text === this.prevText) return;
    this.prevText = text;
    this.element.textContent = text;
  }

  dispose(): void {
    this.element.remove();
  }
}
