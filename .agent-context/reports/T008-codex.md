# T008 Report (codex, written by Claude fallback)

**Task ID & Agent:** T008, codex (Codex run hit usage limit; report written by the Claude orchestrator wrapper)

**Status:** QUOTA_EXHAUSTED

Codex exited with `ERROR: You've hit your usage limit ... try again at 4:29 PM` after about 95k tokens. It did not write this report.

## Completed Work

Partial edits present in the workspace (from `git status` / `git diff --stat`). Full `npx tsc --noEmit` and `npx vitest run` passed after the run: 35 files, 367 tests.

- `src/entities/HumanGuard.ts`: `createGuard` now gives `role === 'police'` `BALANCE.police.maxHp`. Civilian and soldier HP unchanged.
- `src/systems/HumanAISystem.ts` (+102/-31 lines): police share soldier shooting and targeting, with `aimDelay` gating in the shot path (`aimTime` before the first shot). Staggered humans tick `staggerTime` down and skip movement and shooting. Dormant humans and zombies are skipped in perception and targeting. `'stronghold'` and `'patrol'` posts are handled through `defenseBounds`, `canAssist`, and the `loseTargetTime` return-to-PATROL path. Civilian flee has a `homeArea` clamp and a `calmTime` settle.
- `src/systems/PopulationSystem.ts` (new body, 135 lines): exports `updatePopulation(ctx, dt)`. It sets `dormant` for humans and ambient zombies by `activeRadius` from the leader (or the active nest while the leader is dead) at `dormantRefreshHz`. Followers and rising zombies are always awake. It has per-district budgets (`civilianBudget` scaled by `capturedPatrolFactor`, ambient budget, infected districts at 0), respawn delay counters, a `minRespawnDistance` check, a visibility check, `ctx.newId()` for ids, and hard caps on `maxHumans` and `maxAmbient`. It also prunes human corpses older than 30 s that are not pending conversion.
- `tests/ai.test.ts` (+113 lines): AI tests for police aim delay, stagger, and dormancy. Not all were checked by hand.
- `tests/population.test.ts` (new, 228 lines, 9 `it` blocks): dormancy radius and refresh cadence, dormant humans untouched, respawn delay, distance, and cap logic, captured and infected budgets, legacy zero budgets, seed determinism, and a 3-sim-minute bounded run.
- `tests/civilianChase.test.ts`: exists, 3 tests, not modified in this session (git shows no diff).

## Remaining Work

These brief items were not verified by reading the code or the test results. Treat them as unconfirmed until a follow-up run checks them.

1. Confirm `tests/civilianChase.test.ts` covers brief item 6, the civilian chase rule (zombies stop chasing a civilian lost from sight for 2 s). Add tests if missing.
2. Confirm the todo #8 civilian flee behaviour (leaving `homeArea` while fleeing) and its test, if one is wanted.
3. Confirm the `'patrol'` reinforcement behaviour for T009 squads: they path to `waypoints` (spawn point, then stronghold center) and engage on the way. No explicit test was seen for this.
4. Confirm the `retreat` bounds check for `'stronghold'` posts under a real layout, and that legacy `'barricade'` numbers are unchanged.
5. Run `npx tsc --noEmit` and `npm test` again after any further edits.
6. Append the Memory Notes below to `.agent-context/MEMORY.md`. This was not done.

## Public Interfaces/Exports Added

- `src/systems/PopulationSystem.ts`: `updatePopulation(ctx: SimContext, dt: number): void`. Its exact signature was not checked against the stub.
- No changes to `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, or `src/content/**`.

## Verification Run

- `npx tsc --noEmit`: pass (exit 0).
- `npx vitest run`: pass, 35 files, 367 tests (exit 0). This includes the partially written `tests/ai.test.ts` and `tests/population.test.ts`.
- Other workers' files were mid-edit during the run (`ConquestSystem`, `RespawnSystem`, `HordeSystem`, `StructureSystem`, and several new tests). No failures were reported at the time of this run.

## Memory Notes

- Police share the soldier code path, except that `aimDelay` gates the first shot. `BALANCE.police` controls HP, range, and damage.
- `PopulationSystem` budgets are per district and driven by `layout.districts[].civilianBudget` / `ambientBudget`. A legacy layout with zero budgets must not respawn anything.
- Respawns must spend no `ctx.newId()` on failed attempts, so the id sequence stays deterministic.
- Pruning of human corpses excludes ids in `m.pending` (pending conversion). Do not remove a pending conversion.
