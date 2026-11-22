# HH-F1 — orchestrator

- **Task ID & Agent:** HH-F1, orchestrator (small fixes; codex exhausted, so done directly)
- **Status:** COMPLETED

## Completed Work (findings from reports/HH-V1-agy-worker.md and reports/HH-V2-claude-worker.md)
| Finding | Fix |
|---|---|
| V1 #1 blocker: save with empty core loads into Last Brain | `saveSchema.applySave`: `coreDamage = min(alphaCore − 1, sanitized)`; test in hordeStrength + persistence expectation updated |
| V2 #1 risk: guard target thrash resets the aim timer (MG fired 0 shots in 10 s) | `HumanAISystem.perceive`: switch away from a visible target only when the new threat is ≥ `TARGET_SWITCH_MARGIN` (1.5 m) nearer; test in shielding |
| V1 #4 / V2 #2: no endpoint exclusion in `findShotInterceptor` | ignore bodies behind the shooter / beyond the Alpha and bodies first touched inside the Alpha's radius; test + doc (§HH-0 Shielding row) |
| V1 #2 / V2 #3: Last Brain re-entry overwrote recovery grace | `graceLeft = max(graceLeft, entryGrace)` |
| V2 #4: no hit flash while shielded | `damageLeader` sets `hitFlash` before the shield check |
| V1 #3 entry grace, #7 heal recovery, #9 direction, V2 #5 over-cap, #6 critical vs cap, V1 #5 source unused | kept by design, documented in ARCHITECTURE §HH-0b |
| V1 #8 automated leader.hp guard | not added as a source scan (no node types in tsconfig); the type removal (`LeaderState` omits hp/maxHp) makes any use a compile error |
| V1 #6 recipients array per hit, #10 recompute, V2 #7 first-step telemetry | accepted (event payload; trivial cost; legacy-only cosmetic) |

Tests adjusted for the intended behaviour change: shielding "elevated shot … descends" (follower moved off the Alpha's body),
"switches from the Alpha" (Alpha clearly nearer), persistence clamp (999 ⇒ alphaCore − 1).

## Verification Run
- `npx tsc --noEmit`: no errors in HH files (remaining errors only in concurrent VP2 in-progress files, if any).
- shielding + hordeStrength + persistence: 71/71; ai: 28/28 alone (full-suite timeout flake at ai.test.ts:395 is load-related, noted by V1).

## Memory Notes
- Guards keep a visible target unless a new threat is 1.5 m nearer; tests that expect a switch must make the new target clearly nearer.
- Loads clamp coreDamage to alphaCore − 1.
