# Master Implementation Progress

Spec: `docs/todos.md` items 7–9. Contracts: `.agent-context/ARCHITECTURE.md` §TD-0…TD-4. Conventions: `AGENTS.md`.
Branch `open-world` (HEAD 572d264). Previous milestone OW: complete (archived below).

## Active Milestone: TD — Todos 7–9 (mobile controls, capacity notice, purchasable slots). **COMPLETE** (all tasks VERIFIED; final verdict PASS — reports/FINAL-VERIFICATION.md). Not committed.

Wave A (16:50): tsc 0, 443/444 (only navScale perf flake under load; passes alone). Baseline (2026-11-14 15:50): tsc 0 errors, `npm test` 40 files / 415 tests passing (before and after TD-T001 contract code).

## Provider Availability (checked 2026-11-14 15:43)

| Agent | Status | Notes |
| :--- | :--- | :--- |
| `@codex-worker` | **UNAVAILABLE until ~16:29** | Usage limit hit 11:55 ("retry 4:29 PM"). Re-probe once before T002/T003; if still exhausted → `@claude-worker`. |
| `@agy-worker` / `@agy-architect` | **UNAVAILABLE (QUOTA_EXHAUSTED)** | 429 individual quota ~12:10, resets in ~154 h. T004/T005/V1 → `@claude-worker`. |
| `@claude-worker` | Available (hit 5-hour limit ~16:05, reset 16:20; T003/T004 resumed via SendMessage 16:36 with partial edits kept) | Fallback for everything. |
| `@meta-worker` | **Not installed** | No `.claude/agents/meta-worker.md` exists; overflow goes to `@claude-worker`. |

## Task Queue & File Locks

Waves run in order; tasks inside a wave have disjoint locks and may run concurrently (≤ 3 writers at once).
Every task ends with `npx tsc --noEmit` + `npm test` green and a report at `.agent-context/reports/<TASK_ID>-<agent>.md`.
Task ids are prefixed `TD-` in reports (`reports/TD-T002-codex.md`) so they don't collide with the OW reports.

| Task | Wave | Discipline | Description | Assigned Worker (fallback) | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TD-T001 | 0 | Architecture / contracts | Contract code exactly as ARCHITECTURE §TD-2: types (`slotsOwned`, `atCapacity`, `buySlot`, `slotPurchased`, WorldSave `slotsOwned`), contracts (`maxSlots`, doc block), balance (`slotCosts`, `capNoticeRearm`, `touch.*`, save v2), createInitialState defaults; must compile with no behaviour change | orchestrator | `src/core/{types,contracts}.ts`, `src/config/balance.ts`, `src/sim/createInitialState.ts` (defaults only), `src/persistence/saveSchema.ts` (compile shim only: write `slotsOwned`, accept v1+v2) | — | VERIFIED (tsc 0, 415/415; shims: saveSchema MIGRATIONS[1] version bump + slotsOwned passthrough, InputController `buySlot:false`) |
| TD-T002 | A | Logic / simulation | #8 sim side: `atCapacity` latch + `capNoticeRearm`, single `capReached` per entry, `capReachedFlash` on transition only, skip passive/rally recruit scans at cap, pulses consumed at cap; invariants TD-4 #1–3 | `@codex-worker` (→ `@claude-worker`) | `src/systems/HordeSystem.ts`, `tests/{capacity,cascade,hordeCommands,recruitment}.test.ts` | T001 | VERIFIED (claude; diff reviewed; capacity 3 tests + 49/49 horde-area; full suite re-run after wave A) |
| TD-T003 | A | Logic / simulation + schema | #9 sim side: `ownedSlotCount`, `nextSlotCost`, `buySlot`, unlock grants first slot, equip/activate respect `slotsOwned`, `input.buySlot`; save v1→v2 migration; fix tests that assumed 4 free slots; invariants TD-4 #4–8 | `@codex-worker` (→ `@claude-worker`) | `src/systems/ProgressionSystem.ts`, `src/persistence/saveSchema.ts`, `tests/{progression,slots,persistence,rush,openWorld,followup,alphaCombat,respawn}.test.ts` | T001 | VERIFIED (claude; diff reviewed; slots 10 tests; 443/444 under load, capacity flake to re-check; V2 note: malformed v2 save with slotsOwned 0 drops equipped before reconcile) |
| TD-T004 | A | Coding (UI/HUD) | #8 HUD side: toast dedupe (same visible text ⇒ restart its timer, no new node). #9 HUD side: slot strip shows only owned slots (hidden at 0), `abilitySlotView` + `visibleSlotCount`, nest panel shows owned slots + "Buy slot — N BIO" button (`onBuySlot`), `slotPurchased` toast, `maxSlots` deny text | `@agy-worker` (→ `@claude-worker`) | `src/ui/{HUD,NestPanel,uiHelpers}.ts`, `src/ui/hudOpenWorld.css`, `tests/uiHelpers.test.ts` | T001 | VERIFIED (claude; uiHelpers 12/12, build OK; decision: no 0-slot nest hint, tracker already points at the checkpoint) |
| TD-T005 | A | Coding (UI) + math | #7 touch overlay: `src/core/touchMath.ts` pure helpers, `TouchControls` DOM (left stick, ATTACK, RALLY, FOLLOW, owned ability buttons, MAP, PAUSE, RECENTER), `touch.css` (safe areas, ≥ 48 px targets), tests | `@agy-worker` (→ `@claude-worker`) | `src/core/touchMath.ts` (new), `src/ui/TouchControls.ts` (new), `src/ui/touch.css` (new), `tests/touchMath.test.ts` (new) | T001 | VERIFIED (orchestrator; touchMath 10/10; DOM verified in T007) |
| TD-T006 | B | Integration / glue | Wire everything: InputController touch pointers (tap ⇒ horde order, 1-finger orbit, pinch zoom, ignore touches on controls, `setTouchSource`/`queue*`), Game creates TouchControls on coarse pointer or first touch, feeds `setSlots`, wires `onBuySlot` → `SimInput.buySlot`, DPR 1.0 on touch; index.html viewport (`viewport-fit=cover`, no user zoom); README controls; input tests | `@claude-worker` | `src/core/{InputController,Game,cameraMath}.ts`, `index.html`, `README.md`, `tests/input.test.ts` | T002–T005 | VERIFIED (claude; diff reviewed; 446/446 + build; gestures untested until T007) |
| TD-T007 | C | Playtest / tuning | Browser pass in the built-in browser: desktop (cap toast appears once, slots hidden→1→buy at nest) and mobile emulation 375×812 (stick, tap orders, pinch, buttons, layout overlap); small fixes by file owner; tick docs/todos.md 7–9 | orchestrator | `docs/todos.md`, `src/config/balance.ts` (tuning) + owner-file fixes | T006 | VERIFIED (desktop + 375x812 emulation; phone-layout fix in touch.css; todos 7-9 ticked) |
| TD-V1 | D | Spec audit (read-only) | Audit against docs/todos.md 7–9 + ARCHITECTURE §TD (missing requirements, broken UI bindings) | `@agy-architect` (→ `@claude-worker` read-only) | none | T007 | VERIFIED (1 P1: world map uncloseable on touch; 4 P2; 1 P3 → F1) |
| TD-V2 | D | Adversarial review (read-only) | Bugs/edge cases: latch flapping, slot migration, multi-touch pointer bookkeeping, listener leaks on dispose | `@codex-worker` read-only (→ `@claude-worker`) | none | T007 | VERIFIED (codex available again; no P1; 3 P2 + 8 P3 → F1) |
| TD-F1 | D | Fixes | V1/V2 findings, routed to the owning files' worker | `@claude-worker` | per finding | V1, V2 | VERIFIED (F1a claude 11 items, 449/449 + build; F1b orchestrator save fixes 22/22; browser: map × closes on touch, taps near Alpha now order, drag-back no tap, stick resets on blur) |
| TD-V3 | E | Final verification | Full `npx tsc --noEmit`, `npm test` ×2, `npm run build`, write `reports/FINAL-VERIFICATION.md` | `@claude-worker` | `.agent-context/reports/FINAL-VERIFICATION.md` | F1 | VERIFIED (PASS: tsc 0, 449/449 x2, build OK — reports/FINAL-VERIFICATION.md) |

### Dependency & lock review (Phase 1 step 3)

- **Contract first:** T001 is the only task touching `types/contracts/balance`; every Wave A task reads them and none edits them.
  Contract gaps found by a worker are reported back, not patched (AGENTS.md).
- **Wave A locks are disjoint.** Checked overlaps: `saveSchema.ts` belongs to T003 only (T001 only adds a compile shim before
  Wave A starts). `tests/hordeCommands.test.ts` uses both capReached and `unlockAbility`, so it is locked to T002; it unlocks a
  single ability, which still lands in slot 0 under T003's rules, so T003 should not need it (if it does, T003 reports and T002/claude fixes it).
  `uiHelpers.ts` (T004) and `touchMath.ts` (T005) are separate files; T005 builds `setSlots` input from a plain view array so
  it does not import T004's new helper.
- **Game.ts / InputController.ts / index.html are only touched in T006**, after T004 (`onBuySlot`) and T005 (`TouchControls`) exist,
  so no UI worker edits glue.
- **Cross-discipline dependencies:** HUD slot visibility (T004) and touch ability buttons (T005/T006) both read `slotsOwned`
  from the T001 contract, not from T003's code, so they can run alongside T003. Real behaviour is only end-to-end after T006,
  which is why the browser pass (T007) comes before the audits.
- **Writers at once:** realistically all of Wave A falls back to `@claude-worker` today (codex until ~16:29, agy for days).
  Run at most 3 at once: T002 + T003 + T004 first, then T005 (or T005 instead of T002 if codex comes back for T002/T003).
- **Commit points:** orchestrator `git add -A` after each verified wave (baseline trick in MEMORY); commits only with the user's OK.

---

# Archive: Open World milestone (OW) board

Spec: `docs/3_open_world.md`. Architecture/contracts: `.agent-context/ARCHITECTURE.md`. Conventions: `AGENTS.md`.
Previous milestone (recruitment overhaul R0–R4): complete, committed (1eee817, fec178f, 1f274d1).

## Active Milestone: OW — Open World. **COMPLETE** (all tasks VERIFIED; final verdict PASS — reports/FINAL-VERIFICATION.md). Not merged to master.

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
| T015 | E | ~~Remove rush/victory/checkpoint fields~~ **descoped**: they stay as the isolated legacy-district test fixture (gated by `layout.strongholds.length === 0`; ~25 files, no player value). Docs: README controls + 10-min demo path, AGENTS.md/ARCHITECTURE drift | orchestrator | contract files, `README.md`, `AGENTS.md` | T014 | VERIFIED (README/AGENTS.md updated; see reports/T016-orchestrator.md) |
| T016 | E | Browser playthrough + tuning (spec Gate 4) | orchestrator | `src/config/balance.ts` + small fixes by owner | T015 | VERIFIED (browser: boot, districts, LMB, pen breach, capture, death/respawn, reload; 3 fixes) |
| V1 | F | Spec completeness audit (read-only, plan mode) | ~~agy~~ → claude-worker (read-only) | none | T016 | VERIFIED (no P1; P2: yard capture untested e2e, capturedPatrolFactor dead, thin browser/perf evidence) |
| V2 | F | Adversarial bug/edge-case review (read-only) | ~~codex~~ → claude-worker (read-only) | none | T016 | VERIFIED (no P1; 3 P2 → F1) |
| F1 | F | V1/V2 fixes: conversion cap 40, dead Alpha can't use abilities, contested status after load, yard capture e2e test, capturedPatrolFactor, cheap P3s | claude-worker | `src/systems/{Conversion,Progression,Conquest,Population,Horde}System.ts`, `src/persistence/*`, `src/visuals/EntityRenderer.ts`, tests for those | V1, V2 | VERIFIED (410/410; yard capture e2e passes; 7 regression tests) |
| V3 | F | Full build + test run, `reports/FINAL-VERIFICATION.md` | claude-worker | `reports/FINAL-VERIFICATION.md` | V1, V2 fixes | VERIFIED (PASS: tsc 0, 410/410 x2, build OK, clean-HEAD 410/410) |
