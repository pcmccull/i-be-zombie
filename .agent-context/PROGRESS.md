# Master Implementation Progress

Spec: `docs/2_intial_recruitment_design.md`. Briefs: `docs/briefs/R*.md`. Conventions: `AGENTS.md`.

## Active Milestone: R4 — Review, audit & playtest

## Provider Availability

| Agent | Status | Notes |
| :--- | :--- | :--- |
| `@codex-worker` | **UNAVAILABLE (QUOTA_EXHAUSTED)** for the rest of this session | Hit usage limit during R2 (~157k tokens, 2026-11-14 ~08:40; provider says retry 11:26). Per failover policy: fallback → `@claude-worker` (or `@agy-worker`). |
| `@agy-worker` | Available | Headless needs `"toolPermission": "always-proceed"` (set by user). R1 first attempts were permission-blocked → R1 reassigned to codex. |
| `@claude-worker` | Available | Fallback for codex tasks. |

## Task Queue & File Locks

| Task ID | Description | Assigned Agent | Locked Files | Status | Report Path |
| :--- | :--- | :--- | :--- | :--- | :--- |
| R0 | Contracts, balance, AGENTS.md plan | orchestrator | `src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, `AGENTS.md` | VERIFIED | — (inline) |
| R1 | Layout & initial-state scaffolding | ~~agy~~ (permission-blocked) → codex | `src/world/districtLayout.ts`, `src/entities/*`, `src/sim/createInitialState.ts`, `tests/layout.test.ts` + fixture fixes | VERIFIED (tsc 0, 179/179) | — (predates reports dir; summary in transcript) |
| R2a | MomentumSystem + unit tests | orchestrator | `src/systems/MomentumSystem.ts`, `tests/momentum.test.ts` | VERIFIED (7/7) | — |
| R2 | Sim systems (cascade, structures, momentum wiring, civilians, victory) | codex → **QUOTA_EXHAUSTED** → orchestrator finished Remaining Work | `src/systems/*` (except Momentum), `src/sim/Simulation.ts`, `src/entities/ZombieLeader.ts`, `tests/{cascade,structures,opening,momentum-integration,r2-fixtures}.ts` + existing test edits | VERIFIED (tsc 0, 205/205) | `reports/R2-codex.md` (written retroactively) |
| R3 | Visuals, HUD, audio, input wiring, Landmarks | agy (worktree `../i-be-zombie-r3`, branch `r3-visuals`) | `src/world/Landmarks.ts`, `src/visuals/*`, `src/ui/*`, `src/audio/AudioSystem.ts`, `src/core/{Game,InputController}.ts`, `src/world/CityDistrict.ts` | VERIFIED (merged as patch; tsc 0, 205/205, build ok) | — (transcript) |
| R4a | Adversarial logic review (read-only) | ~~codex~~ (unavailable) → claude-worker | none (read-only) | VERIFIED (no P1; 1 P2 + P3s) | `reports/R4a-claude.md` |
| R4b | Spec & cross-file audit (read-only) | agy (`--mode=plan`) | none (read-only) | VERIFIED (3 P2 visual/docs + P3s) | `reports/R4b-agy.md` |
| R4c | Browser playthrough | orchestrator | none | PENDING | `reports/R4c-orchestrator.md` |
| R4d-sim | R4a fixes, pacing/momentum tuning, README, AGENTS.md drift | orchestrator | src/systems/{Horde,Navigation,Momentum}System.ts, balance.ts, tests/{opening,r4d,momentum,cascade,momentum-integration}, README.md, AGENTS.md | VERIFIED (tsc 0, 207/207) | `reports/R4d-sim-orchestrator.md` |
| R4d-visual | Landmarks restart reset, checkpoint wall coupling, Effects.reset markers, HUD alley objective | agy (worktree `../i-be-zombie-r3`, base d00611d) | src/world/{Landmarks,Checkpoint}.ts, src/core/Game.ts, src/visuals/Effects.ts, src/ui/{HUD.ts,hud.css} | IN_PROGRESS | `reports/R4d-visual-agy.md` |
