# R4a — Adversarial logic review (claude-worker, read-only; fallback for codex)

Status: COMPLETED — no P1. tsc 0; 205/205 tests. Probes: scratchpad `r4a/p1–p6.test.ts` (outside repo).

## Findings (ranked) → triage

| # | Sev | Where | Finding | Triage |
|---|---|---|---|---|
| 1 | P2 | HordeSystem.ts:477, balance `catchUpMultiplier` | Catch-up speed 3.7×scale×1.35 ≤ leader walk 5.0 for speedScale ≤ 1.0 → stragglers never catch a continuously walking leader (§6). | FIX R4d: catch-up = max(personal×catchUp, leaderWalk×momentum×margin) beyond catchUpDistance |
| 2 | P3 | MomentumSystem.ts:61-66 | `momentumGain` emitted with amount 0 at 100. | FIX: skip emit when 0 (still reset idle/flash) + test |
| 3 | P3 | HordeSystem.ts:448-461 | Pulse rescans neighbours ≤8× with segmentBlocked each → ~6–21 ms spike for 60 simultaneous pulses. | FIX: single candidate pass, cached LOS |
| 4 | P3 | HordeSystem.ts:162 | `smallest` closure per step while squads exist. | FIX if trivial |
| 5 | P3 | HordeSystem.ts:251-258 | Structure succession may duplicate an existing selected target. | FIX: skip duplicates |
| 6 | P3 | NavigationSystem.ts:119-163 | Sheltered moving civilian forces structure field rebuilds at 5 Hz. | FIX: no drift replan when effective target is a structure |
| 7 | P3 | tests | opening test only asserts bus; no same-step multi-hit destroy test; momentum clamp doesn't check event; crawl relaxation of "never inside collider" lacks a non-crawlable assertion. | FIX: strengthen tests |

## Looked at, found nothing

Invariants (5-seed 400 s fuzz), cascade termination/determinism, structure destroy-once/release/exit/reset, momentum call sites & freeze,
civilians (no shots, homeArea, no collider overlap), alert-assist chaining, victory/defeat, nav replan rate, event shapes, Game seam/restart.
