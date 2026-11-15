# TD-T005 — orchestrator (agy-worker quota exhausted; built by the orchestrator while T002–T004 ran)
**Status:** COMPLETED
**Completed Work:**
- `src/core/touchMath.ts` [pure]: `StickOutput`, `createStickOutput`, `stickFromOffset(dx,dy,radius,deadZone,sprintThreshold,out)` (screen up = forward, dead zone rescaled, unit-clamped, sprint at threshold), `clampKnob`, `isTap`, `pinchZoomDelta` (>0 = zoom out, wheel sign), `touchDistance`.
- `src/ui/TouchControls.ts`: DOM overlay appended to the given root; left stick (pointer-captured by id, window move/up), top row PAUSE/MAP/CAM, right cluster owned-ability buttons + FOLLOW/RALLY + big ATTACK. API per ARCHITECTURE §TD-2: `enable/disable/isEnabled/readStick/containsPoint/onAttack/onRegroup/onFollow/onAbility/onMap/onPause/onRecenter/setSlots/dispose`. Buttons fire on pointerdown (preventDefault + stopPropagation). enable() adds `body.ibz-touch-active`.
- `src/ui/touch.css`: safe-area insets, targets >= 48 px, root `pointer-events:none`; hides `.ibz-slots` and `.ibz-minimap-hint` while touch is active.
- `tests/touchMath.test.ts`: 10 tests.
**Remaining Work:** wiring in T006 (InputController.setTouchSource + queue*, Game creates/enables, setSlots from abilitySlotView for owned slots).
**Verification Run:** `npx vitest run tests/touchMath.test.ts` 10/10; tsc: no errors in touch files.
**Memory Notes:** TouchControls buttons stopPropagation on pointerdown, but InputController listens on `window` pointerdown (capture) for first gesture — T006 must make canvas handlers ignore pointers that start on controls via `containsPoint` (canvas listener won't see them since targets are not the canvas, but window move/up listeners will).
