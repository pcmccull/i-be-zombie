// Nest loadout panel. Visible while the leader stands within nest.equipRadius of an active nest.
// Click a slot to select it, click an ability to put it there (Empty clears). Keyboard: 1-4 select slot,
// [ / ] cycle the selected slot through the available abilities. Never mutates state; emits onEquip only.
import { ABILITIES, SLOT_KEYS } from '../content/abilities';
import type { AbilityId, GameState } from '../core/types';
import { equippableAbilities } from './uiHelpers';

export class NestPanel {
  readonly element: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private _visible = false;
  private selectedSlot = 0;
  private renderKey = '';
  private available: AbilityId[] = [];
  private equipped: (AbilityId | null)[] = [];
  private readonly callbacks: ((slot: number, ability: AbilityId | null) => void)[] = [];

  private readonly onClick = (ev: MouseEvent): void => {
    const target = (ev.target as HTMLElement | null)?.closest('[data-slot],[data-ability]') as HTMLElement | null;
    if (!target) return;
    if (target.dataset.slot !== undefined) {
      this.selectedSlot = Number(target.dataset.slot) || 0;
      this.renderKey = '';
      this.render();
      return;
    }
    const a = target.dataset.ability;
    this.equip(this.selectedSlot, a === undefined || a === '' ? null : (a as AbilityId));
  };

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'ibz-panel ibz-nest-panel';
    this.element.innerHTML = '<div class="ibz-nest-title">NEST - LOADOUT</div><div data-ref="body"></div>';
    this.bodyEl = this.element.querySelector('[data-ref="body"]') as HTMLDivElement;
    parent.appendChild(this.element);
    this.element.addEventListener('click', this.onClick);
  }

  get visible(): boolean {
    return this._visible;
  }

  onEquip(cb: (slot: number, ability: AbilityId | null) => void): void {
    this.callbacks.push(cb);
  }

  /** `atNest` = leader is within equip range of an active nest. */
  update(state: GameState, atNest: boolean): void {
    if (atNest !== this._visible) {
      this._visible = atNest;
      this.element.classList.toggle('is-visible', atNest);
      if (!atNest) this.renderKey = '';
    }
    if (!atNest) return;
    this.available = equippableAbilities(state);
    this.equipped = state.progression.equipped;
    const key = `${this.selectedSlot}|${this.equipped.join(',')}|${this.available.join(',')}`;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.render();
  }

  /** Returns true when the key was consumed (only while visible). */
  handleKey(key: string): boolean {
    if (!this._visible) return false;
    if (key >= '1' && key <= '4') {
      this.selectedSlot = Number(key) - 1;
      this.renderKey = '';
      this.render();
      return true;
    }
    if (key === '[' || key === ']') {
      const options: (AbilityId | null)[] = [null, ...this.available];
      const cur = this.equipped[this.selectedSlot] ?? null;
      let i = options.indexOf(cur);
      if (i < 0) i = 0;
      i = (i + (key === ']' ? 1 : options.length - 1)) % options.length;
      this.equip(this.selectedSlot, options[i]);
      return true;
    }
    return false;
  }

  private equip(slot: number, ability: AbilityId | null): void {
    for (const cb of this.callbacks) cb(slot, ability);
  }

  private render(): void {
    let html = '<div class="ibz-nest-slots">';
    for (let i = 0; i < 4; i++) {
      const id = this.equipped[i] ?? null;
      html += `<button type="button" class="ibz-nest-slot${i === this.selectedSlot ? ' is-selected' : ''}" data-slot="${i}">
        <span class="ibz-key-badge">${SLOT_KEYS[i] ?? i + 1}</span><span>${id ? ABILITIES[id].name : 'Empty'}</span></button>`;
    }
    html += '</div><div class="ibz-nest-list">';
    html += `<button type="button" class="ibz-nest-ability" data-ability="">Empty slot</button>`;
    if (this.available.length === 0) {
      html += '<div class="ibz-nest-none">No mutations unlocked yet. Capture strongholds to unlock them.</div>';
    }
    for (const id of this.available) {
      const def = ABILITIES[id];
      const inSlot = this.equipped.indexOf(id);
      html += `<button type="button" class="ibz-nest-ability${inSlot >= 0 ? ' is-equipped' : ''}" data-ability="${id}">
        <strong>${def.name}</strong>${inSlot >= 0 ? ` <em>(slot ${SLOT_KEYS[inSlot] ?? inSlot + 1})</em>` : ''}
        <span class="ibz-nest-desc">${def.description}</span></button>`;
    }
    html += '</div><div class="ibz-nest-hint">Click a slot, then an ability &middot; keys 1-4 pick slot, [ ] cycle</div>';
    this.bodyEl.innerHTML = html;
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick);
    this.callbacks.length = 0;
    this.element.remove();
  }
}
