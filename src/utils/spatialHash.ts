import type { ISpatialHash } from '../core/contracts';
import type { AABB } from '../core/types';
import { clamp } from './math';

/** Reusable linked lists; external entity ids need not be contiguous. */
export class SpatialHash implements ISpatialHash {
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: Int32Array;
  private readonly touched: number[] = [];
  private readonly ids: number[] = [];
  private readonly next: number[] = [];
  private count = 0;

  constructor(private readonly cellSize: number, private readonly bounds: AABB) {
    if (!(cellSize > 0)) throw new RangeError('cellSize must be positive');
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
    this.heads = new Int32Array(this.cols * this.rows).fill(-1);
  }

  clear(): void {
    for (let i = 0; i < this.touched.length; i++) this.heads[this.touched[i]] = -1;
    this.touched.length = 0;
    this.count = 0;
  }

  insert(id: number, x: number, z: number): void {
    const col = clamp(Math.floor((x - this.bounds.minX) / this.cellSize), 0, this.cols - 1);
    const row = clamp(Math.floor((z - this.bounds.minZ) / this.cellSize), 0, this.rows - 1);
    const cell = row * this.cols + col;
    if (this.heads[cell] === -1) this.touched.push(cell);
    this.ids[this.count] = id;
    this.next[this.count] = this.heads[cell];
    this.heads[cell] = this.count++;
  }

  query(x: number, z: number, r: number, out: number[]): number[] {
    const minX = clamp(Math.floor((x - r - this.bounds.minX) / this.cellSize), 0, this.cols - 1);
    const maxX = clamp(Math.floor((x + r - this.bounds.minX) / this.cellSize), 0, this.cols - 1);
    const minZ = clamp(Math.floor((z - r - this.bounds.minZ) / this.cellSize), 0, this.rows - 1);
    const maxZ = clamp(Math.floor((z + r - this.bounds.minZ) / this.cellSize), 0, this.rows - 1);
    for (let row = minZ; row <= maxZ; row++) {
      for (let col = minX; col <= maxX; col++) {
        for (let i = this.heads[row * this.cols + col]; i !== -1; i = this.next[i]) out.push(this.ids[i]);
      }
    }
    return out;
  }
}
