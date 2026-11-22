// [pure] Reusable environmental interactables (trash cans, car alarms, fire hydrants, barriers, sirens).
// Spec: docs/11_cityupgrade.md §2.6.
import { BALANCE } from '../config/balance';
import type { SimContext } from '../core/contracts';
import type { GameState, InteractableKind, SimInput, Vec2, WorldInteractable } from '../core/types';

const INTERACTABLE_LABELS: Readonly<Record<InteractableKind, string>> = {
  trashCan: 'Knocked over trash can!',
  carAlarm: 'Set off car alarm!',
  fireHydrant: 'Broke fire hydrant!',
  shopWindow: 'Smashed shop window!',
  sirenPost: 'Activated street siren!',
  constructionBarrier: 'Toppled road barrier!',
};

function applyInteractableEffect(ctx: SimContext, item: WorldInteractable): void {
  const radius = item.kind === 'carAlarm' || item.kind === 'sirenPost' ? 24 : 14;
  const r2 = radius * radius;
  const ix = item.pos.x;
  const iz = item.pos.z;

  // Startle nearby civilians (or briefly daze them on fire hydrant spray)
  for (const g of ctx.state.guards) {
    if (g.dormant || g.hp <= 0 || g.state === 'DEAD') continue;
    const dx = g.pos.x - ix;
    const dz = g.pos.z - iz;
    if (dx * dx + dz * dz > r2) continue;

    if (item.kind === 'fireHydrant' && dx * dx + dz * dz <= 36) {
      g.staggerTime = Math.max(g.staggerTime, 1.0);
    } else if (g.role === 'civilian') {
      g.state = 'RETREAT';
      g.stateTime = 0;
    } else if ((item.kind === 'carAlarm' || item.kind === 'sirenPost') && g.strongholdId === null) {
      if (g.state === 'PATROL') {
        g.state = 'ALERT';
        g.stateTime = 0;
      }
    }
  }

  // Nudge nearby idle ambient zombies toward the commotion
  if (item.kind === 'trashCan' || item.kind === 'sirenPost' || item.kind === 'carAlarm') {
    for (const z of ctx.state.zombies) {
      if (z.dormant || z.hp <= 0 || z.state !== 'ambient' || z.heldBy !== 0) continue;
      const dx = ix - z.pos.x;
      const dz = iz - z.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2 || d2 < 1) continue;
      const d = Math.sqrt(d2);
      z.vel.x = (dx / d) * BALANCE.walker.ambientSpeed * 1.6;
      z.vel.z = (dz / d) * BALANCE.walker.ambientSpeed * 1.6;
      z.facing = Math.atan2(dx, dz);
    }
  }
}

export function triggerInteractable(ctx: SimContext, item: WorldInteractable): boolean {
  if (ctx.state.time - item.lastTriggeredAt < item.cooldown) return false;
  item.lastTriggeredAt = ctx.state.time;
  item.triggerCount++;
  applyInteractableEffect(ctx, item);
  ctx.emit({
    type: 'worldInteractable',
    id: item.id,
    kind: item.kind,
    pos: { ...item.pos },
    label: INTERACTABLE_LABELS[item.kind],
  });
  return true;
}

/** Nearest interactable within explicit-interact range that is off cooldown (HUD prompt + V). */
export function nearestInteractable(state: GameState, pos: Vec2): WorldInteractable | null {
  const r2 = (BALANCE.city.interactRange + 1.2) ** 2;
  let best: WorldInteractable | null = null;
  let bestD2 = r2;
  for (const item of state.interactables) {
    if (state.time - item.lastTriggeredAt < item.cooldown) continue;
    const d2 = (item.pos.x - pos.x) ** 2 + (item.pos.z - pos.z) ** 2;
    if (d2 <= bestD2) { best = item; bestD2 = d2; }
  }
  return best;
}

export const INTERACT_VERBS: Readonly<Record<InteractableKind, string>> = {
  trashCan: 'Kick the trash can',
  carAlarm: 'Thump the car (alarm)',
  fireHydrant: 'Break the hydrant',
  shopWindow: 'Smash the window',
  sirenPost: 'Set off the siren',
  constructionBarrier: 'Topple the barrier',
};

/**
 * Explicit V (when no vehicle/shortcut took it) triggers the nearest prop; swinging at a prop, sprinting into it, or
 * ramming it in the cart (speed > 4 m/s) also sets it off.
 */
export function updateWorldInteractions(ctx: SimContext, input: SimInput, interactFree = true): void {
  const leader = ctx.state.leader;
  if (!leader.alive || ctx.state.phase !== 'playing' || ctx.state.interactables.length === 0) return;
  const pv = ctx.state.playerVehicle;
  const ramming = !!pv?.mounted && Math.abs(pv.speed) > BALANCE.city.playerVehicleImpact.propSmashSpeed;
  const interact = interactFree && input.interact;
  if (interact && !pv?.mounted) {
    const item = nearestInteractable(ctx.state, leader.pos);
    if (item) triggerInteractable(ctx, item);
    return;
  }
  const triggerAction = (!pv?.mounted && (input.attack || leader.sprinting)) || ramming;
  if (!triggerAction) return;

  const range = ramming ? 2.2 : input.attack ? 2.4 : 1.3;
  const r2 = range * range;
  for (const item of ctx.state.interactables) {
    if (ctx.state.time - item.lastTriggeredAt < item.cooldown) continue;
    const dx = item.pos.x - leader.pos.x;
    const dz = item.pos.z - leader.pos.z;
    if (dx * dx + dz * dz <= r2) {
      triggerInteractable(ctx, item);
    }
  }
}
