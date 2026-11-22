// [pure] When the Alpha walks up to a tourist (living civilian), sometimes play one of their voice lines.
// Kept rare on purpose so the jokes don't wear out: a random chance per approach, a long global cooldown,
// each tourist speaks at most once, and the clip rotation never repeats a line until every line has played.

/** Minimal view of a human the chatter logic needs (GuardAgent satisfies it). */
export interface ChatterHuman {
  id: number;
  role: string;
  hp: number;
  dormant: boolean;
  pos: { x: number; z: number };
}

export const TOURIST_CHATTER = {
  /** Leader within this distance (m) of a tourist counts as "approaching". */
  triggerRadius: 7,
  /** The leader must leave this distance (m) before the same tourist can count as a new approach. */
  resetRadius: 11,
  /** Probability an approach plays a line (when the cooldown allows it). */
  chance: 0.45,
  /** Seconds after a line starts before another may play: U(min, max). */
  cooldownMin: 35,
  cooldownMax: 70,
  /** First line can't fire right after control is handed over. */
  initialDelay: 8,
} as const;

export interface ChatterState {
  /** Time (s) before which nothing plays. */
  nextAllowedAt: number;
  /** Tourists currently inside the trigger radius (edge-triggered approaches). */
  near: Set<number>;
  /** Tourists that already spoke (or were rolled and passed): one roll per tourist. */
  rolled: Set<number>;
  /** Remaining clip indices in the current shuffle bag. */
  bag: number[];
  lastClip: number;
}

export function createChatterState(now = 0): ChatterState {
  return { nextAllowedAt: now + TOURIST_CHATTER.initialDelay, near: new Set(), rolled: new Set(), bag: [], lastClip: -1 };
}

/** Next clip from a shuffle bag; never the same clip twice in a row across bag refills. */
export function nextClip(s: ChatterState, clipCount: number, rand: () => number): number {
  if (clipCount <= 0) return -1;
  if (s.bag.length === 0) {
    const bag = Array.from({ length: clipCount }, (_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // bag is consumed from the end: avoid opening the new bag with the line that just played
    if (clipCount > 1 && bag[bag.length - 1] === s.lastClip) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    s.bag = bag;
  }
  const clip = s.bag.pop()!;
  s.lastClip = clip;
  return clip;
}

/**
 * Per-frame check. Returns the clip index to play and the speaking tourist, or null.
 * `rand` returns [0,1) (the audio layer may use Math.random; tests pass a seeded rng).
 */
export function updateChatter(
  s: ChatterState,
  now: number,
  leader: { x: number; z: number },
  humans: readonly ChatterHuman[],
  clipCount: number,
  rand: () => number,
): { clip: number; humanId: number } | null {
  const enter2 = TOURIST_CHATTER.triggerRadius ** 2;
  const exit2 = TOURIST_CHATTER.resetRadius ** 2;
  let result: { clip: number; humanId: number } | null = null;
  for (const h of humans) {
    if (h.role !== 'civilian' || h.hp <= 0 || h.dormant) { s.near.delete(h.id); continue; }
    const dx = h.pos.x - leader.x;
    const dz = h.pos.z - leader.z;
    const d2 = dx * dx + dz * dz;
    if (s.near.has(h.id)) {
      if (d2 > exit2) s.near.delete(h.id);
      continue;
    }
    if (d2 > enter2) continue;
    s.near.add(h.id);
    if (result || now < s.nextAllowedAt || s.rolled.has(h.id)) continue;
    s.rolled.add(h.id);
    if (rand() >= TOURIST_CHATTER.chance) continue;
    const clip = nextClip(s, clipCount, rand);
    if (clip < 0) continue;
    const span = TOURIST_CHATTER.cooldownMax - TOURIST_CHATTER.cooldownMin;
    s.nextAllowedAt = now + TOURIST_CHATTER.cooldownMin + rand() * span;
    result = { clip, humanId: h.id };
  }
  return result;
}
