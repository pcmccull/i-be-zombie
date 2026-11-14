# T013 - claude-worker (reassigned from agy)

**Task ID & Agent:** T013, @claude-worker
**Status:** COMPLETED (HUD, minimap, world map, pause menu, nest panel, onboarding, debug overlay, audio). Not wired into Game/Input (T014).

## Completed Work
- `src/ui/uiHelpers.ts` [pure]: map projection (`makeProjection/worldToMap/mapToWorld`, north-up), fog/territory helpers, `selectObjectiveStronghold`, `abilitySlotView`, `equippableAbilities`, `nearbyEquipNest`, `isNestActiveFor`, `followerCap`, `toastForEvent`, `buildDebugLines`, `staticLayerKey`.
- `src/ui/mapRender.ts`, `Minimap.ts` (180 px, cached static layer, ~15 Hz), `WorldMap.ts` (M overlay, click = waypoint, stronghold list + fog-vs-control legend), `PauseMenu.ts` (Continue/Save/Sound/Reset Save with confirm + controls list), `NestPanel.ts`, `DebugOverlay.ts`, `hudOpenWorld.css`.
- `src/ui/HUD.ts`: open-world mode (biomass, `n/40` + brutes, Q/E/R/F slots with cooldown sweep, cost, empty/locked/no-biomass/active states, denied flash; objective tracker with `objectiveStatus` progress; stacked toasts for objectiveComplete/strongholdCaptured/abilityUnlocked/districtDiscovered/reinforcements/nestActivated/denied; "SAVED" tick on `autosave`; respawn overlay with countdown for `phase==='respawning'`; OW intro/onboarding card (firstRun) and help rows; new key hints). Legacy mode (no `setWorld`) unchanged, including victory/defeat overlays and pointer-lock crosshair. Structure labels for stationDoor/securityShutter added.
- `src/audio/AudioSystem.ts`: attackSwing (bite/claw/finisher), abilityUsed (frenzy roar, brute growl), abilityDenied blip, abilityUnlocked arpeggio, strongholdCaptured sting, objectiveComplete ding, districtDiscovered chime, reinforcements siren, leaderRespawned rise, nestActivated, bruteEvolved. All gated by the existing mute/context-running check.
- `tests/uiHelpers.test.ts` (8 tests).

## Remaining Work (T014 wiring - exactly what must be called)
Existing signatures are backward compatible (Game.ts compiles untouched).
1. After constructing/resetting the Simulation: `hud.setWorld(sim.ctx.layout, { firstRun: !loadedSave })`. Call again after every restart/new Simulation (cheap; invalidates map layers). Until called the HUD stays legacy.
2. Every frame (already): `hud.consume(events)` BEFORE `hud.update(state, extras)`. New optional `HudExtras`: `waypoint?: Vec2|null` (Game-owned waypoint, drawn on minimap/map), `frameMs?: number`, `loadedChunks?: number` (F3 overlay). `showDebug` now drives the new DebugOverlay (fps, frame ms, draws, chunks, active/dormant humans+zombies, followers, district states, phase).
3. Callbacks (register once): `hud.onWaypoint((p: Vec2|null) => ...)` store/clear waypoint (clear on arrival/death too); `hud.onEquip((slot, ability|null) => ...)` -> set `SimInput.equip = {slot, ability}` for the next step; `hud.setPauseCallbacks({ onContinue, onSave, onResetSave, onToggleMute })` (onResetSave fires only after the in-menu confirm; onContinue should call `hud.hidePause()` and resume; Save: call `hud.notifyPause('Saved')`).
4. Key routing (HUD owns no key handlers): `M` -> `hud.toggleMap()`; `Esc` -> `hud.togglePause()` (if map open, `hud.hideMap()` first; pause also hides the map); F3 -> existing showDebug flag; while `hud.isNestPanelVisible` forward `event.key` to `hud.handleNestKey(key)` (1-4 select slot, [ ] cycle; returns true when consumed - then do not treat as game input). Remove the old `M` = mute binding (mute now in pause menu / `N`) and keep `hud.setMuted(audio.muted)` in sync (call at boot and after toggles).
5. State getters for Game: `hud.isPauseVisible`, `hud.isMapVisible`, `hud.isNestPanelVisible`, `hud.isModalOpen` (pause||map||intro), `hud.isOpenWorld`. Suggested: pause = stop sim stepping; map pauses nothing. Both must call `input.exitPointerLock()` on open (overlays are clickable only when unlocked) and suppress canvas clicks/RMB orders while open. `showPause()/hidePause()/showMap()/hideMap()` are also available individually.
6. `hud.showSaved()` is called automatically on `autosave` events; call it manually after a manual save only if not using `notifyPause`.
7. Onboarding card = existing intro overlay; Game's existing `hud.hideIntro()` on first input dismisses it. `hud.onIntroDismissed(cb)` unchanged.
8. Audio: `audio.consume(events, state)` unchanged; new cues are automatic.

## Public Interfaces/Exports Added
- HUD: `setWorld`, `isOpenWorld`, `onWaypoint`, `onEquip`, `setPauseCallbacks`, `isPauseVisible/showPause/hidePause/togglePause/notifyPause`, `setMuted`, `isMapVisible/showMap/hideMap/toggleMap`, `isNestPanelVisible`, `handleNestKey`, `isModalOpen`, `showSaved`; `HudExtras.{waypoint,frameMs,loadedChunks}`.
- Classes: `Minimap`, `WorldMap`, `PauseMenu` (+`PauseCallbacks`), `NestPanel`, `DebugOverlay`; module `uiHelpers` (see above).

## Verification Run
- `npx tsc --noEmit`: 0 errors. `npm test`: 37 files / 393 tests passed (one vitest-worker RPC timeout noise under concurrent load, no failures). `npm run build`: OK.
- Not browser-verified (Game wiring is T014); DOM/Canvas code is type-checked only, pure helpers unit-tested.

## Memory Notes
Appended to MEMORY.md ([T013 UI], [T013 Tests]). Key gotchas: re-call `setWorld` per Simulation; interactive overlays need pointer lock released; shell heredocs with quotes can fail in this tool (use Write/Python).
