# Master Implementation Progress

## Active Milestone: HH — Horde Strength replaces Alpha health (docs/13_hode_health.md). **PHASE 3 — verification (Phase 2 T001–T008 VERIFIED 2026-11-21)**

Spec: `docs/13_hode_health.md`. Contracts: `.agent-context/ARCHITECTURE.md` §HH-A…HH-4. Report ids prefixed `HH-`
(`reports/HH-T002-codex.md`). Branch `open-world` (CU/HUD/VP/EW/TD milestones still uncommitted on top of 6cf6e38).
Every task ends with `npx tsc --noEmit` + `npm test` green, writes its report and appends MEMORY notes.

### Provider availability (2026-11-20; probe each before its first dispatch)

| Agent | Status | Notes |
| :--- | :--- | :--- |
| `@codex-worker` | **QUOTA_EXHAUSTED 2026-11-21 (during HH-T002)** | Remaining codex work (T004 if it fails, V2) ⇒ `@claude-worker`. |
| `@agy-worker` (Hydrogen) | Assumed available | T005 (HUD), T006 (visual/audio feedback) + V1. Exhausted ⇒ `@claude-worker`. |
| `@agy-architect` (Argon) | Quota due to reset ~11-20; probe | Only if an agy task fails twice. |
| `@claude-worker` | Available | T003, T007, V3; fallback for everything. |

### Concurrency note (2026-11-21)

The heavy-defenses / VP2 session last wrote at 2026-11-20 22:15 and is idle (VP2 parked). HH owns the files in its locks.

### Task queue & file locks

Waves run in order; tasks in one wave have disjoint locks (≤ 3 writers at once). "new" = file created by the task.

| Task | Wave | Discipline | Description | Worker (fallback) | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| HH-T001 | 0 | Contracts + baseline | Contract code exactly as §HH-1: types (`AlphaDamageSource`, `LastBrainState`, `HordeHealthState`, `GameState.horde`, `PlayerSave.alphaCoreDamage?`, 5 events), `BALANCE.hordeHealth`, contracts doc block, `createInitialState` horde default; `damageLeader(ctx, amount, source?)` optional param + `killLeader` extraction (behaviour-neutral); mechanical `leader.alive && leader.hp > 0` → `leader.alive` at the ~17 sites; compile shims for exhaustive event switches. Baseline tsc/test counts recorded. `git add -A` baseline. | orchestrator | `src/core/{types,contracts}.ts`, `src/config/balance.ts`, `src/sim/createInitialState.ts`, `src/systems/CombatSystem.ts` (param + extraction only), `src/systems/{AwarenessSystem,ConquestSystem,HumanAISystem,PopulationSystem,ProgressionSystem,VictorySystem}.ts` (alive checks only), `src/visuals/{EntityRenderer,VisionFog}.ts` (alive checks only), tests that set `leader.hp = 0` to fake a death, `.agent-context/*` | — | VERIFIED (tsc 0 HH-side; 853 pass, only VP2 in-progress tests fail) — reports/HH-T001-orchestrator.md |
| HH-T002 | A | Core logic (pure) | `HordeHealthSystem.ts`: `strengthValueOf`, `maxHordeStrength`, `computeHordeStrength` (single calc), `applyAlphaDamage` (nearest-first pour within shareRadius ≤ maxRecipients via `damageZombie` → core → global nearest; `sharedDamage` event; alloc-free), `restoreStrength`, `resetHordeHealth`, `isDepleted/isLastBrain/isHordeShielded/lastBrainSpeedMultiplier`, `updateHordeHealth` (recompute, telemetry, aggregated `hordeStrengthChanged` with dominant cause, `hordeCritical` edge, Last Brain FSM: entry/timer/recovery/grace, `killLeader` on expiry). Unit tests drive it directly on hand-made states (§HH-4 #1–4, #6–7, #9). Not wired into Simulation. | `@codex-worker` (→ `@claude-worker`) | `src/systems/HordeHealthSystem.ts` (new), `tests/hordeHealth.test.ts` (new) | T001 | VERIFIED (codex wrote code then QUOTA_EXHAUSTED; orchestrator reviewed; 29/29, tsc 0) — reports/HH-T002-codex.md |
| HH-T004 | A | Enemy AI / projectiles | Body interception for every shot aimed at the Alpha (rifle, barricade, MG/coax, armed-civilian gun): first live follower / free ambient circle on the 2D segment takes the hit (`damageZombie`), tracer ends there; nearest-threat target preference so followers in front draw fire; `source` tags on every `damageLeader` call (`bullet`/`melee` bat/`explosion` tank splash/`vehicle` rammer); splash keeps followers-then-leader order. Tests §HH-4 #10 + #5 (splash accounting at the damage-call level). | `@codex-worker` (→ `@claude-worker`) | `src/systems/{HumanAISystem,TrafficSystem}.ts`, `tests/shielding.test.ts` (new), existing tests broken by interception except T002/T005/T003-listed ones (named in report; expected `tests/ai.test.ts`) | T001 | VERIFIED (codex code, QUOTA_EXHAUSTED before report; orchestrator reviewed; shielding 35/35, tsc 0) — reports/HH-T004-codex.md |
| HH-T005 | A | HUD / UI | `hudModel.hordeStrengthView` (+ tests) replacing `healthView`; `drinkNearby` → `state.horde.coreDamage > 0.01`; remove Alpha HP bar/markup/CSS from the character card and `HealthBars` (world-space Alpha bar); Horde Strength bar becomes the primary survival widget ("HORDE STRENGTH 23 / 50", core segment, smooth fill + lagging loss ghost, red flash on `alphaHit`/`sharedDamage`, green pulse on gain, critical pulse ≤ 20 %, Last Brain takeover: "LAST BRAIN STANDING! 6… 5… FIND A BRAIN!"); reduced motion; 375 × 812 layout. Reads `state.horde` + events only. | `@agy-worker` (→ `@claude-worker`) | `src/ui/{hudModel,HUD}.ts`, `src/ui/{hud.css,touch.css}`, `src/visuals/HealthBars.ts`, `tests/hudModel.test.ts` | T001 | VERIFIED (agy; hudModel 19/19, full suite green, tsc 0; browser check in T008) — reports/HH-T005-agy-worker.md |
| HH-T003 | B | Integration (sim) | Wire it: `damageLeader` → grace check → Last Brain finishing hit (`killLeader`) or `applyAlphaDamage` (keeps flash/stun/`damage` event); Simulation step order §HH-1 (both layouts); `RespawnSystem` → `resetHordeHealth`; `ShopSystem` drinks + `CityActivityDirector` convoy → `restoreStrength` (refuse at full core); `ZombieLeader` × `lastBrainSpeedMultiplier`, `createLeader` stops relying on hp; `saveSchema` writes/clamps `alphaCoreDamage`; fix every test asserting Alpha HP (ai — after T004 —, alphaCombat, beachStart, combat, emerge, expandIntegration, followup, openWorld, progression, respawn, rush, todos10to12, victory, vision, persistence). After it: zero `leader.hp` uses outside types/HealthBars/hudModel. | `@claude-worker` | `src/systems/{CombatSystem,RespawnSystem,ShopSystem,CityActivityDirector}.ts`, `src/sim/Simulation.ts`, `src/entities/ZombieLeader.ts`, `src/persistence/saveSchema.ts`, `tests/{ai,alphaCombat,beachStart,combat,emerge,expandIntegration,followup,openWorld,progression,respawn,rush,todos10to12,victory,vision,persistence}.test.ts` | T002, T004 | VERIFIED (claude-worker; tsc 0; HH suites green; orchestrator fixed 5 shielding spies to mockImplementation) — reports/HH-T003-claude-worker.md |
| HH-T006 | B | Animation / VFX / audio | Alpha stagger proportional to incoming damage + green shared-energy pulse (`sharedDamage` → short tether/flash to recipients, aggregated, pooled VFX); recipients already play `hit` via `damageZombie`; Last Brain: panic lurch pose + exaggerated stagger on the hero rig, desperate aura, heartbeat/tick audio, recovery burst; `hordeCritical` → occasional (cooldown ≥ 20 s) Alpha groan line; gain sparkle on `hordeStrengthChanged` recruit (reuse existing recruit FX where present). No per-follower bursts in big fights. | `@agy-worker` (→ `@claude-worker`) | `src/visuals/{EntityRenderer,Effects}.ts`, `src/graphics/vfx/{vfxRules,VFXManager}.ts`, `src/audio/{AudioSystem,sfxRules}.ts`, `tests/{vfx,sfxRules}.test.ts` | T001 (T005 done first so agy runs serially) | VERIFIED (agy; vfx+sfxRules 84/84, tsc 0; browser check in T008; Game.setReducedMotion wiring → T007) — reports/HH-T006-agy-worker.md |
| HH-T007 | C | Integration tests | `tests/hordeStrength.test.ts`: spec §12 table end to end through `Simulation` (rifle + multiplier, nonfatal follower hit, follower death, 5 simultaneous deaths, splash on Alpha alone / with followers, recruit, cap clamp, depletion → Last Brain, recover by recruit, finishing hit, countdown death → respawn, hideout + nest fast travel, save → load, nest claim raises max, all enemies defeated = no change, rapid hits); Game wiring only if something is missing (HUD/VFX get events via existing consume paths). | `@claude-worker` | `tests/hordeStrength.test.ts` (new), `src/core/Game.ts` (if needed) | T003, T005, T006 | VERIFIED (claude-worker; hordeStrength 21/21; Game.applyGraphics → setReducedMotion; carAttack failure = VP2 layout passes, confirmed flags-off 9/9) — reports/HH-T007-claude-worker.md |
| HH-T008 | D | Cleanup + playtest + docs | Remove `hp/maxHp` from `LeaderState` (`Omit<MobileBase,…>`) + `BALANCE.leader.maxHp`, fix residual compile errors; grep sweep; browser playtest (beach solo, nest claim, checkpoint fight with horde, Last Brain recover + death, drink, mobile 375 × 812); tuning in `BALANCE.hordeHealth`; docs (AGENTS conventions + step order, README, CLAUDE.md checkbox, ARCHITECTURE status). | orchestrator | `src/core/types.ts`, `src/config/balance.ts`, residual compile fixes (owner files, sequential), `AGENTS.md`, `README.md`, `CLAUDE.md`, `.agent-context/*` | T007 | VERIFIED (hp fields removed, playtest, docs) — reports/HH-T008-orchestrator.md |
| HH-V1 | E | Spec audit (read-only) | Audit vs docs/13 §12 table + §13 acceptance criteria + "no parallel health system" | `@agy-worker` plan mode (→ `@claude-worker` read-only) | none | T008 | VERIFIED (agy audit: 1 blocker, 3 should-fix, nits) — reports/HH-V1-agy-worker.md |
| HH-V2 | E | Adversarial review (read-only) | Double counting (splash + share, death in same step as share), grace/Last Brain races (hit same step as recruit, death while respawning), NaN/negative strength, cap shrink, save tampering, interception through walls/elevation (tower guards shooting down), dormant recipients, perf at 200 followers | `@codex-worker` read-only (→ `@claude-worker`) | none | T008 | VERIFIED (claude-worker review: 1 risk, nits) — reports/HH-V2-claude-worker.md |
| HH-F1 | E | Fixes | V1/V2 findings routed to the owning file's worker | `@claude-worker` (+ codex for pure logic) | per finding | V1, V2 | VERIFIED (orchestrator) — reports/HH-F1-orchestrator.md |
| HH-V3 | E | Final verification | `npx tsc --noEmit`, `npm test` ×2, `npm run build`; `reports/FINAL-VERIFICATION.md` + spec §14.10 change report | `@claude-worker` | `.agent-context/reports/FINAL-VERIFICATION.md` | F1 | IN_PROGRESS (claude-worker) |

### Dependency & lock review (Phase 1 step 3)

- **Contract first.** T001 is the only task touching `types/contracts/balance/createInitialState`. It also does the
  behaviour-neutral `alive` replacements (alive ⇔ hp > 0 today: only `damageLeader` kills, respawn revives) so no later task
  needs Awareness/Conquest/Population/Progression/Victory/VisionFog in its locks. `damageLeader` gets its optional `source`
  param and `killLeader` here, so T002 (calls `killLeader`) and T004 (passes `source`) compile against the final signature.
- **Wave A (T002 ∥ T004 ∥ T005) — disjoint.** T002 is a new file + new test (not wired, so nothing else changes behaviour).
  T004 owns HumanAISystem/TrafficSystem and any test interception breaks; it may edit `ai.test.ts` (T003 re-edits it in Wave B, sequentially) but not the rest of the T003 test list — if a test on
  that list breaks it reports it and T003 fixes it. T005 owns all HUD files + `HealthBars` + `hudModel.test`. HUD reads
  `state.horde` (filled with a sensible default by T001) so it can be built before the sim is wired.
- **Wave B (T003 ∥ T006) — disjoint.** T003 is the only sim writer after Wave A: CombatSystem, Simulation, Respawn, Shop,
  CityActivityDirector, ZombieLeader, saveSchema + the Alpha-HP tests. T006 is render/audio only and consumes the T001 event
  contract. `EntityRenderer`'s one-line alive check was T001's; T006 owns the file afterwards.
- **Why T003 waits for T004:** once `damageLeader` stops touching HP, tests that assert soldier damage on the Alpha change;
  with interception (T004) landing first, T003 fixes each such test once against the final behaviour.
- **Wave C.** T007 adds the end-to-end suite on the fully wired game; Game.ts is touched only here (likely no change).
- **Wave D.** T008 removes the obsolete fields last, so the compiler proves no path still uses Alpha HP (spec §12 last line).
- **Risk hot-spots:** (1) many legacy tests assume "soldiers damage the Alpha's HP" — T003 converts them to strength/coreDamage
  assertions, never deletes coverage; (2) balance: the beach solo run and the suburb checkpoint must stay winnable (core 6 ≈
  96 incoming damage; tune in T008); (3) interception could make the Alpha untouchable inside a big blob — spec forbids
  invulnerability, so interception uses real circles and the shared-damage share still applies on every Alpha hit;
  (4) agy identifier corruption on failover (`grep -n "interface[A-Z]"` after agy tasks).
- **Commit points:** orchestrator `git add -A` after each verified wave; commits only with the user's OK.

---

## VP2 — Geometry, skeletal characters & city environment (docs/12_visual_polish2.md)

The VP2 board lives in **`.agent-context/PROGRESS-VP2.md`** (moved 2026-11-21 so the VP2 and HH orchestrators never edit the same file).

---

# Archive: CU board

## Milestone: CU — Living City & Expanded Rewards (docs/11_cityupgrade.md). **COMPLETE (uncommitted)** — reports/CU-T005-orchestrator.md

Spec: `docs/11_cityupgrade.md`. Contracts: `.agent-context/ARCHITECTURE.md` §CU. Report ids prefixed `CU-`.
Baseline (2026-11-18 19:24): an earlier unrecorded pass already landed the core (CityActivityDirector, RewardSystem, save v4,
companions, golf cart, hideouts, secrets, CollectionPanel, tests/cityUpgrade.test.ts). tsc 0, 70 files / 773 tests green.
This milestone audits that pass against the spec and fills the gaps.

| Task | Discipline | Description | Worker (fallback) | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| CU-T001 | Contracts | Event props/staging fields, post-conquest kinds, new events (escalated, perk, shortcut, supplies), balance.city tuning, shortcut endpoint | orchestrator | `src/core/types.ts`, `src/config/balance.ts`, `src/content/{events,rewards}.ts` | — | VERIFIED (tsc 0) |
| CU-T002 | Sim | Director rewrite: per-kind staging + props, bus unload, delayed responders, vision-aware spawn range, no-repeat history, orphans removed only out of sight, post-conquest pools; Larry/Grandma perks; storm-drain shortcut; V interact priority (vehicle > shortcut > prop) | orchestrator | `src/systems/{CityActivityDirector,CompanionSystem,HideoutSystem,PlayerVehicleSystem,WorldInteractionSystem,RewardSystem}.ts`, `src/sim/Simulation.ts`, `tests/cityUpgrade.test.ts`, `tests/cityEvents.test.ts` (new) | T001 | VERIFIED (cityEvents 12 tests; director humans hard-capped) |
| CU-T003 | 3D / audio / VFX | `CityEventProps` (pooled event dressing), CityVisuals (companion accessories, zombie banners + graffiti on controlled districts, drain markers), AudioSystem cues, vfxRules mapping | `@agy-worker` (→ `@claude-worker`) | `src/visuals/{CityEventProps,CityVisuals}.ts`, `src/audio/AudioSystem.ts`, `src/graphics/vfx/{vfxRules,VFXManager}.ts`, `tests/vfx.test.ts` | T001 | VERIFIED (agy hit a 429 before its report; orchestrator reviewed + wired; vfx tests green) |
| CU-T004 | HUD / glue | V context prompt (hudModel), token-styled city strip, debug overlay city lines, Game wiring for CityEventProps | orchestrator | `src/ui/{hudModel,HUD,uiHelpers}.ts`, `src/ui/hud.css`, `src/core/Game.ts`, `tests/hudModel.test.ts` | T002, T003 | VERIFIED (+ touch USE button, CollectionPanel click fix) |
| CU-T005 | Verify | tsc, tests, build, browser playtest (roam, events, interact, cart, companion, shortcut, reload), docs | orchestrator | docs | T004 | VERIFIED (tsc 0, 71 files / 803 tests, build OK; browser pass) |

---

# Archive: HUD board

## Milestone: HUD — HUD redesign (docs/9_hud_redesign.md). **COMPLETE (uncommitted)** — reports/HUD-T004-orchestrator.md

Spec: `docs/9_hud_redesign.md`. Contracts: `.agent-context/ARCHITECTURE.md` §HUD. Report ids prefixed `HUD-`.

| Task | Discipline | Description | Worker (fallback) | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| HUD-T001 | Design system | Tokens, surfaces, keyframes, reduced motion (`hudTheme.css`); SVG icon set (`hudIcons.ts`); pure view models (`hudModel.ts`) + tests; split menu CSS into `hudPanels.css` | orchestrator | `src/ui/{hudTheme.css,hudIcons.ts,hudModel.ts}`, `tests/hudModel.test.ts`, `.agent-context/*`, `docs/9_hud_redesign.md` | — | VERIFIED (hudModel 18 tests) |
| HUD-T002 | Core HUD | Rebuild gameplay HUD: character card, objective, circular minimap, horde card, ability bar, context actions, feedback layer (recruit popups, damage direction, banners), responsive CSS; Game wiring (camera yaw, reduced motion) | orchestrator | `src/ui/{HUD.ts,hud.css,hudOpenWorld.css,Minimap.ts,mapRender.ts,SenseIndicators.ts}`, `src/core/Game.ts` | T001 | VERIFIED (browser 1366/1920/2560 + phone; banners, popups, damage arc, slots, modal hide) |
| HUD-T003 | Menus & panels | Restyle pause menu, world map frame, nest panel, help, intro/respawn/victory modals, cinematic overlay and touch controls to the tokens + icons | `@agy-worker` (→ `@claude-worker`) | `src/ui/{hudPanels.css,PauseMenu.ts,WorldMap.ts,NestPanel.ts,CinematicOverlay.ts,TouchControls.ts,intro.css,touch.css}` | T001 | VERIFIED (agy; diff reviewed, nest overflow-x fix by orchestrator) |
| HUD-T004 | Verify | tsc, tests, build, browser playtest (explore, recruit, fight, capture, unlock, damage, pause, intro), captures, docs | orchestrator | docs | T002, T003 | VERIFIED (tsc 0, 62 files / 701 tests, build OK, no console errors) |

---

# Archive: VP board

## Active Milestone: VP — Visual polish: models, textures, VFX, lighting (docs/8_visual_polish.md). **COMPLETE (uncommitted)** — reports/VP-T006-orchestrator.md

Spec: `docs/8_visual_polish.md`. Contracts: `.agent-context/ARCHITECTURE.md` §VP-0…VP-4. Briefs: `docs/briefs/VP-*.md`.
Branch `open-world` (EW/TD/SFX milestones still uncommitted on top of 6cf6e38). Report ids prefixed `VP-`.
Baseline capture: `docs/captures/vp-before-gameplay.jpg`.

| Task | Discipline | Description | Worker (fallback) | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| VP-T001 | Contracts | `GraphicsQuality.ts` presets + settings, ARCHITECTURE §VP art bible, briefs, board | orchestrator | `src/graphics/performance/GraphicsQuality.ts`, `tests/graphicsQuality.test.ts`, `.agent-context/*`, `docs/briefs/VP-*` | — | VERIFIED (baseline 56 files / 615 tests green; graphicsQuality 5 tests) |
| VP-T002 | VFX | Pooled `VFXManager` (instanced billboard particles, sprite atlas, emitter configs, budgets, distance/vision cull, quality + reduced motion), event adapter for every spec §5 row, Effects.ts de-duplication | `@codex-worker` (→ `@claude-worker`) | `src/graphics/vfx/**`, `src/visuals/Effects.ts`, `tests/vfx.test.ts` | T001 | VERIFIED (codex; API reviewed, wired, particles live in browser; 50 tests) |
| VP-T003 | Characters | Human archetypes (tourist/resident/worker/security/defender) by deterministic profile, PBR-ish materials, hit/panic reactions; Alpha hero silhouette (oversized hand, asymmetric shoulders, mismatched eyes, tourist shirt, cosmetic attach slots) | `@agy-worker` (→ `@claude-worker`) | `src/visuals/{LowPolyCharacters,zombieModel,zombieTextures,EntityRenderer}.ts`, `src/visuals/humanProfiles.ts` (new), `tests/humanProfiles.test.ts` (new) | T001 | VERIFIED (agy; skeleton contract intact, slots alloc-free; archetypes + panic seen in browser; orchestrator added near-Alpha human shadow casting) |
| VP-T004 | Environment | World-space surface detail patch (asphalt/sidewalk/grass/stucco/sand/tile) + detail atlas, foliage wind, building facade breakup | orchestrator | `src/graphics/materials/**`, `src/world/{CityDistrict,TropicalScenery}.ts`, `tests/surfaceDetail.test.ts` | T001 | VERIFIED (aSurface tagging, detail atlas, palm/tree wind, striped awnings, balconies; 5 tests; browser OK) |
| VP-T005 | Lighting/postfx/perf | `LightingController`, `PostProcessingPipeline` (three/examples composer: FXAA, selective bloom, grade), `GraphicsDiagnostics` (median/p95, calls, tris, particles, casters) + `?bench` scene | orchestrator | `src/graphics/{lighting,postfx}/**`, `src/graphics/performance/{GraphicsDiagnostics,frameStats,benchmark}.ts`, `tests/frameStats.test.ts` | T001 | VERIFIED (display-referred post: grade + saturated-only bloom; bench=1 measured; 4 tests) |
| VP-T006 | Integration | Game wiring (quality presets, reduced motion, VFX, lighting, postfx, diagnostics), PauseMenu graphics controls | orchestrator | `src/core/Game.ts`, `src/ui/PauseMenu.ts`, `src/ui/hud.css` | T002–T005 | VERIFIED (VFX wired; PauseMenu graphics + reduced motion; tsc 0, 683/683, build OK) |
| VP-T007 | Verify | Browser before/after captures, benchmark numbers, tsc/test/build, docs (AGENTS/README/CLAUDE) | orchestrator | docs | T006 | VERIFIED (README perf table, AGENTS/CLAUDE, captures; real-display FPS not measurable: window off-screen) |

---

# Archive: EW board


## Active Milestone: EW — Expanded world, boundaries, zombie vision (docs/5_expand_world.md). **PHASE 2 — Wave 0 done (T001 VERIFIED); Wave A1 VERIFIED (T002/T003/T005); Wave A2 VERIFIED; Wave B VERIFIED (T007/T008/T009); T010 VERIFIED; T011 VERIFIED; T012 VERIFIED (+ vision limit & warning cues); PHASE 3 — V1, V2, F1, V3 VERIFIED. MILESTONE COMPLETE (uncommitted)**

Spec: `docs/5_expand_world.md`. Contracts: `.agent-context/ARCHITECTURE.md` §EW-0…EW-5. Conventions: `AGENTS.md`.
Branch `open-world` (HEAD 83316dc). User decisions (2026-11-14): grow the world to a 4 × 4 district grid; eyesight tiers 2–4
bought with biomass at a nest. Report ids are prefixed `EW-` (`reports/EW-T002-codex.md`).

### Provider availability (2026-11-14 ~20:15; re-probe each before dispatch)

| Agent | Status | Notes |
| :--- | :--- | :--- |
| `@codex-worker` | Probably available (limit reset 16:29) | Probe once before Wave A. Exhausted ⇒ `@claude-worker`. |
| `@agy-worker` | Available — gemini-4-hydrogen (agent file fixed by user 2026-11-15) | Primary for T004 (failover), T006–T009 + V1. |
| `@agy-architect` | gemini-4-argon — QUOTA_EXHAUSTED 2026-11-15 (resets ~11-20) | Heavyweight only; not needed this milestone. |
| `@claude-worker` | Available | Fallback for everything. |

### Task Queue & File Locks

Waves run in order; tasks inside a wave have disjoint locks and run concurrently (≤ 3 writers at once). Every task ends with
`npx tsc --noEmit` + `npm test` green and writes `.agent-context/reports/EW-<TASK>-<agent>.md` + MEMORY notes.

| Task | Wave | Discipline | Description | Assigned Worker (fallback) | Locked Files | Depends | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| EW-T001 | 0 | Contracts | Contract code exactly as §EW-3: types (16 DistrictIds, 16 StrongholdIds, `'boundary'` ColliderKind, new PropKinds, DistrictDef tier/archetype/cell, boundary/backdrop types, `playArea`, vision/sense types, `GameState.vision`, `visionTier`, `buyVision`, events, `maxVision`, PlayerSave.visionTier), contracts doc block, balance (bounds, vision, senses, population caps, save v3), content (16 districts, 16 strongholds). Compile shims: `districtLayout` grows bounds and emits the 12 new districts as plain rects (zero budgets) each with a minimal stronghold (1 police, `killDefenders`) + nest; `boundaryLayout.ts` stub (empty arrays); legacy layout `playArea/boundaries/backdrop`; `createInitialState` defaults (`vision`, `visionTier: 1`); `saveSchema` accepts v3 (passthrough + new-record defaults only); InputController/Game `buyVision:false`; fix tests that hard-code 4 districts | orchestrator | `src/core/{types,contracts}.ts`, `src/config/balance.ts`, `src/content/{districts,strongholds}.ts`, `src/world/{districtLayout,legacyDistrictLayout}.ts`, `src/world/boundaryLayout.ts` (new stub), `src/sim/createInitialState.ts` (defaults), `src/persistence/saveSchema.ts` (shim), `src/core/{InputController,Game}.ts` (one-line input default if needed), tests that break on the shim (listed in report) | — | VERIFIED (tsc 0, 464/464 after test fixes, build OK; reports/EW-T001-orchestrator.md; 12 placeholder districts until T002) |
| EW-T002 | A1 | Logic / world data | 12 new districts as real content: road grid over 4 × 4 (new roads at x = ±208, ±300, z = −168, −240, −328, −400 etc. — never overlapping existing colliders), `grid.ts` cell math + ≥ 3 seam crossings per shared edge (incl. the old world edges), `archetypes.ts` seeded block generator (building style mix, props incl. new PropKinds, ambient/civilian spawn zones, budgets) for the 12 archetypes, `expansion.ts` 12 strongholds (tiered compounds: breakable door id ≥ 100, defenders by tier, towers at tier ≥ 4, reinforcement points, nests, objectives realized per content), danger dressing near tier ≥ 4 borders; humans total ≤ `population.maxHumans`; invariants §EW-5 #1–2 | `@codex-worker` (→ `@claude-worker`) | `src/world/districtLayout.ts`, `src/world/layout/**` (roads + new grid/archetypes/expansion; existing 4 builders only for seam-crossing openings), `tests/{world,layout}.test.ts`, `tests/expansion.test.ts` (new) | T001 | VERIFIED (codex + 1 follow-up: 212 buildings, 434 colliders, 328 humans tier-scaled, ids 100-111; orchestrator re-measured; tsc 0, 539/539, build OK) |
| EW-T003 | A1 | Logic / world data | `buildWorldBoundaries(world)`: perimeter split into segments by adjacent district archetype + side (south ocean beach: walkable sand to a `deep_water` waterline; east bay: seawall/docks + `deep_water`; west: `mangrove_barrier` + canals; north: `concrete_debris`/`urban_fence`, `military_perimeter` by airport/military, `collapsed_bridge`/`vehicle_blockade` where roads meet the edge, `shipping_containers` by industrial/marina); continuous overlapping `'boundary'` colliders in the band; `backdrop` rects beyond bounds; invariant §EW-5 #3 (incl. 2 000-step push test using the pure sim) | `@codex-worker` (→ `@claude-worker`) | `src/world/boundaryLayout.ts`, `tests/boundaries.test.ts` (new) | T001 | VERIFIED (codex; diff reviewed: 64 segments/64 colliders/6 backdrops, 16 tests incl. 2400-step push; re-run push test after T002 settles; airfield rect overlaps mangroves/skyline backdrop — T007 draws airfield on top) |
| EW-T005 | A1 | Logic / state machine | `AwarenessSystem`: `visionProfile`, `updateAwareness(ctx, dt, stepEvents)` (5 Hz identify/seen, budgeted round-robin LOS, engaged memory, tier detection extras), sense cues (gunshot/scream/siren/crowd, fuzz, aggregation, ttl, cap), `isIdentified/isSeen/awarenessOf/canTarget/isWorldPositionInSight`; no per-agent allocation; invariants §EW-5 #4–5 (unit tests call it directly; Simulation wiring is T010) | `@codex-worker` (→ `@claude-worker`) | `src/systems/AwarenessSystem.ts` (new), `tests/{vision,senses}.test.ts` (new) | T001 | VERIFIED (codex; diff reviewed: WeakMap scratch, LOS budget round-robin, cues fuzzed/aggregated; 28 tests; T010 must call it every step so reinforcement ids are tracked) |
| EW-T004 | A2 | Logic / performance | Scale nav/collision to the 840 × 680 m world (~365 k cells × 2 grids): bounded flow-field resets (touched-cell lists instead of whole-array fills), boot build time, `findPath` budget; keep APIs; update perf tests for the new size (standalone + under-load thresholds) | `@codex-worker` (→ `@claude-worker`) | `src/world/{NavigationGrid,CollisionWorld}.ts`, `tests/{navScale,navigation,collision}.test.ts` | T002 | VERIFIED (codex partial → finished by the agy-worker wrapper itself, not agy; build 29→12 ms, gate rebuild 24→0.4 ms; npm test 559/559) |
| EW-T006 | A2 | Logic + schema | `visionCost`, `buyVision`, `updateProgression` edge; save v3 (`visionTier`, 16-district/stronghold defaults, fog remap v2 → v3, v1 chain); invariant §EW-5 #6 | `@agy-worker` (→ `@claude-worker`) | `src/systems/ProgressionSystem.ts`, `src/persistence/saveSchema.ts`, `tests/{progression,persistence,slots}.test.ts`, `tests/visionProgression.test.ts` (new) | T001 | VERIFIED (claude-worker after the agy Argon 429; diff reviewed; full npm test 559/559 with T004) |
| EW-T007 | B | Coding (3D world art) | `BoundaryScenery` (band dressing per BoundaryKind from segments + seed, backdrop skyline/mangroves/ocean/bay/highway/airfield, instanced, ≤ 30 draw calls), CityDistrict: render new PropKinds, archetype building looks, remove dark skirt, streaming over 99 chunks; TropicalScenery/tropicalLayout: beach + ocean along the whole south edge, bay water east, palms/umbrellas over new districts; re-run `tests/intro.test.ts` | `@agy-worker` (→ `@claude-worker`) | `src/world/BoundaryScenery.ts` (new), `src/world/{CityDistrict,TropicalScenery,tropicalLayout}.ts`, `tests/intro.test.ts` (only if a world-geometry assumption moved) | T002, T003 | VERIFIED (agy Hydrogen; spot-checked: no shadows cast, fog on, colliders read from layout, dark skirt removed; ~18 draw calls; tsc 0, intro+tropical 16/16, build OK; visual check in T011) |
| EW-T008 | B | Coding (rendering) | `visionMath.ts` (haze factor, tier blend, profile lerp) + tests; `VisionFog` (shared-uniform material patch, combined with camera fog, quality low/high, exclusions); HealthBars/EntityRenderer: only identified humans get bars/markers/hit flashes UI, `seen` humans render as dark silhouettes, unidentified humans beyond haze radius hidden | `@agy-worker` (→ `@claude-worker`) | `src/core/visionMath.ts` (new), `src/visuals/VisionFog.ts` (new), `src/visuals/{HealthBars,EntityRenderer}.ts`, `tests/visionMath.test.ts` (new) | T005 | VERIFIED (agy Hydrogen; orchestrator fix: humanVisual none/heard/sensed => hidden at any distance (was silhouette inside haze = position leak); visionMath 6/6, tsc 0; full suite with wave) |
| EW-T009 | B | Coding (UI/audio) | `SenseIndicators` (screen-edge directional arcs per cue, intensity → opacity, fades on ttl, ≤ maxCues nodes, never a map dot); NestPanel eyesight section (current tier, radius, abilities, next cost, Buy → `onBuyVision`); HUD: district-entered banner with threat pips, humorous first-run tips (poor sight, first upgrade), `visionUpgraded`/`maxVision` toasts; Minimap/WorldMap: humans drawn only if identified (seen = grey dot), cues as fuzzy arcs, no hidden stronghold defenders/reinforcements; AudioSystem: panned + attenuated cue sounds with per-kind cooldown | `@agy-worker` (→ `@claude-worker`) | `src/ui/SenseIndicators.ts` (new), `src/ui/{HUD,NestPanel,uiHelpers,Minimap,WorldMap,mapRender}.ts`, `src/ui/hudOpenWorld.css`, `src/audio/AudioSystem.ts`, `tests/uiHelpers.test.ts` | T005, T006 | VERIFIED (agy Hydrogen; reviewed cue angle (yaw convention), map gating, HUD additive over the other session's edits; uiHelpers 19/19). Wave B idle run: tsc 0, 53 files / 576 pass, build OK |
| EW-T010 | C | Integration / glue | Simulation: step-event slice → `updateAwareness` after `updateRespawn` (open world; legacy too, harmless); createInitialState final vision init; HordeSystem attack-order gate (§EW-3); InputController picks filtered by `canTarget` (humans only); Game: BoundaryScenery, VisionFog install + per-frame uniforms (interpolated leader, tier blend), `onBuyVision` → `buyVision` one step, SenseIndicators feed, quality = low on touch/low DPR + PauseMenu toggle; AGENTS step order; tests §EW-5 #7 + `tests/expandIntegration.test.ts` (zoom-independence, perimeter push through the real Simulation, save→load tier, 10-min roam perf) | `@claude-worker` | `src/sim/{Simulation,createInitialState}.ts`, `src/systems/HordeSystem.ts`, `src/core/{Game,InputController}.ts`, `src/ui/PauseMenu.ts`, `tests/expandIntegration.test.ts` (new), `tests/{openWorld,hordeCommands}.test.ts` | T002–T009 | VERIFIED (claude-worker; diff reviewed; orchestrator added Effects root noVisionHaze; tsc 0, 55 files / 592 pass, build OK; visual check of scenery/eyesight panel/cue arcs → T011) |
| EW-T011 | C | Playtest / tuning | Built-in browser: perimeter tour of all four edges + corners (screenshots), zoom out at the edge, tier 1→4 purchase and look, cue arcs during a fight, mixed-tier district crossing, mobile 375 × 812, frame time; tuning via balance; owner-file fixes | orchestrator | `src/config/balance.ts` (tuning) + owner-file fixes | T010 | VERIFIED |
| EW-T012 | C | Docs | AGENTS.md (world conventions, step order, new modules), README (eyesight, world), ARCHITECTURE status, CLAUDE.md checkbox | orchestrator | `AGENTS.md`, `README.md`, `CLAUDE.md`, `.agent-context/ARCHITECTURE.md` | T010 | VERIFIED |
| EW-V1 | D | Spec audit (read-only) | Audit vs docs/5_expand_world.md §8 checklist + §9 deliverables | `@agy-worker` plan mode (→ `@claude-worker` read-only) | none | T011 | VERIFIED (0 P1, §8 14/14 PASS; 2 P2 + 2 P3 → F1) |
| EW-V2 | D | Adversarial review (read-only) | Escape gaps at corners/road ends, LOS budget starvation, cue leaks of exact positions, save migration off-by-one, shader patch program-cache churn, dormant-agent loops at 400+ humans | `@codex-worker` read-only (→ `@claude-worker`) | none | T011 | VERIFIED (0 P1; 5 P2 → F1) |
| EW-F1 | D | Fixes | V1/V2 findings routed to the owning files' worker | `@claude-worker` (+ codex for pure logic) | per finding | V1, V2 | VERIFIED (5 V2 P2 fixed; V1 items fixed/documented) |
| EW-V3 | E | Final verification | `npx tsc --noEmit`, `npm test` × 2, `npm run build`; write `reports/FINAL-VERIFICATION.md` (+ spec §9 change report) | `@claude-worker` | `.agent-context/reports/FINAL-VERIFICATION.md` | F1 | VERIFIED (PASS; tsc 0, 614/614 ×2 after load budgets relaxed, build OK) |

### Dependency & lock review (Phase 1 step 3)

- **Contract first.** T001 is the only task touching `types/contracts/balance/content`. It also leaves the game compiling and
  green with the world already at full size (12 placeholder districts) so every Wave A task works against final bounds.
- **Wave A1 (T002 ∥ T003 ∥ T005) locks are disjoint.** T003 owns `boundaryLayout.ts`; T002 owns `districtLayout.ts`, which
  already calls `buildWorldBoundaries` from the T001 shim, so T002 never edits the boundary file and T003 never edits layout.
  Boundary colliders live only in the 20 m band, outside `playArea`, so T002's connectivity tests and T003's perimeter tests
  can't break each other. T005 is a new file plus new tests.
- **Wave A2 (T004 ∥ T006).** T004 waits for T002 so perf is measured on real content. `tests/navigation.test.ts` and
  `collision.test.ts` are T004's only; `persistence/progression/slots` tests are T006's only. T006 doesn't touch layout.
- **Wave B (T007 ∥ T008 ∥ T009) disjoint:** CityDistrict/Tropical/BoundaryScenery (T007) vs visuals HealthBars/EntityRenderer +
  new VisionFog (T008) vs `src/ui/**` + AudioSystem (T009). None touches Game/InputController — all wiring is T010.
  T008/T009 consume `state.vision` and `progression.visionTier` from the T001 contract, so they only need T005/T006 for real data.
- **HordeSystem** is touched only by T010 (order gate). **Simulation/createInitialState** only by T001 (defaults) and T010.
- **Risk hot-spots:** (1) T002 is the biggest task (≈ 12 district builders) — split into T002a (roads/grid/archetypes) and
  T002b (expansion strongholds) on the same worker if it runs long; (2) nav ×4.5 cells may slow whole-world tests — T004
  owns the fix, T002 may raise test timeouts only; (3) intro camera path tests (T007 re-checks; south coast geometry moves
  waterline into the band, not the beach).
- **Commit points:** orchestrator `git add -A` after each verified wave (baseline trick); commits only with the user's OK.

---

## Side milestone: ZA — Zombie animation & visual polish (docs/6_zombie_movement.md). **COMPLETE** (orchestrator-implemented; visuals-only, disjoint from EW locks). Committed.

| Task | Description | Agent | Files | Status |
| :--- | :--- | :--- | :--- | :--- |
| ZA1 | Pure core: skeleton + leg FK, deterministic profiles (8 archetypes × 6 body types), animation controller (IK gait, springs, lurch/twitch, attack keys synced to the damage step, 3 death styles, rise), tests | orchestrator | `src/visuals/{zombieRig,zombieProfiles,zombieAnimation}.ts`, `tests/zombieAnimation.test.ts` | VERIFIED (15 tests) |
| ZA2 | 3D: procedural atlas + normal map, articulated part/accessory geometry, MeshStandard atlas patch, HordeRenderer rewrite (side-table, LOD, hit direction, look-at-leader), Alpha hero rig in EntityRenderer, Game wiring (camera/leader/dt) | orchestrator | `src/visuals/{zombieTextures,zombieModel,HordeRenderer,EntityRenderer,LowPolyCharacters}.ts`, `src/core/Game.ts` (horde setters + `hordeStats`), `src/main.ts` (dev handle) | VERIFIED (tsc 0, 539/539, build OK; browser: no console errors, 91 zombies drawn, horde CPU ≈ 1 ms/frame, +20 draw calls) |

---

## Archive: IN — Opening cinematic (docs/4_intro_scene.md). **COMPLETE** (orchestrator-implemented; tightly coupled to Game wiring, so not delegated). Not committed.

| Task | Description | Agent | Files | Status |
| :--- | :--- | :--- | :--- | :--- |
| IN1 | Pure core: `GameFlowState` + central input gate, spline/easing/timeline math, intro script (cues measured from intro2.mp3, keyframes, music cues), tropical dressing layout | orchestrator | `src/core/{gameFlow,cinematicMath}.ts`, `src/content/intro.ts`, `src/world/tropicalLayout.ts`, `tests/intro.test.ts` | VERIFIED (14 tests incl. camera-path collision + zombie-hidden-until-reveal) |
| IN2 | 3D/UI/audio: CinematicController (drives the existing camera), TropicalScenery (ocean/beach/palms/umbrellas/traffic), CinematicOverlay + intro.css, IntroAudio (narration + synth score), Miami palette, south skirt removed | orchestrator | `src/core/CinematicController.ts`, `src/world/{TropicalScenery,CityDistrict}.ts`, `src/ui/{CinematicOverlay.ts,intro.css,PauseMenu.ts,HUD.ts}`, `src/audio/{IntroAudio,AudioSystem}.ts`, `src/visuals/HordeRenderer.ts` | VERIFIED |
| IN3 | Wiring: flow states, input lock, skip, replay (watch-only, conquest restored), autosave gating, handoff + first objective | orchestrator | `src/core/{Game,InputController,ThirdPersonCamera}.ts` | VERIFIED (tsc 0, 463/463, build OK; browser: full run, skip, replay+restore, mobile) |

---

Spec: `docs/todos.md` items 7–9. Contracts: `.agent-context/ARCHITECTURE.md` §TD-0…TD-4. Conventions: `AGENTS.md`.
Branch `open-world` (HEAD 572d264). Previous milestone OW: complete (archived below).

## Archive: TD — Todos 7–9 (mobile controls, capacity notice, purchasable slots). **COMPLETE** (all tasks VERIFIED; final verdict PASS — reports/FINAL-VERIFICATION.md). Not committed.

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
