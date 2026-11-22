# HH-T002 — codex (written by Claude wrapper after codex quota exhaustion)

**Task ID & Agent:** HH-T002 / codex (run via wrapper; codex exited on usage limit, report not written by codex)

**Status:** QUOTA_EXHAUSTED

## Completed Work

- `src/systems/HordeHealthSystem.ts` (new, 208 lines, pure, no three import). Contains all ARCHITECTURE §HH-1 exports:
  `strengthValueOf`, `maxHordeStrength`, `computeHordeStrength` (state-keyed reused scratch result), `applyAlphaDamage`
  (nearest-first share pass within `shareRadius`, capped at `maxRecipients`; core pass; uncapped overflow pass to nearest followers;
  one `sharedDamage` event; `alphaHit` cause tally), `restoreStrength` (heal, core only), `resetHordeHealth`, `isDepleted`,
  `isLastBrain`, `isHordeShielded`, `lastBrainSpeedMultiplier`, `finishLastBrain`, `updateHordeHealth` (single
  `hordeStrengthChanged` per step with dominant cause, critical edge with hysteresis, grace decay, Last Brain FSM).
  Module-level state: only `WeakMap<GameState, Scratch>`.
- `tests/hordeHealth.test.ts` (new, 421 lines, 29 tests).
- Verified by wrapper (see below): both files compile and all 29 tests pass.

## Remaining Work

- Codex did not finish its own review or the full `npm test` run (it was mid-run when the quota hit).
- Not yet run: full `npm test` suite (the concurrent session's in-progress files may fail; not checked here).
- Not done: append `- [HH-T002] ...` memory notes to `.agent-context/MEMORY.md` (see Memory Notes below for the content to append).
- Wiring into `CombatSystem` / `Simulation` is HH-T003 and was intentionally not done.
- Review nit for the next reviewer: `applyAlphaDamage` `_source` is unused (telemetry by source is not recorded); the per-call `recipients` array is allocated in the event path only as specified.

## Public Interfaces/Exports Added

From `src/systems/HordeHealthSystem.ts`:
`strengthValueOf(state, z)`, `maxHordeStrength(ctx)`, `computeHordeStrength(ctx)` → `{ strength, maxStrength, followerStrength }` (reused scratch per state),
`applyAlphaDamage(ctx, incoming, source)`, `restoreStrength(ctx, units, cause)` → applied units, `resetHordeHealth(state)`,
`isDepleted(state)`, `isLastBrain(state)`, `isHordeShielded(state)`, `lastBrainSpeedMultiplier(state)`, `finishLastBrain(ctx)`,
`updateHordeHealth(ctx, dt)`.

## Verification Run

- `npx tsc --noEmit` → exit 0 (run by wrapper after codex exit).
- `npx vitest run tests/hordeHealth.test.ts` → 1 file passed, 29 tests passed, 0 failed.
- `npm test` (full suite) → not run.

## Memory Notes

- [HH-T002] `HordeHealthSystem` is the only writer of `state.horde`; scratch lives in a `WeakMap<GameState, Scratch>` keyed per state, so restarts stay clean.
- [HH-T002] `computeHordeStrength` returns a reused per-state object; callers must read it before the next call.
- [HH-T002] Non-finite or non-positive damage and heal are ignored with no event and no telemetry change.
- [HH-T002] `resetHordeHealth` keeps the pre-reset strength in scratch so the next `updateHordeHealth` still reports the respawn gain/loss once.
- [HH-T002] Overflow after the core is empty has no recipient cap, so one hit can drain every follower; a hit larger than the total available HP is discarded.
