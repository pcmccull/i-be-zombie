# T014 Report - Client integration

**Task ID & Agent:** T014 / claude-worker
**Status:** COMPLETED

## Completed Work
- `src/core/cameraMath.ts`: pure helpers `abilitySlotForKey`, `keyActionFor`, `isSystemKey`, `keyAllowedWhileModal`, `hordeCommandForRightClick`, `zoomTarget`, `ZOOM_MIN/MAX/DEFAULT` (8/64/17); `shouldRequestLock/ReleaseLock` gained `modalOpen`, keep lock through `respawning`, release only for victory/defeat/help/modal.
- `src/core/InputController.ts`: new input model (table below); legacy rally/rush/recall/attackTarget always false/null; ignores game keys, axes and canvas orders while pause/map is open; `onUiKey` hook (nest panel keys), `onLockLost` hook (browser Esc / alt-tab -> pause), pointer-lock mouse-look and RMB-drag orbit unchanged. RMB on ground is rejected when a building proxy is in front of the ground point.
- `src/core/ThirdPersonCamera.ts`: zoom 8-64 (default 17, multiplicative wheel), `setBounds(layout.bounds)` replaces the legacy `BALANCE.world` clamp.
- `src/core/Game.ts`: full open-world wiring: `buildDistrictLayout()` + `SaveStore` boot, `hud.setWorld({firstRun: !save})`, autosave (throttled 2 s, `savedAt = Date.now()`), pause halts sim, pause callbacks (Continue / Save / Reset Save -> `store.clear()` + clean restart / mute), `hud.onEquip` -> next step `input.equip`, `hud.onWaypoint` -> amber world pillar + minimap, per-frame `city.updateStreaming` first, then landmarks/checkpoint/nests, `horde.consume/setView`, `entities.setView`, `effects.setWorld/update(dt,state,alpha)`, loaded-chunk-filtered shared occluder list, sun follows focus, fog 120-330, far plane 520, HUD extras (waypoint, frameMs, loadedChunks), hover labels for POLICE/SOLDIER/CIVILIAN. `dispose()` removes the same listeners as before (all InputController listeners via AbortController).
- `src/main.ts`, `index.html`: unchanged (no change needed).
- `tests/input.test.ts` (new, 9 tests). `tests/picking|pointerLock|cameraMath` unchanged and passing.
- No edits outside the locked files. Simulation already accepts `save` (T012), so the temporary `applySave` path was not needed.

## Final control scheme
| Input | Action |
|---|---|
| WASD / arrows, Shift | move (camera-relative), sprint |
| LMB | Alpha attack; `aimPoint` = ground under crosshair/cursor. First click while mouse is uncaptured only captures the mouse |
| RMB on human / gate / structure | horde attack order (Ctrl = additive split target) |
| RMB on ground | horde move order (marker, expires) |
| Space / Shift+RMB | regroup (rally) |
| G | everyone follows |
| Q E R F | ability slots 0-3 |
| M | world map (click = waypoint) |
| Esc | pause menu (Continue / Save / Reset Save / mute); also opens when the browser releases the mouse |
| N | mute |
| Tab / F3 / C / V / Z X / wheel | help / debug overlay / recenter / look back / turn / zoom |
| Mouse move (locked) or RMB-drag | orbit |
| Nest panel (near an active nest) | click or keys 1-4, [ ] equip abilities |

## Remaining Work
- None blocking. Not verified visually: LMB kill-a-civilian-to-follower, Q/E/R/F with unlocked abilities, walking across district borders (needs a real GPU session, see below).

## Public Interfaces/Exports Added
cameraMath: `abilitySlotForKey, keyActionFor, isSystemKey, keyAllowedWhileModal, hordeCommandForRightClick, zoomTarget, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, KeyAction, RightClickInfo`. `ThirdPersonCamera.setBounds(AABB)`. `InputController` deps: `onGroundPing` removed; added `isModal`, `onUiKey`, `onLockLost`; `onKey` actions now `recenter|help|debug|mute|map|pause`.

## Verification Run
- `npx tsc --noEmit`: clean. `npm test`: 38 files / 402 tests pass. `npm run build`: OK (chunk-size warning only).
- Browser smoke (headless Edge via CDP against my own `vite --port 5180`, stopped afterwards): boots with no console errors or exceptions; WebGL renders the suburbs, HUD, minimap, nest panel and onboarding card; after boot 8 chunks loaded (<= 12), 59 occluders, 86 humans, 100-225 draw calls (SwiftShader). Verified: W walks, RMB ground -> `order.type==='move'`, G -> `follow`, Space/Q/LMB do not crash and followers rose 5 -> 13 (cascade), M opens the map and toggles closed, Esc opens pause and sim time stops advancing, Esc again resumes, save wrote 1.7 kB to `ibz.openworld.save`, reload shows "Your conquest continues" and restarts from the saved nest. Headless frame rate is low so sim time advanced slowly.
- Not run: border crossing, F3 overlay content, Reset Save button click.

## Orchestrator visual checklist (real browser)
1. Walk from the suburbs start into police/shopping districts: terrain should stream in without pop-in inside fog (120-330 m), F3 shows chunks <= 12.
2. LMB (mouse captured) on a civilian: bite, civilian rises as follower. RMB on a civilian/structure sends the horde; RMB on ground shows the move marker.
3. Esc releases the mouse and opens pause; Save then reload restores; Reset Save (confirm) restarts clean.
4. Zoom out with the wheel to ~64: 40-zombie horde stays framed; shadows follow the leader.

## Memory Notes
Appended to MEMORY.md ([T014 Client], [T014 Game], [T014 Tooling]).
