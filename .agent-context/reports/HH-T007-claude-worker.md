# HH-T007 — claude-worker

**Task ID & Agent:** HH-T007 / claude-worker
**Status:** COMPLETED (no HH-owned bugs found)

## Completed Work
- `tests/hordeStrength.test.ts` (new, 21 tests, pure imports, open world via `buildDistrictLayout()` + `usePreBeachEconomy()`, all through `Simulation.step`; guards/vehicles/ambient zombies cleared each step). Covers every spec §12 row: lone rifle hit (-10*2.5/40), followers nearby (nearest -25, core untouched, one sharedDamage), non-fatal follower hit, follower death -1 once, 5 simultaneous deaths = one event delta -5, explosion shared once, explosion on Alpha + followers (Σ follower hp lost == own splash + 75 share, telemetry matches), recruit +1, cap clamp with brutes, nest claim +followersPerNest maxStrength, Last Brain single start / no timer restart, recruit recovery + recoveryGrace ignores hits, hit after entryGrace = death (`finished`), expiry death + respawn core full, hideout fast travel + nest fast travel keep strength/coreDamage (no hordeStrengthChanged), save->load keeps coreDamage / recomputed strength (+applySave), 10 s quiet world constant, N rapid hits = N sharedDamage + one strength event, determinism per seed (4 seeds x 100 hits) with finite/in-range, drink restores core and is refused at full core. `invariants()` checks followerCount, finiteness, strength in [0,max]. `leader.hp` is never read.
- `src/core/Game.ts`: `applyGraphics()` now also calls `this.entities.setReducedMotion(this.graphics.reducedMotion)`. Confirmed (not duplicated): HUD, audio, VFX, entities already receive `hordeStrengthChanged/sharedDamage/lastBrain*/hordeCritical` through the single drained-events fan-out; `Game.dispose()` untouched (no new listeners).

## Remaining Work
None for HH-T007.

## Public Interfaces/Exports Added
None.

## Verification Run
- `npx vitest run tests/hordeStrength.test.ts`: 21/21 pass.
- `npx tsc --noEmit`: only 6 errors, all `src/visuals/HordeRenderer.ts` (492, 522, 762, 793, 800, 801: "Object is possibly 'null'") — VP2 in-progress, not mine.
- `npm test`: 79 files pass, 9 fail (14 tests), none in HH files: buildingPlan, environmentPopulation, expansion (x4), landmarkPlans (x3), world, trafficControl ("waits for someone standing in the lane"), `_scratch_vp2` (VP2 scratch) — all VP2-owned. One to route: `tests/carAttack.test.ts` "an attack order on a car is accepted and sends the horde at it" (fails at line 140: no `melee` on the vehicle within 8 s; passed in HH-T004's run). Most likely VP2 layout change near (40, 95) blocking the 4 zombies, but not verified (could not stash/flag-toggle with the concurrent session). If it persists after VP2 settles, re-check; HH changes touched nothing in vehicle targeting.

## Memory Notes
Appended `- [HH-T007]` lines to MEMORY.md (test isolation recipe; manual coreDamage edits report cause `capacity`; drink heal event appears one step later; Game wiring confirmation).
