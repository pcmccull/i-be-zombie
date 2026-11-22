// Corner minimap (HUD-T002): circular, north-up, centered on the Alpha. Canvas2D. The static layer (terrain / fog /
// territory / district borders) is cached once for the whole world in an offscreen canvas and redrawn only when
// discovery or district/stronghold status changes; each frame blits the window around the Alpha and draws the
// dynamic layer (vision-gated humans, followers, nests, strongholds, cues, waypoint) on top. Fog is respected: the
// static layer only paints revealed cells and the dynamic layer applies the same AwarenessSystem gates as the map.
import type { DistrictId, DistrictLayout, GameState, Vec2 } from '../core/types';
import { getDistrictAt } from '../world/worldQueries';
import { centeredProjection, clampToCircle } from './hudModel';
import { icon } from './hudIcons';
import { drawDynamicLayer, drawStaticLayer, FOG_COLOR } from './mapRender';
import { districtName, staticLayerKey, worldToMap, type MapProjection } from './uiHelpers';

/** Meters from the Alpha to the minimap rim. */
const VIEW_RADIUS = 85;
/** Static-layer resolution (pixels per meter) for the whole-world cache. */
const STATIC_PX_PER_M = 1.4;
const MIN_FRAME_MS = 50; // ~20 Hz

const tmp: Vec2 = { x: 0, z: 0 };

export class Minimap {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticG: CanvasRenderingContext2D | null;
  private readonly districtEl: HTMLDivElement;
  private layout: DistrictLayout;
  private staticProj: MapProjection | null = null;
  private staticKey = '';
  private lastDrawMs = -1e9;
  private size = 0;
  private sizeDirty = true;
  private prevDistrict: DistrictId | null = null;

  private readonly onResize = (): void => { this.sizeDirty = true; };

  constructor(parent: HTMLElement, layout: DistrictLayout) {
    this.layout = layout;
    this.element = document.createElement('div');
    this.element.className = 'hz-minimap';
    this.element.innerHTML = `
      <div class="hz-mm-district"><span class="hz-mm-district-ico">${icon('pin', 's')}</span><span class="hz-mm-district-name"></span></div>
      <div class="hz-mm-ring">
        <canvas class="hz-mm-canvas"></canvas>
        <span class="hz-mm-north">N</span>
      </div>
      <div class="hz-mm-hint"><span class="hz-key">M</span> Map</div>`;
    parent.appendChild(this.element);
    this.canvas = this.element.querySelector('canvas') as HTMLCanvasElement;
    this.districtEl = this.element.querySelector('.hz-mm-district-name') as HTMLDivElement;
    this.g = this.canvas.getContext('2d');
    this.staticCanvas = document.createElement('canvas');
    this.staticG = this.staticCanvas.getContext('2d');
    this.allocStatic();
    window.addEventListener('resize', this.onResize);
  }

  private allocStatic(): void {
    const b = this.layout.bounds;
    this.staticCanvas.width = Math.ceil((b.maxX - b.minX) * STATIC_PX_PER_M);
    this.staticCanvas.height = Math.ceil((b.maxZ - b.minZ) * STATIC_PX_PER_M);
  }

  setLayout(layout: DistrictLayout): void {
    this.layout = layout;
    this.allocStatic();
    this.staticKey = '';
    this.prevDistrict = null;
  }

  /** Force the static layer to redraw next update (e.g. after a world reset). */
  invalidate(): void {
    this.staticKey = '';
    this.prevDistrict = null;
  }

  private ensureSize(): void {
    if (!this.sizeDirty) return;
    this.sizeDirty = false;
    const css = this.canvas.clientWidth || 196;
    const px = Math.max(96, Math.min(1024, Math.round(css * Math.min(2, window.devicePixelRatio || 1))));
    if (px !== this.size) {
      this.size = px;
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  update(state: GameState, waypoint: Vec2 | null, objective: Vec2 | null, nowMs: number = performance.now()): void {
    if (!this.g || !this.staticG) return;
    const district = getDistrictAt(this.layout, state.leader.pos);
    if (district !== this.prevDistrict) {
      this.prevDistrict = district;
      this.districtEl.textContent = districtName(district);
    }
    const key = staticLayerKey(state, this.layout);
    const dirty = key !== this.staticKey;
    if (!dirty && nowMs - this.lastDrawMs < MIN_FRAME_MS) return;
    this.lastDrawMs = nowMs;
    this.ensureSize();
    if (dirty) {
      this.staticKey = key;
      this.staticProj = drawStaticLayer(this.staticG, this.staticCanvas.width, this.staticCanvas.height, this.layout, state, { labels: false });
    }
    const sp = this.staticProj;
    if (!sp || this.size <= 0) return;
    const g = this.g;
    const n = this.size;
    const c = state.leader.pos;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = FOG_COLOR;
    g.fillRect(0, 0, n, n);
    // Blit the static window around the Alpha (source rect may run past the world edge; clip it manually).
    worldToMap(sp, c.x, c.z, tmp);
    const srcR = VIEW_RADIUS * sp.scale;
    let sx = tmp.x - srcR;
    let sy = tmp.z - srcR;
    let sw = srcR * 2;
    let sh = srcR * 2;
    let dx = 0;
    let dy = 0;
    let dw = n;
    let dh = n;
    const k = n / sw;
    if (sx < 0) { dx = -sx * k; dw -= dx; sw += sx; sx = 0; }
    if (sy < 0) { dy = -sy * k; dh -= dy; sh += sy; sy = 0; }
    const W = this.staticCanvas.width;
    const H = this.staticCanvas.height;
    if (sx + sw > W) { const over = sx + sw - W; sw -= over; dw -= over * k; }
    if (sy + sh > H) { const over = sy + sh - H; sh -= over; dh -= over * k; }
    if (sw > 1 && sh > 1 && dw > 1 && dh > 1) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.staticCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    const proj = centeredProjection(this.layout.bounds, c, VIEW_RADIUS, n);
    const iconScale = n / 115;
    drawDynamicLayer(g, proj, this.layout, state, { size: iconScale, annotate: false, waypoint });

    // Objective marker (known strongholds only): on the map when in range, clamped to the rim otherwise.
    if (objective) {
      worldToMap(proj, objective.x, objective.z, tmp);
      const rim = clampToCircle(n / 2, n / 2, n / 2 - 11 * iconScale, tmp);
      drawObjectiveMarker(g, tmp.x, tmp.z, 7 * iconScale, rim);
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.element.remove();
  }
}

function drawObjectiveMarker(g: CanvasRenderingContext2D, x: number, y: number, r: number, rim: boolean): void {
  g.save();
  g.translate(x, y);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.48;
    if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = '#FFD166';
  g.globalAlpha = rim ? 0.95 : 1;
  g.fill();
  g.lineWidth = Math.max(1.5, r * 0.28);
  g.strokeStyle = '#193F48';
  g.stroke();
  g.restore();
}
