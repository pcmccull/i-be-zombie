import { BALANCE } from '../config/balance';
import type { ICollisionWorld, IFlowField, INavigationGrid, SegmentOptions } from '../core/contracts';
import type { AABB, Collider, Vec2 } from '../core/types';
import { clamp, copyVec, normalizeInPlace, set } from '../utils/math';

const STEP_X = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const STEP_Z = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

/** Indexed binary heap: one entry per cell, with allocation-free decrease-key. */
class CellHeap {
  private readonly ids: Int32Array;
  private readonly positions: Int32Array;
  private readonly priorities: Float64Array;
  size = 0;

  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.positions = new Int32Array(capacity).fill(-1);
    this.priorities = new Float64Array(capacity);
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.positions[this.ids[i]] = -1;
    this.size = 0;
  }

  put(id: number, priority: number): void {
    let index = this.positions[id];
    if (index < 0) index = this.size++;
    this.priorities[id] = priority;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentId = this.ids[parent];
      if (this.priorities[parentId] <= priority) break;
      this.ids[index] = parentId;
      this.positions[parentId] = index;
      index = parent;
    }
    this.ids[index] = id;
    this.positions[id] = index;
  }

  pop(): number {
    const result = this.ids[0];
    this.positions[result] = -1;
    const last = this.ids[--this.size];
    if (this.size > 0) {
      const priority = this.priorities[last];
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= this.size) break;
        if (child + 1 < this.size && this.priorities[this.ids[child + 1]] < this.priorities[this.ids[child]]) child++;
        const childId = this.ids[child];
        if (priority <= this.priorities[childId]) break;
        this.ids[index] = childId;
        this.positions[childId] = index;
        index = child;
      }
      this.ids[index] = last;
      this.positions[last] = index;
    }
    return result;
  }
}

export class NavigationGrid implements INavigationGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  version = 0;
  private readonly walkable: Uint8Array;
  private readonly cost: Float64Array;
  private readonly parent: Int32Array;
  private readonly closed: Uint8Array;
  private readonly searchCells: Int32Array;
  private searchCount = 0;
  private readonly heap: CellHeap;
  private readonly flowCells: Int32Array;
  private readonly connections: Uint8Array;
  private readonly neighborOffsets: Int32Array;
  private readonly stepCosts: Float64Array;
  private readonly route: number[] = [];
  private readonly clearanceBox: AABB = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly clearanceCandidates: Collider[] = [];
  private colliderRanges = new Int32Array(0);
  private colliderActive = new Uint8Array(0);
  private walkableCount = 0;

  constructor(
    private readonly collision: ICollisionWorld,
    cellSize: number = BALANCE.world.navCellSize,
    private readonly agentRadius: number = BALANCE.world.navAgentRadius,
    /** Colliders this grid treats as walkable (e.g. crawlable cars for the horde grid). */
    private readonly passable: (c: Collider) => boolean = () => false,
  ) {
    if (!(cellSize > 0) || agentRadius < 0) throw new RangeError('Invalid navigation dimensions');
    this.cellSize = cellSize;
    const bounds = collision.bounds;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cellSize);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cellSize);
    const size = this.cols * this.rows;
    this.walkable = new Uint8Array(size);
    this.cost = new Float64Array(size).fill(Infinity);
    this.parent = new Int32Array(size);
    this.closed = new Uint8Array(size);
    this.searchCells = new Int32Array(size);
    this.heap = new CellHeap(size);
    this.flowCells = new Int32Array(size);
    this.connections = new Uint8Array(size);
    this.neighborOffsets = Int32Array.from(STEP_X, (dx, i) => STEP_Z[i] * this.cols + dx);
    this.stepCosts = Float64Array.from(STEP_X, (dx, i) => (dx && STEP_Z[i] ? Math.SQRT2 : 1) * cellSize);
    this.rebuild();
  }

  rebuild(): void {
    const b = this.collision.bounds;
    const s = this.cellSize;
    const r = this.agentRadius;
    const colliders = this.collision.colliders;
    const full = this.version === 0 || this.colliderActive.length !== colliders.length;
    if (full) {
      this.colliderRanges = new Int32Array(colliders.length * 4);
      this.colliderActive = new Uint8Array(colliders.length);
    }
    let left = full ? 0 : this.cols, right = full ? this.cols - 1 : -1;
    let top = full ? 0 : this.rows, bottom = full ? this.rows - 1 : -1;
    // Compare raster footprints, including passability, so toggles, overlapping doors,
    // moved colliders and changes to a caller's passable predicate all remain exact.
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i], offset = i * 4;
      const minX = Math.max(0, Math.ceil((c.minX - r - b.minX) / s - 0.5));
      const maxX = Math.min(this.cols - 1, Math.floor((c.maxX + r - b.minX) / s - 0.5));
      const minZ = Math.max(0, Math.ceil((c.minZ - r - b.minZ) / s - 0.5));
      const maxZ = Math.min(this.rows - 1, Math.floor((c.maxZ + r - b.minZ) / s - 0.5));
      const active = +(c.enabled && c.blocksMove && !this.passable(c) && minX <= maxX && minZ <= maxZ);
      const ranges = this.colliderRanges;
      if (!full && (active !== this.colliderActive[i] || (active &&
          (minX !== ranges[offset] || maxX !== ranges[offset + 1] ||
           minZ !== ranges[offset + 2] || maxZ !== ranges[offset + 3])))) {
        if (this.colliderActive[i]) {
          left = Math.min(left, ranges[offset]); right = Math.max(right, ranges[offset + 1]);
          top = Math.min(top, ranges[offset + 2]); bottom = Math.max(bottom, ranges[offset + 3]);
        }
        if (active) {
          left = Math.min(left, minX); right = Math.max(right, maxX);
          top = Math.min(top, minZ); bottom = Math.max(bottom, maxZ);
        }
      }
      ranges[offset] = minX; ranges[offset + 1] = maxX;
      ranges[offset + 2] = minZ; ranges[offset + 3] = maxZ;
      this.colliderActive[i] = active;
    }
    // Restore only the changed rectangle, then reapply every overlapping footprint.
    for (let z = top; z <= bottom; z++) {
      const worldZ = b.minZ + (z + 0.5) * s;
      for (let x = left; x <= right; x++) {
        const worldX = b.minX + (x + 0.5) * s;
        this.walkableCount -= this.walkable[z * this.cols + x];
        this.walkable[z * this.cols + x] = +(worldX >= b.minX + r && worldX <= b.maxX - r &&
          worldZ >= b.minZ + r && worldZ <= b.maxZ - r);
        this.walkableCount += this.walkable[z * this.cols + x];
      }
    }
    // Rasterize collider rectangles directly, rather than query the world for every cell.
    for (let i = 0; i < colliders.length && left <= right; i++) {
      if (!this.colliderActive[i]) continue;
      const offset = i * 4, ranges = this.colliderRanges;
      const minX = Math.max(left, ranges[offset]), maxX = Math.min(right, ranges[offset + 1]);
      const minZ = Math.max(top, ranges[offset + 2]), maxZ = Math.min(bottom, ranges[offset + 3]);
      if (minX > maxX || minZ > maxZ) continue;
      for (let z = minZ; z <= maxZ; z++) {
        for (let id = z * this.cols + minX, end = z * this.cols + maxX; id <= end; id++) {
          this.walkableCount -= this.walkable[id];
          this.walkable[id] = 0;
        }
      }
    }
    // Connectivity changes only on a rebuild, not on every shared-field replan.
    // Cache the eight legal edges, including the no-corner-cutting rule.
    if (left <= right) for (let z = Math.max(0, top - 1); z <= Math.min(this.rows - 1, bottom + 1); z++) {
      for (let x = Math.max(0, left - 1); x <= Math.min(this.cols - 1, right + 1); x++) {
        const id = z * this.cols + x;
        if (!this.walkable[id]) { this.connections[id] = 0; continue; }
        const w = x > 0 && this.walkable[id - 1] !== 0;
        const e = x + 1 < this.cols && this.walkable[id + 1] !== 0;
        const n = z > 0 && this.walkable[id - this.cols] !== 0;
        const south = z + 1 < this.rows && this.walkable[id + this.cols] !== 0;
        let mask = 0;
        if (n) mask |= 2;
        if (w) mask |= 8;
        if (e) mask |= 16;
        if (south) mask |= 64;
        if (n && w && this.walkable[id - this.cols - 1]) mask |= 1;
        if (n && e && this.walkable[id - this.cols + 1]) mask |= 4;
        if (south && w && this.walkable[id + this.cols - 1]) mask |= 32;
        if (south && e && this.walkable[id + this.cols + 1]) mask |= 128;
        this.connections[id] = mask;
      }
    }
    this.version++;
  }

  private index(p: Vec2): number {
    const b = this.collision.bounds;
    if (p.x < b.minX || p.z < b.minZ || p.x >= b.maxX || p.z >= b.maxZ) return -1;
    const x = Math.floor((p.x - b.minX) / this.cellSize);
    const z = Math.floor((p.z - b.minZ) / this.cellSize);
    return z * this.cols + x;
  }

  private open(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.cols && z < this.rows && this.walkable[z * this.cols + x] !== 0;
  }

  private center(id: number, out: Vec2): Vec2 {
    return set(out, this.collision.bounds.minX + (id % this.cols + 0.5) * this.cellSize,
      this.collision.bounds.minZ + (Math.floor(id / this.cols) + 0.5) * this.cellSize);
  }

  isWalkable(p: Vec2): boolean {
    const id = this.index(p);
    return id >= 0 && this.walkable[id] !== 0;
  }

  nearestWalkable(p: Vec2, out: Vec2 = { x: 0, z: 0 }): Vec2 {
    if (this.isWalkable(p)) return copyVec(out, p);
    const b = this.collision.bounds;
    const cx = clamp(Math.floor((p.x - b.minX) / this.cellSize), 0, this.cols - 1);
    const cz = clamp(Math.floor((p.z - b.minZ) / this.cellSize), 0, this.rows - 1);
    let best = -1;
    let bestDistance = Infinity;
    // Full ring search keeps the result nearest in world distance, including off-grid inputs.
    const maxRing = Math.max(cx, cz, this.cols - 1 - cx, this.rows - 1 - cz);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let z = Math.max(0, cz - ring); z <= Math.min(this.rows - 1, cz + ring); z++) {
        const minX = Math.max(0, cx - ring), maxX = Math.min(this.cols - 1, cx + ring);
        const stepX = Math.abs(z - cz) === ring ? 1 : Math.max(1, maxX - minX);
        for (let x = minX; x <= maxX; x += stepX) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== ring || !this.open(x, z)) continue;
          const dx = b.minX + (x + 0.5) * this.cellSize - p.x;
          const dz = b.minZ + (z + 0.5) * this.cellSize - p.z;
          const distance = dx * dx + dz * dz;
          if (distance < bestDistance) {
            best = z * this.cols + x;
            bestDistance = distance;
          }
        }
      }
      // Every unsearched cell lies beyond one of the next ring's four sides.
      let remaining = Infinity;
      const next = ring + 1, size = this.cellSize;
      if (cx - next >= 0) remaining = Math.min(remaining, Math.abs(b.minX + (cx - next + 0.5) * size - p.x));
      if (cx + next < this.cols) remaining = Math.min(remaining, Math.abs(b.minX + (cx + next + 0.5) * size - p.x));
      if (cz - next >= 0) remaining = Math.min(remaining, Math.abs(b.minZ + (cz - next + 0.5) * size - p.z));
      if (cz + next < this.rows) remaining = Math.min(remaining, Math.abs(b.minZ + (cz + next + 0.5) * size - p.z));
      if (best >= 0 && remaining * remaining > bestDistance) break;
    }
    return best >= 0 ? this.center(best, out) : copyVec(out, p);
  }

  /** Include both sides when a point lies exactly on a grid edge or corner. */
  private touchedPointOpen(x: number, z: number): boolean {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    if (!this.open(ix, iz)) return false;
    const edgeX = Math.abs(x - Math.round(x)) < 1e-10;
    const edgeZ = Math.abs(z - Math.round(z)) < 1e-10;
    return (!edgeX || this.open(ix - 1, iz)) && (!edgeZ || this.open(ix, iz - 1)) &&
      (!edgeX || !edgeZ || this.open(ix - 1, iz - 1));
  }

  hasClearWalk(a: Vec2, b: Vec2): boolean {
    const bounds = this.collision.bounds;
    const r = this.agentRadius;
    if (Math.min(a.x, b.x) < bounds.minX + r || Math.max(a.x, b.x) > bounds.maxX - r ||
        Math.min(a.z, b.z) < bounds.minZ + r || Math.max(a.z, b.z) > bounds.maxZ - r) return false;
    const ax = (a.x - bounds.minX) / this.cellSize;
    const az = (a.z - bounds.minZ) / this.cellSize;
    const bx = (b.x - bounds.minX) / this.cellSize;
    const bz = (b.z - bounds.minZ) / this.cellSize;
    if (!this.touchedPointOpen(ax, az) || !this.touchedPointOpen(bx, bz)) return false;
    let x = Math.floor(ax);
    let z = Math.floor(az);
    const dx = bx - ax;
    const dz = bz - az;
    const sx = Math.sign(dx);
    const sz = Math.sign(dz);
    const tx = dx === 0 ? Infinity : 1 / Math.abs(dx);
    const tz = dz === 0 ? Infinity : 1 / Math.abs(dz);
    let nextX = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - ax) / dx;
    let nextZ = dz === 0 ? Infinity : ((sz > 0 ? z + 1 : z) - az) / dz;
    const alongXEdge = dx === 0 && Math.abs(ax - Math.round(ax)) < 1e-10;
    const alongZEdge = dz === 0 && Math.abs(az - Math.round(az)) < 1e-10;
    while (true) {
      if (!this.open(x, z) || (alongXEdge && !this.open(x - 1, z)) || (alongZEdge && !this.open(x, z - 1))) return false;
      if (Math.min(nextX, nextZ) > 1 || (!Number.isFinite(nextX) && !Number.isFinite(nextZ))) break;
      if (Math.abs(nextX - nextZ) < 1e-10) {
        if (!this.open(x + sx, z) || !this.open(x, z + sz)) return false;
        x += sx;
        z += sz;
        nextX += tx;
        nextZ += tz;
      } else if (nextX < nextZ) {
        x += sx;
        nextX += tx;
      } else {
        z += sz;
        nextZ += tz;
      }
    }
    // Sweep against expanded footprints too: cell centers alone miss thin props
    // and off-center paths whose agent circle grazes a neighboring collider.
    const box = this.clearanceBox;
    box.minX = Math.min(a.x, b.x) - r; box.maxX = Math.max(a.x, b.x) + r;
    box.minZ = Math.min(a.z, b.z) - r; box.maxZ = Math.max(a.z, b.z) + r;
    const candidates = this.collision.queryAABB(box, this.clearanceCandidates);
    const worldDx = b.x - a.x, worldDz = b.z - a.z;
    for (const c of candidates) {
      if (!c.blocksMove || this.passable(c)) continue;
      let t0 = 0, t1 = 1;
      if (worldDx === 0) {
        if (a.x < c.minX - r || a.x > c.maxX + r) continue;
      } else {
        const u = (c.minX - r - a.x) / worldDx, v = (c.maxX + r - a.x) / worldDx;
        t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
      }
      if (worldDz === 0) {
        if (a.z < c.minZ - r || a.z > c.maxZ + r) continue;
      } else {
        const u = (c.minZ - r - a.z) / worldDz, v = (c.maxZ + r - a.z) / worldDz;
        t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
      }
      if (t0 <= t1) return false;
    }
    return true;
  }

  private heuristic(x: number, z: number, goalX: number, goalZ: number): number {
    const dx = Math.abs(x - goalX);
    const dz = Math.abs(z - goalZ);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * this.cellSize;
  }

  private resetSearch(): void {
    // Sparse searches clear only the cells they touched; near-full searches are cheaper as bulk fills.
    if (this.searchCount > this.cost.length >> 2) {
      this.cost.fill(Infinity);
      this.closed.fill(0);
    } else {
      for (let i = 0; i < this.searchCount; i++) {
        const id = this.searchCells[i];
        this.cost[id] = Infinity;
        this.closed[id] = 0;
      }
    }
    this.searchCount = 0;
    this.heap.clear();
  }

  private setCost(id: number, cost: number): void {
    if (this.cost[id] === Infinity) this.searchCells[this.searchCount++] = id;
    this.cost[id] = cost;
  }

  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const startPoint = this.nearestWalkable(from);
    const endPoint = this.nearestWalkable(to);
    const start = this.index(startPoint);
    const goal = this.index(endPoint);
    if (start < 0 || goal < 0 || !this.walkable[start] || !this.walkable[goal]) return null;
    if (start === goal) return [endPoint];
    this.resetSearch();
    this.setCost(start, 0);
    this.parent[start] = -1;
    const gx = goal % this.cols;
    const gz = Math.floor(goal / this.cols);
    this.heap.put(start, this.heuristic(start % this.cols, Math.floor(start / this.cols), gx, gz));
    // A consistent octile heuristic closes each walkable cell at most once.
    // The exact budget preserves complete-search semantics, even for long detours.
    let remaining = this.walkableCount;
    let reached = false;
    while (this.heap.size > 0 && remaining-- > 0) {
      const id = this.heap.pop();
      if (id === goal) { reached = true; break; }
      this.closed[id] = 1;
      const x = id % this.cols;
      const z = Math.floor(id / this.cols);
      const mask = this.connections[id];
      for (let i = 0; i < 8; i++) {
        if (!(mask & (1 << i))) continue;
        const neighbor = id + this.neighborOffsets[i];
        if (this.closed[neighbor]) continue;
        const cost = this.cost[id] + this.stepCosts[i];
        if (cost >= this.cost[neighbor]) continue;
        this.setCost(neighbor, cost);
        this.parent[neighbor] = id;
        this.heap.put(neighbor, cost + this.heuristic(x + STEP_X[i], z + STEP_Z[i], gx, gz));
      }
    }
    if (!reached) return null;
    this.route.length = 0;
    for (let id = goal; id !== start; id = this.parent[id]) this.route.push(id);
    const points: Vec2[] = [startPoint];
    // Keep start/end cell centers as candidates for off-center requested endpoints.
    points.push(this.center(start, { x: 0, z: 0 }));
    for (let i = this.route.length - 1; i >= 0; i--) points.push(this.center(this.route[i], { x: 0, z: 0 }));
    points.push(endPoint);
    const path: Vec2[] = [];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = points.length - 1;
      while (next > anchor && !this.hasClearWalk(points[anchor], points[next])) next--;
      if (next === anchor) return null;
      path.push(points[next]);
      anchor = next;
    }
    return path;
  }

  buildFlowField(goals: readonly Vec2[], reuse?: IFlowField, maxDistance: number = Infinity): FlowField {
    if (Number.isNaN(maxDistance) || maxDistance < 0) throw new RangeError('Invalid flow field distance');
    const b = this.collision.bounds;
    const field = reuse instanceof FlowField && reuse.matches(this.cols, this.rows, this.cellSize, b.minX, b.minZ, b.maxX, b.maxZ, this.collision)
      ? reuse : new FlowField(this.cols, this.rows, this.cellSize, b.minX, b.minZ, b.maxX, b.maxZ, this.collision);
    const snapped: Vec2[] = [];
    for (const goal of goals) {
      const point = this.nearestWalkable(goal);
      if (this.isWalkable(point)) snapped.push(point);
    }
    field.reset(snapped, this.version, this.walkable);
    this.resetSearch();
    for (let g = 0; g < snapped.length; g++) {
      const id = this.index(snapped[g]);
      this.setCost(id, 0);
      field.goalIndex[id] = g;
      this.heap.put(id, 0);
    }
    let flowCount = 0;
    while (this.heap.size > 0) {
      const id = this.heap.pop();
      this.flowCells[flowCount++] = id;
      this.closed[id] = 1;
      const current = this.cost[id];
      field.distance[id] = current;
      const mask = this.connections[id];
      for (let i = 0; i < 8; i++) {
        if (!(mask & (1 << i))) continue;
        const neighbor = id + this.neighborOffsets[i];
        if (this.closed[neighbor]) continue;
        const cost = current + this.stepCosts[i];
        // Do not enqueue or expose a fringe beyond the requested path cost.
        if (cost > maxDistance || cost >= this.cost[neighbor]) continue;
        this.setCost(neighbor, cost);
        this.heap.put(neighbor, cost);
      }
    }
    field.buildDirections(this.flowCells, flowCount, this.connections);
    return field;
  }
}

/** A field owns its raster snapshot, so rebuilds cannot partially change old guidance. */
export class FlowField implements IFlowField {
  goals: readonly Vec2[] = [];
  navVersion = 0;
  readonly distance: Float32Array;
  readonly directionX: Float32Array;
  readonly directionZ: Float32Array;
  readonly goalIndex: Int32Array;
  private readonly walkable: Uint8Array;
  private sourceWalkable?: Uint8Array;
  private readonly touched: Int32Array;
  private touchedCount = 0;
  private readonly neighborCenter: Vec2 = { x: 0, z: 0 };
  private readonly moveAccess: SegmentOptions = { mode: 'move' };

  constructor(
    private readonly cols: number,
    private readonly rows: number,
    private readonly cellSize: number,
    private readonly minX: number,
    private readonly minZ: number,
    private readonly maxX: number = minX + cols * cellSize,
    private readonly maxZ: number = minZ + rows * cellSize,
    private readonly collision?: ICollisionWorld,
  ) {
    const size = cols * rows;
    this.distance = new Float32Array(size).fill(Infinity);
    this.directionX = new Float32Array(size);
    this.directionZ = new Float32Array(size);
    this.goalIndex = new Int32Array(size).fill(-1);
    this.walkable = new Uint8Array(size);
    this.touched = new Int32Array(size);
  }

  matches(cols: number, rows: number, size: number, x: number, z: number, maxX: number, maxZ: number, collision?: ICollisionWorld): boolean {
    return this.cols === cols && this.rows === rows && this.cellSize === size && this.minX === x && this.minZ === z &&
      this.maxX === maxX && this.maxZ === maxZ && this.collision === collision;
  }

  reset(goals: readonly Vec2[], version: number, walkable: Uint8Array): void {
    if (this.sourceWalkable !== walkable || this.navVersion !== version) {
      this.walkable.set(walkable);
      this.sourceWalkable = walkable;
    }
    this.goals = goals;
    this.navVersion = version;
    if (this.touchedCount > this.distance.length >> 2) {
      this.distance.fill(Infinity);
      this.directionX.fill(0);
      this.directionZ.fill(0);
      this.goalIndex.fill(-1);
    } else {
      for (let i = 0; i < this.touchedCount; i++) {
        const id = this.touched[i];
        this.distance[id] = Infinity;
        this.directionX[id] = 0;
        this.directionZ[id] = 0;
        this.goalIndex[id] = -1;
      }
    }
    this.touchedCount = 0;
  }

  buildDirections(cells?: Int32Array, count: number = cells?.length ?? this.distance.length,
      connections?: Uint8Array): void {
    // Bounded builds visit a fraction of the world; skip scanning every raster row.
    for (let i = 0; i < count; i++) {
      const id = cells ? cells[i] : i;
      if (!Number.isFinite(this.distance[id])) continue;
      this.touched[this.touchedCount++] = id;
      const goal = this.goalIndex[id];
      let vx = 0;
      let vz = 0;
      if (goal >= 0) {
        vx = this.goals[goal].x - (this.minX + (id % this.cols + 0.5) * this.cellSize);
        vz = this.goals[goal].z - (this.minZ + (Math.floor(id / this.cols) + 0.5) * this.cellSize);
      } else {
        let best = this.distance[id];
        const mask = connections ? connections[id] : 255;
        for (let j = 0; j < 8; j++) {
          if (!(mask & (1 << j))) continue;
          const dx = STEP_X[j], dz = STEP_Z[j];
          if (!connections) {
            const x = id % this.cols, z = Math.floor(id / this.cols);
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
            if (dx && dz && (!this.walkable[z * this.cols + nx] || !this.walkable[nz * this.cols + x])) continue;
          }
          const distance = this.distance[id + dz * this.cols + dx];
          if (distance < best) {
            best = distance; vx = dx; vz = dz;
          }
        }
      }
      // Non-goal directions are grid steps, so their lengths are known exactly.
      const length = goal >= 0 ? Math.hypot(vx, vz) : vx !== 0 && vz !== 0 ? Math.SQRT2 : 1;
      if (length > 0) {
        this.directionX[id] = vx / length;
        this.directionZ[id] = vz / length;
      }
    }
  }

  private cell(p: Vec2): number {
    if (p.x < this.minX || p.z < this.minZ || p.x >= this.maxX || p.z >= this.maxZ) return -1;
    const x = Math.floor((p.x - this.minX) / this.cellSize);
    const z = Math.floor((p.z - this.minZ) / this.cellSize);
    return x >= 0 && z >= 0 && x < this.cols && z < this.rows ? z * this.cols + x : -1;
  }

  private reachable(id: number): boolean {
    return id >= 0 && this.walkable[id] !== 0 && Number.isFinite(this.distance[id]);
  }

  private recoveryCell(id: number, p: Vec2): number {
    if (id < 0) return -1;
    if (this.walkable[id]) return this.reachable(id) ? id : -1;
    const x = id % this.cols;
    const z = Math.floor(id / this.cols);
    let best = -1;
    let distance = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const neighbor = nz * this.cols + nx;
        if (this.reachable(neighbor) && this.distance[neighbor] < distance) {
          set(this.neighborCenter, this.minX + (nx + 0.5) * this.cellSize, this.minZ + (nz + 0.5) * this.cellSize);
          if (this.collision?.segmentBlocked(p, this.neighborCenter, this.moveAccess)) continue;
          best = neighbor;
          distance = this.distance[neighbor];
        }
      }
    }
    return best;
  }

  /** Multiple actual goals may share one raster cell. Choose the nearest to p. */
  private nearestGoal(id: number, p: Vec2): number {
    let best = this.goalIndex[id];
    if (best < 0) return -1;
    let distance = Infinity;
    for (let i = 0; i < this.goals.length; i++) {
      const g = this.goals[i];
      if (this.cell(g) !== id) continue;
      const d = (g.x - p.x) ** 2 + (g.z - p.z) ** 2;
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }

  sample(p: Vec2, out: Vec2): boolean {
    const id = this.cell(p);
    const recovered = this.recoveryCell(id, p);
    set(out, 0, 0);
    if (recovered < 0) return false;
    const goal = recovered === id ? this.nearestGoal(id, p) : -1;
    if (goal >= 0) {
      set(out, this.goals[goal].x - p.x, this.goals[goal].z - p.z);
      if (Math.hypot(out.x, out.z) <= 0.05) set(out, 0, 0);
      else normalizeInPlace(out);
      return true;
    }
    if (recovered !== id) {
      set(out, this.minX + (recovered % this.cols + 0.5) * this.cellSize - p.x,
        this.minZ + (Math.floor(recovered / this.cols) + 0.5) * this.cellSize - p.z);
      normalizeInPlace(out);
      return true;
    }
    const x = (p.x - this.minX) / this.cellSize - 0.5;
    const z = (p.z - this.minZ) / this.cellSize - 0.5;
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const cx = id % this.cols;
    const cz = Math.floor(id / this.cols);
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        const nx = x0 + dx;
        const nz = z0 + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const neighbor = nz * this.cols + nx;
        if (!this.reachable(neighbor)) continue;
        // Do not blend across a blocked corner into another corridor.
        if (nx !== cx && nz !== cz && (!this.walkable[cz * this.cols + nx] || !this.walkable[nz * this.cols + cx])) continue;
        const weight = (dx === 0 ? 1 - fx : fx) * (dz === 0 ? 1 - fz : fz);
        out.x += this.directionX[neighbor] * weight;
        out.z += this.directionZ[neighbor] * weight;
      }
    }
    if (out.x * out.x + out.z * out.z < 1e-16) set(out, this.directionX[id], this.directionZ[id]);
    normalizeInPlace(out);
    return true;
  }

  distanceAt(p: Vec2): number {
    const cell = this.cell(p);
    const id = this.recoveryCell(cell, p);
    if (id < 0) return Infinity;
    const goal = id === cell ? this.nearestGoal(id, p) : -1;
    if (goal >= 0) return Math.hypot(p.x - this.goals[goal].x, p.z - this.goals[goal].z);
    const dx = p.x - (this.minX + (id % this.cols + 0.5) * this.cellSize);
    const dz = p.z - (this.minZ + (Math.floor(id / this.cols) + 0.5) * this.cellSize);
    return this.distance[id] + Math.hypot(dx, dz);
  }
}
