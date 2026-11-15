// [pure] UI helpers: map projection, objective selection, ability-slot view models, toast text, debug lines.
// No DOM, no three. Everything here runs under Vitest in Node.
import { BALANCE } from '../config/balance';
import { ABILITIES, SLOT_KEYS } from '../content/abilities';
import { DISTRICTS } from '../content/districts';
import { STRONGHOLDS } from '../content/strongholds';
import type {
  AABB,
  AbilityId,
  DistrictId,
  DistrictLayout,
  DiscoveryState,
  GameEvent,
  GameState,
  NestDef,
  StrongholdDef,
  StrongholdId,
  TerritoryStatus,
  Vec2,
} from '../core/types';

// ---------------------------------------------------------------------------
// Map projection (north-up: north = -Z is the top edge, east = +X is the right edge)
// ---------------------------------------------------------------------------

export interface MapProjection {
  /** Pixels per meter. */
  scale: number;
  offX: number;
  offY: number;
  minX: number;
  minZ: number;
  /** Size in pixels of the projected world rectangle. */
  width: number;
  height: number;
}

/** Fit `bounds` inside a `w x h` pixel box (letterboxed, centered). */
export function makeProjection(bounds: AABB, w: number, h: number): MapProjection {
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX);
  const bh = Math.max(1e-6, bounds.maxZ - bounds.minZ);
  const scale = Math.min(w / bw, h / bh);
  const width = bw * scale;
  const height = bh * scale;
  return {
    scale,
    offX: (w - width) / 2,
    offY: (h - height) / 2,
    minX: bounds.minX,
    minZ: bounds.minZ,
    width,
    height,
  };
}

export function worldToMap(p: MapProjection, x: number, z: number, out: Vec2): Vec2 {
  // Vec2 is {x, z}: for map pixels `z` holds the vertical pixel coordinate.
  out.x = p.offX + (x - p.minX) * p.scale;
  out.z = p.offY + (z - p.minZ) * p.scale;
  return out;
}

/** Inverse of worldToMap. Returns null when the pixel is outside the projected world rectangle. */
export function mapToWorld(p: MapProjection, px: number, py: number, out: Vec2): Vec2 | null {
  const lx = px - p.offX;
  const ly = py - p.offY;
  if (!(lx >= 0 && ly >= 0 && lx <= p.width && ly <= p.height)) return null;
  out.x = p.minX + lx / p.scale;
  out.z = p.minZ + ly / p.scale;
  return out;
}

// ---------------------------------------------------------------------------
// Fog / territory
// ---------------------------------------------------------------------------

export function cellIndexAt(d: DiscoveryState, bounds: AABB, x: number, z: number): number {
  const col = Math.floor((x - bounds.minX) / d.cellSize);
  const row = Math.floor((z - bounds.minZ) / d.cellSize);
  if (col < 0 || row < 0 || col >= d.cols || row >= d.rows) return -1;
  return row * d.cols + col;
}

export function isRevealedAt(d: DiscoveryState, bounds: AABB, x: number, z: number): boolean {
  const i = cellIndexAt(d, bounds, x, z);
  return i >= 0 && d.bits[i] === 1;
}

export interface TerritoryStyle {
  /** rgba tint laid over revealed terrain. Empty string = no tint. */
  tint: string;
  label: string;
  /** Solid swatch for legend/icons. */
  color: string;
}

export function territoryStyle(status: TerritoryStatus): TerritoryStyle {
  switch (status) {
    case 'infected':
      return { tint: 'rgba(125, 154, 106, 0.38)', label: 'Infected', color: '#7d9a6a' };
    case 'contested':
      return { tint: 'rgba(255, 179, 71, 0.30)', label: 'Contested', color: '#ffb347' };
    case 'human':
      return { tint: 'rgba(224, 120, 42, 0.16)', label: 'Human-held', color: '#e0782a' };
    case 'unknown':
    default:
      return { tint: '', label: 'Unknown', color: '#4a5260' };
  }
}

export function districtName(id: DistrictId): string {
  return DISTRICTS.find((d) => d.id === id)?.name ?? id;
}

export function strongholdName(id: StrongholdId): string {
  return STRONGHOLDS.find((s) => s.id === id)?.name ?? id;
}

export function abilityName(id: AbilityId): string {
  return ABILITIES[id]?.name ?? id;
}

export type StrongholdMapStatus = 'unknown' | 'held' | 'contested' | 'captured';

export function strongholdMapStatus(state: GameState, def: StrongholdDef): StrongholdMapStatus {
  const sh = state.strongholds.find((s) => s.id === def.id);
  if (sh?.captured) return 'captured';
  if (!state.districts[def.districtId]?.discovered) return 'unknown';
  return sh?.contested ? 'contested' : 'held';
}

export const STRONGHOLD_COLORS: Record<StrongholdMapStatus, string> = {
  unknown: '#6b7280',
  held: '#e0782a',
  contested: '#ffb347',
  captured: '#9be35a',
};

/** Cheap key that changes exactly when the minimap/world-map static layer must be redrawn. */
export function staticLayerKey(state: GameState, layout: DistrictLayout): string {
  let k = `${state.discovery.revealed}|`;
  for (const d of layout.districts) {
    const ds = state.districts[d.id];
    k += `${ds ? ds.status[0] : '?'}${ds && ds.strongholdCaptured ? 'c' : ''},`;
  }
  for (const s of state.strongholds) k += s.captured ? 'C' : s.contested ? 'o' : '-';
  return k;
}

/** Nests the player can use: start nest (strongholdId null) or one whose stronghold is captured. */
export function isNestActiveFor(state: GameState, nest: NestDef): boolean {
  if (nest.strongholdId === null) return true;
  for (const s of state.strongholds) if (s.id === nest.strongholdId) return s.captured;
  return false;
}

/** Nearest active nest within BALANCE.nest.equipRadius of the leader, else null. */
export function nearbyEquipNest(state: GameState, layout: DistrictLayout): NestDef | null {
  if (state.phase !== 'playing' || !state.leader.alive) return null;
  const r2 = BALANCE.nest.equipRadius * BALANCE.nest.equipRadius;
  let best: NestDef | null = null;
  let bestD = Infinity;
  for (const n of layout.nests) {
    if (!isNestActiveFor(state, n)) continue;
    const dx = n.pos.x - state.leader.pos.x;
    const dz = n.pos.z - state.leader.pos.z;
    const d = dx * dx + dz * dz;
    if (d <= r2 && d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Objective selection
// ---------------------------------------------------------------------------

/**
 * Which stronghold the objective tracker should show: the nearest uncaptured CONTESTED stronghold if any,
 * otherwise the nearest uncaptured stronghold in a discovered district, otherwise (nothing discovered)
 * the nearest uncaptured one. Null when everything is captured / the layout has no strongholds.
 */
export function selectObjectiveStronghold(
  layout: DistrictLayout,
  state: GameState,
  from: Vec2,
): StrongholdDef | null {
  let bestContested: StrongholdDef | null = null;
  let bestContestedD = Infinity;
  let bestDiscovered: StrongholdDef | null = null;
  let bestDiscoveredD = Infinity;
  let bestAny: StrongholdDef | null = null;
  let bestAnyD = Infinity;
  for (const def of layout.strongholds) {
    const st = state.strongholds.find((s) => s.id === def.id);
    if (!st || st.captured) continue;
    const dx = def.center.x - from.x;
    const dz = def.center.z - from.z;
    const d = dx * dx + dz * dz;
    if (d < bestAnyD) {
      bestAnyD = d;
      bestAny = def;
    }
    if (state.districts[def.districtId]?.discovered && d < bestDiscoveredD) {
      bestDiscoveredD = d;
      bestDiscovered = def;
    }
    if (st.contested && d < bestContestedD) {
      bestContestedD = d;
      bestContested = def;
    }
  }
  return bestContested ?? bestDiscovered ?? bestAny;
}

// ---------------------------------------------------------------------------
// Ability slots
// ---------------------------------------------------------------------------

export type SlotKind = 'empty' | 'passive' | 'ready' | 'cooldown' | 'active' | 'nobiomass';

export interface SlotView {
  slot: number;
  key: string;
  abilityId: AbilityId | null;
  name: string;
  kind: SlotKind;
  /** 0..1 fraction of the cooldown (or active duration) still remaining; 0 when ready. */
  remainingFrac: number;
  /** Seconds remaining shown in the label (cooldown or active), 0 otherwise. */
  seconds: number;
  cost: number;
  /** Short caption under the name. */
  caption: string;
}

export function abilitySlotView(state: GameState, slot: number): SlotView {
  const key = SLOT_KEYS[slot] ?? String(slot + 1);
  const id = state.progression.equipped[slot] ?? null;
  if (!id) {
    return { slot, key, abilityId: null, name: 'Empty', kind: 'empty', remainingFrac: 0, seconds: 0, cost: 0, caption: 'Equip at a nest' };
  }
  const def = ABILITIES[id];
  const cost = def.biomassCost;
  if (!def.activatable) {
    return { slot, key, abilityId: id, name: def.name, kind: 'passive', remainingFrac: 0, seconds: 0, cost, caption: 'EQUIPPED' };
  }
  const activeLeft = id === 'horde_frenzy' ? state.progression.frenzyTimeLeft
    : id === 'rush' ? state.abilities.rushTimeLeft : 0;
  if (activeLeft > 0.01) {
    const left = activeLeft;
    return {
      slot, key, abilityId: id, name: def.name, kind: 'active',
      remainingFrac: Math.max(0, Math.min(1, left / Math.max(0.001, def.duration))),
      seconds: left, cost, caption: `ACTIVE ${left.toFixed(1)}s`,
    };
  }
  const cd = state.progression.cooldowns[id] ?? 0;
  if (cd > 0.01) {
    return {
      slot, key, abilityId: id, name: def.name, kind: 'cooldown',
      remainingFrac: Math.max(0, Math.min(1, cd / Math.max(0.001, def.cooldown))),
      seconds: cd, cost, caption: `${cd.toFixed(1)}s`,
    };
  }
  if (cost > state.progression.biomass) {
    return { slot, key, abilityId: id, name: def.name, kind: 'nobiomass', remainingFrac: 0, seconds: 0, cost, caption: `NEED ${cost} BIO` };
  }
  return { slot, key, abilityId: id, name: def.name, kind: 'ready', remainingFrac: 0, seconds: 0, cost, caption: cost > 0 ? `READY - ${cost} BIO` : 'READY' };
}

/** Slots the player owns (0..BALANCE.progression.slots). Slots at or above this are hidden. */
export function visibleSlotCount(state: GameState): number {
  const n = Math.floor(state.progression.slotsOwned);
  if (!(n > 0)) return 0;
  return Math.min(n, BALANCE.progression.slots);
}

/** Biomass price of the next slot, or null when none can be bought (0 owned: first is granted; all owned). */
export function nextSlotPrice(state: GameState): number | null {
  const n = visibleSlotCount(state);
  if (n < 1 || n >= BALANCE.progression.slots) return null;
  return BALANCE.progression.slotCosts[n] ?? null;
}

/** True when an owned slot has no ability in it. */
export function hasEmptyOwnedSlot(state: GameState): boolean {
  const n = visibleSlotCount(state);
  for (let i = 0; i < n; i++) if (!state.progression.equipped[i]) return true;
  return false;
}

/** Abilities that may be placed in a slot: unlocked, slotBehavior 'slot', not pounce. */
export function equippableAbilities(state: GameState): AbilityId[] {
  const out: AbilityId[] = [];
  for (const id of state.progression.unlocked) {
    const def = ABILITIES[id];
    if (def && def.slotBehavior === 'slot' && id !== 'pounce') out.push(id);
  }
  return out;
}

export function bruteCount(state: GameState): number {
  let n = 0;
  for (const z of state.zombies) if (z.brute && z.state === 'follower' && z.hp > 0) n++;
  return n;
}

export function followerCap(layout: DistrictLayout | null): number {
  return layout && layout.strongholds.length > 0 ? BALANCE.openWorld.maxFollowers : BALANCE.horde.maxFollowers;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export interface ToastSpec {
  text: string;
  kind: 'info' | 'good' | 'warn';
}

export function denyReasonText(reason: Extract<GameEvent, { type: 'abilityDenied' }>['reason']): string | null {
  switch (reason) {
    case 'biomass':
      return 'Not enough biomass';
    case 'notAtNest':
      return 'Change loadout at a nest';
    case 'noTarget':
      return 'No valid target';
    case 'locked':
      return 'Ability locked';
    case 'maxSlots':
      return 'All ability slots owned';
    case 'cooldown':
    case 'empty':
    default:
      return null; // slot flash only
  }
}

/** Open-world toast for an event, or null if the event has none. `autosave` is handled by the HUD tick, not here. */
export function toastForEvent(ev: GameEvent, state?: GameState | null): ToastSpec | null {
  switch (ev.type) {
    case 'objectiveComplete':
      return { text: `Objective complete: ${ev.label}`, kind: 'good' };
    case 'strongholdCaptured': {
      let text = `${strongholdName(ev.strongholdId)} CAPTURED`;
      if (ev.unlock) text += ` - unlocked ${abilityName(ev.unlock)}`;
      return { text, kind: 'good' };
    }
    case 'abilityUnlocked': {
      const name = abilityName(ev.abilityId);
      if (ev.slot !== null && ev.slot !== undefined) {
        return { text: `New mutation: ${name} - equipped in slot ${SLOT_KEYS[ev.slot] ?? ev.slot + 1}`, kind: 'good' };
      }
      if (state && !hasEmptyOwnedSlot(state)) {
        return { text: `New mutation: ${name} - buy or free a slot at a nest`, kind: 'good' };
      }
      return { text: `New mutation: ${name} - equip it at a nest`, kind: 'good' };
    }
    case 'slotPurchased':
      return { text: `Ability slot ${SLOT_KEYS[ev.slot] ?? ev.slot + 1} unlocked`, kind: 'good' };
    case 'districtDiscovered':
      return { text: `Discovered: ${districtName(ev.districtId)}`, kind: 'info' };
    case 'reinforcements':
      return { text: `Human reinforcements incoming${ev.count > 0 ? ` (${ev.count})` : ''}!`, kind: 'warn' };
    case 'nestActivated':
      return { text: 'Nest activated - new respawn & loadout point', kind: 'good' };
    case 'strongholdContested':
      return { text: `${strongholdName(ev.strongholdId)} is under attack`, kind: 'info' };
    case 'leaderRespawned':
      return { text: 'The Alpha rises again', kind: 'info' };
    case 'abilityDenied': {
      const t = denyReasonText(ev.reason);
      return t ? { text: t, kind: 'warn' } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Debug overlay
// ---------------------------------------------------------------------------

export interface DebugStats {
  fps: number;
  frameMs?: number;
  drawCalls: number;
  loadedChunks?: number;
}

export function buildDebugLines(state: GameState, stats: DebugStats): string[] {
  let zActive = 0;
  let zDormant = 0;
  for (const z of state.zombies) {
    if (z.state === 'dead') continue;
    if (z.dormant) zDormant++;
    else zActive++;
  }
  let hActive = 0;
  let hDormant = 0;
  for (const g of state.guards) {
    if (g.state === 'DEAD' || g.hp <= 0) continue;
    if (g.dormant) hDormant++;
    else hActive++;
  }
  const dist = DISTRICTS.map((d) => {
    const s = state.districts[d.id];
    return `${d.id}:${s ? s.status : '?'}${s && s.discovered ? '' : '(fog)'}`;
  }).join(' ');
  const frame = stats.frameMs !== undefined ? `${stats.frameMs.toFixed(1)} ms` : '-';
  return [
    `FPS ${Math.round(stats.fps)} | frame ${frame} | draws ${stats.drawCalls}`,
    `chunks ${stats.loadedChunks ?? '-'} | phase ${state.phase} | t ${state.time.toFixed(0)}s`,
    `humans ${hActive} active / ${hDormant} dormant`,
    `zombies ${zActive} active / ${zDormant} dormant | followers ${state.followerCount}`,
    `districts ${dist}`,
  ];
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/**
 * Toast dedupe decision: the index of an already-visible toast with identical text (restart its timer),
 * or 'add' when a new node is needed.
 */
export function toastDedupe(visibleTexts: readonly (string | null)[], text: string): number | 'add' {
  for (let i = 0; i < visibleTexts.length; i++) if (visibleTexts[i] === text) return i;
  return 'add';
}
