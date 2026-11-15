// Full-screen world map overlay (M). Pauses nothing. Click sets a waypoint (onWaypoint(p)); clicking on
// the existing waypoint or the Clear button clears it (onWaypoint(null)).
import type { DistrictLayout, GameState, Vec2 } from '../core/types';
import { drawDynamicLayer, drawStaticLayer } from './mapRender';
import {
  STRONGHOLD_COLORS,
  abilityName,
  mapToWorld,
  staticLayerKey,
  strongholdMapStatus,
  territoryStyle,
  worldToMap,
  type MapProjection,
} from './uiHelpers';

const CANVAS_W = 960;
const MIN_FRAME_MS = 120;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

export class WorldMap {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticG: CanvasRenderingContext2D | null;
  private readonly listEl: HTMLDivElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly closeCallbacks: (() => void)[] = [];
  private layout: DistrictLayout;
  private proj: MapProjection | null = null;
  private staticKey = '';
  private listKey = '';
  private lastDrawMs = -1e9;
  private _visible = false;
  private waypoint: Vec2 | null = null;
  private readonly w = CANVAS_W;
  private readonly h: number;
  private readonly callbacks: ((p: Vec2 | null) => void)[] = [];
  private readonly tmp: Vec2 = { x: 0, z: 0 };
  private readonly tmp2: Vec2 = { x: 0, z: 0 };

  private readonly onCanvasClick = (ev: MouseEvent): void => {
    if (!this.proj) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((ev.clientX - rect.left) * this.canvas.width) / rect.width;
    const py = ((ev.clientY - rect.top) * this.canvas.height) / rect.height;
    const world = mapToWorld(this.proj, px, py, this.tmp);
    if (!world) return;
    if (this.waypoint) {
      worldToMap(this.proj, this.waypoint.x, this.waypoint.z, this.tmp2);
      const dx = this.tmp2.x - px;
      const dy = this.tmp2.z - py;
      if (dx * dx + dy * dy < 14 * 14) {
        this.emit(null);
        return;
      }
    }
    this.emit({ x: world.x, z: world.z });
  };

  private readonly onClear = (): void => this.emit(null);
  private readonly onCloseClick = (): void => { for (const cb of this.closeCallbacks) cb(); };

  constructor(parent: HTMLElement, layout: DistrictLayout) {
    this.layout = layout;
    const aspect = (layout.bounds.maxZ - layout.bounds.minZ) / Math.max(1, layout.bounds.maxX - layout.bounds.minX);
    this.h = Math.round(this.w * aspect);
    this.element = document.createElement('div');
    this.element.className = 'ibz-worldmap';
    this.element.innerHTML = `
      <div class="ibz-panel ibz-worldmap-card">
        <div class="ibz-worldmap-head">
          <span class="ibz-worldmap-title">WORLD MAP</span>
          <span class="ibz-worldmap-sub">Click to set a waypoint &middot; click it again to clear &middot; M to close</span>
          <button type="button" class="ibz-btn ibz-btn-small" data-ref="clear">Clear waypoint</button>
          <button type="button" class="ibz-btn ibz-worldmap-close" data-ref="close" aria-label="Close map">&times;</button>
        </div>
        <div class="ibz-worldmap-body">
          <canvas class="ibz-worldmap-canvas" data-ref="canvas"></canvas>
          <div class="ibz-worldmap-side">
            <div class="ibz-worldmap-list" data-ref="list"></div>
            <div class="ibz-worldmap-legend">
              <div class="ibz-legend-title">LEGEND</div>
              <div><span class="ibz-sw" style="background:#0c0f13;border:1px solid #4a5260"></span>Fog: not yet explored (hides terrain only)</div>
              <div><span class="ibz-sw" style="background:#e0782a"></span>Human-held district (explored, not conquered)</div>
              <div><span class="ibz-sw" style="background:#ffb347"></span>Contested: a stronghold objective is under attack</div>
              <div><span class="ibz-sw" style="background:#7d9a6a"></span>Infected: stronghold captured</div>
              <div><span class="ibz-sw ibz-sw-diamond" style="background:#e0782a"></span>Stronghold (pips = defense tier)</div>
              <div><span class="ibz-sw ibz-sw-dot" style="background:#c8f0a0"></span>Nest (ring = respawn point)</div>
              <div class="ibz-legend-note">Exploring reveals terrain only. Territory changes only when you capture strongholds.</div>
            </div>
          </div>
        </div>
      </div>`;
    parent.appendChild(this.element);
    this.canvas = this.element.querySelector('[data-ref="canvas"]') as HTMLCanvasElement;
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.listEl = this.element.querySelector('[data-ref="list"]') as HTMLDivElement;
    this.clearBtn = this.element.querySelector('[data-ref="clear"]') as HTMLButtonElement;
    this.closeBtn = this.element.querySelector('[data-ref="close"]') as HTMLButtonElement;
    this.g = this.canvas.getContext('2d');
    this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = this.w;
    this.staticCanvas.height = this.h;
    this.staticG = this.staticCanvas.getContext('2d');
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.clearBtn.addEventListener('click', this.onClear);
    this.closeBtn.addEventListener('click', this.onCloseClick);
  }

  get visible(): boolean {
    return this._visible;
  }

  onWaypoint(cb: (p: Vec2 | null) => void): void {
    this.callbacks.push(cb);
  }

  /** Close (x) button; HUD routes this to its hideMap path. */
  onClose(cb: () => void): void {
    this.closeCallbacks.push(cb);
  }

  setLayout(layout: DistrictLayout): void {
    this.layout = layout;
    this.staticKey = '';
    this.listKey = '';
  }

  show(): void {
    this._visible = true;
    this.element.classList.add('is-visible');
    this.staticKey = '';
    this.listKey = '';
    this.lastDrawMs = -1e9;
  }

  hide(): void {
    this._visible = false;
    this.element.classList.remove('is-visible');
  }

  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }

  update(state: GameState, waypoint: Vec2 | null, nowMs: number = performance.now()): void {
    if (!this._visible || !this.g || !this.staticG) return;
    this.waypoint = waypoint;
    const key = staticLayerKey(state, this.layout);
    const dirty = key !== this.staticKey;
    if (!dirty && nowMs - this.lastDrawMs < MIN_FRAME_MS) return;
    this.lastDrawMs = nowMs;
    if (dirty) {
      this.staticKey = key;
      this.proj = drawStaticLayer(this.staticG, this.w, this.h, this.layout, state, { labels: true });
    }
    if (!this.proj) return;
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.w, this.h);
    this.g.drawImage(this.staticCanvas, 0, 0);
    drawDynamicLayer(this.g, this.proj, this.layout, state, { size: 1.6, annotate: true, waypoint });
    this.clearBtn.disabled = !waypoint;
    this.renderList(state, key);
  }

  private renderList(state: GameState, key: string): void {
    const listKey = `${key}|${state.progression.unlocked.length}`;
    if (listKey === this.listKey) return;
    this.listKey = listKey;
    let html = '<div class="ibz-legend-title">STRONGHOLDS</div>';
    for (const def of this.layout.strongholds) {
      const status = strongholdMapStatus(state, def);
      const color = STRONGHOLD_COLORS[status];
      const known = status !== 'unknown';
      const statusText =
        status === 'captured' ? 'Captured' : status === 'contested' ? 'Contested' : known ? 'Human-held' : 'Undiscovered';
      const district = territoryStyle(state.districts[def.districtId]?.status ?? 'unknown').label;
      const unlock = def.unlock ? `Unlocks: ${abilityName(def.unlock)}` : 'No mutation (biomass only)';
      html += `<div class="ibz-sh-row"><span class="ibz-sw ibz-sw-diamond" style="background:${color}"></span>
        <div><div class="ibz-sh-name">${known ? escapeHtml(def.name) : '???'}</div>
        <div class="ibz-sh-meta">${statusText}${known ? ` &middot; Tier ${def.defenseTier} &middot; ${escapeHtml(unlock)}` : ''}</div>
        <div class="ibz-sh-meta">District: ${known ? escapeHtml(district) : 'Unknown'}</div></div></div>`;
    }
    this.listEl.innerHTML = html;
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.clearBtn.removeEventListener('click', this.onClear);
    this.closeBtn.removeEventListener('click', this.onCloseClick);
    this.closeCallbacks.length = 0;
    this.callbacks.length = 0;
    this.element.remove();
  }

  private emit(p: Vec2 | null): void {
    for (const cb of this.callbacks) cb(p);
  }
}
