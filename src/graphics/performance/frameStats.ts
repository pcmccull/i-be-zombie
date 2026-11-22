// [pure] Rolling frame-time window: median / p95 / mean over the last N frames (docs/8_visual_polish.md §7).
// Fixed-size ring buffer; percentile queries copy into a preallocated scratch array (no per-frame allocation).

export class FrameStats {
  private readonly ring: Float64Array;
  private readonly scratch: Float64Array;
  private count = 0;
  private head = 0;

  constructor(readonly capacity = 240) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
    this.ring = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.ring[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get size(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
  }

  /** Nearest-rank percentile (p in [0,100]); 0 when empty. */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    const s = this.scratch.subarray(0, this.count);
    s.set(this.ring.subarray(0, this.count));
    s.sort();
    const rank = Math.min(this.count - 1, Math.max(0, Math.ceil((p / 100) * this.count) - 1));
    return s[rank];
  }

  median(): number {
    return this.percentile(50);
  }

  p95(): number {
    return this.percentile(95);
  }

  mean(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.ring[i];
    return sum / this.count;
  }
}
