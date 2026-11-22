// [pure] Reproducible benchmark scene (docs/8_visual_polish.md §7): `?bench=1` = 100 zombies + 100 humans around the
// Alpha with live combat; `?bench=2` = stress (260 zombies + 120 humans). Debug-only: never reachable from normal play,
// never saved (Game skips autosave while a benchmark is active). Uses the normal entity factories, so the sim treats
// the spawned agents like any other (followers count toward followerCount; capacity rule respected for followers).
import { BALANCE } from '../../config/balance';
import type { ICollisionWorld } from '../../core/contracts';
import type { GameState, Rng, Vec2 } from '../../core/types';
import { createGuard } from '../../entities/HumanGuard';
import { createZombie } from '../../entities/Zombie';

export type BenchmarkKind = 0 | 1 | 2;

export interface BenchmarkSpec {
  zombies: number;
  humans: number;
  radius: number;
}

export const BENCHMARKS: Readonly<Record<1 | 2, BenchmarkSpec>> = {
  1: { zombies: 100, humans: 100, radius: 32 },
  2: { zombies: 260, humans: 120, radius: 40 },
};

/** `?bench=1` / `?bench=2` → kind; anything else 0. */
export function parseBenchmarkParam(search: string): BenchmarkKind {
  const m = /[?&]bench=(\d)/.exec(search);
  const v = m ? Number(m[1]) : 0;
  return v === 1 || v === 2 ? v : 0;
}

function freeSpot(center: Vec2, radius: number, rng: Rng, collision: ICollisionWorld, r: number): Vec2 {
  for (let attempt = 0; attempt < 12; attempt++) {
    const a = rng.next() * Math.PI * 2;
    const d = 4 + Math.sqrt(rng.next()) * radius;
    const p = { x: center.x + Math.sin(a) * d, z: center.z + Math.cos(a) * d };
    if (!collision.resolveCircle(p, r)) return p; // false = no overlap to push out of
  }
  const p = { x: center.x, z: center.z };
  collision.resolveCircle(p, r);
  return p;
}

/**
 * Adds the benchmark population around the leader. Returns how many zombies/humans were added.
 * Followers fill up to the horde cap; the rest are ambient (they still animate, steer and get footsteps).
 */
export function spawnBenchmark(
  state: GameState, collision: ICollisionWorld, rng: Rng, kind: 1 | 2, openWorld = true,
): { zombies: number; humans: number } {
  const spec = BENCHMARKS[kind];
  // Stress test: a mid-game open-world horde (base + 4 nests; the real base cap is 0 until the first nest).
  const cap = openWorld ? BALANCE.openWorld.maxFollowers + 4 * BALANCE.openWorld.followersPerNest : BALANCE.horde.maxFollowers;
  const c = state.leader.pos;
  let zombies = 0;
  for (let i = 0; i < spec.zombies; i++) {
    const follower = state.followerCount < cap;
    const pos = freeSpot(c, spec.radius * 0.6, rng, collision, BALANCE.walker.radius);
    const z = createZombie(state.nextEntityId++, pos, {
      state: follower ? 'follower' : 'ambient', variant: Math.floor(rng.next() * 8), spawnZone: -1, isConverted: false, rng,
    });
    state.zombies.push(z);
    if (follower) state.followerCount++;
    zombies++;
  }
  let humans = 0;
  for (let i = 0; i < spec.humans; i++) {
    const role = i % 5 === 0 ? 'police' : 'civilian';
    const pos = freeSpot(c, spec.radius, rng, collision, 0.4);
    state.guards.push(createGuard(state.nextEntityId++, {
      role, post: 'patrol', pos, facing: rng.next() * Math.PI * 2, tower: null, waypoints: [pos],
    }, collision));
    humans++;
  }
  return { zombies, humans };
}
