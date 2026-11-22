// [3D] Chunk geometry cache + time-budgeted build queue for CityDistrict (VP2-T010).
//
// * `ChunkGeometryCache` keeps the merged geometry of a chunk (ground, markings, building LOD0/LOD1 buckets, dressing
//   placements) across unload/reload with an LRU cap on chunk records (default 24 = 12 loaded + 12 recently left).
//   Records of loaded chunks are pinned and never evicted; an evicted record disposes its GPU geometry.
// * `BuildJob` / `BuildQueue` build one chunk-LOD's buildings a few at a time (frame budget in ms, nearest chunk first)
//   so streaming never hitches; the caller shows the other LOD (or nothing) until the job completes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DressingInstance } from './environmentPopulation';

export type BuildingBucket = 'opaque' | 'glass' | 'emissive';

/** Per-building world-space geometry (carries the `aBuilding` attribute) before a chunk merge. */
export interface BuiltBuilding {
  index: number;
  opaque: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  emissive: THREE.BufferGeometry | null;
  /** World AABB [minX, minY, minZ, maxX, maxY, maxZ] of everything the building draws. */
  bounds: readonly number[] | null;
}

/** Merged buildings of one chunk at one LOD: at most one geometry per bucket (= one draw call each). */
export interface BuildingLodGeometry {
  opaque: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  emissive: THREE.BufferGeometry | null;
  triangles: number;
  /** Building indices drawn (shown) by this geometry. */
  indices: readonly number[];
}

export interface ChunkRecord {
  chunkId: number;
  lods: [BuildingLodGeometry | null, BuildingLodGeometry | null];
  /** Building index -> world bounds (set by the first finished LOD). */
  bounds: Map<number, readonly number[]>;
  ground: THREE.BufferGeometry | null;
  markings: THREE.BufferGeometry | null;
  dressing: DressingInstance[] | null;
  pins: number;
}

function triCount(g: THREE.BufferGeometry | null): number {
  if (!g) return 0;
  return g.index ? Math.floor(g.index.count / 3) : Math.floor(g.getAttribute('position').count / 3);
}

function disposeLod(l: BuildingLodGeometry | null): void {
  if (!l) return;
  l.opaque?.dispose();
  l.glass?.dispose();
  l.emissive?.dispose();
}

export class ChunkGeometryCache {
  private readonly records = new Map<number, ChunkRecord>();
  /** Counters for diagnostics / tests. */
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(readonly maxRecords = 24) {}

  get size(): number { return this.records.size; }

  peek(chunkId: number): ChunkRecord | undefined { return this.records.get(chunkId); }

  /** Get-or-create + mark most recently used. */
  ensure(chunkId: number): ChunkRecord {
    let r = this.records.get(chunkId);
    if (r) {
      this.records.delete(chunkId);
      this.records.set(chunkId, r);
      this.hits++;
    } else {
      this.misses++;
      r = { chunkId, lods: [null, null], bounds: new Map(), ground: null, markings: null, dressing: null, pins: 0 };
      this.records.set(chunkId, r);
      this.evict();
    }
    return r;
  }

  pin(chunkId: number): ChunkRecord {
    const r = this.ensure(chunkId);
    r.pins++;
    return r;
  }

  unpin(chunkId: number): void {
    const r = this.records.get(chunkId);
    if (r && r.pins > 0) r.pins--;
    this.evict();
  }

  private evict(): void {
    if (this.records.size <= this.maxRecords) return;
    for (const [id, r] of this.records) {
      if (this.records.size <= this.maxRecords) break;
      if (r.pins > 0) continue;
      this.disposeRecord(r);
      this.records.delete(id);
      this.evictions++;
    }
  }

  private disposeRecord(r: ChunkRecord): void {
    disposeLod(r.lods[0]);
    disposeLod(r.lods[1]);
    r.ground?.dispose();
    r.markings?.dispose();
    r.lods = [null, null];
    r.ground = r.markings = null;
    r.dressing = null;
  }

  stats(): { records: number; pinned: number; triangles: number; hits: number; misses: number; evictions: number } {
    let triangles = 0;
    let pinned = 0;
    for (const r of this.records.values()) {
      if (r.pins > 0) pinned++;
      for (const l of r.lods) if (l) triangles += l.triangles;
    }
    return { records: this.records.size, pinned, triangles, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }

  dispose(): void {
    for (const r of this.records.values()) this.disposeRecord(r);
    this.records.clear();
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/** Incremental build of one chunk-LOD's buildings. */
export class BuildJob {
  private next = 0;
  private built: BuiltBuilding[] = [];

  constructor(
    readonly chunkId: number,
    readonly lod: 0 | 1,
    readonly indices: readonly number[],
    private readonly buildOne: (index: number) => BuiltBuilding,
  ) {}

  get done(): boolean { return this.next >= this.indices.length; }
  get remaining(): number { return this.indices.length - this.next; }

  /** Builds buildings until `deadline` (ms on the `now` clock) passes; always builds at least one. Returns count built. */
  step(deadline: number, now: () => number): number {
    let n = 0;
    do {
      if (this.next >= this.indices.length) break;
      this.built.push(this.buildOne(this.indices[this.next++]));
      n++;
    } while (this.next < this.indices.length && now() < deadline);
    return n;
  }

  /** Merges the finished buildings (consumes and disposes the per-building geometry). */
  finish(): { geometry: BuildingLodGeometry; bounds: Map<number, readonly number[]> } {
    const lists: Record<BuildingBucket, THREE.BufferGeometry[]> = { opaque: [], glass: [], emissive: [] };
    const bounds = new Map<number, readonly number[]>();
    const indices: number[] = [];
    for (const b of this.built) {
      if (b.opaque) lists.opaque.push(b.opaque);
      if (b.glass) lists.glass.push(b.glass);
      if (b.emissive) lists.emissive.push(b.emissive);
      if (b.bounds) bounds.set(b.index, b.bounds);
      indices.push(b.index);
    }
    const merge = (list: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
      if (list.length === 0) return null;
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      return g;
    };
    const opaque = merge(lists.opaque);
    const glass = merge(lists.glass);
    const emissive = merge(lists.emissive);
    this.built = [];
    return {
      geometry: { opaque, glass, emissive, triangles: triCount(opaque) + triCount(glass) + triCount(emissive), indices },
      bounds,
    };
  }

  dispose(): void {
    for (const b of this.built) { b.opaque?.dispose(); b.glass?.dispose(); b.emissive?.dispose(); }
    this.built = [];
  }
}

export class BuildQueue {
  private jobs: BuildJob[] = [];

  get length(): number { return this.jobs.length; }

  has(chunkId: number, lod: 0 | 1): boolean {
    return this.jobs.some(j => j.chunkId === chunkId && j.lod === lod);
  }

  add(job: BuildJob): void {
    if (!this.has(job.chunkId, job.lod)) this.jobs.push(job);
    else job.dispose();
  }

  /** Drops (and disposes) every job whose chunk fails `keep`. */
  prune(keep: (chunkId: number, lod: 0 | 1) => boolean): void {
    this.jobs = this.jobs.filter(j => {
      if (keep(j.chunkId, j.lod)) return true;
      j.dispose();
      return false;
    });
  }

  /**
   * Spends up to `budgetMs` building (Infinity = drain). `priority` is smaller-first (distance to focus). `onDone`
   * receives each finished job. Returns the number of buildings built.
   */
  run(
    budgetMs: number,
    priority: (job: BuildJob) => number,
    onDone: (job: BuildJob, result: ReturnType<BuildJob['finish']>) => void,
    now: () => number = () => performance.now(),
  ): number {
    if (this.jobs.length === 0) return 0;
    const deadline = budgetMs === Infinity ? Infinity : now() + budgetMs;
    let built = 0;
    while (this.jobs.length > 0) {
      let best = 0;
      let bestP = priority(this.jobs[0]);
      for (let i = 1; i < this.jobs.length; i++) {
        const p = priority(this.jobs[i]);
        if (p < bestP) { best = i; bestP = p; }
      }
      const job = this.jobs[best];
      built += job.step(deadline, now);
      if (job.done) {
        this.jobs.splice(best, 1);
        onDone(job, job.finish());
      }
      if (now() >= deadline) break;
    }
    return built;
  }

  dispose(): void {
    for (const j of this.jobs) j.dispose();
    this.jobs = [];
  }
}
