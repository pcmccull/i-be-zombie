// Corner minimap (Canvas2D, north-up, whole world). Static layer (terrain/fog/territory) is cached in an
// offscreen canvas and only redrawn when discovery or district/stronghold status changes.
import type { DistrictLayout, GameState, Vec2 } from '../core/types';
import { drawDynamicLayer, drawStaticLayer } from './mapRender';
import { staticLayerKey, type MapProjection } from './uiHelpers';

const WIDTH = 180;
const MIN_FRAME_MS = 66; // ~15 Hz

export class Minimap {
  readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly staticCanvas: HTMLCanvasElement;
  private readonly staticG: CanvasRenderingContext2D | null;
  private layout: DistrictLayout;
  private proj: MapProjection | null = null;
  private staticKey = '';
  private lastDrawMs = -1e9;
  private readonly w: number;
  private readonly h: number;

  constructor(parent: HTMLElement, layout: DistrictLayout) {
    this.layout = layout;
    const aspect = (layout.bounds.maxZ - layout.bounds.minZ) / Math.max(1, layout.bounds.maxX - layout.bounds.minX);
    this.w = WIDTH;
    this.h = Math.round(WIDTH * aspect);
    this.element = document.createElement('div');
    this.element.className = 'ibz-panel ibz-minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.className = 'ibz-minimap-canvas';
    this.element.appendChild(this.canvas);
    const hint = document.createElement('div');
    hint.className = 'ibz-minimap-hint';
    hint.textContent = 'M: world map';
    this.element.appendChild(hint);
    parent.appendChild(this.element);
    this.g = this.canvas.getContext('2d');
    this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = this.w;
    this.staticCanvas.height = this.h;
    this.staticG = this.staticCanvas.getContext('2d');
  }

  setLayout(layout: DistrictLayout): void {
    this.layout = layout;
    this.staticKey = '';
  }

  /** Force the static layer to redraw next update (e.g. after a world reset). */
  invalidate(): void {
    this.staticKey = '';
  }

  update(state: GameState, waypoint: Vec2 | null, nowMs: number = performance.now()): void {
    if (!this.g || !this.staticG) return;
    const key = staticLayerKey(state, this.layout);
    const dirty = key !== this.staticKey;
    if (!dirty && nowMs - this.lastDrawMs < MIN_FRAME_MS) return;
    this.lastDrawMs = nowMs;
    if (dirty) {
      this.staticKey = key;
      this.proj = drawStaticLayer(this.staticG, this.w, this.h, this.layout, state, { labels: false });
    }
    if (!this.proj) return;
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.w, this.h);
    this.g.drawImage(this.staticCanvas, 0, 0);
    drawDynamicLayer(this.g, this.proj, this.layout, state, { size: 1, annotate: false, waypoint });
  }

  dispose(): void {
    this.element.remove();
  }
}
