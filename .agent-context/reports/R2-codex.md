# R2 — codex report (written retroactively by the orchestrator)

Status: QUOTA_EXHAUSTED

Codex exited with "You've hit your usage limit ... try again at 11:26 AM" after ~157k tokens, before writing its own report.

## Completed Work (by codex, verified by orchestrator)

- `src/systems/StructureSystem.ts` (new): findStructure, damageStructure (damage + structureDamaged events, destroy once, collider off, both nav grids rebuilt, release with burst path, `released` only when count > 0, defensive momentum), updateStructures, isReleaseBurst.
- `src/systems/HordeSystem.ts`: generations + scheduleRecruitPulse, pulses (hash query, closest-first, maxRecruitsPerPulse, move-LOS), LOS for leader/rally recruitment, held exclusion, momentum radius/speed multipliers, recruit boost, regroup via follow field, structure engagement, structure → sheltered-human succession, released-zombie wander honouring wanderTarget.
- `src/systems/{CombatSystem,NavigationSystem,HumanAISystem,ConversionSystem,VictorySystem}.ts`, `src/sim/Simulation.ts`, `src/entities/ZombieLeader.ts`: structure targets/melee, shelter redirect, civilians (flee/homeArea, no shooting), barricade range, guardAlert role, convert pulse at rise end, checkpoint-only victory, step order 9b.
- Tests: `tests/{cascade,structures,opening,momentum-integration}.test.ts`, `tests/r2-fixtures.ts`, additions to ai/conversion/horde/victory tests.

## Remaining Work (completed by orchestrator as fallback)

- Fix `tests/cascade.test.ts` regroup bound (ignored the 12 m/s² velocity ramp) — done, bound derived from speeds.
- `tests/opening.test.ts` timed out (10 s) under full parallel suite load; raised to 30 s (not a perf test; stress test covers perf) — done.
- Verification: tsc 0 errors; 205/205 tests; opening autopilot 38/69/70 followers at 30/60/90 s, first 30 at 23.15 s.

## Notes for downstream

- Pacing overshoots spec (69 at 60 s vs 30–50) and momentum decays to 0 within ~10 s early → R4d tuning.
