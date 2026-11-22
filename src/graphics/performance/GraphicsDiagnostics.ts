// Developer graphics overlay (F3, next to the HUD debug panel): frame time median/p95, draw calls, triangles,
// textures/geometries in GPU memory, live particles, shadow casters, quality preset (docs/8_visual_polish.md §7).
// DOM only; reads numbers handed to it by Game. Also exposes the latest sample for scripted benchmarks.
import { FrameStats } from './frameStats';

export interface DiagnosticsSample {
  quality: string;
  reducedMotion: boolean;
  postfx: boolean;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  particles: number;
  particleCap: number;
  shadowCasters: number;
  zombiesDrawn: number;
  humans: number;
  benchmark: number;
}

export interface DiagnosticsSnapshot extends DiagnosticsSample {
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  frames: number;
}

export class GraphicsDiagnostics {
  readonly frames = new FrameStats(300);
  private readonly el: HTMLDivElement;
  private visible = false;
  private refreshTimer = 0;
  private last: DiagnosticsSample | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ibz-gfx-diag';
    Object.assign(this.el.style, {
      position: 'absolute', right: '12px', bottom: '64px', padding: '6px 9px', minWidth: '210px',
      font: '11px/1.35 ui-monospace, Consolas, monospace', color: '#d9f7c8', background: 'rgba(12,18,14,0.78)',
      border: '1px solid rgba(140,220,120,0.35)', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre',
      display: 'none', zIndex: '30',
    } as Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  /** Call once per rendered frame with the real frame time (ms). */
  pushFrame(ms: number): void {
    this.frames.push(ms);
  }

  /** Cheap: the text refreshes at ~4 Hz while visible. */
  update(dt: number, sample: DiagnosticsSample): void {
    this.last = sample;
    if (!this.visible) return;
    this.refreshTimer -= dt;
    if (this.refreshTimer > 0) return;
    this.refreshTimer = 0.25;
    const s = this.snapshot();
    this.el.textContent =
      `GFX ${s.quality.toUpperCase()}${s.reducedMotion ? ' · reduced motion' : ''}${s.postfx ? ' · post' : ''}` +
      (s.benchmark ? ` · BENCH ${s.benchmark}` : '') + '\n' +
      `frame p50 ${s.medianMs.toFixed(1)} ms  p95 ${s.p95Ms.toFixed(1)} ms\n` +
      `calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
      `geo ${s.geometries}  tex ${s.textures}  shadow casters ${s.shadowCasters}\n` +
      `particles ${s.particles}/${s.particleCap}  zombies ${s.zombiesDrawn}  humans ${s.humans}`;
  }

  snapshot(): DiagnosticsSnapshot {
    const base: DiagnosticsSample = this.last ?? {
      quality: '-', reducedMotion: false, postfx: false, drawCalls: 0, triangles: 0, geometries: 0, textures: 0,
      particles: 0, particleCap: 0, shadowCasters: 0, zombiesDrawn: 0, humans: 0, benchmark: 0,
    };
    return { ...base, medianMs: this.frames.median(), p95Ms: this.frames.p95(), meanMs: this.frames.mean(), frames: this.frames.size };
  }

  dispose(): void {
    this.el.remove();
  }
}
