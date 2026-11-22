// Collection & Wardrobe modal: Cosmetics, Companions, Vehicles, Hideouts, Trophies & Secrets.
// Spec: docs/11_cityupgrade.md §4, §6.
import { ACHIEVEMENTS, COMPANIONS, HIDEOUTS, REWARDS, SECRETS } from '../content/rewards';
import type {
  CompanionId,
  CosmeticSlot,
  GameState,
  HideoutId,
  PlayerVehicleKind,
} from '../core/types';

export interface CollectionCallbacks {
  onEquipCosmetic(slot: CosmeticSlot, rewardId: string | null): void;
  onBuyReward(rewardId: string): void;
  onToggleCompanion(id: CompanionId): void;
  onSummonVehicle(kind: PlayerVehicleKind): void;
  onFastTravelHideout(id: HideoutId): void;
  onClose(): void;
}

type TabId = 'wardrobe' | 'companions' | 'vehicles' | 'hideouts' | 'trophies';

export class CollectionPanel {
  readonly root: HTMLDivElement;
  private visible = false;
  private activeTab: TabId = 'wardrobe';
  private readonly brainsEl: HTMLSpanElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private lastState: GameState | null = null;

  constructor(parent: HTMLElement, private readonly cb: CollectionCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'ibz-panel hz-collection-modal';
    this.root.style.display = 'none';
    this.root.style.pointerEvents = 'auto';
    this.root.style.position = 'fixed';
    this.root.style.left = '50%';
    this.root.style.top = '50%';
    this.root.style.transform = 'translate(-50%, -50%)';
    this.root.style.width = 'min(680px, 94vw)';
    this.root.style.maxHeight = '82vh';
    this.root.style.zIndex = '24';
    this.root.style.flexDirection = 'column';
    this.root.style.gap = '10px';
    this.root.style.padding = '16px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';

    const title = document.createElement('div');
    title.textContent = 'CITY COLLECTION';
    title.style.fontWeight = '900';
    title.style.fontSize = '1.15rem';
    title.style.letterSpacing = '0.04em';

    const rightHead = document.createElement('div');
    rightHead.style.display = 'flex';
    rightHead.style.alignItems = 'center';
    rightHead.style.gap = '12px';

    this.brainsEl = document.createElement('span');
    this.brainsEl.style.fontWeight = '800';
    this.brainsEl.style.color = '#ff85b3';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ibz-btn';
    closeBtn.textContent = '×';
    closeBtn.style.minWidth = '36px';
    closeBtn.onclick = () => this.cb.onClose();

    rightHead.append(this.brainsEl, closeBtn);
    header.append(title, rightHead);

    this.tabsEl = document.createElement('div');
    this.tabsEl.style.display = 'flex';
    this.tabsEl.style.flexWrap = 'wrap';
    this.tabsEl.style.gap = '6px';

    const tabs: Array<{ id: TabId; label: string }> = [
      { id: 'wardrobe', label: 'Wardrobe' },
      { id: 'companions', label: 'Companions' },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'hideouts', label: 'Hideouts' },
      { id: 'trophies', label: 'Trophies & Secrets' },
    ];
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.className = 'ibz-btn';
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.onclick = () => {
        this.activeTab = t.id;
        if (this.lastState) this.render(this.lastState);
      };
      this.tabsEl.appendChild(btn);
    }

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.overflowY = 'auto';
    this.bodyEl.style.display = 'grid';
    this.bodyEl.style.gap = '8px';
    this.bodyEl.style.paddingRight = '4px';

    this.root.append(header, this.tabsEl, this.bodyEl);
    parent.appendChild(this.root);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  private bodySig = '';

  setVisible(v: boolean, state?: GameState): void {
    this.visible = v;
    this.bodySig = '';
    this.root.style.display = v ? 'flex' : 'none';
    if (v && state) this.render(state);
  }

  render(state: GameState): void {
    this.lastState = state;
    if (!this.visible) return;
    const r = state.rewards;
    this.brainsEl.textContent = `Brains: ${r.brains}`;

    for (const btn of Array.from(this.tabsEl.querySelectorAll('button'))) {
      const isCur = btn.dataset.tab === this.activeTab;
      btn.style.opacity = isCur ? '1' : '0.68';
      btn.style.outline = isCur ? '2px solid #8be04e' : 'none';
    }

    // Rebuild rows only when what they show changed: a per-frame rebuild swaps the buttons out between pointerdown and
    // click, so purchases/equips were silently lost (CU-T005 playtest).
    const sig = [
      this.activeTab, r.brains, r.unlockedRewardIds.join(','), JSON.stringify(r.equippedCosmeticIdsBySlot),
      r.activeCompanionIds.join(','), r.unlockedCompanionIds.join(','), r.activeVehicleId ?? '', r.unlockedHideoutIds.join(','),
      r.discoveredSecretIds.join(','), JSON.stringify(r.achievementProgress),
    ].join('|');
    if (sig === this.bodySig) return;
    this.bodySig = sig;
    this.bodyEl.replaceChildren();
    if (this.activeTab === 'wardrobe') {
      const cosmetics = REWARDS.filter(x => x.type === 'cosmetic');
      for (const item of cosmetics) {
        const unlocked = r.unlockedRewardIds.includes(item.id);
        const equipped = item.slot ? r.equippedCosmeticIdsBySlot[item.slot] === item.id : false;
        const row = this.makeRow(
          `${item.displayName} (${item.slot ?? ''})`,
          item.description,
          unlocked
            ? (equipped ? 'Unequip' : 'Equip')
            : (item.costBrains !== undefined ? `Buy (${item.costBrains} Brains)` : 'Achievement'),
          unlocked || (item.costBrains !== undefined && r.brains >= item.costBrains),
          () => {
            if (!item.slot) return;
            if (unlocked) this.cb.onEquipCosmetic(item.slot, equipped ? null : item.id);
            else if (item.costBrains !== undefined) this.cb.onBuyReward(item.id);
          },
        );
        this.bodyEl.appendChild(row);
      }
    } else if (this.activeTab === 'companions') {
      for (const comp of COMPANIONS) {
        const unlocked = r.unlockedCompanionIds.includes(comp.id);
        const active = r.activeCompanionIds.includes(comp.id);
        const row = this.makeRow(
          `${comp.name} — ${comp.title}`,
          unlocked ? `${comp.perkLabel}. ${comp.description}` : `Find near ${comp.districtId.replace('_', ' ')}`,
          unlocked ? (active ? 'Active (Bench)' : 'Deploy') : 'Undiscovered',
          unlocked,
          () => this.cb.onToggleCompanion(comp.id),
        );
        this.bodyEl.appendChild(row);
      }
    } else if (this.activeTab === 'vehicles') {
      const vehicles = REWARDS.filter(x => x.type === 'vehicle');
      for (const veh of vehicles) {
        const unlocked = r.unlockedRewardIds.includes(veh.id);
        const kind = veh.vehicleKind!;
        const active = r.activeVehicleId === kind;
        const row = this.makeRow(
          veh.displayName,
          veh.description,
          unlocked ? (active ? 'Summon Again' : 'Summon') : `Buy (${veh.costBrains ?? 0} Brains)`,
          unlocked || (veh.costBrains !== undefined && r.brains >= veh.costBrains),
          () => {
            if (unlocked) this.cb.onSummonVehicle(kind);
            else this.cb.onBuyReward(veh.id);
          },
        );
        this.bodyEl.appendChild(row);
      }
    } else if (this.activeTab === 'hideouts') {
      for (const h of HIDEOUTS) {
        const unlocked = r.unlockedHideoutIds.includes(h.id);
        const row = this.makeRow(
          h.name,
          h.description,
          unlocked ? 'Fast Travel' : 'Locked',
          unlocked,
          () => {
            this.cb.onFastTravelHideout(h.id);
            this.cb.onClose();
          },
        );
        this.bodyEl.appendChild(row);
      }
    } else {
      for (const ach of ACHIEVEMENTS) {
        const cur = r.achievementProgress[ach.statKey] ?? 0;
        const done = Boolean(r.achievementProgress[`done:${ach.id}`]);
        const row = this.makeRow(
          `${ach.title} ${done ? '✓' : `(${Math.min(cur, ach.threshold)}/${ach.threshold})`}`,
          ach.description,
          done ? 'Earned' : `+${ach.brainsBonus} Brains`,
          false,
          () => {},
        );
        this.bodyEl.appendChild(row);
      }
      for (const sec of SECRETS) {
        const found = r.discoveredSecretIds.includes(sec.id);
        const row = this.makeRow(
          found ? sec.title : '??? Hidden City Secret',
          found ? sec.description : `Explore ${sec.districtId.replace('_', ' ')} to uncover.`,
          found ? 'Discovered' : 'Hidden',
          false,
          () => {},
        );
        this.bodyEl.appendChild(row);
      }
    }
  }

  private makeRow(
    title: string,
    desc: string,
    btnLabel: string,
    enabled: boolean,
    onClick: () => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';
    row.style.padding = '8px 10px';
    row.style.borderRadius = '8px';
    row.style.background = 'rgba(12, 22, 28, 0.72)';
    row.style.border = '1px solid rgba(255,255,255,0.12)';

    const text = document.createElement('div');
    const t = document.createElement('div');
    t.textContent = title;
    t.style.fontWeight = '800';
    t.style.fontSize = '0.95rem';
    const d = document.createElement('div');
    d.textContent = desc;
    d.style.fontSize = '0.82rem';
    d.style.opacity = '0.82';
    text.append(t, d);

    const btn = document.createElement('button');
    btn.className = 'ibz-btn';
    btn.textContent = btnLabel;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.55';
    btn.style.whiteSpace = 'nowrap';
    btn.onclick = onClick;

    row.append(text, btn);
    return row;
  }

  dispose(): void {
    this.root.remove();
  }
}
