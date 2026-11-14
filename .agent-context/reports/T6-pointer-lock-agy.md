# Task Report — T6-pointer-lock (agy)

- **Task ID & Agent:** `T6-pointer-lock` — `@agy-worker`
- **Status:** `COMPLETED`

## Completed Work

- **[src/core/cameraMath.ts](../../src/core/cameraMath.ts):**
  - Added named camera-feel constants `MIN_CAMERA_PITCH`, `MAX_CAMERA_PITCH`, `MOUSE_LOOK_SENSITIVITY` (`0.005` rad/px), and `POINTER_LOCK_SPIKE_PX` (`300` px).
  - Added pure helpers `clampCameraPitch`, `computeOrbitDelta`, `applyOrbitDelta` (matching drag sign conventions: `+dx` orbits right `-yaw`, `+dy` tilts up `+pitch`, clamped to `[20°, 78°]`, using pre-allocated `out` objects), `shouldRequestLock`, `shouldReleaseLock`, and `isInitialLockJump`.
- **[src/core/ThirdPersonCamera.ts](../../src/core/ThirdPersonCamera.ts):**
  - Updated `addOrbit(dxPx, dyPx)` to use `applyOrbitDelta` and `MOUSE_LOOK_SENSITIVITY` with a reusable scratch object.
- **[src/core/InputController.ts](../../src/core/InputController.ts):**
  - Added Pointer Lock support on the game canvas (`isLocked` getter, `exitPointerLock()`, `tryRequestPointerLock()`).
  - Left-clicking the canvas while unlocked requests `canvas.requestPointerLock()` (dismissing the intro via `onGesture` without selecting or pinging a target). Never requests lock on keyboard input alone or while the help panel or victory/defeat overlay is open.
  - Added `document` `'mousemove'`, `'pointerlockchange'`, and `'pointerlockerror'` listeners registered through `this.listeners.signal` (`AbortController`).
  - While locked, `onMouseMove` feeds `event.movementX`/`event.movementY` into `deps.onOrbit` with zero per-event allocations and no drag threshold, ignoring the first movement event after locking if `|movementX| > 300 || |movementY| > 300` (Chrome quirk).
  - While locked, left-click picks/pings at the canvas centre `(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5)` using the existing `pick()` path (28 px tolerance and occlusion checks), right-click recalls, and `updateHover()` uses the canvas centre.
  - Silently falls back to drag mode if `requestPointerLock` / `pointerLockElement` is unsupported or `pointerlockerror` fires. Releases pointer lock on `dispose()`.
- **[src/core/Game.ts](../../src/core/Game.ts):**
  - Wired `canLock` using `shouldRequestLock` (`phase === 'playing'` and `!hud.isHelpVisible`).
  - Programmatically exits pointer lock when the `Tab` help panel opens and when `shouldReleaseLock` triggers on `'victory'` / `'defeat'`.
  - Passes `pointerLocked: this.input.isLocked` in `HudExtras`.
- **[src/ui/HUD.ts](../../src/ui/HUD.ts) & [src/ui/hud.css](../../src/ui/hud.css):**
  - Added palette-consistent centre crosshair (`.ibz-crosshair`, visible when locked during active play, turns amber `.is-target` when hovering a target).
  - Added subtle HUD hint (`"Click to capture mouse"`, `.ibz-capture-hint`) when unlocked during active play, and updated bottom-right control reminder text to show `"Esc to release mouse"` when locked and `"Click to capture mouse"` when unlocked.
  - Updated the `Tab` help panel rows and reset logic.
- **[README.md](../../README.md):**
  - Updated the `## Controls` table section with click-to-capture, mouse look while captured, centre-crosshair targeting, `Esc` to release, and drag-to-orbit fallback when not captured.
- **[tests/pointerLock.test.ts](../../tests/pointerLock.test.ts):**
  - Added 6 pure unit tests covering `computeOrbitDelta`, non-finite input guards, `applyOrbitDelta` & `clampCameraPitch`, `shouldRequestLock`, `shouldReleaseLock`, and `isInitialLockJump`.

## Remaining Work

- None.

## Public Interfaces/Exports Added

- `src/core/cameraMath.ts`:
  - `MIN_CAMERA_PITCH`, `MAX_CAMERA_PITCH`, `MOUSE_LOOK_SENSITIVITY`, `POINTER_LOCK_SPIKE_PX`
  - `OrbitDelta`, `CameraAngles`, `PointerLockDecisionState`
  - `clampCameraPitch`, `computeOrbitDelta`, `applyOrbitDelta`, `shouldRequestLock`, `shouldReleaseLock`, `isInitialLockJump`
- `src/core/InputController.ts`:
  - `InputController.isLocked: boolean`
  - `InputController.exitPointerLock(): void`
- `src/ui/HUD.ts`:
  - `HudExtras.pointerLocked?: boolean`
  - `HUD.isHelpVisible: boolean`

## Verification Run

- `npx tsc --noEmit`: **0 errors** (exit code 0)
- `npm test` (`vitest run`): **24 test files passed, 213/213 tests passed, 0 failed, 0 skipped**
- `npm run build` (`tsc --noEmit && vite build`): **Succeeded** (`dist/index.html` 0.94 kB, `dist/assets/index-BynoXZfS.css` 11.10 kB, `dist/assets/index-CCxt-RAE.js` 724.98 kB)

## Memory Notes

- Calling `element.setPointerCapture(pointerId)` while an element is pointer-locked can throw `InvalidStateError` in Chromium; `InputController` skips `setPointerCapture`/`releasePointerCapture` while `isLocked` is true and wraps capture calls in `try/catch`.
- Modern Chromium returns a `Promise` from `canvas.requestPointerLock()` that rejects with `SecurityError` if requested during the post-`Esc` cooldown; catching the promise in `tryRequestPointerLock()` prevents unhandled rejection warnings while falling back cleanly to drag mode.
