// [pure] HUD view models (HUD-T001). Turns GameState + events into what each HUD element shows. No DOM, no three:
// HUD.ts only renders these and diffs signatures, so all decisions are unit-tested here (tests/hudModel.test.ts).
import { BALANCE } from '../config/balance';
import { ABILITIES } from '../content/abilities';
import type { SimContext } from '../core/contracts';
import type { DistrictLayout, GameEvent, GameState, StrongholdId, Vec2 } from '../core/types';
import { objectiveStatus } from '../systems/ConquestSystem';
import { nestTeleportSource, unclaimedNest } from '../systems/nests';
import { shortcutAt } from '../systems/HideoutSystem';
import { INTERACT_VERBS, nearestInteractable } from '../systems/WorldInteractionSystem';
import { abilityIcon, type IconName } from './hudIcons';
import { districtName, selectObjectiveStronghold, strongholdName, type MapProjection } from './uiHelpers';

export type Tone = 'green' | 'teal' | 'yellow' | 'coral' | 'cream';

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

// ---------------------------------------------------------------------------------------------------------------
// Character card
// ---------------------------------------------------------------------------------------------------------------

export const LOW_STRENGTH_FRAC = 0.4;

export interface HordeStrengthView {
  strength: number;
  max: number;
  frac: number;
  coreFrac: number;
  text: string;
  level: 'ok' | 'low' | 'critical' | 'lastBrain';
  countdown: number;
  countdownText: string;
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

export function hordeStrengthView(state: GameState): HordeStrengthView {
  const h = state.horde;
  const max = Math.max(1, finite(h.maxStrength));
  const rawStrength = finite(h.strength);
  const strength = rawStrength <= 0 ? 0 : rawStrength >= max ? max : rawStrength;
  const frac = clamp01(strength / max);
  const coreFrac = clamp01((BALANCE.hordeHealth.alphaCore - finite(h.coreDamage)) / max);
  const text = `${Math.round(strength)} / ${Math.round(max)}`;
  const active = Boolean(h.lastBrain?.active);
  const level: HordeStrengthView['level'] = active
    ? 'lastBrain'
    : frac <= BALANCE.hordeHealth.criticalFrac
      ? 'critical'
      : frac <= LOW_STRENGTH_FRAC
        ? 'low'
        : 'ok';
  const countdown = active ? Math.max(0, Math.ceil(finite(h.lastBrain.timeLeft))) : 0;
  const countdownText = active ? `LAST BRAIN STANDING! ${countdown}... FIND A BRAIN!` : '';
  return { strength, max, frac, coreFrac, text, level, countdown, countdownText };
}

export interface StatusChip {
  id: 'rush' | 'frenzy' | 'exhausted' | 'stunned' | 'sprint';
  label: string;
  icon: IconName;
  tone: Tone;
  /** Remaining fraction 0..1 for timed effects; -1 = untimed. */
  frac: number;
}

/** Short-lived status effects on the Alpha / horde, most important first. Never invents states. */
export function statusChips(state: GameState): StatusChip[] {
  const out: StatusChip[] = [];
  const rush = state.abilities.rushTimeLeft;
  if (rush > 0.01) out.push({ id: 'rush', label: 'Rush', icon: 'rush', tone: 'teal', frac: clamp01(rush / BALANCE.rush.duration) });
  const frenzy = state.progression?.frenzyTimeLeft ?? 0;
  if (frenzy > 0.01) out.push({ id: 'frenzy', label: 'Frenzy', icon: 'frenzy', tone: 'coral', frac: clamp01(frenzy / BALANCE.frenzy.duration) });
  if (state.leader.alive && state.leader.hitStun > 0.05) out.push({ id: 'stunned', label: 'Dazed', icon: 'dizzy', tone: 'yellow', frac: -1 });
  if (state.leader.alive && state.leader.exhausted) out.push({ id: 'exhausted', label: 'Winded', icon: 'bolt', tone: 'coral', frac: -1 });
  else if (state.leader.alive && state.leader.sprinting) out.push({ id: 'sprint', label: 'Sprint', icon: 'bolt', tone: 'teal', frac: -1 });
  return out;
}

export function chipsSignature(chips: readonly StatusChip[]): string {
  let s = '';
  for (const c of chips) s += `${c.id}:${c.frac < 0 ? -1 : Math.round(c.frac * 20)},`;
  return s;
}

export function eyesightLabel(state: GameState): { tier: number; name: string } {
  const raw = state.progression?.visionTier ?? 1;
  const tier = raw >= 1 && raw <= 4 ? raw : 1;
  return { tier, name: BALANCE.vision.tiers[tier - 1]?.name ?? 'Eyes' };
}

// ---------------------------------------------------------------------------------------------------------------
// Horde card
// ---------------------------------------------------------------------------------------------------------------

export type HordeMode = 'following' | 'attacking' | 'moving' | 'split' | 'none';

export interface HordeView {
  mode: HordeMode;
  label: string;
  icon: IconName;
  tone: Tone;
  count: number;
  cap: number;
  /** 0..1 of the cap. */
  fill: number;
  full: boolean;
}

export function hordeView(state: GameState, cap: number, targetLabel = ''): HordeView {
  const count = state.followerCount;
  let mode: HordeMode = 'following';
  let label = 'Following';
  let icon: IconName = 'zombie';
  let tone: Tone = 'green';
  if (count <= 0) {
    mode = 'none';
    // Beach start: no horde can exist until the nest by the bus is claimed.
    label = cap <= 0 ? 'Go to the nest' : 'Find walkers';
    icon = cap <= 0 ? 'nest' : 'zombie';
    tone = 'cream';
  } else if (state.squads.length > 0) {
    mode = 'split';
    label = `Attacking ${state.squads.length + 1} targets`;
    icon = 'target';
    tone = 'coral';
  } else if (state.order.type === 'attack') {
    mode = 'attacking';
    label = targetLabel ? `Attacking ${targetLabel}` : 'Attacking';
    icon = 'target';
    tone = 'coral';
  } else if (state.order.type === 'move') {
    mode = 'moving';
    label = 'Moving out';
    icon = 'move';
    tone = 'teal';
  }
  const c = Math.max(1, cap);
  return { mode, label, icon, tone, count, cap, fill: clamp01(count / c), full: count >= cap };
}

/**
 * Horde high-water milestones worth a banner: every 10 followers below the cap, plus the cap itself.
 * Returns the highest milestone in (prevBest, count], or null.
 */
export function hordeMilestone(prevBest: number, count: number, cap: number): number | null {
  if (count <= prevBest) return null;
  let hit: number | null = null;
  for (let m = 10; m < cap; m += 10) if (m > prevBest && m <= count) hit = m;
  if (cap > prevBest && cap <= count) hit = cap;
  return hit;
}

// ---------------------------------------------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------------------------------------------

export interface ObjectiveRow {
  label: string;
  done: boolean;
  progress: number;
}

export interface ObjectiveView {
  kind: 'nest' | 'explore' | 'stronghold' | 'complete' | 'none';
  strongholdId: StrongholdId | null;
  title: string;
  sub: string;
  contested: boolean;
  tier: number;
  done: number;
  total: number;
  rows: ObjectiveRow[];
  reward: string;
  /** Known objective location for the minimap marker (only when its district is discovered). */
  target: Vec2 | null;
  /** Changes whenever anything shown changes (progress bucketed to 5 %). */
  sig: string;
  /** Changes only when the objective itself (which stronghold / step count) changes: drives the brief expand. */
  stepSig: string;
}

export function objectiveView(layout: DistrictLayout | null, state: GameState): ObjectiveView {
  const empty: ObjectiveView = {
    kind: 'none', strongholdId: null, title: '', sub: '', contested: false, tier: 0, done: 0, total: 0, rows: [], reward: '',
    target: null, sig: 'none', stepSig: 'none',
  };
  if (!layout || layout.strongholds.length === 0) return empty;
  // Beach start: first walk into the nest by the bus to raise the horde.
  const nest = unclaimedNest(state, layout);
  if (nest) {
    return {
      ...empty, kind: 'nest', title: 'Claim the nest', sub: 'Walk into the glowing nest by the bus to raise your horde',
      reward: `Reward: a horde of ${BALANCE.openWorld.firstNestHorde} zombies`, target: { x: nest.pos.x, z: nest.pos.z },
      total: 1, rows: [{ label: 'Walk into the nest by the bus', done: false, progress: 0 }],
      sig: `nest|${nest.id}`, stepSig: `nest|${nest.id}`,
    };
  }
  const def = selectObjectiveStronghold(layout, state, state.leader.pos);
  if (!def) {
    return { ...empty, kind: 'complete', title: 'The city is yours', sub: 'Every stronghold has fallen', sig: 'complete', stepSig: 'complete' };
  }
  if (!state.districts[def.districtId]?.discovered) {
    return {
      ...empty, kind: 'explore', title: 'Explore the city', sub: 'Find a human stronghold to overrun', sig: 'explore', stepSig: 'explore',
    };
  }
  const sh = state.strongholds.find((x) => x.id === def.id);
  const statuses = objectiveStatus({ state, layout } as unknown as SimContext, def.id);
  const rows: ObjectiveRow[] = statuses.map((o) => ({ label: o.label, done: o.done, progress: clamp01(o.done ? 1 : o.progress) }));
  let done = 0;
  for (const r of rows) if (r.done) done++;
  const contested = !!sh?.contested;
  const next = rows.find((r) => !r.done);
  const reward = def.unlock ? `Reward: ${ABILITIES[def.unlock].name} + ${def.biomassReward} brains` : `Reward: ${def.biomassReward} brains`;
  let sig = `${def.id}|${contested ? 1 : 0}|`;
  for (const r of rows) sig += `${r.done ? 1 : 0}${Math.round(r.progress * 20)},`;
  return {
    kind: 'stronghold',
    strongholdId: def.id,
    title: `Take over ${strongholdName(def.id)}`,
    sub: next ? next.label : 'Hold on - capturing!',
    contested,
    tier: def.defenseTier,
    done,
    total: rows.length,
    rows,
    reward,
    target: { x: def.center.x, z: def.center.z },
    sig,
    stepSig: `${def.id}|${done}/${rows.length}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ability bar (primary attack + Recall; mutation slots use uiHelpers.abilitySlotView)
// ---------------------------------------------------------------------------------------------------------------

export interface PrimaryAttackView {
  name: string;
  icon: IconName;
  busy: boolean;
  /** 0..1 radial sweep while recovering. */
  frac: number;
  /** Claw combo hit index (1..3) while the chain window is open, else 0. */
  combo: number;
}

export function primaryAttackView(state: GameState): PrimaryAttackView {
  const claws = state.progression?.equipped?.includes('alpha_claws') ?? false;
  const l = state.leader;
  const busy = l.alive && l.attackPhase !== 'ready';
  const span = Math.max(0.05, BALANCE.alpha.biteWindup + BALANCE.alpha.biteRecovery);
  return {
    name: claws ? 'Claws' : 'Bite',
    icon: claws ? 'claws' : 'bite',
    busy: busy || !l.alive,
    frac: !l.alive ? 1 : busy ? clamp01(l.attackTimer / span) : 0,
    combo: claws && l.comboWindow > 0 ? Math.max(0, Math.min(3, l.comboStep)) : 0,
  };
}

export interface CooldownView {
  ready: boolean;
  frac: number;
  seconds: number;
}

export { abilityIcon };

// ---------------------------------------------------------------------------------------------------------------
// Contextual actions (bottom-right)
// ---------------------------------------------------------------------------------------------------------------

export interface ContextAction {
  id: 'attackTarget' | 'recall' | 'drink' | 'interact';
  keys: string[];
  label: string;
  icon: IconName;
  tone: Tone;
}

export interface ContextInput {
  /** Hover label of a target under the pointer that the horde may attack (already vision-gated by Game). */
  hoverLabel: string | null;
  /** A healing drink lies within reach and the Alpha is hurt. */
  drinkNearby: boolean;
  /** World layout (open world): enables the nest teleport prompt. */
  layout?: DistrictLayout | null;
}

export const MAX_CONTEXT_ACTIONS = 3;

/** Only the actions that are relevant right now, most useful first (max MAX_CONTEXT_ACTIONS). */
export function contextActions(state: GameState, input: ContextInput): ContextAction[] {
  const out: ContextAction[] = [];
  if (state.phase !== 'playing' || !state.leader.alive) return out;
  const away = state.followerCount > 0 && (state.order.type !== 'follow' || state.squads.length > 0);
  if (input.hoverLabel && state.followerCount > 0) {
    out.push({ id: 'attackTarget', keys: ['RMB'], label: `Sic 'em: ${titleCase(input.hoverLabel)}`, icon: 'target', tone: 'coral' });
  }
  if (away) {
    out.push({ id: 'recall', keys: ['Space'], label: 'Recall horde', icon: 'recall', tone: 'teal' });
  }
  const verb = interactPrompt(state, input.layout);
  if (verb) out.unshift({ id: 'interact', keys: ['V'], label: verb, icon: 'bolt', tone: 'yellow' });
  if (input.drinkNearby) out.push({ id: 'drink', keys: ['Walk'], label: 'Grab a drink (heal)', icon: 'drink', tone: 'teal' });
  return out.slice(0, MAX_CONTEXT_ACTIONS);
}

/**
 * What V does right here, mirroring the sim's priority (PlayerVehicleSystem > HideoutSystem shortcut > nest teleport
 * map (needs `layout`) > nearest prop): null when V would do nothing. Open world only.
 */
export function interactPrompt(state: GameState, layout?: DistrictLayout | null): string | null {
  if (state.phase !== 'playing' || !state.leader.alive) return null;
  const lp = state.leader.pos;
  const pv = state.playerVehicle;
  if (pv) {
    const label = BALANCE.city.playerVehicles[pv.kind].label;
    if (pv.mounted) return `Hop out of the ${label}`;
    if ((pv.pos.x - lp.x) ** 2 + (pv.pos.z - lp.z) ** 2 <= (BALANCE.city.interactRange + 1.5) ** 2) return `Hop in the ${label}`;
  }
  if (shortcutAt(state, lp)) return 'Crawl through the storm drain';
  if (layout && nestTeleportSource(state, layout)) return 'Teleport to another nest';
  const item = nearestInteractable(state, lp);
  return item ? INTERACT_VERBS[item.kind] : null;
}

export function contextSignature(actions: readonly ContextAction[]): string {
  return actions.map((a) => `${a.id}:${a.label}`).join('|');
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/** Ambient, unheld, living, awake zombies within `radius` of the leader (what Rally would pull in). */
export function countRecruitable(state: GameState, radius: number): number {
  const r2 = radius * radius;
  const lx = state.leader.pos.x;
  const lz = state.leader.pos.z;
  let n = 0;
  for (const z of state.zombies) {
    if (z.state !== 'ambient' || z.heldBy !== 0 || z.hp <= 0 || z.dormant) continue;
    const dx = z.pos.x - lx;
    const dz = z.pos.z - lz;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

export const DRINK_HINT_RADIUS = 14;

export function drinkNearby(state: GameState, radius = DRINK_HINT_RADIUS): boolean {
  if (!state.leader.alive || state.horde.coreDamage <= 0.01) return false;
  const pickups = state.pickups ?? [];
  const r2 = radius * radius;
  for (const p of pickups) {
    const dx = p.pos.x - state.leader.pos.x;
    const dz = p.pos.z - state.leader.pos.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Center feedback
// ---------------------------------------------------------------------------------------------------------------

export interface RecruitPopup {
  text: string;
  /** 1 small, 2 medium, 3 large. */
  tier: 1 | 2 | 3;
}

/** Center popup for an aggregated recruit burst; small trickles (< 3) only bump the horde counter. */
export function recruitPopup(n: number): RecruitPopup | null {
  if (n < 3) return null;
  if (n < 6) return { text: `+${n} ZOMBIES!`, tier: 1 };
  if (n < 12) return { text: `+${n} NEW FRIENDS!`, tier: 2 };
  return { text: `+${n} HORDE SURGE!`, tier: 3 };
}

/** World position a hit on the Alpha came from, if the event says so (shots, bats, cars). */
export function damageSourceFor(ev: GameEvent, leaderPos: Vec2): Vec2 | null {
  if (ev.type === 'shot') {
    if (!ev.hit) return null;
    const dx = ev.to.x - leaderPos.x;
    const dz = ev.to.z - leaderPos.z;
    return dx * dx + dz * dz <= 1.6 * 1.6 ? { x: ev.from.x, z: ev.from.z } : null;
  }
  if (ev.type === 'humanMelee') {
    if (!ev.hit) return null;
    const dx = ev.pos.x - leaderPos.x;
    const dz = ev.pos.z - leaderPos.z;
    return dx * dx + dz * dz <= 2.6 * 2.6 ? { x: ev.pos.x, z: ev.pos.z } : null;
  }
  if (ev.type === 'vehicleHit' && ev.target === 'leader') return { x: ev.pos.x, z: ev.pos.z };
  return null;
}

export interface BannerSpec {
  /** Dedupe key: the same banner never queues twice. */
  key: string;
  title: string;
  sub: string;
  quip: string;
  icon: IconName;
  tone: Tone;
}

export const QUIPS = {
  outpost: ['Outpost liberated! From the living.', 'The humans are mildly concerned.', 'Under new (undead) management.', 'Property values: plummeting.'],
  district: ['More brains, more problems.', 'Welcome to the neighborhood.', 'The tourists have joined the tour.'],
  horde: ['New friends! Questionable hygiene.', 'Your horde has excellent attendance.', 'Shamble with pride.', 'Strength in (un)numbers.'],
  ability: ["Evolution: it's a lifestyle.", 'Fresh mutation, still warm.', 'The humans did not see this coming.'],
} as const;

export function pickQuip(list: readonly string[], n: number): string {
  if (list.length === 0) return '';
  const i = ((Math.floor(n) % list.length) + list.length) % list.length;
  return list[i];
}

/** Major-event banner for an event (null for everything that is only a toast). `n` rotates the quips. */
export function bannerForEvent(ev: GameEvent, n: number): BannerSpec | null {
  switch (ev.type) {
    case 'strongholdCaptured':
      return {
        key: `sh:${ev.strongholdId}`, title: 'OUTPOST OVERRUN!', sub: strongholdName(ev.strongholdId),
        quip: pickQuip(QUIPS.outpost, n), icon: 'fort', tone: 'green',
      };
    case 'hordeUnlocked':
      return {
        key: 'horde-unlocked', title: 'HORDE UNLOCKED!', sub: `${ev.count} zombies rise to follow you`,
        quip: `Overrun strongholds to take their nests (+${BALANCE.openWorld.followersPerNest} horde each).`, icon: 'horde', tone: 'teal',
      };
    case 'districtStatus':
      if (ev.status !== 'infected' || ev.prev === 'infected') return null;
      return {
        key: `d:${ev.districtId}`, title: 'DISTRICT CONQUERED!', sub: districtName(ev.districtId),
        quip: pickQuip(QUIPS.district, n), icon: 'pin', tone: 'yellow',
      };
    case 'abilityUnlocked':
      return {
        key: `a:${ev.abilityId}`, title: 'NEW ABILITY UNLOCKED!', sub: ABILITIES[ev.abilityId]?.name ?? ev.abilityId,
        quip: pickQuip(QUIPS.ability, n), icon: abilityIcon(ev.abilityId), tone: 'teal',
      };
    case 'gateDestroyed':
      return { key: 'gate', title: 'GATE BREACHED!', sub: 'The checkpoint is open', quip: 'Knock knock.', icon: 'gate', tone: 'yellow' };
    default:
      return null;
  }
}

export function hordeBanner(milestone: number, cap: number, n: number): BannerSpec {
  const full = milestone >= cap;
  return {
    key: `h:${milestone}`,
    title: full ? 'MAXIMUM HORDE!' : 'HORDE GROWING!',
    sub: full ? `${milestone} zombies - that's everyone` : `${milestone} zombies strong`,
    quip: pickQuip(QUIPS.horde, n),
    icon: 'horde',
    tone: 'green',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Circular minimap math
// ---------------------------------------------------------------------------------------------------------------

/**
 * Projection for a north-up, player-centered minimap: `size` px square showing `radius` meters around `center`.
 * Compatible with uiHelpers.worldToMap (minX/minZ are the world bounds origin so cached static layers line up).
 */
export function centeredProjection(bounds: { minX: number; minZ: number }, center: Vec2, radius: number, size: number): MapProjection {
  const scale = size / (2 * Math.max(1, radius));
  return {
    scale,
    offX: size / 2 - (center.x - bounds.minX) * scale,
    offY: size / 2 - (center.z - bounds.minZ) * scale,
    minX: bounds.minX,
    minZ: bounds.minZ,
    width: size,
    height: size,
  };
}

/**
 * Clamp a map pixel to a circle (rim markers for off-map objectives). Returns true when it had to be clamped.
 * `out.x/out.z` hold pixel x/y like worldToMap.
 */
export function clampToCircle(cx: number, cy: number, r: number, out: Vec2): boolean {
  const dx = out.x - cx;
  const dy = out.z - cy;
  const d = Math.hypot(dx, dy);
  if (d <= r || d < 1e-6) return false;
  out.x = cx + (dx / d) * r;
  out.z = cy + (dy / d) * r;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Context emphasis
// ---------------------------------------------------------------------------------------------------------------

export type HudContext = 'explore' | 'combat' | 'recruit';

/**
 * Which HUD group to emphasise. Combat: the Alpha was hurt / swung recently or the horde is on an attack order.
 * Recruit: walkers joined recently. Otherwise explore.
 */
export function hudContext(state: GameState, secondsSinceDamage: number, secondsSinceRecruit: number, secondsSinceSwing: number): HudContext {
  if (secondsSinceDamage < 4 || secondsSinceSwing < 3 || state.order.type === 'attack' || state.squads.length > 0) return 'combat';
  if (secondsSinceRecruit < 3) return 'recruit';
  return 'explore';
}
