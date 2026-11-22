// Screen-edge directional sense arcs for nonvisual awareness cues (gunshot, scream, siren, crowd/scent).
// Pooled to BALANCE.senses.maxCues DOM nodes; never draws map dots or exact positions.
import { BALANCE } from '../config/balance';
import type { GameState, SenseKind } from '../core/types';
import { icon, type IconName } from './hudIcons';
import { WARNING_CUE_MIN_OPACITY, cueOpacity, cueScreenAngle, isWarningCue } from './uiHelpers';

interface CueSlot {
  root: HTMLDivElement;
  icon: HTMLSpanElement;
  visible: boolean;
  kind: SenseKind | '';
}

const KIND_ICON: Record<SenseKind, IconName> = {
  gunshot: 'warning',
  scream: 'warning',
  siren: 'sound',
  crowd: 'human',
};

const KIND_TITLE: Record<SenseKind, string> = {
  gunshot: 'GUNSHOT',
  scream: 'SCREAM',
  siren: 'SIREN',
  crowd: 'SCENT',
};

export class SenseIndicators {
  readonly element: HTMLDivElement;
  private readonly slots: CueSlot[] = [];

  constructor(root: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ibz-sense-layer';
    const max = BALANCE.senses.maxCues;
    for (let i = 0; i < max; i++) {
      const node = document.createElement('div');
      node.className = 'ibz-sense-arc';
      node.innerHTML = '<div class="ibz-sense-wedge"></div><span class="ibz-sense-arrow"></span><span class="ibz-sense-icon"></span>';
      const icon = node.querySelector('.ibz-sense-icon') as HTMLSpanElement;
      this.element.appendChild(node);
      this.slots.push({ root: node, icon, visible: false, kind: '' });
    }
    root.appendChild(this.element);
  }

  update(state: GameState, cameraYaw: number, _dt: number): void {
    const cues = state.vision?.cues ?? [];
    const active = state.phase === 'playing' && state.leader.alive;
    const count = active ? Math.min(cues.length, this.slots.length) : 0;

    for (let i = 0; i < count; i++) {
      const cue = cues[i];
      const slot = this.slots[i];
      // Gunshots/screams are warnings: always clearly visible (floored), with an arrow toward the sound.
      const opacity = cueOpacity(cue.intensity, cue.age, cue.ttl, isWarningCue(cue.kind) ? WARNING_CUE_MIN_OPACITY : 0);
      if (opacity <= 0.01) {
        if (slot.visible) {
          slot.visible = false;
          slot.root.classList.remove('is-visible');
        }
        continue;
      }

      const angle = cueScreenAngle(state.leader.pos, cue.pos, cameraYaw);
      const xPct = 50 + Math.sin(angle) * 42;
      const yPct = 50 - Math.cos(angle) * 38;

      if (slot.kind !== cue.kind) {
        if (slot.kind) slot.root.classList.remove(`is-${slot.kind}`);
        slot.kind = cue.kind;
        slot.root.classList.add(`is-${cue.kind}`);
        slot.root.classList.toggle('is-warning', isWarningCue(cue.kind));
        slot.icon.innerHTML = icon(KIND_ICON[cue.kind], isWarningCue(cue.kind) ? 'm' : 's');
        slot.root.setAttribute('aria-label', KIND_TITLE[cue.kind]);
      }

      slot.root.style.left = `${xPct.toFixed(2)}%`;
      slot.root.style.top = `${yPct.toFixed(2)}%`;
      slot.root.style.opacity = opacity.toFixed(3);
      slot.root.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`;
      // Counter-rotate icon so it stays upright
      slot.icon.style.transform = `rotate(${(-angle).toFixed(3)}rad)`;

      if (!slot.visible) {
        slot.visible = true;
        slot.root.classList.add('is-visible');
      }
    }

    for (let i = count; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.visible) {
        slot.visible = false;
        slot.root.classList.remove('is-visible');
      }
    }
  }

  dispose(): void {
    this.slots.length = 0;
    this.element.remove();
  }
}
