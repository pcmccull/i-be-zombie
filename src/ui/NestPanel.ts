// Nest loadout panel. Visible while the leader stands within nest.equipRadius of an active nest.
// Click a slot to select it, click an ability to put it there (Empty clears). Keyboard: 1-4 select slot,
// [ / ] cycle the selected slot through the available abilities. Never mutates state; emits onEquip only.
import './hudTheme.css';
import './hudPanels.css';
import { ABILITIES, SLOT_KEYS } from '../content/abilities';
import type { AbilityId, GameState, TraitId } from '../core/types';
import { abilityIcon, icon } from './hudIcons';
import { equippableAbilities, eyesightPanelView, nextSlotPrice, traitPanelViews, visibleSlotCount, type EyesightPanelView, type TraitPanelView } from './uiHelpers';

export class NestPanel {
  readonly element: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private _visible = false;
  private selectedSlot = 0;
  /** Ability whose description is expanded via its info button (one at a time). */
  private infoOpen: AbilityId | null = null;
  private renderKey = '';
  private available: AbilityId[] = [];
  private equipped: (AbilityId | null)[] = [];
  private owned = 0;
  private price: number | null = null;
  private biomass = 0;
  private vision: EyesightPanelView | null = null;
  private traits: TraitPanelView[] = [];
  private readonly buyCallbacks: (() => void)[] = [];
  private readonly buyVisionCallbacks: (() => void)[] = [];
  private readonly buyTraitCallbacks: ((id: TraitId) => void)[] = [];
  private readonly callbacks: ((slot: number, ability: AbilityId | null) => void)[] = [];

  private readonly onClick = (ev: MouseEvent): void => {
    const target = (ev.target as HTMLElement | null)?.closest('[data-slot],[data-ability],[data-info],[data-buy],[data-buy-vision],[data-buy-trait]') as HTMLElement | null;
    if (!target) return;
    const info = target.dataset.info;
    if (info !== undefined) {
      this.infoOpen = this.infoOpen === info ? null : (info as AbilityId);
      this.renderKey = '';
      this.render();
      return;
    }
    if (target.dataset.buyVision !== undefined) {
      this.buyVision();
      return;
    }
    const trait = target.dataset.buyTrait;
    if (trait === 'speed' || trait === 'attack') {
      for (const cb of this.buyTraitCallbacks) cb(trait);
      return;
    }
    if (target.dataset.buy !== undefined) {
      this.buy();
      return;
    }
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
    this.element.innerHTML = `<div class="ibz-nest-title">${icon('nest', 's')}<span>NEST - LOADOUT</span></div><div data-ref="body"></div>`;
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

  onBuySlot(cb: () => void): void {
    this.buyCallbacks.push(cb);
  }

  onBuyVision(cb: () => void): void {
    this.buyVisionCallbacks.push(cb);
  }

  onBuyTrait(cb: (id: TraitId) => void): void {
    this.buyTraitCallbacks.push(cb);
  }

  private buy(): void {
    for (const cb of this.buyCallbacks) cb();
  }

  private buyVision(): void {
    for (const cb of this.buyVisionCallbacks) cb();
  }

  /** `atNest` = leader is within equip range of an active nest. */
  update(state: GameState, atNest: boolean): void {
    // Playtest (T016): an empty loadout panel at the start nest covered the objective tracker and the intro card.
    // Only open it once there is something to equip, a slot to buy, or a vision upgrade in progress/affordable.
    this.owned = visibleSlotCount(state);
    this.price = nextSlotPrice(state);
    const vision = eyesightPanelView(state);
    this.vision = vision;
    const traits = traitPanelViews(state);
    this.traits = traits;
    const hasLoadout = this.owned > 0 && (equippableAbilities(state).length > 0 || this.price !== null);
    // Once any tier is bought the section stays (shows MAX at the top tier) so the player can read their eyesight.
    const hasVisionOffer = vision.tier > 1 || (vision.nextCost !== null && state.progression.biomass > 0);
    const hasTraitOffer = traits.some((t) => t.level > 0) || state.progression.biomass > 0;
    atNest = atNest && (hasLoadout || hasVisionOffer || hasTraitOffer);
    if (atNest !== this._visible) {
      this._visible = atNest;
      this.element.classList.toggle('is-visible', atNest);
      if (!atNest) {
        this.renderKey = '';
        this.infoOpen = null;
      }
    }
    if (!atNest) return;
    this.available = equippableAbilities(state);
    this.equipped = state.progression.equipped;
    this.biomass = state.progression.biomass;
    if (this.selectedSlot >= this.owned) this.selectedSlot = Math.max(0, this.owned - 1);
    const affordable = this.price !== null && this.biomass >= this.price ? 1 : 0;
    const vKey = `${vision.tier}|${vision.nextCost}|${vision.affordable ? 1 : 0}|` +
      traits.map((t) => `${t.level}:${t.affordable ? 1 : 0}`).join(',');
    const key = `${this.owned}|${this.price}|${affordable}|${this.selectedSlot}|${this.equipped.join(',')}|${this.available.join(',')}|${vKey}`;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.render();
  }

  /** Returns true when the key was consumed (only while visible). */
  handleKey(key: string): boolean {
    if (!this._visible) return false;
    if (key === 'b' || key === 'B') {
      if (this.price === null) return false;
      this.buy();
      return true;
    }
    if (key >= '1' && key <= '4') {
      if (Number(key) > this.owned) return true; // unowned slot: consume, do nothing
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
    let html = '';
    if (this.owned > 0) {
      html += '<div class="ibz-nest-slots">';
      for (let i = 0; i < this.owned; i++) {
        const id = this.equipped[i] ?? null;
        html += `<button type="button" class="ibz-nest-slot${i === this.selectedSlot ? ' is-selected' : ''}${id ? '' : ' is-empty'}" data-slot="${i}">
          <span class="hz-key">${SLOT_KEYS[i] ?? i + 1}</span><span class="ibz-nest-slot-ico">${icon(abilityIcon(id), 's')}</span><span class="ibz-nest-slot-name">${id ? ABILITIES[id].name : 'Empty'}</span></button>`;
      }
      html += '</div>';
      if (this.price !== null) {
        const can = this.biomass >= this.price;
        html += `<button type="button" class="ibz-nest-buy${can ? '' : ' is-unaffordable'}" data-buy="1">
          Buy slot <span class="hz-key">${SLOT_KEYS[this.owned] ?? this.owned + 1}</span> &mdash; ${this.price} BRAINS <em><span class="hz-key">B</span></em></button>`;
      }
      html += '<div class="ibz-nest-list">';
      html += `<button type="button" class="ibz-nest-ability" data-ability=""><span class="ibz-nest-ico">${icon(abilityIcon(null), 's')}</span><span class="ibz-nest-ability-text"><strong>Empty slot</strong></span></button>`;
      if (this.available.length === 0) {
        html += '<div class="ibz-nest-none">No mutations unlocked yet. Capture strongholds to unlock them.</div>';
      }
      for (const id of this.available) {
        const def = ABILITIES[id];
        const inSlot = this.equipped.indexOf(id);
        const open = this.infoOpen === id;
        html += `<div class="ibz-nest-row"><button type="button" class="ibz-nest-ability${inSlot >= 0 ? ' is-equipped' : ''}" data-ability="${id}">
          <span class="ibz-nest-ico">${icon(abilityIcon(id), 's')}</span><span class="ibz-nest-ability-text"><span><strong>${def.name}</strong>${inSlot >= 0 ? ` <em>(slot ${SLOT_KEYS[inSlot] ?? inSlot + 1})</em>` : ''}</span></span></button>
          <button type="button" class="ibz-nest-info${open ? ' is-open' : ''}" data-info="${id}" aria-label="About ${def.name}" aria-expanded="${open}" title="About ${def.name}">${icon('info', 's')}</button></div>`;
        if (open) html += `<div class="ibz-nest-desc">${def.description}</div>`;
      }
      html += `</div><div class="ibz-nest-hint">Click a slot, then an ability &middot; keys 1-${Math.max(1, this.owned)} pick slot, [ ] cycle &middot; B buy slot</div>`;
    }
    if (this.vision) {
      const v = this.vision;
      html += `<div class="ibz-nest-vision">
        <div class="ibz-nest-section-title">${icon('eye', 's')}<span>EYESIGHT</span></div>
        <div class="ibz-nest-vision-head"><strong>${v.name}</strong><span>Clear ${v.clearRadius} m</span></div>
        <div class="ibz-nest-vision-detects">${v.detects.join(' &middot; ')}</div>`;
      if (v.nextCost !== null) {
        html += `<button type="button" class="ibz-nest-buy${v.affordable ? '' : ' is-unaffordable'}" data-buy-vision="1"${v.affordable ? '' : ' disabled'}>
          ${v.nextTierName ?? 'Upgrade'} &mdash; ${v.nextCost} BRAINS</button>`;
      } else {
        html += '<div class="ibz-nest-vision-max">MAX</div>';
      }
      html += '</div>';
    }
    for (const t of this.traits) {
      html += `<div class="ibz-nest-vision ibz-nest-trait" data-trait="${t.id}">
        <div class="ibz-nest-section-title">${icon(t.id === 'speed' ? 'bolt' : 'claws', 's')}<span>${t.name.toUpperCase()}</span></div>
        <div class="ibz-nest-vision-head"><strong>Level ${t.level} / ${t.maxLevel}</strong><span>${t.bonus}</span></div>`;
      if (t.nextCost !== null) {
        html += `<button type="button" class="ibz-nest-buy${t.affordable ? '' : ' is-unaffordable'}" data-buy-trait="${t.id}"${t.affordable ? '' : ' disabled'}>
          Level ${t.level + 1} (${t.nextBonus}) &mdash; ${t.nextCost} BRAINS</button>`;
      } else {
        html += '<div class="ibz-nest-vision-max">MAX</div>';
      }
      html += '</div>';
    }
    this.bodyEl.innerHTML = html;
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick);
    this.buyCallbacks.length = 0;
    this.buyVisionCallbacks.length = 0;
    this.buyTraitCallbacks.length = 0;
    this.callbacks.length = 0;
    this.element.remove();
  }
}
