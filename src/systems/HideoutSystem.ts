// [pure] Hideouts & fast travel between unlocked zombie safehouses, plus discovered shortcuts (storm drains).
// Spec: docs/11_cityupgrade.md §4.1.D, §4.1.G, Phase 3 ("at least one exploration shortcut").
import { BALANCE } from '../config/balance';
import { HIDEOUTS, SECRETS, type SecretDef } from '../content/rewards';
import type { SimContext } from '../core/contracts';
import type { GameState, HideoutId, SimInput, Vec2 } from '../core/types';
import { revealAround } from './ConquestSystem';

const lastShortcutAt = new WeakMap<GameState, number>();

/** Move the Alpha and every follower to `dest` (horde reassembles in a ring, never stranded). */
function relocateParty(ctx: SimContext, dest: Vec2): void {
  const state = ctx.state;
  ctx.collision.resolveCircle(dest, state.leader.radius);
  state.leader.pos.x = state.leader.prevPos.x = dest.x;
  state.leader.pos.z = state.leader.prevPos.z = dest.z;
  state.leader.vel.x = 0;
  state.leader.vel.z = 0;
  state.leader.elevation = 0;

  if (state.playerVehicle?.mounted) {
    state.playerVehicle.mounted = false;
    state.playerVehicle.speed = 0;
  }

  let idx = 0;
  for (const z of state.zombies) {
    if (z.state !== 'follower' || z.hp <= 0) continue;
    const angle = (idx++ * 2.39996) % (Math.PI * 2);
    const dist = 2.0 + (idx % 5) * 0.7;
    const p = { x: dest.x + Math.cos(angle) * dist, z: dest.z + Math.sin(angle) * dist };
    ctx.collision.resolveCircle(p, z.radius);
    z.pos.x = z.prevPos.x = p.x;
    z.pos.z = z.prevPos.z = p.z;
  }
  revealAround(state, ctx.layout, dest, BALANCE.discovery.revealRadius);
}

export function fastTravelToHideout(ctx: SimContext, hideoutId: HideoutId): boolean {
  const state = ctx.state;
  if (!state.leader.alive || state.phase !== 'playing') return false;
  if (!state.rewards.unlockedHideoutIds.includes(hideoutId)) return false;
  const def = HIDEOUTS.find(h => h.id === hideoutId);
  if (!def) return false;
  const dest = { x: def.pos.x, z: def.pos.z };
  relocateParty(ctx, dest);
  ctx.emit({ type: 'fastTraveled', hideoutId, pos: { ...dest } });
  return true;
}

/** The discovered shortcut end within reach of the Alpha, with the far end; null if none. */
export function shortcutAt(state: GameState, pos: Vec2): { secret: SecretDef; from: Vec2; to: Vec2 } | null {
  const r2 = BALANCE.city.shortcutRange ** 2;
  for (const s of SECRETS) {
    if (!s.shortcutTo || !state.rewards.discoveredSecretIds.includes(s.id)) continue;
    const da = (pos.x - s.pos.x) ** 2 + (pos.z - s.pos.z) ** 2;
    if (da <= r2) return { secret: s, from: s.pos, to: s.shortcutTo };
    const db = (pos.x - s.shortcutTo.x) ** 2 + (pos.z - s.shortcutTo.z) ** 2;
    if (db <= r2) return { secret: s, from: s.shortcutTo, to: s.pos };
  }
  return null;
}

/** V at a discovered drain: the Alpha + horde crawl through to the other end. */
export function useShortcut(ctx: SimContext): boolean {
  const state = ctx.state;
  if (!state.leader.alive || state.phase !== 'playing' || state.playerVehicle?.mounted) return false;
  if (state.time - (lastShortcutAt.get(state) ?? -Infinity) < BALANCE.city.shortcutCooldown) return false;
  const hit = shortcutAt(state, state.leader.pos);
  if (!hit) return false;
  lastShortcutAt.set(state, state.time);
  // Step out beside the far grate, not on it, so a second press doesn't bounce straight back.
  const dest = { x: hit.to.x + 1.6, z: hit.to.z };
  relocateParty(ctx, dest);
  ctx.emit({ type: 'shortcutUsed', secretId: hit.secret.id, from: { ...hit.from }, to: { ...hit.to } });
  return true;
}

/** Returns true when it consumed the interact press. */
export function updateHideouts(ctx: SimContext, input: SimInput, interactFree = true): boolean {
  if (ctx.layout.strongholds.length === 0) return false;
  if (input.fastTravelHideout) {
    fastTravelToHideout(ctx, input.fastTravelHideout);
  }
  return interactFree && input.interact ? useShortcut(ctx) : false;
}
