// Full-screen world map overlay (M). Pauses nothing. Click sets a waypoint (onWaypoint(p)); clicking on
// the existing waypoint or the Clear button clears it (onWaypoint(null)).
// Teleport mode (showTeleport, opened by V at an active nest): the other active nests are highlighted and clicking
// one (on the map or in the side list) picks it (onTeleport(nestId)); waypoints are off meanwhile.
import './hudTheme.css';
import './hudPanels.css';
import type { DistrictLayout, GameState, NestDef, Vec2 } from '../core/types';
import { nestTeleportDestinations } from '../systems/nests';
import { icon } from './hudIcons';
import { drawDynamicLayer, drawStaticLayer } from './mapRender';
import {
  STRONGHOLD_COLORS,
  abilityName,
  districtName,
  strongholdName,
  mapToWorld,
  staticLayerKey,
  strongholdMapStatus,
  territoryStyle,
  worldToMap,
  type MapProjection,
} from './uiHelpers';

const CANVAS_W = 960;
const WAYPOINT_SUB = 'Click to set a waypoint &middot; click it again to clear &middot; M to close';
const TELEPORT_SUB = 'Pick a glowing nest: you and your horde dive in here and crawl out there &middot; Esc to cancel';
const MIN_FRAME_MS = 120;

/** Stronghold nests are named after their stronghold (several can share a district), the rest by district. */
function nestName(n: NestDef): string {
  return n.strongholdId ? strongholdName(n.strongholdId) : `${districtName(n.districtId)} nest`;
}

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
  private readonly titleEl: HTMLSpanElement;
  private readonly subEl: HTMLSpanElement;
  private teleportFrom: string | null = null;
  private destinations: NestDef[] = [];
  private readonly teleportCallbacks: ((nestId: string) => void)[] = [];

  private readonly onListClick = (ev: MouseEvent): void => {
    const btn = (ev.target as HTMLElement | null)?.closest('[data-teleport]') as HTMLElement | null;
    const id = btn?.dataset.teleport;
    if (id && this.teleportFrom) this.emitTeleport(id);
  };

  private readonly onCanvasClick = (ev: MouseEvent): void => {
    if (!this.proj) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = ((ev.clientX - rect.left) * this.canvas.width) / rect.width;
    const py = ((ev.clientY - rect.top) * this.canvas.height) / rect.height;
    if (this.teleportFrom) {
      // Pick the destination nest nearest the click (generous radius: the dots are small).
      let best: NestDef | null = null, bestD = 26 * 26;
      for (const n of this.destinations) {
        worldToMap(this.proj, n.pos.x, n.pos.z, this.tmp2);
        const d = (this.tmp2.x - px) ** 2 + (this.tmp2.z - py) ** 2;
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best) this.emitTeleport(best.id);
      return;
    }
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
          <span class="ibz-worldmap-title">${icon('map', 'm')}<span data-ref="title">WORLD MAP</span></span>
          <span class="ibz-worldmap-sub" data-ref="sub">${WAYPOINT_SUB}</span>
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
              <div><span class="ibz-sw ibz-sw-dot" style="background:#8b949e"></span>Seen movement / sound blur (unidentified)</div>
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
    this.titleEl = this.element.querySelector('[data-ref="title"]') as HTMLSpanElement;
    this.subEl = this.element.querySelector('[data-ref="sub"]') as HTMLSpanElement;
    this.g = this.canvas.getContext('2d');
    this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = this.w;
    this.staticCanvas.height = this.h;
    this.staticG = this.staticCanvas.getContext('2d');
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.clearBtn.addEventListener('click', this.onClear);
    this.closeBtn.addEventListener('click', this.onCloseClick);
    this.listEl.addEventListener('click', this.onListClick);
  }

  /** Teleport mode is active (opened from a nest). */
  get teleporting(): boolean {
    return this.teleportFrom !== null;
  }

  onTeleport(cb: (nestId: string) => void): void {
    this.teleportCallbacks.push(cb);
  }

  /** Open the map in nest teleport mode, standing at nest `fromNestId`. */
  showTeleport(fromNestId: string): void {
    this.teleportFrom = fromNestId;
    this.destinations = [];
    this.element.classList.add('is-teleport');
    this.titleEl.textContent = 'NEST TELEPORT';
    this.subEl.innerHTML = TELEPORT_SUB;
    this.clearBtn.style.display = 'none';
    this.show();
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
    if (this.teleportFrom !== null) {
      this.teleportFrom = null;
      this.destinations = [];
      this.element.classList.remove('is-teleport');
      this.titleEl.textContent = 'WORLD MAP';
      this.subEl.innerHTML = WAYPOINT_SUB;
      this.clearBtn.style.display = '';
      this.listKey = '';
    }
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
    const tp = this.teleportFrom !== null;
    drawDynamicLayer(this.g, this.proj, this.layout, state, { size: 1.6, annotate: !tp, waypoint: tp ? null : waypoint });
    this.clearBtn.disabled = !waypoint;
    if (tp) {
      this.destinations = nestTeleportDestinations(state, this.layout, this.teleportFrom as string);
      this.drawTeleportMarks(nowMs);
      this.renderTeleportList(state);
    } else this.renderList(state, key);
  }

  /** Pulsing rings on every destination nest, a dashed "you are here" ring on the nest the party dives into. */
  private drawTeleportMarks(nowMs: number): void {
    const g = this.g, proj = this.proj;
    if (!g || !proj) return;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 220);
    g.save();
    g.font = 'bold 13px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const n of this.destinations) {
      worldToMap(proj, n.pos.x, n.pos.z, this.tmp2);
      g.beginPath();
      g.arc(this.tmp2.x, this.tmp2.z, 10 + pulse * 6, 0, Math.PI * 2);
      g.strokeStyle = `rgba(125, 255, 106, ${0.55 + 0.4 * pulse})`;
      g.lineWidth = 3;
      g.stroke();
      const label = nestName(n);
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(8, 10, 12, 0.85)';
      g.strokeText(label, this.tmp2.x, this.tmp2.z - 20);
      g.fillStyle = '#c8f0a0';
      g.fillText(label, this.tmp2.x, this.tmp2.z - 20);
    }
    const from = this.layout.nests.find((n) => n.id === this.teleportFrom);
    if (from) {
      worldToMap(proj, from.pos.x, from.pos.z, this.tmp2);
      g.beginPath();
      g.arc(this.tmp2.x, this.tmp2.z, 13, 0, Math.PI * 2);
      g.setLineDash([4, 4]);
      g.strokeStyle = '#ffb347';
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
  }

  private renderTeleportList(state: GameState): void {
    const listKey = `tp|${this.teleportFrom}|${this.destinations.map((n) => n.id).join(',')}|${state.followerCount}`;
    if (listKey === this.listKey) return;
    this.listKey = listKey;
    const from = this.layout.nests.find((n) => n.id === this.teleportFrom);
    const n = state.followerCount;
    let html = `<div class="ibz-legend-title">CRAWL OUT AT</div>
      <div class="ibz-sh-meta ibz-tp-note">You${n > 0 ? ` + ${n} zombie${n === 1 ? '' : 's'}` : ''} dive into the
      ${from ? escapeHtml(nestName(from)) : 'nest'}.</div>`;
    for (const d of this.destinations) {
      const dist = from ? Math.round(Math.hypot(d.pos.x - from.pos.x, d.pos.z - from.pos.z)) : 0;
      html += `<button type="button" class="ibz-btn ibz-tp-row" data-teleport="${escapeHtml(d.id)}">${icon('nest', 's')}
        <span class="ibz-tp-text"><span class="ibz-sh-name">${escapeHtml(nestName(d))}</span>
        <span class="ibz-sh-meta">${dist} m away</span></span></button>`;
    }
    this.listEl.innerHTML = html;
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
      const unlock = def.unlock ? `Unlocks: ${abilityName(def.unlock)}` : 'No mutation (brains only)';
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
    this.listEl.removeEventListener('click', this.onListClick);
    this.closeCallbacks.length = 0;
    this.teleportCallbacks.length = 0;
    this.callbacks.length = 0;
    this.element.remove();
  }

  private emitTeleport(nestId: string): void {
    for (const cb of this.teleportCallbacks) cb(nestId);
  }

  private emit(p: Vec2 | null): void {
    for (const cb of this.callbacks) cb(p);
  }
}
