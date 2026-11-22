# HH-T001 — orchestrator

- **Task ID & Agent:** HH-T001, orchestrator
- **Status:** COMPLETED

## Completed Work
- `src/core/types.ts`: `AlphaDamageSource`, `LastBrainState`, `HordeHealthState`, `GameState.horde`, `PlayerSave.alphaCoreDamage?`,
  events `hordeStrengthChanged`, `sharedDamage`, `lastBrainStart`, `lastBrainEnd`, `hordeCritical` (exact shapes ARCHITECTURE §HH-1).
- `src/config/balance.ts`: `BALANCE.hordeHealth` (§HH-1 numbers).
- `src/sim/createInitialState.ts`: `horde` default (core full, strength = maxStrength = alphaCore, telemetry 0).
- `src/systems/CombatSystem.ts`: `damageLeader(ctx, amount, _source: AlphaDamageSource = 'bullet')` (param unused until T003);
  new exported `killLeader(ctx)` = the single death path (idempotent; `damageLeader` calls it at hp 0). Behaviour unchanged.
- Mechanical `X.alive && X.hp > 0` → `X.alive` / `!X.alive || X.hp <= 0` → `!X.alive` in ZombieLeader, Awareness, Combat,
  Conquest, HumanAI, nests, NestTravel, Population, Progression, Traffic, Victory, EntityRenderer, VisionFog.
- Tests that faked death with `hp = 0`: progression (now `alive = false`, one fewer denied event), vision (`alive = false`), rush.

## Remaining `leader.hp` uses (owned downstream)
- T003: `ZombieLeader.createLeader` (hp init), `CombatSystem.damageLeader` body, `RespawnSystem` 35, `ShopSystem` 51–59,
  `CityActivityDirector` 492–493; tests expandIntegration 96, followup 41/47, openWorld 172.
- T005: `HUD.ts` 961/970, `hudModel.ts` 35–36/340, `HealthBars.ts` 74–78, `tests/hudModel.test.ts`.

## Public Interfaces/Exports Added
`killLeader(ctx)` (CombatSystem); types + balance above.

## Verification Run
- Baseline before edits: `npx tsc --noEmit` 0 errors; `npx vitest run` 75 files / 827 tests passed.
- After: `npx tsc --noEmit` 0 errors outside VP2 Wave A in-progress files (`src/graphics/{geometry,buildings,...}` — concurrent session).
- `npx vitest run`: 853 passed, 3 failed — all in VP2 in-progress tests (`buildingPlan`, `meshUtils`), none HH.

## Memory Notes
- A VP2 orchestrator session runs Wave A in this folder at the same time (locks: `src/graphics/**` new files,
  `visuals/{zombieAnimation,zombieProfiles}.ts`, `tests/{zombieAnimation,characterClips,humanoidRig,bodyMesh,buildingPlan,meshUtils}`).
  Full tsc/test runs include its in-progress errors; judge HH work by filtering those paths.
