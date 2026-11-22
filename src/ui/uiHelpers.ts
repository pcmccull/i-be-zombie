// [pure] UI helpers: map projection, objective selection, ability-slot view models, toast text, debug lines.
// No DOM, no three. Everything here runs under Vitest in Node.
import { BALANCE } from '../config/balance';
import { ABILITIES, SLOT_KEYS } from '../content/abilities';
import { DISTRICTS } from '../content/districts';
import { STRONGHOLDS } from '../content/strongholds';
import { isIdentified, isSeen } from '../systems/AwarenessSystem';
import { traitAttackRateMultiplier, traitCost, traitSpeedMultiplier, visionCost } from '../systems/ProgressionSystem';
import { followerCapFor } from '../systems/HordeSystem';
import { cityDirectorDiagnostics } from '../systems/CityActivityDirector';
import type {
  SenseKind,
  AABB,
  AbilityId,
  DistrictId,
  DistrictLayout,
  DiscoveryState,
  GameEvent,
  GameState,
  GuardAgent,
  NestDef,
  StrongholdDef,
  StrongholdId,
  TerritoryStatus,
  ThreatTier,
  TraitId,
  Vec2,
  VisionTier,
} from '../core/types';
import { isNestActiveIn } from '../systems/nests';

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

/** Nests the player can use: claimed walk-in nest, captured stronghold nest, or an always-on start nest (systems/nests.ts). */
export function isNestActiveFor(state: GameState, nest: NestDef): boolean {
  return isNestActiveIn(state, nest);
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
    return { slot, key, abilityId: id, name: def.name, kind: 'nobiomass', remainingFrac: 0, seconds: 0, cost, caption: `NEED ${cost} BRAINS` };
  }
  return { slot, key, abilityId: id, name: def.name, kind: 'ready', remainingFrac: 0, seconds: 0, cost, caption: cost > 0 ? `READY - ${cost} BRAINS` : 'READY' };
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

/** Same rule as HordeSystem.followerCap (open-world base + followersPerNest per unlocked nest). */
export function followerCap(layout: DistrictLayout | null, state: GameState | null = null): number {
  if (!layout || layout.strongholds.length === 0) return BALANCE.horde.maxFollowers;
  return state ? followerCapFor(state, layout) : BALANCE.openWorld.maxFollowers;
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
      return 'Not enough brains';
    case 'notAtNest':
      return 'Change loadout at a nest';
    case 'noTarget':
      return 'No valid target';
    case 'locked':
      return 'Ability locked';
    case 'maxSlots':
      return 'All ability slots owned';
    case 'maxVision':
      return 'Eyesight already at max';
    case 'maxTrait':
      return 'Mutation already at max';
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
    case 'traitUpgraded':
      return { text: `${BALANCE.traits[ev.trait].name} — level ${ev.level}`, kind: 'good' };
    case 'slotPurchased':
      return { text: `Ability slot ${SLOT_KEYS[ev.slot] ?? ev.slot + 1} unlocked`, kind: 'good' };
    case 'visionUpgraded': {
      const name = BALANCE.vision.tiers[ev.tier - 1]?.name ?? `Tier ${ev.tier}`;
      return { text: `Eyes adjust \u2014 ${name}`, kind: 'good' };
    }
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
    // todos #10b/#12
    case 'resistanceRaised':
      return ev.label ? { text: `The city fights back: ${ev.label}`, kind: 'warn' } : null;
    case 'vehicleRam':
      return { text: 'A driver is gunning for the horde!', kind: 'warn' };
    case 'shopLooted':
      return { text: 'Shop broken into - drinks inside heal the Alpha', kind: 'good' };
    case 'pickup':
      return { text: `Drink: +${Math.round(ev.heal)} HP`, kind: 'good' };
    case 'rewardGranted':
      return { text: `Unlocked: ${ev.displayName}`, kind: 'good' };
    case 'companionRecruited':
      return { text: `Companion joined: ${ev.name}`, kind: 'good' };
    case 'hideoutUnlocked':
      return { text: `Hideout unlocked: ${ev.name}`, kind: 'good' };
    case 'secretDiscovered':
      return { text: `Secret found: ${ev.title}`, kind: 'good' };
    case 'cityEventStarted':
      return { text: `Nearby: ${ev.label}`, kind: 'info' };
    case 'worldInteractable':
      return { text: ev.label, kind: 'info' };
    case 'cityEventEscalated':
      return { text: 'Sirens: the police are on their way', kind: 'warn' };
    case 'shortcutUsed':
      return { text: 'Squelch... out the other end of the storm drain', kind: 'info' };
    case 'suppliesLooted':
      return ev.heal > 0 ? { text: `Convoy supplies: +${Math.round(ev.heal)} HP`, kind: 'good' } : null;
    case 'districtAlertChanged':
      if (ev.alert === 'panic' || ev.alert === 'lockdown') {
        return { text: `${districtName(ev.districtId)} alert: ${ev.alert.toUpperCase()}`, kind: 'warn' };
      }
      return null;
    default:
      return null;
  }
}

/**
 * todos #10c: while the horde is off on an attack or move order (or split), remind the player how to call it back.
 * null when everyone is already following (or there is no horde).
 */
export function recallHint(state: GameState, touch: boolean): string | null {
  if (state.followerCount <= 0 || state.phase !== 'playing') return null;
  if (state.order.type === 'follow' && state.squads.length === 0) return null;
  return touch ? 'Tap FOLLOW to call the horde back' : 'SPACE recall horde';
}

// ---------------------------------------------------------------------------
// Debug overlay
// ---------------------------------------------------------------------------

export interface DebugStats {
  fps: number;
  frameMs?: number;
  drawCalls: number;
  loadedChunks?: number;
  /** District under the Alpha (open world), for the living-city line. */
  districtId?: DistrictId;
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
    ...cityDebugLines(state, stats.districtId),
  ];
}

/** Living-city diagnostics (docs/11_cityupgrade.md §7): alert/heat/control, live events, cooldowns, vehicle, rewards. */
export function cityDebugLines(state: GameState, districtId?: DistrictId): string[] {
  if (!state.cityEvents) return [];
  const out: string[] = [];
  if (districtId) {
    const d = state.districts[districtId];
    out.push(`city ${districtId}: alert ${d?.alert ?? 'normal'} heat ${(d?.heat ?? 0).toFixed(0)} control ${d?.control ?? '-'}`);
  }
  const hot = DISTRICTS.map((d) => [d.id, state.districts[d.id]?.heat ?? 0] as const).filter(([, h]) => h >= 1)
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, h]) => `${id}:${h.toFixed(0)}`);
  if (hot.length) out.push(`heat ${hot.join(' ')}`);
  const evs = state.cityEvents.map((e) => `${e.kind}(${Math.max(0, e.expiresAt - state.time).toFixed(0)}s,${e.participantGuardIds.length}h/${e.participantZombieIds.length}z${e.escalated ? ',police' : ''})`);
  out.push(`events ${evs.length}: ${evs.join(' ') || '-'}`);
  const diag = cityDirectorDiagnostics(state);
  const cds = diag.cooldowns.map(([k, t]) => `${k}:${t.toFixed(0)}`).join(' ');
  out.push(`next check ${diag.nextCheck.toFixed(1)}s | event humans ${diag.humans} | orphans ${diag.orphans} | cooldowns ${cds || '-'}`);
  const pv = state.playerVehicle;
  const r = state.rewards;
  out.push(`vehicle ${pv ? `${pv.kind}${pv.mounted ? ' (driving)' : ''} ${pv.speed.toFixed(1)}m/s` : '-'} | companions ${r.activeCompanionIds.join(',') || '-'} | brains ${r.brains} | unlocks ${r.unlockedRewardIds.length}`);
  return out;
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

// ---------------------------------------------------------------------------
// EW: senses, vision panel, map gating, threat pips
// ---------------------------------------------------------------------------

/**
 * Screen-edge angle (radians) from leaderPos to cuePos relative to cameraYaw.
 * 0 = straight ahead (top of screen), +PI/2 = screen right, -PI/2 = screen left, +-PI = behind.
 */
export function cueScreenAngle(leaderPos: Vec2, cuePos: Vec2, cameraYaw: number): number {
  const dx = cuePos.x - leaderPos.x;
  const dz = cuePos.z - leaderPos.z;
  if (dx === 0 && dz === 0) return 0;
  const sinY = Math.sin(cameraYaw);
  const cosY = Math.cos(cameraYaw);
  const forwardDot = dx * sinY + dz * cosY;
  const rightDot = dx * -cosY + dz * sinY;
  return Math.atan2(rightDot, forwardDot);
}

/** Minimum indicator strength for gunshot/scream warnings, so a distant shot is never a faint smudge. */
export const WARNING_CUE_MIN_OPACITY = 0.85;

/** True for cue kinds shown as warning icons (always visible, with a direction arrow). */
export function isWarningCue(kind: SenseKind): boolean {
  return kind === 'gunshot' || kind === 'scream';
}

/** Indicator opacity [0..1] from cue intensity and remaining lifetime; `minIntensity` floors the intensity. */
export function cueOpacity(intensity: number, age: number, ttl: number, minIntensity = 0): number {
  if (!(ttl > 0) || age >= ttl) return 0;
  const i = Math.max(0, Math.min(1, Math.max(minIntensity, intensity)));
  if (!(i > 0)) return 0;
  const life = Math.max(0, Math.min(1, 1 - Math.max(0, age) / ttl));
  return i * life;
}

export type MapHumanVisibility = 'identified' | 'seen' | 'none';

/** Map visibility for a human: identified = full marker, seen = grey dot, otherwise hidden. */
export function mapHumanVisibility(state: GameState, guard: GuardAgent): MapHumanVisibility {
  if (guard.hp <= 0 || guard.state === 'DEAD') return 'none';
  if (isIdentified(state, guard.id)) return 'identified';
  if (isSeen(state, guard.id)) return 'seen';
  return 'none';
}

/** Clamped threat-tier pip count (1..5). */
export function threatPipCount(tier: ThreatTier): number {
  return Math.max(1, Math.min(5, Math.round(tier)));
}

export interface EyesightPanelView {
  tier: VisionTier;
  name: string;
  clearRadius: number;
  detects: string[];
  nextTierName: string | null;
  nextCost: number | null;
  affordable: boolean;
}

export function eyesightPanelView(state: GameState): EyesightPanelView {
  const rawTier = state.progression.visionTier;
  const tier: VisionTier = rawTier >= 1 && rawTier <= 4 ? rawTier : 1;
  const profile = BALANCE.vision.tiers[tier - 1] ?? BALANCE.vision.tiers[0];
  const detects: string[] = [`Clear sight ${profile.clearRadius} m`];
  if (profile.movingDetectRadius > 0) detects.push(`Moving humans (${profile.movingDetectRadius} m)`);
  if (profile.defenseRadius > 0) detects.push(`Stronghold defenses (${profile.defenseRadius} m)`);
  if (profile.reinforcementRadius > 0) detects.push(`Reinforcements (${profile.reinforcementRadius} m)`);
  const nextCost = visionCost(state);
  const nextProfile = nextCost !== null ? BALANCE.vision.tiers[tier] : undefined;
  return {
    tier,
    name: profile.name,
    clearRadius: profile.clearRadius,
    detects,
    nextTierName: nextProfile ? nextProfile.name : null,
    nextCost,
    affordable: nextCost !== null && state.progression.biomass >= nextCost,
  };
}

export interface TraitPanelView {
  id: TraitId;
  name: string;
  level: number;
  maxLevel: number;
  /** Current bonus, e.g. "+14% speed". */
  bonus: string;
  /** Bonus after the next level; null at max. */
  nextBonus: string | null;
  nextCost: number | null;
  affordable: boolean;
}

/** Nest panel rows for the biomass traits (Running Speed, Attack Speed). Costs rise every level. */
export function traitPanelViews(state: GameState): TraitPanelView[] {
  const pct = (m: number): number => Math.round((m - 1) * 100);
  return (['speed', 'attack'] as const).map((id) => {
    const def = BALANCE.traits[id];
    const mult = id === 'speed' ? traitSpeedMultiplier(state) : traitAttackRateMultiplier(state);
    const level = Math.round((mult - 1) / def.perLevel);
    const unit = id === 'speed' ? 'speed' : 'attack rate';
    const nextCost = traitCost(state, id);
    return {
      id,
      name: def.name,
      level,
      maxLevel: def.costs.length,
      bonus: `+${pct(mult)}% ${unit}`,
      nextBonus: nextCost !== null ? `+${pct(mult + def.perLevel)}%` : null,
      nextCost,
      affordable: nextCost !== null && state.progression.biomass >= nextCost,
    };
  });
}
