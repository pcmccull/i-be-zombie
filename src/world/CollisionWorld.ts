import type { ICollisionWorld, SegmentOptions } from '../core/contracts';
import type { AABB, Collider, ColliderDef, Vec2 } from '../core/types';
import { clamp } from '../utils/math';
import { BALANCE } from '../config/balance';

/** Low obstacles a packed horde can clamber over (cars, dumpsters, barriers — not trucks/walls). */
export function isCrawlable(c: Collider): boolean {
  return (c.kind === 'vehicle' || c.kind === 'prop') && c.height <= BALANCE.horde.crawlMaxHeight;
}

export class CollisionWorld implements ICollisionWorld {
  readonly bounds: AABB;
  readonly colliders: readonly Collider[];
  private readonly cellSize = 8;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: number[][];
  private readonly seen: Uint32Array;
  private stamp = 0;
  private readonly scratch: Collider[] = [];
  private readonly box: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  constructor(bounds: AABB, defs: readonly ColliderDef[]) {
    this.bounds = { ...bounds };
    this.colliders = defs.map((def, id) => ({ ...def, id, enabled: true }));
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / this.cellSize));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / this.cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.seen = new Uint32Array(defs.length);
    for (const c of this.colliders) {
      for (let z = this.row(c.minZ); z <= this.row(c.maxZ); z++) {
        for (let x = this.col(c.minX); x <= this.col(c.maxX); x++) this.cells[z * this.cols + x].push(c.id);
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
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    for (let z = this.row(box.minZ); z <= this.row(box.maxZ); z++) {
      for (let x = this.col(box.minX); x <= this.col(box.maxX); x++) {
        const cell = this.cells[z * this.cols + x];
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
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
    this.box.minX = Math.min(a.x, b.x);
    this.box.maxX = Math.max(a.x, b.x);
    this.box.minZ = Math.min(a.z, b.z);
    this.box.maxZ = Math.max(a.z, b.z);
    const candidates = this.queryAABB(this.box, this.scratch);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const move = opts?.mode === 'move';
    const h0 = opts?.fromHeight ?? 1.5;
    const dh = (opts?.toHeight ?? 1.2) - h0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
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
