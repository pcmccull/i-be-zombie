# EW-T010 — Integration: sim wiring, client wiring, order gate (claude-worker)

Read first:
- `AGENTS.md`
- `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5)
- `.agent-context/MEMORY.md`
- `.agent-context/PROGRESS.md` (row EW-T010)
- `src/core/contracts.ts` (EW doc block)

Upstream reports in `.agent-context/reports/` — they hold the exact public APIs and the wiring each module needs:
- `EW-T003-codex.md`
- `EW-T005-codex.md`
- `EW-T006-claude-worker.md`
- `EW-T007-agy-worker.md`
- `EW-T008-agy-worker.md` (+ orchestrator review)
- `EW-T009-agy-worker.md`

## Locked files (edit ONLY these)
- Sim: `src/sim/Simulation.ts`, `src/sim/createInitialState.ts`, `src/systems/HordeSystem.ts` (order gate only)
- Client: `src/core/Game.ts`, `src/core/InputController.ts`, `src/ui/PauseMenu.ts`
- Tests: NEW `tests/expandIntegration.test.ts`, `tests/openWorld.test.ts`, `tests/hordeCommands.test.ts`

### Concurrent session warning (important)
Another session is working right now in `src/core/Game.ts`, `src/ui/PauseMenu.ts`, `src/ui/HUD.ts`, `src/audio/**`, `src/ui/hud.css` and `src/ui/touch.css`.
- Its work includes tourist voices, sound effects, `SampleBank`, `sfxRules`, and the mouse-capture removal.
- Its edits in `Game.ts` / `PauseMenu.ts` are uncommitted, and it may keep editing while you work.

How to edit around it:
- **Preserve every one of its changes.** Keep your edits small and additive (new fields, new calls, new methods).
- Re-read the file right before each Edit, and prefer several small Edits over rewriting blocks.
- Never revert, reformat or reorder code you didn't write. Never touch `src/audio/**`, `HUD.ts` or the css files.
- If an Edit fails because the text changed under you, re-read and retry.
- Game.ts and PauseMenu.ts are CRLF; keep it.

## Implement
1. **Simulation**
   - Call `updateAwareness(ctx, dt, stepEvents)` (AwarenessSystem) each step after `updateRespawn` (open world). Legacy can run it too if harmless; decide and document.
   - `stepEvents` = the events emitted during this step (slice from the step's start index).
   - It must also run while respawning, so `identified` collapses to the engaged set.
   - Update the step-order comment in `Simulation.ts`.
   - createInitialState: final vision init (`createVisionState`, `visionTier` from progression/save).
   - Check that `applySave` keeps `state.vision.tier` consistent on the next awareness update.
2. **HordeSystem `applyHordeCommands`** (contracts EW block, §EW-5 #7):
   - Open world only. An attack order whose target is a human with `!canTarget(state, id)` becomes a move order to that human's current position.
   - Legacy layout unchanged.
   - Split-target adds (Ctrl+RMB) follow the same rule.
3. **InputController:** hover/picks of humans are filtered by `canTarget` (no hover label/crosshair-target on unidentified humans); `buyVision` edge via a `queueBuyVision()` mirroring `queueBuySlot`.
4. **Game.ts:**
   - Construct `BoundaryScenery(scene, layout)` (open world only): `update(time)` per frame, `dispose()` in dispose.
   - VisionFog:
     - Construct with quality = low on touch / DPR ≤ 1, else high.
     - Call `patchScene(scene)` after the world/entities/scenery are built, and again when CityDistrict streams in new chunk meshes (find the hook or re-patch cheaply each time chunks change).
     - Per frame: `update(state, alpha, dt)` before render.
     - Effects (muzzle flashes, tracers, command markers) must set `userData.noVisionHaze` or use `fog:false`. Check `Effects.ts`; if it needs a change, report it instead of editing (not your file). The patch skips `fog === false` materials.
   - `entities.setVisionGating(openWorld)` and `healthBars.setVisionGating(openWorld)`.
   - `hud.onBuyVision(() => input.queueBuyVision())`, or the same pattern used for `onBuySlot`.
   - `new SenseIndicators(hud.senseRoot)`: `update(state, camera.yaw, dt)` per frame, `dispose()` in dispose.
   - `audio.consume(events, state, camera.yaw)`.
   - Camera zoom must not change what is identified — it can't, since AwarenessSystem reads only `leader.pos`. Just don't add camera inputs.
5. **PauseMenu:** a "Vision quality: Low / High" toggle → `visionFog.setQuality` (callback, same pattern as existing toggles).

## Tests
- `tests/hordeCommands.test.ts` (§EW-5 #7): in the open world, an attack order on an unidentified human becomes a move order to its position; on an identified one it attacks; legacy unchanged.
- NEW `tests/expandIntegration.test.ts` (pure, via `new Simulation(buildDistrictLayout(), seed)`):
  - identified/seen update during real steps;
  - results are identical regardless of any camera value (there is none in SimInput — assert `SimInput` has no camera-zoom field affecting vision, and that two runs with different `cameraYaw` produce the same identified sets);
  - buyVision through SimInput at a nest raises the tier and AwarenessSystem picks it up (clear radius grows);
  - save → load keeps the tier;
  - 2 sim-minutes of scripted roaming keep `revision`, cue counts and step time bounded.
  - Heavy tests: timeouts ≥ 60 s, and yield (`await new Promise(r => setTimeout(r, 0))`).
- Keep `tests/openWorld.test.ts` green; update it only if the step order change requires it.

## Verify
- `npx tsc --noEmit`, `npm test`, `npm run build`.
- Then a short browser smoke test in the built-in browser:
  - Dev server via `.claude/launch.json` (or `npm run dev`, port 5173).
  - No console errors; haze visible; boundary scenery visible at an edge; nest panel Eyesight section; a cue arc after a gunshot if practical.
  - Report what you saw; screenshots optional.

## Done when
tsc + full tests + build pass. Write `.agent-context/reports/EW-T010-claude-worker.md` (AGENTS.md format) and append Memory
Notes to `.agent-context/MEMORY.md`.
