import type { ICollisionWorld, SegmentOptions } from '../core/contracts';
import type { AABB, Collider, ColliderDef, Vec2 } from '../core/types';
import { clamp } from '../utils/math';
import { BALANCE } from '../config/balance';

/**
 * Car-height obstacles zombies and the Alpha climb over: parked cars, dumpsters, barriers and short walls
 * (<= `horde.crawlMaxHeight`). Never buildings, towers, gates, breakable structures or the world edge.
 */
export function isCrawlable(c: Collider): boolean {
  return (c.kind === 'vehicle' || c.kind === 'prop' || c.kind === 'wall') && c.height <= BALANCE.horde.crawlMaxHeight;
}

const climbProbe: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

/**
 * Height of the climbable obstacle under a circle (car roof, wall top); 0 on open ground. Counts as soon as the body
 * (not just its center) reaches the obstacle (todos #11), so a climber is up top before it is inside the bodywork;
 * one merely sliding along the side (center = radius out) stays down.
 */
export function climbHeightAt(collision: ICollisionWorld, pos: Vec2, radius: number, scratch: Collider[]): number {
  const inset = radius * 0.8;
  climbProbe.minX = pos.x - inset; climbProbe.maxX = pos.x + inset;
  climbProbe.minZ = pos.z - inset; climbProbe.maxZ = pos.z + inset;
  let height = 0;
  for (const c of collision.queryAABB(climbProbe, scratch)) {
    if (c.blocksMove && isCrawlable(c) && pos.x > c.minX - inset && pos.x < c.maxX + inset &&
        pos.z > c.minZ - inset && pos.z < c.maxZ + inset) height = Math.max(height, c.height);
  }
  return height;
}

export class CollisionWorld implements ICollisionWorld {
  readonly bounds: AABB;
  readonly colliders: readonly Collider[];
  // 8 m keeps local perception/movement queries small even in the denser districts.
  private readonly cellSize = 8;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellOffsets: Uint32Array;
  private readonly cellIds: Uint32Array;
  private readonly seen: Uint32Array;
  private stamp = 0;
  private readonly scratch: Collider[] = [];
  private readonly box: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  constructor(bounds: AABB, defs: readonly ColliderDef[]) {
    this.bounds = { ...bounds };
    this.colliders = defs.map((def, id) => ({ ...def, id, enabled: true }));
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / this.cellSize));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / this.cellSize));
    // Compressed buckets avoid allocating thousands of empty JS arrays at boot.
    this.cellOffsets = new Uint32Array(this.cols * this.rows + 1);
    this.seen = new Uint32Array(defs.length);
    for (const c of this.colliders) {
      const minX = this.col(c.minX), maxX = this.col(c.maxX), maxZ = this.row(c.maxZ);
      for (let z = this.row(c.minZ); z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) this.cellOffsets[z * this.cols + x + 1]++;
      }
    }
    for (let i = 1; i < this.cellOffsets.length; i++) this.cellOffsets[i] += this.cellOffsets[i - 1];
    this.cellIds = new Uint32Array(this.cellOffsets[this.cellOffsets.length - 1]);
    const cursors = this.cellOffsets.slice(0, -1);
    for (const c of this.colliders) {
      const minX = this.col(c.minX), maxX = this.col(c.maxX), maxZ = this.row(c.maxZ);
      for (let z = this.row(c.minZ); z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) this.cellIds[cursors[z * this.cols + x]++] = c.id;
      }
    }
  }

  private col(x: number): number {
    return clamp(Math.floor((x - this.bounds.minX) / this.cellSize), 0, this.cols - 1);
  }

  private row(z: number): number {
    return clamp(Math.floor((z - this.bounds.minZ) / this.cellSize), 0, this.rows - 1);
  }

  setEnabled(id: number, enabled: boolean): void {
    const collider = this.colliders[id];
    if (collider) collider.enabled = enabled;
  }

  findByTag(tag: string): Collider | undefined {
    return this.colliders.find(c => c.enabled && c.tag === tag);
  }

  queryAABB(box: AABB, out: Collider[]): Collider[] {
    out.length = 0;
    this.nextStamp();
    const minX = this.col(box.minX), maxX = this.col(box.maxX), maxZ = this.row(box.maxZ);
    for (let z = this.row(box.minZ); z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = z * this.cols + x;
        for (let i = this.cellOffsets[cell], end = this.cellOffsets[cell + 1]; i < end; i++) {
          const id = this.cellIds[i];
          if (this.seen[id] === this.stamp) continue;
          this.seen[id] = this.stamp;
          const c = this.colliders[id];
          if (c.enabled && (c.blocksMove || c.blocksSight) && c.minX <= box.maxX && c.maxX >= box.minX &&
              c.minZ <= box.maxZ && c.maxZ >= box.minZ) out.push(c);
        }
      }
    }
    return out;
  }

  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.seen.fill(0);
      this.stamp = 1;
    }
  }

  private circleCandidates(p: Vec2, radius: number): Collider[] {
    this.box.minX = p.x - radius;
    this.box.maxX = p.x + radius;
    this.box.minZ = p.z - radius;
    this.box.maxZ = p.z + radius;
    return this.queryAABB(this.box, this.scratch);
  }

  moveCircle(pos: Vec2, dx: number, dz: number, radius: number, passable?: (c: Collider) => boolean): void {
    if (!(radius > 0)) throw new RangeError('Circle radius must be positive');
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * 0.5)));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      pos.x += sx;
      pos.z += sz;
      this.resolveCircle(pos, radius, passable);
    }
  }

  resolveCircle(pos: Vec2, radius: number, passable?: (c: Collider) => boolean): boolean {
    const startX = pos.x;
    const startZ = pos.z;
    for (let iteration = 0; iteration < 4; iteration++) {
      pos.x = clamp(pos.x, this.bounds.minX + radius, this.bounds.maxX - radius);
      pos.z = clamp(pos.z, this.bounds.minZ + radius, this.bounds.maxZ - radius);
      const candidates = this.circleCandidates(pos, radius);
      let pushed = false;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (!c.blocksMove || (passable && passable(c))) continue;
        const dx = pos.x - clamp(pos.x, c.minX, c.maxX);
        const dz = pos.z - clamp(pos.z, c.minZ, c.maxZ);
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 0) {
          const d = Math.sqrt(d2);
          // Tiny separation prevents repeated resolution of roundoff at contact.
          const push = (radius - d + 1e-10) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        } else {
          const left = pos.x - c.minX;
          const right = c.maxX - pos.x;
          const top = pos.z - c.minZ;
          const bottom = c.maxZ - pos.z;
          const minimum = Math.min(left, right, top, bottom);
          if (minimum === left) pos.x = c.minX - radius - 1e-10;
          else if (minimum === right) pos.x = c.maxX + radius + 1e-10;
          else if (minimum === top) pos.z = c.minZ - radius - 1e-10;
          else pos.z = c.maxZ + radius + 1e-10;
        }
        pushed = true;
      }
      if (!pushed) break;
    }
    pos.x = clamp(pos.x, this.bounds.minX + radius, this.bounds.maxX - radius);
    pos.z = clamp(pos.z, this.bounds.minZ + radius, this.bounds.maxZ - radius);
    return pos.x !== startX || pos.z !== startZ;
  }

  isBlocked(p: Vec2, radius: number, passable?: (c: Collider) => boolean): boolean {
    const b = this.bounds;
    if (p.x - radius < b.minX || p.x + radius > b.maxX || p.z - radius < b.minZ || p.z + radius > b.maxZ) return true;
    const candidates = this.circleCandidates(p, radius);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c.blocksMove || (passable && passable(c))) continue;
      const dx = p.x - clamp(p.x, c.minX, c.maxX);
      const dz = p.z - clamp(p.z, c.minZ, c.maxZ);
      if ((dx === 0 && dz === 0) || dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  segmentBlocked(a: Vec2, b: Vec2, opts?: SegmentOptions): boolean {
    this.nextStamp();
    const dx = b.x - a.x, dz = b.z - a.z;
    const sx = Math.sign(dx), sz = Math.sign(dz);
    let x = this.col(a.x), z = this.row(a.z);
    // The outer buckets contain off-world colliders too, just like queryAABB.
    // Traverse only intersected buckets rather than the segment's entire AABB.
    let budget = this.cols + this.rows + 1;
    while (budget-- > 0) {
      if (this.segmentCellBlocked(z * this.cols + x, a, b, opts)) return true;
      const tx = (sx > 0 ? x + 1 < this.cols : sx < 0 && x > 0)
        ? (this.bounds.minX + (sx > 0 ? x + 1 : x) * this.cellSize - a.x) / dx : Infinity;
      const tz = (sz > 0 ? z + 1 < this.rows : sz < 0 && z > 0)
        ? (this.bounds.minZ + (sz > 0 ? z + 1 : z) * this.cellSize - a.z) / dz : Infinity;
      if (Math.min(tx, tz) > 1) break;
      if (tx === tz) {
        if (this.segmentCellBlocked(z * this.cols + x + sx, a, b, opts) ||
            this.segmentCellBlocked((z + sz) * this.cols + x, a, b, opts)) return true;
        x += sx; z += sz;
      } else if (tx < tz) x += sx;
      else z += sz;
    }
    return false;
  }

  private segmentCellBlocked(cell: number, a: Vec2, b: Vec2, opts?: SegmentOptions): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const move = opts?.mode === 'move';
    const h0 = opts?.fromHeight ?? 1.5;
    const dh = (opts?.toHeight ?? 1.2) - h0;
    for (let i = this.cellOffsets[cell], end = this.cellOffsets[cell + 1]; i < end; i++) {
      const id = this.cellIds[i];
      if (this.seen[id] === this.stamp) continue;
      this.seen[id] = this.stamp;
      const c = this.colliders[id];
      if (!c.enabled) continue;
      if (!(move ? c.blocksMove : c.blocksSight) || opts?.ignoreIds?.includes(c.id)) continue;
      let t0 = 0;
      let t1 = 1;
      if (dx === 0) {
        if (a.x < c.minX || a.x > c.maxX) continue;
      } else {
        const u = (c.minX - a.x) / dx;
        const v = (c.maxX - a.x) / dx;
        t0 = Math.max(t0, Math.min(u, v));
        t1 = Math.min(t1, Math.max(u, v));
      }
      if (dz === 0) {
        if (a.z < c.minZ || a.z > c.maxZ) continue;
      } else {
        const u = (c.minZ - a.z) / dz;
        const v = (c.maxZ - a.z) / dz;
        t0 = Math.max(t0, Math.min(u, v));
        t1 = Math.min(t1, Math.max(u, v));
      }
      if (t0 <= t1 && (move || Math.min(h0 + dh * t0, h0 + dh * t1) < c.height)) return true;
    }
    return false;
  }
}
