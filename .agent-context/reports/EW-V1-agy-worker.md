# EW-V1 — Read-Only Spec Completeness Audit

**Produced by:** agy (`@agy-worker`, Gemini 4 Hydrogen Medium)
**Task ID & Agent:** `EW-V1` / `agy-worker`
**Status:** `COMPLETED`
**Completed Work:** Read-only spec completeness audit of `docs/5_expand_world.md` (§1, §8, §9) and `.agent-context/ARCHITECTURE.md` (§EW-0..§EW-5, including the 2026-11-15 vision-limit and warning-cue decisions) against the repository at `C:\projects\i-be-zombie`. Checked UI callback wiring, documentation consistency (`README.md`, `AGENTS.md`), and test coverage. Wrote this report.
**Remaining Work:** None for EW-V1. Findings below are routed for `EW-F1` / `EW-V3`.
**Public Interfaces/Exports Added:** None.

---

## Verification Run

| Command | Result | Details |
|---|---|---|
| `npx tsc --noEmit` | PASS (exit 0) | 0 TypeScript errors |
| `npm test` | PASS (exit 0) | 55 test files passed, 596 tests passed, 0 failed, 0 skipped (135.30 s) |

---

## 1. Non-Negotiable Design Requirements (`docs/5_expand_world.md` §1)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | One continuous open world (≥ 16 connected districts, Miami-inspired) | **PASS** | `src/content/districts.ts:21-58` defines 16 districts on a 4×4 grid; `src/world/districtLayout.ts:19-48` builds all 16 contiguously; `src/world/TropicalScenery.ts` & `src/world/BoundaryScenery.ts` render beach, ocean, bay, palms, canals/mangroves. |
| 2 | No linear difficulty path; high-threat adjacent to low-threat; no level locks | **PASS** | `src/content/districts.ts:21-58` mixes tiers 1–5; `tests/expansion.test.ts:49-65` verifies every tier ≥ 4 district shares an edge with a tier ≤ 2 district and 3 walkable crossings exist on all 24 shared edges (`tests/expansion.test.ts:203`). |
| 3 | No gray voids or arbitrary visible world edges | **PASS** | `src/world/boundaryLayout.ts:69-115` generates `boundaries` and `backdrop` rects; `src/world/BoundaryScenery.ts:164-207` dresses all 8 `BoundaryKind`s and 6 backdrop kinds; `src/core/Game.ts:814-816` matches sky/fog to `hazeColor` past the vision limit. |
| 4 | Outer boundaries are real obstacles (no walk, path, or fall through) | **PASS** | `src/world/boundaryLayout.ts:87-92` creates `kind: 'boundary'` colliders (`blocksMove: true`) covering the 20 m band and overlapping corners; `tests/boundaries.test.ts:153-240` verifies 0.5 m edge coverage, no exterior walkable nav cells, and 2,400-step push containment. |
| 5 | Do not wall off districts; interior barricades distinct from world edge | **PASS** | Interior doors/gates use `kind: 'breakable'` / `'gate'` (`src/entities/Structure.ts`); world edges use `kind: 'boundary'` (`src/world/boundaryLayout.ts:87`). `tests/expansion.test.ts:203` verifies 3 crossings per shared district edge. |
| 6 | Start with poor zombie vision | **PASS** | `src/config/balance.ts:315` sets Tier 1 (`Rotten Eyes`) to `clearRadius: 18`, `hazeRadius: 46`, `hazeStrength: 0.82`; `src/sim/createInitialState.ts` initializes `visionTier: 1`. |
| 7 | Eyesight is a permanent upgrade (4 persistent mutation tiers) | **PASS** | `src/config/balance.ts:314-321` defines tiers 1–4; `src/systems/ProgressionSystem.ts:168-190` implements `visionCost` and `buyVision`; `src/persistence/saveSchema.ts:303,453,495` persists `visionTier`. |
| 8 | Vision enhances gameplay, not punish basic controls; early first upgrade | **PASS** | `src/config/balance.ts:321` sets Tier 2 cost to `20` biomass (available at any active nest including `nest_start`, `ProgressionSystem.ts:40-45`); `EntityRenderer.ts:131` excludes the Alpha (`noVisionHaze`), `HealthBars.ts:73-89` keeps leader/horde bars readable, and `VisionFog.ts:158` skips `fog: false` UI/markers. |
| 9 | Separate discovered geography from current vision | **PASS** | `state.discovery` (42×34 fog grid) is updated by `ConquestSystem` and saved (`saveSchema.ts:309`); `state.vision` (`AwarenessSystem.ts:181-232`) is transient and rebuilt at 5 Hz; `mapRender.ts:60-103,220-235` draws terrain from `discovery.bits` and humans from `mapHumanVisibility`. |
| 10 | Optimize for large hordes and mobile-capable browsers | **PASS** | `AwarenessSystem.ts:150-159` budgets LOS to `maxLosChecksPerUpdate = 48` round-robin at 5 Hz; `NavigationGrid.ts` uses incremental rebuilds & touched-cell resets; `BoundaryScenery.ts:224-240` instances props (~18 draw calls); `Game.ts:183,302-306` supports `low` vision quality and touch DPR cap (`Game.ts:421`). |

---

## 2. Global End-to-End Acceptance Criteria (`docs/5_expand_world.md` §8)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | No visibly exposed gray/empty map edges during gameplay, perimeter walk, or zoom | **PASS** | `src/world/boundaryLayout.ts:73-114`, `src/world/BoundaryScenery.ts:164-189`, `src/world/TropicalScenery.ts:71-126`, `src/core/Game.ts:813-816` (backdrop + sky/fog matched to `hazeColor`). |
| 2 | Entire exterior perimeter uses environment-appropriate visible obstacles with collision and pathfinding barriers | **PASS** | `src/world/boundaryLayout.ts:33-41,87-92` selects `BoundaryKind` per adjacent district archetype/road and pushes `kind: 'boundary'` colliders; `src/world/BoundaryScenery.ts` renders matching props from `layout.boundaries`; `tests/boundaries.test.ts:153-230`. |
| 3 | No boundary gap lets any entity leave playable world; non-interactive scenery extends beyond bounds | **PASS** | `src/world/boundaryLayout.ts:82-86` overlaps adjacent runs by 0.1 m and extends ends through corners; `tests/boundaries.test.ts:153-240` proves 0.5 m perimeter coverage, no exterior nav cells, and 2,400-step actor containment. `backdrop` rects lie outside `bounds` (`boundaryLayout.ts:97-114`). |
| 4 | Continuous, freely explorable world with ≥ 16 districts and intentionally mixed nearby difficulty | **PASS** | `src/content/districts.ts:21-58` (16 districts, tiers 1–5); `src/world/districtLayout.ts:19-48`; `tests/expansion.test.ts:49-65,203`. |
| 5 | Player can attempt extreme-threat district early; failure/retreat possible without level locks | **PASS** | No district gates or level checks exist in `ConquestSystem` or `districtLayout.ts`; `tests/expansion.test.ts:49-65` verifies tier 4–5 districts border tier 1–2 districts with 3 walkable road crossings (`tests/expansion.test.ts:203`). |
| 6 | Newly infected players begin with limited but playable sight | **PASS** | `src/config/balance.ts:315,322` (`clearRadius: 18`, `hazeRadius: 46`, `alwaysRadius: 6`). |
| 7 | Four eyesight tiers are configurable, visually distinct, and reflected in target detection | **PASS** | `src/config/balance.ts:313-331`; `src/visuals/VisionFog.ts:77-111` blends `clearRadius`/`hazeRadius`/`hazeStrength` over `tierBlendTime`; `src/systems/AwarenessSystem.ts:136-178` gates identification, moving detection, defense detection, and reinforcement detection; `tests/vision.test.ts:54,111,123`. |
| 8 | Camera zoom, world map, and UI cannot bypass logical sight restrictions | **PASS** | `AwarenessSystem.ts:137-174` reads only `leader.pos` and `visionTier` (`tests/vision.test.ts:39`, `tests/expandIntegration.test.ts:36`); `HordeSystem.ts:272-286` converts attack orders on `!canTarget` humans to move orders; `InputController.ts:554` & `Game.ts:269` block hover/pick via `targetAllowed`; `EntityRenderer.ts:510-598` & `HealthBars.ts:93` hide unidentified humans/bars; `mapRender.ts:220-235` & `WorldMap.ts:180-192` gate map humans/strongholds. Also **2026-11-15 vision limit**: `VisionFog.ts:222-223` ramps haze to 1.0 over `VISION_EDGE_BAND` (`visionMath.ts:98`), `Game.ts:814-816` sets sky/fog to `hazeColor`, and `Game.ts:824-835` drops effects past `hiddenBeyond`. |
| 9 | Directional audio/sensory cues communicate nearby activity beyond sight without exposing perfect coordinates | **PASS** | `AwarenessSystem.ts:72-115,189-225` emits fuzzed, aggregated, capped cues (`gunshot`, `scream`, `siren`, `crowd`); `SenseIndicators.ts:47-98` renders screen-edge arcs; `mapRender.ts:203-219` renders fuzzy radial gradients; `AudioSystem.ts:305-315` plays panned/attenuated sounds. Also **2026-11-15 warning cues**: `AwarenessSystem.ts:76-78,90,107-112` cues gunshots/screams even inside clear sight with proportional fuzz and evicts them last; `SenseIndicators.ts:15-16,56,73` & `hudOpenWorld.css:696-726` render ⚠ + arrow at `>= WARNING_CUE_MIN_OPACITY` (`0.85`). |
| 10 | Explored geography persists separately from live enemy/tactical visibility | **PASS** | `saveSchema.ts:309,622-629` persists `discoveryBits` and `districts`; `state.vision` is transient (`createInitialState.ts`, `AwarenessSystem.ts`); `mapRender.ts:60-103,220-235` separates terrain fog from live human/cue layers. |
| 11 | Eyesight upgrades integrate with progression and persistence, including older saves | **PASS** | `ProgressionSystem.ts:168-190,210`; `saveSchema.ts:47-78` (`MIGRATIONS[2]` upgrades v2→v3 with `visionTier = 1`, 12 new districts/strongholds, and +11/+17 fog bit remap; v1 chains through v2); `tests/visionProgression.test.ts:18-105`, `tests/persistence.test.ts:487-535`. |
| 12 | High NPC/horde counts do not cause costly per-entity-per-frame LOS checks | **PASS** | `AwarenessSystem.ts:150-159,227-230` runs at `updateHz = 5` with round-robin `maxLosChecksPerUpdate = 48` and cached `los` in a `WeakMap`; `tests/vision.test.ts:160` tests 300 humans; `tests/expandIntegration.test.ts:83` tests 2 sim-minutes of roaming. |
| 13 | Desktop and supported mobile graphics paths remain usable; reduced-quality rendering mode exists | **PASS** | `Game.ts:183,302-306,421` sets `low` quality (no desaturation) on touch or DPR ≤ 1 and caps touch DPR at `BALANCE.touch.lowDpr`; `PauseMenu.ts:10-12,49,69,114-118` exposes the runtime quality toggle. |
| 14 | Existing district traversal, horde following, combat, and unlock mechanics still work | **PASS** | `npm test` passes all 55 test files / 596 tests, including `openWorld.test.ts`, `combat.test.ts`, `horde.test.ts`, `hordeCommands.test.ts`, `progression.test.ts`, `slots.test.ts`, `intro.test.ts`. |

---

## 3. Required Orchestrator Deliverables (`docs/5_expand_world.md` §9)

- **Status:** **MISSING (Pending `EW-V3`)**
- `.agent-context/reports/FINAL-VERIFICATION.md:1-42` is still the `TD-V3` verification report. The EW final change report covering §9 items 1–8 is tracked as `EW-V3` (`PENDING`) in `.agent-context/PROGRESS.md:40`.

---

## 4. UI Bindings & Documentation Consistency Check

- **UI Bindings:** All declared callbacks are wired:
  - `NestPanel.onEquip` / `onBuySlot` / `onBuyVision` → `HUD.ts:595-603` → `Game.ts:281-283` (`InputController.queueBuyVision` at `InputController.ts:157`).
  - `WorldMap.onClose` / `onWaypoint` → `HUD.ts:590-591` → `Game.ts:280`.
  - `PauseMenu.setCallbacks` (`onContinue`, `onSave`, `onResetSave`, `onToggleMute`, `onReplayIntro`, `getVisionQuality`, `onToggleVisionQuality`) → `Game.ts:296-307`.
  - `TouchControls` (`onAttack`, `onRegroup`, `onFollow`, `onAbility`, `onMap`, `onPause`, `onRecenter`) → `Game.ts:287-293`.
  - `CinematicOverlay` (`onStart`, `onSkip`) → `Game.ts:249-250`.
- **Docs vs. Code (`README.md`, `AGENTS.md`):**
  - `README.md:21-26` tier table (`18/28/42/60`, vision limit `~52/~72/~94/~123` = `hazeRadius * 1.12`, costs `20/60/120`) matches `src/config/balance.ts:314-321` and `src/core/visionMath.ts:98`.
  - `AGENTS.md:197-220` matches `balance.ts`, `visionMath.ts`, `AwarenessSystem.ts`, and `saveSchema.ts`.
  - One stale OW line remains in `README.md:86` (see Finding #4 below).

---

## 5. Findings

1. **[P2] Spec §9 final change report not yet written**
   - **Location:** `.agent-context/reports/FINAL-VERIFICATION.md:1-42` (still `TD-V3`)
   - **Spec Clause:** `docs/5_expand_world.md` §9 ("Required orchestrator deliverables: Produce a final change report containing: 1. Files/modules added or modified... 8. Remaining limitations or follow-up polish items.")
   - **Suggested Fix:** Write the EW change report in `EW-V3` (`.agent-context/PROGRESS.md:40`) covering all 8 items from §9.

2. **[P2] Client-side EW rendering/UI modules lack automated unit/DOM tests**
   - **Location:** `src/visuals/VisionFog.ts`, `src/visuals/EntityRenderer.ts:510-598`, `src/visuals/HealthBars.ts:91-99`, `src/ui/SenseIndicators.ts`, `src/core/InputController.ts:554`
   - **Spec Clause:** `docs/5_expand_world.md` §4, §5, §8 (haze shader ramp/suspend, silhouette vs. hidden human gating, warning-cue opacity floor & direction rotation, `targetAllowed` pick gating)
   - **Suggested Fix:** Add lightweight pure/DOM tests where feasible (e.g., `SenseIndicators` DOM update/opacity floor, `VisionFog` uniform state/quality/`hiddenBeyond` without WebGL, or `InputController` `targetAllowed` filter) or document browser-playtest verification in `EW-V3`.

3. **[P3] Map `waypointMarker` skips fog (`fog: false`) and is not culled beyond `hiddenBeyond`**
   - **Location:** `src/core/Game.ts:238-244`, `src/core/Game.ts:902-908`
   - **Spec Clause:** `ARCHITECTURE.md` §EW-0 (2026-11-15 user request: "everything past the vision limit is hidden") & `AGENTS.md:214-215` ("Any new always-visible 3D overlay must do the same [cull past `hiddenBeyond`].")
   - **Suggested Fix:** Either keep `waypointMarker` visible intentionally as a player navigation beacon (document as a deliberate exception in `EW-V3`) or hide `this.waypointMarker.visible` when its XZ distance from `leader.pos` exceeds `this.visionFog.hiddenBeyond`.

4. **[P3] Stale "four strongholds" text in `README.md`**
   - **Location:** `README.md:86` ("The goal is to conquer all four strongholds, in whatever order you like.")
   - **Spec Clause:** `docs/5_expand_world.md` §1.1, §2 (16 districts / 16 strongholds)
   - **Suggested Fix:** Update `README.md:86` to "all 16 strongholds".

---

## Memory Notes
- `npx tsc --noEmit` (0 errors) and `npm test` (55 files / 596 tests passed) are green as of 2026-11-15.
- All EW-T001..T012 features (16 districts, 64 boundary segments/colliders, 6 backdrops, `AwarenessSystem`, `VisionFog` + `VISION_EDGE_BAND` limit, `SenseIndicators` + warning cues, `NestPanel` eyesight UI, save v3 + v2→v3 fog remap) are wired and verified.
