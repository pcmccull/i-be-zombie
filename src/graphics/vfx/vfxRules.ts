// [pure] Render-only VFX rules. No renderer, DOM, random source or simulation writes.
import { BALANCE } from '../../config/balance';
import type { CompanionId, DistrictLayout, GameEvent, GameState, GroundPatch, VehicleAgent, ZombieAgent } from '../../core/types';
import type { QualityProfile } from '../performance/GraphicsQuality';
import { vehiclePaint } from '../../visuals/vehicleLook';
import { halfLength } from '../../systems/vehicleModels';

export type VfxName = 'zombie.footstep' | 'combat.swing' | 'combat.hit' | 'zombie.recruited' | 'horde.rally' | 'horde.charge' | 'defender.muzzle' | 'bullet.impact' | 'barricade.destroyed' | 'vehicle.explosion' | 'ability.unlock' | 'ambient.mote'
  | 'vehicle.claw' | 'vehicle.impact' | 'vehicle.glass' | 'vehicle.smoke' | 'human.dazed' | 'body.fall'
  | 'brains.trail' | 'brains.collect'
  // Living City (docs/11_cityupgrade.md §6): interactables, shortcut ends, companion perks.
  | 'interact.dust' | 'interact.spray' | 'interact.glass' | 'interact.alarm' | 'companion.perk'
  // Horde Strength (docs/13_hode_health.md): shared damage tether, Last Brain aura & recovery.
  | 'horde.tether' | 'horde.tetherGlint' | 'horde.lastBrainAura' | 'horde.recovery';
export type VfxSurface = 'asphalt' | 'sidewalk' | 'grass' | 'sand' | 'concrete' | 'wood' | 'metal' | 'cloth';
export interface VfxPayload {
  x: number; y?: number; z: number; dirX?: number; dirZ?: number; radius?: number;
  intensity?: number; surface?: VfxSurface; faction?: 'zombie' | 'human' | 'alpha' | 'structure'; color?: number;
}

/** Atlas cells, counted from its bottom left (canvas drawing flips the row). */
export enum VfxTile { Dot, Star, Wisp, Smoke, Shard, Streak, ArrowUp, Leaf, Ring, Glint }
export interface EmitterConfig {
  count: number;
  lifetime: readonly [number, number];
  speed: number; spread: number; gravity: number; drag: number;
  size: readonly [number, number];
  opacity: number; opacityCurve: 'fade' | 'pop' | 'soft';
  colors: readonly number[]; tiles: readonly VfxTile[];
  blend: 'normal' | 'additive' | 'mixed'; spin: number; bounce: number;
  motion: 'burst' | 'spiral' | 'ring' | 'trail' | 'arc' | 'drift';
  flash?: boolean;
}

const dust: EmitterConfig = {
  count: 2, lifetime: [0.3, 0.5], speed: 0.65, spread: 0.15, gravity: -0.15, drag: 2,
  size: [0.16, 0.5], opacity: 0.35, opacityCurve: 'soft', colors: [0xa9a294], tiles: [VfxTile.Smoke],
  blend: 'normal', spin: 0.4, bounce: 0, motion: 'burst',
};
export const EMITTERS: Record<VfxName, EmitterConfig> = {
  'zombie.footstep': dust,
  'combat.swing': { ...dust, count: 7, lifetime: [0.12, 0.23], speed: 2, spread: 1.1, size: [0.5, 0.1], opacity: 0.5,
    colors: [0xe6ffd0], tiles: [VfxTile.Streak], blend: 'additive', motion: 'arc' },
  'combat.hit': { ...dust, count: 10, lifetime: [0.12, 0.3], speed: 3.5, spread: 0.08, gravity: 1.8, drag: 3,
    size: [0.26, 0.04], opacity: 0.9, opacityCurve: 'pop', colors: [0xe0782a, 0xfff3d5],
    tiles: [VfxTile.Star, VfxTile.Glint, VfxTile.Dot], blend: 'additive', spin: 4, flash: true },
  'zombie.recruited': { ...dust, count: 12, lifetime: [0.5, 0.95], speed: 1.8, spread: 0.45, gravity: -0.6, drag: 0.6,
    size: [0.3, 0.08], opacity: 0.7, colors: [0x5effb8, 0x2fd3c0], tiles: [VfxTile.Wisp, VfxTile.Wisp, VfxTile.Star],
    blend: 'additive', spin: 3, motion: 'spiral' },
  'horde.rally': { ...dust, count: 28, lifetime: [0.65, 1.15], speed: 1.5, spread: 2, gravity: -0.3, drag: 0.4,
    size: [0.45, 0.12], opacity: 0.65, colors: [0x9be35a, 0x5effb8], tiles: [VfxTile.ArrowUp, VfxTile.Wisp],
    blend: 'additive', spin: 0.2, motion: 'ring' },
  'horde.charge': { ...dust, count: 3, lifetime: [0.2, 0.4], speed: 1.6, spread: 0.3, gravity: -0.2, drag: 1.2,
    size: [0.3, 0.65], colors: [0xc9b99a, 0xffffff], tiles: [VfxTile.Smoke, VfxTile.Smoke, VfxTile.Streak],
    blend: 'mixed', motion: 'trail' },
  'defender.muzzle': { ...dust, count: 2, lifetime: [0.18, 0.4], speed: 1.2, spread: 0.05, gravity: 3.5,
    size: [0.12, 0.25], colors: [0xc9b99a, 0xffd68e], tiles: [VfxTile.Smoke, VfxTile.Glint], blend: 'mixed', spin: 5 },
  'bullet.impact': { ...dust, count: 7, lifetime: [0.2, 0.45], speed: 2, gravity: 5, size: [0.16, 0.3],
    colors: [0xa9a294, 0xc9b99a, 0xffd68e], tiles: [VfxTile.Smoke, VfxTile.Shard, VfxTile.Glint], blend: 'mixed', spin: 5, bounce: 0.3 },
  'barricade.destroyed': { ...dust, count: 38, lifetime: [0.55, 1.25], speed: 5, spread: 1, gravity: 9.8, drag: 0.7,
    size: [0.3, 0.13], opacity: 0.65, colors: [0xc9b99a, 0x9a7852], tiles: [VfxTile.Shard, VfxTile.Shard, VfxTile.Smoke],
    spin: 6, bounce: 0.32 },
  'vehicle.explosion': { ...dust, count: 48, lifetime: [0.7, 2.5], speed: 4, spread: 1.1, gravity: -0.5, drag: 1.2,
    size: [0.8, 2.1], opacity: 0.7, colors: [0x716b60, 0xffb347, 0xffe7b5],
    tiles: [VfxTile.Smoke, VfxTile.Smoke, VfxTile.Glint, VfxTile.Dot], blend: 'mixed', flash: true },
  'ability.unlock': { ...dust, count: 32, lifetime: [0.5, 1], speed: 2.4, spread: 1.7, gravity: 1.8, drag: 0.6,
    size: [0.28, 0.08], opacity: 0.8, colors: [0x5effb8, 0xf6e3a1, 0x9fd8cf],
    tiles: [VfxTile.Star, VfxTile.Shard, VfxTile.Glint], blend: 'mixed', spin: 5, motion: 'ring', flash: true },
  'ambient.mote': { ...dust, count: 1, lifetime: [5, 9], speed: 0.25, spread: 0, gravity: 0, drag: 0.05,
    size: [0.12, 0.12], opacity: 0.28, colors: [0x92ad6e, 0xe8d6a8, 0xcbdace],
    tiles: [VfxTile.Leaf, VfxTile.Dot, VfxTile.Smoke], spin: 0.6, motion: 'drift' },
  // Brains flying into the Alpha (visuals/BrainPickups): a twinkly trail, then a small happy pop of hearts-pink stars.
  'brains.trail': { ...dust, count: 1, lifetime: [0.25, 0.45], speed: 0.3, spread: 0.6, gravity: -0.4, drag: 1.5,
    size: [0.2, 0.05], opacity: 0.85, opacityCurve: 'fade', colors: [0xffb3c8, 0xfff1a8], tiles: [VfxTile.Star, VfxTile.Glint],
    blend: 'additive', spin: 3 },
  'brains.collect': { ...dust, count: 10, lifetime: [0.35, 0.7], speed: 2.2, spread: 0.9, gravity: -1.2, drag: 1.8,
    size: [0.26, 0.06], opacity: 0.9, opacityCurve: 'pop', colors: [0xff9ec0, 0xfff1a8, 0xffd2e0],
    tiles: [VfxTile.Star, VfxTile.Star, VfxTile.Glint, VfxTile.Dot], blend: 'additive', spin: 4, motion: 'ring' },
  // Claws on a car: hot sparks (glints/streaks) + paint chips (shards, payload colour) that bounce off the asphalt.
  'vehicle.claw': { ...dust, count: 12, lifetime: [0.25, 0.65], speed: 4.6, spread: 0.2, gravity: 8, drag: 1.4,
    size: [0.42, 0.1], opacity: 1, opacityCurve: 'fade', colors: [0xffd68e, 0xfff3d5],
    tiles: [VfxTile.Glint, VfxTile.Shard, VfxTile.Streak, VfxTile.Glint, VfxTile.Shard, VfxTile.Dot], blend: 'mixed', spin: 8,
    bounce: 0.35, flash: true },
  // A car ploughing into a body: white flash, road dust kicked forward, grit.
  'vehicle.impact': { ...dust, count: 16, lifetime: [0.35, 0.85], speed: 3.4, spread: 0.6, gravity: 5, drag: 1.6,
    size: [0.4, 1.0], opacity: 0.5, colors: [0xa9a294, 0xc9b99a], tiles: [VfxTile.Smoke, VfxTile.Smoke, VfxTile.Shard, VfxTile.Dot],
    blend: 'mixed', spin: 4, bounce: 0.3, flash: true },
  // Driver dragged out through the window: safety-glass shards spray and tinkle on the road.
  'vehicle.glass': { ...dust, count: 26, lifetime: [0.6, 1.3], speed: 3.8, spread: 0.6, gravity: 9.8, drag: 0.6,
    size: [0.28, 0.14], opacity: 0.85, opacityCurve: 'fade', colors: [0xcfe9ff, 0x9fd8cf, 0xffffff],
    tiles: [VfxTile.Shard, VfxTile.Shard, VfxTile.Glint], blend: 'mixed', spin: 9, bounce: 0.4 },
  // Bonnet smoke of a stalled (dark) or failing (light steam, payload colour) car. Rises and spreads.
  'vehicle.smoke': { ...dust, count: 1, lifetime: [1.6, 2.6], speed: 0.9, spread: 0.25, gravity: -1.4, drag: 0.8,
    size: [0.6, 2.4], opacity: 0.72, colors: [0x4f4c48], tiles: [VfxTile.Smoke], spin: 0.5 },
  // Stars circling a dazed, dragged-out driver's head.
  'human.dazed': { ...dust, count: 5, lifetime: [1.1, 1.7], speed: 0.35, spread: 0.4, gravity: 0, drag: 0.6,
    size: [0.38, 0.26], opacity: 0.95, opacityCurve: 'fade', colors: [0xffe36e, 0xfff3d5], tiles: [VfxTile.Star],
    blend: 'additive', spin: 2, motion: 'spiral' },
  // A body hitting the ground: a low ring of surface-coloured dust.
  'body.fall': { ...dust, count: 7, lifetime: [0.4, 0.8], speed: 1.7, spread: 0.45, gravity: -0.1, drag: 2.6,
    size: [0.3, 0.85], opacity: 0.36 },
  // Trash can / construction barrier knocked over: a small puff of street grit.
  'interact.dust': { ...dust, count: 9, lifetime: [0.3, 0.7], speed: 1.6, spread: 0.5, gravity: 0.8, drag: 1.8,
    size: [0.35, 0.9], opacity: 0.45, colors: [0xc9b99a, 0xa9a294], tiles: [VfxTile.Smoke, VfxTile.Shard, VfxTile.Dot],
    spin: 2, bounce: 0.2 },
  // Hydrant burst: a blue fountain that rises on its own speed and falls back under gravity.
  'interact.spray': { ...dust, count: 16, lifetime: [0.5, 0.95], speed: 6, spread: 0.12, gravity: 9.8, drag: 0.3,
    size: [0.2, 0.1], opacity: 0.85, opacityCurve: 'soft', colors: [0x7fd6ff, 0xdff6ff], tiles: [VfxTile.Dot, VfxTile.Glint, VfxTile.Streak],
    blend: 'additive', spin: 1, bounce: 0.25 },
  // Shop window cracking: glints popping out and falling as safety-glass shards.
  'interact.glass': { ...dust, count: 10, lifetime: [0.4, 0.9], speed: 2.4, spread: 0.7, gravity: 9.8, drag: 0.5,
    size: [0.22, 0.1], opacity: 0.9, opacityCurve: 'pop', colors: [0xcfe9ff, 0xffffff, 0x9fd8cf],
    tiles: [VfxTile.Glint, VfxTile.Shard, VfxTile.Glint], blend: 'additive', spin: 8, bounce: 0.3, flash: true },
  // Car alarm / siren post: amber rings and glints flickering outward.
  'interact.alarm': { ...dust, count: 8, lifetime: [0.5, 0.9], speed: 1.2, spread: 1.4, gravity: 0, drag: 1.5,
    size: [0.3, 0.06], opacity: 0.9, opacityCurve: 'pop', colors: [0xffb347, 0xfff3d5], tiles: [VfxTile.Glint, VfxTile.Star],
    blend: 'additive', spin: 4, motion: 'ring' },
  // Companion perk (whistle, pan clang, handbag): a small expanding ring of sparkles.
  'companion.perk': { ...dust, count: 9, lifetime: [0.45, 0.8], speed: 0.4, spread: 0.6, gravity: 0, drag: 1.2,
    size: [0.3, 0.9], opacity: 0.8, opacityCurve: 'fade', colors: [0x5effb8, 0xf6e3a1, 0xff9ec0], tiles: [VfxTile.Ring, VfxTile.Glint],
    blend: 'additive', spin: 1, motion: 'ring' },
  // Horde Strength (docs/13_hode_health.md): shared damage tether, recipient glints, Last Brain aura & recovery.
  'horde.tether': { ...dust, count: 10, lifetime: [0.22, 0.42], speed: 2.6, spread: 0.7, gravity: -0.4, drag: 1.8,
    size: [0.28, 0.08], opacity: 0.85, opacityCurve: 'pop', colors: [0x5effb8, 0x2fd3c0, 0x9be35a],
    tiles: [VfxTile.Wisp, VfxTile.Glint, VfxTile.Ring], blend: 'additive', spin: 3, motion: 'ring', flash: true },
  'horde.tetherGlint': { ...dust, count: 3, lifetime: [0.2, 0.36], speed: 1.5, spread: 0.35, gravity: -0.3, drag: 1.5,
    size: [0.22, 0.06], opacity: 0.9, opacityCurve: 'pop', colors: [0x5effb8, 0x9be35a],
    tiles: [VfxTile.Glint, VfxTile.Star], blend: 'additive', spin: 4, flash: true },
  'horde.lastBrainAura': { ...dust, count: 1, lifetime: [0.35, 0.65], speed: 1.3, spread: 0.85, gravity: -0.8, drag: 1.2,
    size: [0.3, 0.08], opacity: 0.72, opacityCurve: 'soft', colors: [0xff3b24, 0x5effb8, 0xff6b4a],
    tiles: [VfxTile.Wisp, VfxTile.Glint, VfxTile.Smoke], blend: 'additive', spin: 3.5, motion: 'spiral' },
  'horde.recovery': { ...dust, count: 18, lifetime: [0.45, 0.85], speed: 2.8, spread: 0.9, gravity: -0.6, drag: 1.0,
    size: [0.34, 0.08], opacity: 0.88, opacityCurve: 'pop', colors: [0x5effb8, 0x9be35a, 0xe6ffd0],
    tiles: [VfxTile.Wisp, VfxTile.Star, VfxTile.Glint], blend: 'additive', spin: 3.5, motion: 'ring', flash: true },
};

export const PARTICLE_CAPACITY = 1280;
export const UNLOCK_RADIUS = 32;
export const MAX_CHARGE_EMITTERS = 24;
export function scaledCount(base: number, profile: QualityProfile, reduced: boolean): number {
  return Number.isFinite(base) ? Math.max(0, Math.floor(base * profile.burstScale * (reduced ? 0.5 : 1))) : 0;
}
export function canSpawn(live: number, n: number, max: number): boolean {
  return Number.isInteger(live) && Number.isInteger(n) && live >= 0 && n > 0 && live + n <= max;
}
export function withinVision(x: number, z: number, leaderX: number, leaderZ: number, hiddenBeyond: number): boolean {
  return hiddenBeyond >= 0 && (x - leaderX) ** 2 + (z - leaderZ) ** 2 <= hiddenBeyond ** 2;
}
/** Dust kicked up by a falling body / car impact; every surface has one. */
export function dustColor(surface: VfxSurface): number {
  return surface === 'sand' ? 0xe8d6a8 : surface === 'grass' ? 0x8a9a6a : surface === 'asphalt' ? 0x969b9f :
    surface === 'wood' ? 0x9a7852 : 0xa9a294;
}
const CAR_HALF_W = 0.95;
/**
 * Where a claw lands on a car: the point of its footprint closest to the attacker, at door height. Falls back to the
 * roof when the attacker stands inside the footprint (or is unknown), so the sparks are never hidden in the body.
 */
export function clawPoint(v: Pick<VehicleAgent, 'pos' | 'facing' | 'model'>, attacker: { x: number; z: number } | undefined): VfxPayload {
  if (!attacker) return { x: v.pos.x, y: 1.55, z: v.pos.z };
  const s = Math.sin(v.facing), c = Math.cos(v.facing), halfL = halfLength(v);
  const dx = attacker.x - v.pos.x, dz = attacker.z - v.pos.z;
  // Car-local: forward = (sin, cos), side = (cos, -sin).
  const f = dx * s + dz * c, r = dx * c - dz * s;
  const fc = Math.max(-halfL, Math.min(halfL, f)), rc = Math.max(-CAR_HALF_W, Math.min(CAR_HALF_W, r));
  if (fc === f && rc === r) return { x: v.pos.x, y: 1.55, z: v.pos.z };
  const ox = fc * s + rc * c, oz = fc * c - rc * s;
  // Push slightly outside so depth testing keeps the burst in front of the panel.
  const len = Math.hypot(dx - ox, dz - oz) || 1;
  return { x: v.pos.x + ox + (dx - ox) / len * 0.12, y: 0.95, z: v.pos.z + oz + (dz - oz) / len * 0.12,
    dirX: (dx - ox) / len, dirZ: (dz - oz) / len };
}
export function footstepColor(surface: VfxSurface): number | undefined {
  return surface === 'sand' ? 0xe8d6a8 : surface === 'asphalt' ? 0x969b9f : surface === 'grass' ? 0x7d9a6a : undefined;
}

export interface MappedVfx { name: VfxName; payload: VfxPayload }
const one = (name: VfxName, payload: VfxPayload): MappedVfx[] => [{ name, payload }];
const at = (p: { x: number; z: number }, y = 1): VfxPayload => ({ x: p.x, y, z: p.z });
const humanHit = 0xe0782a, zombieHit = 0x98c77d;
type EventMapper = (ev: GameEvent, state?: GameState) => MappedVfx[];
// Each adapter is checked against its discriminated event before entering the table.
function adapter<K extends GameEvent['type']>(fn: (ev: Extract<GameEvent, { type: K }>, state?: GameState) => MappedVfx[]): EventMapper {
  return (ev, state) => fn(ev as Extract<GameEvent, { type: K }>, state);
}
/** The unlock sparkle around the Alpha: rewards, secrets, companions and hideouts are the Alpha's own discoveries. */
const alphaSparkle = (state?: GameState): MappedVfx[] =>
  state ? one('ability.unlock', { ...at(state.leader.pos, 0.7), radius: 1.7, faction: 'alpha' }) : [];
/** Companion accent colour for the perk ring (Larry red, Chef white, Grandma purple). */
const COMPANION_ACCENT: Record<CompanionId, number> = { larry_lifeguard: 0xff5a4f, chef_brainsley: 0xffffff, grandma_rot: 0xb983ff };
const EVENT_MAP: Partial<Record<GameEvent['type'], EventMapper>> = {
  attackSwing: adapter<'attackSwing'>(ev => one('combat.swing', { ...at(ev.pos), dirX: Math.sin(ev.facing), dirZ: Math.cos(ev.facing), faction: 'alpha' })),
  melee: adapter<'melee'>((ev, state) => {
    const target = ev.target;
    if (target.kind === 'vehicle') {
      // The killing claw stalls the car in the same step, so a fresh stall still sparks.
      const v = state?.vehicles?.find(c => c.id === target.id);
      if (!v || (v.mode === 'stalled' && v.modeTime > 0.05)) return [];
      return one('vehicle.claw', { ...clawPoint(v, ev.pos), color: vehiclePaint(v), faction: 'structure',
        intensity: ev.attacker === 'leader' ? 1.6 : 1 });
    }
    const guard = target.kind === 'guard' ? state?.guards.find(g => g.id === target.id) : undefined;
    const pos = guard?.pos ?? (target.kind === 'gate' ? state?.gate?.center :
      target.kind === 'structure' ? state?.structures?.find(s => s.id === target.id)?.center : undefined) ?? ev.pos;
    return one('combat.hit', { ...at(pos, (guard?.elevation ?? 0) + 1),
      faction: target.kind === 'guard' ? 'human' : 'structure', color: humanHit });
  }),
  damage: adapter<'damage'>((ev, state) => {
    // Car claws are drawn from their melee event (it carries the attacker side); damage always precedes it.
    if (ev.target.kind === 'vehicle') return [];
    const human = ev.target.kind === 'guard';
    const zombie = ev.target.kind === 'zombie' || ev.target.kind === 'leader';
    const target = ev.target;
    const y = human && target.kind === 'guard' ? (state?.guards.find(g => g.id === target.id)?.elevation ?? 0) + 1 : 1;
    return one('combat.hit', { ...at(ev.pos, y), faction: zombie ? 'zombie' : human ? 'human' : 'structure', color: zombie ? zombieHit : humanHit });
  }),
  structureDamaged: adapter<'structureDamaged'>(ev => one('combat.hit', { ...at(ev.pos), faction: 'structure', color: humanHit })),
  humanMelee: adapter<'humanMelee'>(ev => ev.hit ? one('combat.hit', { ...at(ev.pos), faction: 'zombie', color: zombieHit }) : []),
  shot: adapter<'shot'>(ev => [
    { name: 'defender.muzzle', payload: { ...at(ev.from, ev.from.y), dirX: ev.to.x - ev.from.x, dirZ: ev.to.z - ev.from.z, faction: 'human' } },
    { name: ev.hit ? 'combat.hit' : 'bullet.impact', payload: { ...at(ev.to, ev.to.y), faction: ev.hit ? 'zombie' : 'structure', color: ev.hit ? zombieHit : undefined } },
  ]),
  recruited: adapter<'recruited'>(ev => one('zombie.recruited', { ...at(ev.pos, 0.5), faction: 'zombie' })),
  converted: adapter<'converted'>(ev => one('zombie.recruited', { ...at(ev.pos, 0.5), faction: 'zombie' })),
  recruitPulse: adapter<'recruitPulse'>(ev => ev.recruits > 0 ? one('zombie.recruited', { ...at(ev.pos, 0.5), radius: 0.8 }) : []),
  rally: adapter<'rally'>(ev => one('horde.rally', { ...at(ev.pos, 0.3), radius: ev.radius })),
  frenzyStart: adapter<'frenzyStart'>(ev => one('horde.charge', { ...at(ev.pos, 0.2), radius: ev.radius })),
  rushStart: adapter<'rushStart'>((_, state) => state ? one('horde.charge', at(state.leader.pos, 0.2)) : []),
  structureDestroyed: adapter<'structureDestroyed'>(ev => one(ev.landmark === 'bus' ? 'vehicle.explosion' : 'barricade.destroyed', {
    ...at(ev.pos, 0.8), surface: ev.kind === 'alleyGate' || ev.kind === 'penGate' ? 'metal' : 'wood', faction: 'structure',
  })),
  // Tank shell: fireball + debris dust where it lands (the muzzle flash comes from its 'shot').
  shellBlast: adapter<'shellBlast'>(ev => [
    { name: 'vehicle.explosion', payload: { ...at(ev.pos, 0.6), intensity: 1.4, faction: 'structure' } },
    { name: 'barricade.destroyed', payload: { ...at(ev.pos, 0.4), surface: 'metal', faction: 'structure' } },
  ]),
  gateDestroyed: adapter<'gateDestroyed'>(ev => one('barricade.destroyed', { ...at(ev.pos, 0.8), surface: 'metal', faction: 'structure' })),
  vehicleHit: adapter<'vehicleHit'>((ev, state) => {
    const v = state?.vehicles?.find(c => c.id === ev.vehicleId);
    return one('vehicle.impact', { ...at(ev.pos, 0.5), dirX: v ? Math.sin(v.facing) : undefined, dirZ: v ? Math.cos(v.facing) : undefined,
      intensity: Math.max(0.6, Math.min(2, Math.abs(ev.speed) / 8)) * (ev.killed ? 1.3 : 1), faction: ev.target === 'leader' ? 'alpha' : 'zombie' });
  }),
  vehicleCrash: adapter<'vehicleCrash'>((ev, state) => {
    const v = state?.vehicles?.find(c => c.id === ev.vehicleId);
    return [
      { name: 'vehicle.impact', payload: { ...at(ev.pos, 0.7), dirX: v ? Math.sin(v.facing) : undefined, dirZ: v ? Math.cos(v.facing) : undefined,
        intensity: Math.max(1, Math.min(2.5, ev.speed / 6)), faction: 'structure' } },
      { name: 'vehicle.glass', payload: { ...at(ev.pos, 1.1), faction: 'structure' } },
    ];
  }),
  driverBailed: adapter<'driverBailed'>((ev, state) => {
    if (!ev.pulled) return [];
    const v = state?.vehicles?.find(c => c.id === ev.vehicleId);
    // Driver window: the car's left side (+side axis), cabin height.
    const glass = v ? { x: v.pos.x + Math.cos(v.facing) * 1.0, y: 1.2, z: v.pos.z - Math.sin(v.facing) * 1.0 } : at(ev.pos, 1.2);
    return [
      { name: 'vehicle.glass', payload: { ...glass, faction: 'structure' } },
      { name: 'body.fall', payload: { ...at(ev.pos, 0.25), faction: 'human' } },
      { name: 'human.dazed', payload: { ...at(ev.pos, 1.95), radius: 0.4, faction: 'human' } },
    ];
  }),
  // The Alpha claws up out of the soil at a nest: clods + dust thrown up around the hole.
  leaderEmerge: adapter<'leaderEmerge'>(ev => [
    { name: 'barricade.destroyed', payload: { ...at(ev.pos, 0.15), surface: 'grass', faction: 'alpha', color: 0x6b4f33, intensity: 0.8 } },
    { name: 'body.fall', payload: { ...at(ev.pos, 0.2), radius: 1.2, faction: 'alpha' } },
  ]),
  // Nest teleport: soil sprays out of the hole as the horde dives in, and again where it crawls out.
  nestTravelStarted: adapter<'nestTravelStarted'>(ev => one('barricade.destroyed', { ...at(ev.from, 0.15), surface: 'grass', faction: 'alpha', color: 0x6b4f33, intensity: 0.7 })),
  nestTravelArrived: adapter<'nestTravelArrived'>(ev => one('barricade.destroyed', { ...at(ev.pos, 0.15), surface: 'grass', faction: 'alpha', color: 0x6b4f33, intensity: 1 })),
  zombieDied: adapter<'zombieDied'>(ev => one('body.fall', { ...at(ev.pos, 0.25), faction: 'zombie' })),
  guardDied: adapter<'guardDied'>(ev => one('body.fall', { ...at(ev.pos, 0.25), faction: 'human' })),
  abilityUnlocked: adapter<'abilityUnlocked'>((_, state) => state ? one('ability.unlock', { ...at(state.leader.pos, 0.7), radius: 1.7, faction: 'alpha' }) : []),
  // Its world-space proximity gate is applied by VFXManager using setWorld's layout.
  strongholdCaptured: adapter<'strongholdCaptured'>((_, state) => state ? one('ability.unlock', { ...at(state.leader.pos, 0.7), radius: 1.7, faction: 'alpha' }) : []),
  // --- Living City (docs/11_cityupgrade.md §6) ---
  worldInteractable: adapter<'worldInteractable'>(ev => {
    switch (ev.kind) {
      case 'trashCan':
      case 'constructionBarrier': return one('interact.dust', { ...at(ev.pos, 0.4), faction: 'structure' });
      case 'fireHydrant': return one('interact.spray', { ...at(ev.pos, 0.9), faction: 'structure', color: 0x7fd6ff });
      case 'shopWindow': return one('interact.glass', { ...at(ev.pos, 1.4), faction: 'structure' });
      case 'carAlarm':
      case 'sirenPost': return one('interact.alarm', { ...at(ev.pos, 2.4), faction: 'structure' });
      default: return [];
    }
  }),
  companionPerk: adapter<'companionPerk'>(ev => one('companion.perk', { ...at(ev.pos, 1.8), faction: 'human', color: COMPANION_ACCENT[ev.companionId] })),
  // Storm-drain shortcut: a puff of grime at both manholes.
  shortcutUsed: adapter<'shortcutUsed'>(ev => [
    { name: 'interact.dust', payload: { ...at(ev.from, 0.2), faction: 'structure', color: 0x6f7a72 } },
    { name: 'interact.dust', payload: { ...at(ev.to, 0.2), faction: 'structure', color: 0x6f7a72 } },
  ]),
  suppliesLooted: adapter<'suppliesLooted'>(ev => one('interact.dust', { ...at(ev.pos, 0.5), faction: 'human', color: 0x9a7852 })),
  rewardGranted: adapter<'rewardGranted'>((_, state) => alphaSparkle(state)),
  secretDiscovered: adapter<'secretDiscovered'>((_, state) => alphaSparkle(state)),
  companionRecruited: adapter<'companionRecruited'>((_, state) => alphaSparkle(state)),
  hideoutUnlocked: adapter<'hideoutUnlocked'>((_, state) => alphaSparkle(state)),
  sharedDamage: adapter<'sharedDamage'>((ev, state) => {
    const out: MappedVfx[] = [{ name: 'horde.tether', payload: { ...at(ev.pos, 1.0), radius: 1.4, faction: 'alpha' } }];
    const cap = Math.min(4, ev.recipients.length);
    for (let i = 0; i < cap; i++) {
      const id = ev.recipients[i];
      const z = state?.zombies?.find(c => c.id === id);
      out.push({
        name: 'horde.tetherGlint',
        payload: { x: z?.pos.x ?? ev.pos.x, y: (z?.elevation ?? 0) + 0.9, z: z?.pos.z ?? ev.pos.z, faction: 'zombie' },
      });
    }
    return out;
  }),
  lastBrainEnd: adapter<'lastBrainEnd'>(ev =>
    ev.outcome === 'recovered' ? one('horde.recovery', { ...at(ev.pos, 0.7), radius: 1.5, faction: 'alpha' }) : [],
  ),
};
export function mapEvent(ev: GameEvent, state?: GameState): MappedVfx[] { return EVENT_MAP[ev.type]?.(ev, state) ?? []; }

/** Unlock events have no position: recover their source even when no capture companion is present. */
export function isUnlockNearby(ev: GameEvent, state: GameState, layout?: DistrictLayout): boolean {
  if (ev.type !== 'abilityUnlocked' && ev.type !== 'strongholdCaptured') return true;
  const source = layout?.strongholds.find(s => ev.type === 'strongholdCaptured' ? s.id === ev.strongholdId : s.unlock === ev.abilityId);
  if (!source) return ev.type === 'abilityUnlocked';
  return withinVision(source.center.x, source.center.z, state.leader.pos.x, state.leader.pos.z, UNLOCK_RADIUS);
}

/** Prefer damage's actual hit point over attacker's position; preserve repeated strikes. */
export function mapEvents(events: readonly GameEvent[], state?: GameState): MappedVfx[] {
  const result: MappedVfx[] = [];
  const used = new Uint8Array(events.length);
  let hasTether = false;
  let glintsRemaining = 4;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const mapped = mapEvent(ev, state);
    if ((ev.type === 'melee' && ev.target.kind !== 'vehicle') || ev.type === 'structureDamaged' || (ev.type === 'shot' && ev.hit) || (ev.type === 'humanMelee' && ev.hit)) {
      const matchBit = ev.type === 'structureDamaged' ? 2 : 1;
      for (let j = 0; j < events.length; j++) {
        if (used[j] & matchBit) continue;
        const other = events[j];
        let same = false;
        if (ev.type === 'melee' && other.type === 'damage') {
          const a = ev.target, b = other.target;
          same = a.kind === b.kind && (!('id' in a) || ('id' in b && a.id === b.id));
        } else if (ev.type === 'structureDamaged' && (other.type === 'damage' || other.type === 'melee')) {
          same = other.target.kind === 'structure' && other.target.id === ev.id;
        } else if (other.type === 'damage' && (ev.type === 'shot' || ev.type === 'humanMelee')) {
          const p = ev.type === 'shot' ? ev.to : ev.pos;
          same = (other.target.kind === 'zombie' || other.target.kind === 'leader') &&
            (other.pos.x - p.x) ** 2 + (other.pos.z - p.z) ** 2 < (ev.type === 'shot' ? 0.25 : 4);
        }
        if (same) {
          used[j] |= matchBit;
          if (ev.type === 'shot') mapped.pop(); else mapped.length = 0;
          break;
        }
      }
    }
    for (let k = 0; k < mapped.length; k++) {
      const m = mapped[k];
      if (m.name === 'horde.tether') {
        if (hasTether) continue;
        hasTether = true;
      } else if (m.name === 'horde.tetherGlint') {
        if (glintsRemaining <= 0) continue;
        glintsRemaining--;
      } else if (m.name === 'ability.unlock' && result.some(r => r.name === 'ability.unlock')) {
        continue;
      }
      result.push(m);
    }
  }
  return result;
}

const surfaceKinds: Record<GroundPatch['kind'], VfxSurface> = {
  road: 'asphalt', sidewalk: 'sidewalk', plaza: 'sidewalk', park: 'grass', lot: 'concrete', compound: 'concrete', sand: 'sand', court: 'concrete',
};
interface SurfaceGrid { cols: number; rows: number; buckets: GroundPatch[][] }
const surfaces = new WeakMap<DistrictLayout, SurfaceGrid>();
const CELL = 16;
export function surfaceAt(layout: DistrictLayout, x: number, z: number): VfxSurface {
  let grid = surfaces.get(layout);
  if (!grid) {
    const cols = Math.ceil((layout.bounds.maxX - layout.bounds.minX) / CELL) + 1;
    const rows = Math.ceil((layout.bounds.maxZ - layout.bounds.minZ) / CELL) + 1;
    grid = { cols, rows, buckets: Array.from({ length: cols * rows }, () => []) };
    for (const p of layout.ground) {
      const x0 = Math.max(0, Math.floor((p.rect.minX - layout.bounds.minX) / CELL));
      const z0 = Math.max(0, Math.floor((p.rect.minZ - layout.bounds.minZ) / CELL));
      const x1 = Math.min(cols - 1, Math.floor((p.rect.maxX - layout.bounds.minX) / CELL));
      const z1 = Math.min(rows - 1, Math.floor((p.rect.maxZ - layout.bounds.minZ) / CELL));
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) grid.buckets[iz * cols + ix].push(p);
    }
    surfaces.set(layout, grid);
  }
  const ix = Math.floor((x - layout.bounds.minX) / CELL), iz = Math.floor((z - layout.bounds.minZ) / CELL);
  if (ix >= 0 && ix < grid.cols && iz >= 0 && iz < grid.rows) {
    const patches = grid.buckets[iz * grid.cols + ix];
    // Last patch wins, matching the layout's layered ground slabs.
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i];
      if (x >= p.rect.minX && x <= p.rect.maxX && z >= p.rect.minZ && z <= p.rect.maxZ) return surfaceKinds[p.kind];
    }
  }
  // Same south beach strip as tropicalLayout, derived from bounds rather than city coordinates.
  return z >= layout.bounds.maxZ && z <= layout.bounds.maxZ + 26 &&
    x >= layout.bounds.minX - 60 && x <= layout.bounds.maxX + 60 ? 'sand' : 'grass';
}

export interface FootstepAccumulator { credit: number; cursor: number; ids: Int32Array; times: Float64Array }
export function createFootstepAccumulator(): FootstepAccumulator {
  return { credit: 0, cursor: 0, ids: new Int32Array(2048).fill(-1), times: new Float64Array(2048).fill(-Infinity) };
}
export interface FootstepOptions {
  dt: number; time: number; rate: number; radius: number; focusX: number; focusZ: number;
  leaderX: number; leaderZ: number; hiddenBeyond: number; alpha?: number; fixedDt?: number;
}
export type FootstepCandidate = Pick<ZombieAgent, 'id' | 'pos' | 'prevPos' | 'state' | 'dormant' | 'elevation'>;
/** Caller owns scratch and output. Hash collisions conservatively skip a stride, never repeat it. */
export function pickFootsteps(candidates: readonly FootstepCandidate[], a: FootstepAccumulator, o: FootstepOptions, out: number[] = []): number[] {
  out.length = 0;
  a.credit = Math.min(a.credit + Math.max(0, o.dt) * Math.max(0, o.rate), Math.max(1, o.rate * 0.1));
  const budget = Math.floor(a.credit + 1e-9);
  a.credit -= budget; // Unused whole tokens expire; idle hordes cannot bank a burst.
  const n = candidates.length, alpha = o.alpha ?? 1, fixedDt = o.fixedDt ?? 1 / 60;
  let scanned = 0;
  for (; scanned < n && out.length < budget; scanned++) {
    const z = candidates[(a.cursor + scanned) % n];
    if ((z.state !== 'follower' && z.state !== 'ambient') || z.dormant || z.elevation > 0.15) continue;
    const dx = z.pos.x - z.prevPos.x, dz = z.pos.z - z.prevPos.z;
    if (dx * dx + dz * dz <= (0.6 * fixedDt) ** 2) continue;
    const x = z.prevPos.x + dx * alpha, pz = z.prevPos.z + dz * alpha;
    if ((x - o.focusX) ** 2 + (pz - o.focusZ) ** 2 > o.radius ** 2 || !withinVision(x, pz, o.leaderX, o.leaderZ, o.hiddenBeyond)) continue;
    const slot = (Math.imul(z.id, 2654435761) >>> 0) % a.ids.length;
    if (o.time - a.times[slot] < 0.35) continue;
    a.ids[slot] = z.id; a.times[slot] = o.time;
    out.push(z.id);
  }
  a.cursor = n ? (a.cursor + scanned) % n : 0;
  return out;
}
