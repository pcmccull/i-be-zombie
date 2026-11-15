# TD-T006 (claude)
**Status:** COMPLETED

## Completed Work
- src/core/InputController.ts: TouchSource interface, setTouchSource/queueAttack/queueAbility/queueCommand, stick merge in buildSimInput, touch pointer path (orbit, tap -> horde order, pinch zoom), clear() resets touches.
- src/core/cameraMath.ts: touchGestureMode, touchTapAllowed.
- src/core/Game.ts: buy-slot wiring (pendingBuySlot -> input.buySlot one step), TouchControls creation/enable/dispose, button wiring, per-frame owned-slot views, DPR cap (BALANCE.touch.lowDpr) at both setPixelRatio sites, handleKeyAction shared by keys and touch.
- index.html: viewport meta, touch-action none, overscroll-behavior none.
- README.md: Ability slots + Touch controls sections.
- tests/input.test.ts: touch gesture tests.
- 'b' key needed no change: onUiKey already forwards all keys to hud.handleNestKey while the nest panel is visible.

## Remaining Work
None. Not verified on a real touch device or in a headless browser (no smoke test run).

## Public Interfaces/Exports Added
InputController.setTouchSource/queueAttack/queueAbility/queueCommand, exported `TouchSource`; cameraMath `touchGestureMode`, `touchTapAllowed`, `TouchGestureMode`.

## Verification Run
- npx tsc --noEmit: pass
- npm test: 43 files, 446 tests passed
- npm run build: pass

## Memory Notes
See [TD-T006] in MEMORY.md.
