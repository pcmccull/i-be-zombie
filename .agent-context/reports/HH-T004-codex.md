# HH-T004 — codex (written by Claude orchestrator wrapper after codex quota exhaustion)

**Task ID & Agent:** HH-T004 / codex (report written by wrapper per QUOTA fallback rule; codex hit "usage limit", retry at 11:36 AM)

**Status:** QUOTA_EXHAUSTED (implementation largely present and passing; codex did not finish its own report or final review)

**Completed Work (workspace, verified by wrapper):**
- `src/systems/HumanAISystem.ts`: `findShotInterceptor(ctx, from, fromHeight, to, toHeight): ZombieAgent | null` exported (bounded scan over `ctx.state.zombies`, skips non-follower / dormant / hp<=0, circle-segment chord test, LOS height rule with `FOLLOWER_HEIGHT = 1.7`, `LEADER_CHEST_HEIGHT = 1.2`, no per-shot allocation). `hitAlpha` routes rifle/barricade/MG/coax/armed-civilian bullets: interceptor takes `damageZombie`, tracer end retargeted to interceptor, otherwise `damageLeader(ctx, dmg, 'bullet')`. Tank splash `damageLeader(..., 'explosion')` (line ~371); bat `damageLeader(..., 'melee')` (line ~469).
- `src/systems/TrafficSystem.ts`: rammer leader hits `damageLeader(ctx, damage, 'vehicle')`. Also removed `l.hp > 0` gates in `hordeAim`, `collide`, rammer sight, and the civilian/flee branch (now `l.alive` only) — see Memory Notes / open question.
- `tests/shielding.test.ts` (new, 225 lines, 35 tests): interception, clear line, dormant/dead, beside-line, elevated shooter over near follower, nearest-threat target preference (incl. LOS-hidden follower skipped), tank splash once-per-follower + single `damageLeader(...,'explosion')`, bat melee tag, rammer 'vehicle' tag. All pass.
- `tests/ai.test.ts`: 6-line change (edited by codex; not reviewed in detail by wrapper). Passes.

**Remaining Work:**
1. Codex never ran the final `tsc`/`npm test` pass or wrote its report — done by wrapper (below).
2. Review the `l.hp > 0` removals in `TrafficSystem.ts` (hordeAim, collide, rammer sight, flee branch). They are only correct if HH-T003 / the orchestrator intends `alive` to be the sole death signal for the Alpha; otherwise restore the hp guards.
3. Confirm `HumanAISystem` target preference (item 2) is documented as already-true behavior: guards select nearest visible threat via `findNearestThreat`-style logic; the new test confirms it. No code change was needed there beyond what is in the diff.

**Public Interfaces/Exports Added:** `findShotInterceptor` (src/systems/HumanAISystem.ts).

**Verification Run (wrapper, 2026-11-21):**
- `npx tsc --noEmit`: PASS (exit 0).
- `npx vitest run tests/shielding.test.ts tests/ai.test.ts tests/heavyDefenses.test.ts tests/todos10to12.test.ts tests/carAttack.test.ts tests/hordeHealth.test.ts`: 6/6 files, 124/124 tests pass.
- Full `npx vitest run`: 81 files pass, 1 FAIL: `tests/environmentAssets.test.ts` > "builds every FurnitureKind at lod 0/1 and variants 0..2..." — VP2-owned in-progress work, out of HH-T004 scope.
- Test files touched by HH-T004: `tests/shielding.test.ts` (new), `tests/ai.test.ts` (modified).

**Memory Notes:**
- [HH-T004] Shots at the Alpha go through `findShotInterceptor` (HumanAISystem); elevated shooters use the LOS height rule (follower 1.7 m vs shot height at crossing).
- [HH-T004] Tank splash is not intercepted; each follower gets its own splash once per blast, then `damageLeader(...,'explosion')` once.
- [HH-T004] TrafficSystem no longer gates on `l.hp > 0` for the Alpha (alive-only); verify against HH-T003 before relying on it.
