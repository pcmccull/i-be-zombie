# R4d — Sim fixes, tuning & docs (orchestrator)

Status: COMPLETED — tsc 0; 207/207 tests.

## Completed Work

| R4a # | Fix | Files |
|---|---|---|
| 1 (P2) | Catch-up floor: beyond `catchUpDistance`, speed = max(personal × catchUpMultiplier, leaderWalk × momentum × `catchUpLeaderMargin` 1.12) | balance.ts, HordeSystem.ts; test r4d.test.ts |
| 2 | No zero-amount `momentumGain` at 100 (idle still resets) | MomentumSystem.ts; momentum.test.ts |
| 3 | Pulse: single candidate pass (≤1 segmentBlocked per candidate) + selection over short list | HordeSystem.ts |
| 4 | `smallest` closure hoisted to `smallestGroup()` | HordeSystem.ts |
| 5 | Structure succession skips targets already selected | HordeSystem.ts (`isSelected`) |
| 6 | No drift replans while effective target is a structure | NavigationSystem.ts |
| 7 | Opening test asserts all 4 landmarks opened + ≤60 at 60 s; same-step multi-hit destroy-once test; momentum clamp event check | opening/r4d/momentum tests |

Opening autopilot fix: the route now orders the horde onto the barricade police (previously the leader walked past them; after fix #1 the tighter horde no longer auto-engaged by accident and the leader died). This matches "reasonably effective play".

Tuning: momentum `graceTime` 5→8, `decayPerSecond` 3→1.5 (sweep 8/1.5, 8/1, 10/1.5 on autopilot; chosen curve reaches GROWING ~40 s, FULL ~70 s).
Result: followers 38/49/71 at 30/60/90 s (was 38/69/70), all landmarks opened, no defeat.

Test fixups (intentional behaviour change, not weakening): cascade regroup + momentum-integration boost tests now compute expected speeds with the catch-up floor / place the boost probe inside catch-up range.

Docs: README (what's new, controls, step order, design decisions, tuning, tests, limitations), AGENTS.md drift (cameraMath, initial-state counts, tower climb, armL/R).

## Remaining Work

- Merge R4d-visual (agy) patch; full tsc/test/build; R4c browser playthrough with pane visible.
- R4b magic-numbers list (P3) left as-is: values are pre-existing local steering constants; not gameplay tuning knobs.
