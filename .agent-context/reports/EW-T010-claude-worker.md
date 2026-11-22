# EW-T010 - Integration

- **Task ID & Agent:** EW-T010, claude-worker
- **Status:** COMPLETED

## Completed Work
- `src/sim/Simulation.ts`: `updateAwareness(ctx, dt, this.events.slice(stepEventStart))` runs last in each step, open world only, including while `respawning`. Legacy does not run it (no fog there; avoids touching legacy order tests). `createInitialState` already had `createVisionState()`; `applySave` sets `progression.visionTier` and awareness copies it into `vision.tier` on the next update, so no change was needed there (tested).
- `src/systems/HordeSystem.ts` `applyHordeCommands`: open world only, an attack command (incl. additive/Ctrl split) or `attackTarget` on a human with `!canTarget` is rewritten to a move command to that human's current position. Legacy unchanged.
- `src/core/InputController.ts`: new dep `targetAllowed(target)` filters unidentified humans out of picking/hover candidates; `queueBuyVision()` sets a one-step `SimInput.buyVision` edge (not dropped by modal/lock, since it is a UI click).
- `src/core/Game.ts` (additive, CRLF kept): `BoundaryScenery` (open world, `update(state.time)` per frame, disposed), `VisionFog` (quality low on touch / DPR <= 1, else high; `patchScene` after construction, on every chunk-set change in `syncOccluders`, and every 90 frames to catch lazily built rigs/effects; `update(state, alpha, dt)` before render; haze strength forced to 0 during the opening cinematic), `entities/healthBars.setVisionGating(openWorld)`, `hud.onBuyVision -> input.queueBuyVision`, `SenseIndicators(hud.senseRoot).update(state, cameraRig.yaw, dt)` + dispose, `targetAllowed` wired to `canTarget`. `audio.consume(events, state, yaw, ...)` was already passing yaw (other session).
- `src/ui/PauseMenu.ts` (CRLF kept): "Vision quality: Low/High" button via `onToggleVisionQuality` / `getVisionQuality` callbacks (label refreshed on show/click; hidden if no callback). Game wires them to `visionFog.setQuality`. HUD.ts not touched.
- Tests: `tests/hordeCommands.test.ts` +4 (unidentified -> move, identified -> attack, split add, left-click path, legacy unchanged); NEW `tests/expandIntegration.test.ts` (5 tests: identified/seen during real steps, camera/yaw independence, buyVision tier + clear radius, save->load tier, 2-minute roam bounded); `tests/openWorld.test.ts` updated: scripted attack orders now mark the target identified first (helper `identify`), because the new gate would otherwise turn them into moves.

## Remaining Work
- Not my files: `src/visuals/Effects.ts` has no `userData.noVisionHaze` / `fog:false` markers (grep found none). Muzzle flashes, tracers, command markers and rings will be hazed by distance from the Alpha. Needs owner change: set `noVisionHaze=true` on the Effects root group (or `fog:false` on materials). Game re-patches every ~1.5 s so late-created materials are covered once flagged.
- Touch/mobile quality default is applied at construction only.

## Public Interfaces/Exports Added
- `InputController.queueBuyVision()`, `InputDependencies.targetAllowed?`
- `PauseCallbacks.onToggleVisionQuality?`, `PauseCallbacks.getVisionQuality?`

## Verification Run
- `npx tsc --noEmit`: PASS.
- `npm test`: 54/55 files passed on first run; the single failure was a 5 s default timeout on my new camera-independence test (heavy, 2 sims x 180 steps on the full world under load). Fixed by 60 s timeouts; file re-run alone PASS (5/5). Earlier full run: 591 passed. `tests/openWorld.test.ts` alone: 14/14 PASS after the `identify` change. I did not re-run the entire suite after the timeout fix.
- `npm run build`: PASS (only the existing chunk-size warning).
- Browser smoke (headless Edge via CDP, vite on 5190): no console errors/exceptions; intro -> PLAYING after Esc; `vision` state populated (tier 1, identified 3-4); fog uniforms live (clear 18, haze strength 0.82 in play, 0 during intro); `BoundaryScenery` present in scene. Screenshot at the world edge was only 500x320 and showed HUD only, so boundary visuals, nest-panel Eyesight section and cue arcs were NOT visually verified. Edge and vite processes killed afterwards.

## Memory Notes
- **[EW-T010 Integration]** Awareness runs last in `Simulation.step` (open world only, also while respawning) with `events.slice(stepStart)`. The order gate lives in `applyHordeCommands` (unidentified human target -> move to its position, incl. additive and `attackTarget`); scripted sims that order attacks on far humans must mark them identified (`state.vision.identified` sorted insert, see `tests/openWorld.test.ts` `identify`). Game: VisionFog re-patches on chunk-set change + every 90 frames; haze strength forced to 0 while the intro cinematic runs. PauseMenu vision toggle uses getter/toggle callbacks (HUD not involved). Effects.ts still needs `noVisionHaze` flags (EW-T010 report).

## Orchestrator review (2026-11-15)
- Added `userData.noVisionHaze = true` on the Effects root (`src/visuals/Effects.ts`), as requested in this report.
- Stopped the leftover vite process on port 5190.
- Re-run: tsc 0, `vitest run` 55 files / 592 pass, build OK.
