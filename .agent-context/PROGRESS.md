# Master Implementation Progress

Spec: `docs/3_open_world.md`. Architecture/contracts: `.agent-context/ARCHITECTURE.md`. Conventions: `AGENTS.md`.
Previous milestone (recruitment overhaul R0–R4): complete, committed (1eee817, fec178f, 1f274d1).

## Active Milestone: OW — Open World. T001 VERIFIED + committed on branch `open-world`; Wave A next.

Baseline (2026-11-14 10:31): `npx tsc --noEmit` 0 errors, `npm test` 25 files / 216 tests passing.

## Provider Availability

| Agent | Status | Notes |
| :--- | :--- | :--- |
| `@codex-worker` | **UNAVAILABLE (QUOTA_EXHAUSTED)** | Hit usage limit during T009 (2026-11-14 ~11:55; provider: retry 4:29 PM). Fallback → `@claude-worker`. |
| `@agy-worker` | **UNAVAILABLE (QUOTA_EXHAUSTED)** | 429 individual quota during T010/T011 (~12:10; resets in ~154 h). T010/T011/T013/V1 → `@claude-worker`. |
| `@claude-worker` | Available | Fallback for codex and agy. |

## Task Queue & File Locks

Waves run in order. Tasks inside a wave have disjoint locks and may run concurrently (≤ 3 writers at once).
Every task ends with `npx tsc --noEmit` + `npm test` green and a report at `.agent-context/reports/<TASK_ID>-<agent>.md`.

| Task | Wave | Description | Agent | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| T001 | 0 | Compiling contract skeleton: types/contracts/balance, content data (abilities, strongholds, districts), stub systems, legacy layout rename + test imports, AGENTS.md rewrite | orchestrator | `src/core/{types,contracts}.ts`, `src/config/balance.ts`, `src/content/**`, `AGENTS.md`, `src/world/legacyDistrictLayout.ts` (moved), stub files `src/systems/{Progression,Conquest,Respawn,Population}System.ts`, `src/persistence/*.ts` (stubs), `src/sim/createInitialState.ts` (default fields only), test import lines | — | VERIFIED (tsc 0; 210/210 on staged snapshot) |
| T002 | A | World layout: 4 contiguous districts, roads, landmarks, strongholds, nests, spawn budgets; `worldQueries.ts` (getDistrictAt, chunks, ChunkStreamer) | codex | `src/world/districtLayout.ts`, `src/world/layout/**`, `src/world/worldQueries.ts`, `tests/{layout,world}.test.ts` | T001 | VERIFIED (snapshot tsc 0, 260/260; structure ids 1 bus,2 alley,3 store,4 pen,5 station,6 mall) |
| T003 | A | Nav at world scale: bounded flow fields, NavigationSystem catch-up/teleport for far offscreen followers, perf test | codex | `src/world/{NavigationGrid,CollisionWorld}.ts`, `src/systems/NavigationSystem.ts`, `tests/{navigation,fixes-nav,navScale}.test.ts` | T001 | VERIFIED (bounded fields 5.5 ms avg; follow-up for T007: out-of-bound stragglers get zero steering in HordeSystem far/regroup branches) |
| T004 | A | Alpha combat: LMB attack state machine, Claws combo + stagger, hit stun, Alpha kills always infect, brute damage, frenzy attack rate | codex | `src/entities/ZombieLeader.ts`, `src/systems/{Combat,Conversion}System.ts`, `tests/{combat,conversion,movement,alphaCombat}.test.ts` | T001 | VERIFIED (snapshot tsc 0, 286/286; damageGuard gained byAlpha arg; stagger consumed by T008) |
| T005 | A | Progression: ability registry use, biomass, cooldowns, equip at nest, unlock once, Horde Frenzy, Brute Evolution | codex | `src/systems/ProgressionSystem.ts`, `src/entities/Zombie.ts`, `tests/progression.test.ts` | T001 | VERIFIED (20 tests; frenzy radius filtering is T007) |
| T006 | A | Persistence: versioned WorldSave, parse/validate/migrate, SaveStore (never throws), round-trip tests | agy (fallback claude) | `src/persistence/**`, `tests/persistence.test.ts` | T001 | VERIFIED (8 tests; agy ran headless in default mode — no auto sandbox on host) |
| T007 | B | Horde: move order, regroup, frenzy multipliers (replaces rush), 40 cap, dormant skip, brute steering | ~~codex~~ → claude-worker | `src/systems/HordeSystem.ts`, `tests/{horde,cascade,recruitment,engagement,fixes-horde,todos,r4d,opening,momentum-integration}.test.ts` | T003, T005 | VERIFIED (codex partial + claude audit; snapshot 340/340) |
| T008 | B | Humans + population: police/soldier/civilian roles, stagger, patrols/reinforcement behaviour, dormant flags, budgeted respawns, caps | ~~codex~~ → claude-worker | `src/systems/{HumanAI,Population}System.ts`, `src/entities/HumanGuard.ts`, `tests/{ai,civilianChase,population}.test.ts` | T002, T004 | VERIFIED (codex partial + claude fixes: reinforcement approachPath, todos #8 civilian half; snapshot 365/365) |
| T009 | B | Conquest + respawn: objectives, contested/capture once, unlocks, district status, alert + bounded reinforcements, nests, discovery fog; leader death/respawn | ~~codex~~ → claude-worker | `src/systems/{Conquest,Respawn,Structure}System.ts`, `tests/{conquest,discovery,respawn}.test.ts` | T002, T005 | VERIFIED (codex partial + claude audit; 34 tests; wiring in T012) |
| T010 | B | World rendering: per-chunk merged city meshes + streaming, stronghold/nest landmarks, district props, generalized gate visuals | agy | `src/world/{CityDistrict,Landmarks,Checkpoint}.ts` | T002 | VERIFIED (agy partial kept + claude fix/NestMarkers; snapshot 371/371 + build; browser check in T014) |
| T011 | B | Characters & FX: police/soldier/civilian looks, brute variant, leader attack anims, frenzy aura, claw swing, capture burst, move marker, render-radius culling | agy | `src/visuals/**` | T001 | VERIFIED (claude failover; snapshot 371/371 + build; wiring list in report for T014) |
| T012 | C | Sim integration: new step order, createInitialState from world + save, remove victory call, open-world integration tests (spec §10 items 1–12 headless) | claude-worker | `src/sim/{Simulation,createInitialState}.ts`, `src/systems/VictorySystem.ts` (delete), `tests/{victory,openWorld}.test.ts` | T002–T009 | VERIFIED (snapshot 393/393; spec §10 1-12 headless pass; opening 21 followers @30 s; t=0 reveal deferred to first step) |
| T013 | C | UI + audio: HUD (health, followers, biomass, Q/E/R/F slots, objectives, toasts, respawn overlay), minimap, world map (fog ≠ territory), pause menu, nest equip panel, debug overlay, audio cues | ~~agy~~ → claude-worker | `src/ui/**`, `src/audio/AudioSystem.ts` | T001, T011 | VERIFIED (snapshot 379/379 + build; wiring list in report for T014) |
| T014 | D | Client integration: new input model, Game wiring (save boot, autosave, pause, chunk streaming, map/HUD/FX/audio events), camera range | claude-worker | `src/core/{Game,InputController,ThirdPersonCamera}.ts`, `src/main.ts`, `index.html`, `tests/{picking,pointerLock,cameraMath}.test.ts` | T010–T013 | VERIFIED (402/402 + build; headless smoke boot/move/map/pause/save-reload OK; LMB/abilities/borders need GPU playtest in T016) |
| T015 | E | ~~Remove rush/victory/checkpoint fields~~ **descoped**: they stay as the isolated legacy-district test fixture (gated by `layout.strongholds.length === 0`; ~25 files, no player value). Docs: README controls + 10-min demo path, AGENTS.md/ARCHITECTURE drift | orchestrator | contract files, `README.md`, `AGENTS.md` | T014 | PENDING |
| T016 | E | Browser playthrough + tuning (spec Gate 4) | orchestrator | `src/config/balance.ts` + small fixes by owner | T015 | PENDING |
| V1 | F | Spec completeness audit (read-only, plan mode) | agy | none | T016 | PENDING |
| V2 | F | Adversarial bug/edge-case review (read-only) | codex | none | T016 | PENDING |
| V3 | F | Full build + test run, `reports/FINAL-VERIFICATION.md` | claude-worker | `reports/FINAL-VERIFICATION.md` | V1, V2 fixes | PENDING |
