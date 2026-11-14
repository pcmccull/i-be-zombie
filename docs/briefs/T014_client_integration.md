# T014 — Client integration: input model, Game wiring, save/load, streaming (claude-worker)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md` (input model §4), reports `T010`, `T011`, `T012`, `T013`,
`T6-pointer-lock-agy.md`, `docs/3_open_world.md` §7 "Controls", §10, current `src/core/{Game,InputController,ThirdPersonCamera,cameraMath}.ts`,
`src/main.ts`, `index.html`, `src/persistence/*`.

## Locked files
`src/core/Game.ts`, `src/core/InputController.ts`, `src/core/ThirdPersonCamera.ts`, `src/core/cameraMath.ts`, `src/main.ts`, `index.html`,
`tests/{picking,pointerLock,cameraMath}.test.ts` (+ new `tests/input.test.ts` for pure input mapping helpers). Small API fixes in
`src/ui/**`, `src/visuals/**`, `src/world/{CityDistrict,Landmarks,Checkpoint,NestMarkers}.ts` only if wiring is impossible otherwise (list each).

## Deliver
1. **Input model** (ARCHITECTURE §4) producing the new SimInput fields; keep pointer-lock mouse-look (todos #6) working: LMB = `attack`
   (+ `aimPoint` from the ground ray; while locked use crosshair); RMB click on human/gate/structure = `hordeCommand attack` (Ctrl = additive),
   RMB on ground = `move`; RMB drag still orbits when unlocked; Space / Shift+RMB = `regroup`; G = `follow`; Q E R F = `abilitySlot` 0–3;
   M = world map; Esc = pause menu (and releases pointer lock); N = mute; Tab help, F3 debug, C/V/Z/X/wheel unchanged. Legacy SimInput fields
   stay false/null. Ignore game keys while a menu/map is open.
2. **Game**: build `buildDistrictLayout()` (open world) and pass it to `Simulation` explicitly; boot loads `SaveStore(localStorage)` →
   `new Simulation(layout, save?.seed ?? BALANCE.sim.seed, save)`; autosave on `autosave` events (throttled ≥ 2 s; `savedAt` = Date.now());
   pause halts sim stepping (render continues); Pause menu Save/Continue/Reset Save (clear + restart clean) wiring; nest panel `onEquip` → next
   step's `input.equip`; world map waypoint → world marker + minimap; chunk streaming `cityDistrict.updateStreaming(cameraFocus)` each frame and
   landmark/nest visibility; Effects/Audio/HUD consume drained events; debug stats (renderer.info draw calls, chunk counts, actor counts).
3. Camera: zoom range suitable for a 40-zombie horde in the open world; far plane/fog tuned to chunk load radius; occluders only from loaded chunks.
4. `Game.dispose()` removes all listeners (existing rule).
5. Verify in the browser (dev server via `.claude/launch.json` `vite-5174`): boot clean, walk across district borders, LMB kills a civilian →
   follower, RMB move/attack, Q/E/R/F, M map, Esc pause → Save → reload restores, F3 shows bounded chunks. Record findings in the report.

## Done when
`npx tsc --noEmit`, `npm test`, `npm run build` pass and the browser smoke check passes. Report `.agent-context/reports/T014-claude.md`, MEMORY.
