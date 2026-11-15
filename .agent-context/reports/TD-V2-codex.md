# TD-V2 — Adversarial review of the TD (todos 7–9) uncommitted change

**Task ID & Agent:** TD-V2 · codex (read-only adversarial review). Report written by the Claude orchestrator on codex's findings, since the read-only sandbox cannot write files. Codex's first run exited with no output; the second run (the one used here) produced findings.

**Status:** COMPLETED (no quota error; no source or test files edited)

## Completed Work

- Reviewed `git diff HEAD` (ignoring untracked `assets/` and `docs/4_intro_scene.md`) across HordeSystem, ProgressionSystem, saveSchema, uiHelpers, HUD, NestPanel, TouchControls, InputController, Game, touchMath, cameraMath.
- Codex ran in-memory checks for the capacity latch, same-step activation plus purchase, malformed v1 rejection and the stronghold slot grant. All passed.
- No P1 findings.

## Findings

### P2

**P2-1. Joystick stays stuck after blur, visibility change, modal toggle or restart.**
- Where: `src/ui/TouchControls.ts:63-65` (only `pointerup`/`pointercancel` release the stick), `src/core/InputController.ts:213-225` (`clear()` resets touches, not the stick), `:480-481` (`onBlur`/`onVisibility` call only `clear()`).
- Failure scenario: the player holds the stick, switches apps, and the `pointerup` never arrives. `stick.moveForward` stays at 1. On return the Alpha walks forever. The next stick press is also rejected, because `onStickDown` returns early while `stickPointer !== null` (`TouchControls.ts:174`).
- Fix: add `TouchControls.reset()` that calls `releaseStick()`. Call it from `InputController.clear()` through an optional `TouchSource.reset?()`. Also release the stick on `lostpointercapture` and when the stick element is removed.

**P2-2. A drag that returns near its start is counted as a tap and issues a move or attack order.**
- Where: `src/core/InputController.ts:425-440` and `:442-458`. `touchTapAllowed` (`src/core/cameraMath.ts`) compares only the displacement at lift-off with the start point. It ignores the path travelled.
- Failure scenario: a finger drags 150 px to orbit the camera, swings back to the start, and lifts within 280 ms. The result is a horde move order on the ground under the finger, even though the player was orbiting.
- Fix: add a per-touch `moved` flag (or track max travel). Set it in `onTouchMove` once the distance from `startX`/`startY` exceeds `BALANCE.touch.tapMaxMove`, and pass `!t.moved` into `touchTapAllowed`.

**P2-3. A v2 save with `slotsOwned` missing (or 0) drops every equipped ability.**
- Where: `src/persistence/saveSchema.ts:333` (`parseSave` sets `slotsOwned = clampSlots(player.slotsOwned)` and passes it to `sanitizeEquipped` before any reconciliation) and `:446-450` (`applySave`, same order).
- Failure scenario: a v2 save (hand-edited, or a missing field) has `equippedAbilities: ['rush', 'x', 'y', null]` and no `slotsOwned`. Sanitisation with `owned = 0` nulls all four entries. `reconcileSlots` then restores `slotsOwned` to 1, so the loadout is gone and the next autosave persists the loss.
- Contradicts ARCHITECTURE TD-0, which says a missing `slotsOwned` must be derived as `max(highest equipped index + 1, slot unlocked ? 1 : 0)`.
- Likelihood is low: `createSave` always writes a reconciled value, so only malformed or hand-edited saves reach this.
- Fix: in both `parseSave` and `applySave`, when the raw field is absent, derive owned from the raw equipped array and unlocked list before calling `sanitizeEquipped`. Route through `reconcileSlots` first, then sanitise. An explicit 0 keeps its current meaning.

### P3

**P3-1. The v1→v2 migration counts garbage entries as owned slots.**
- Where: `src/persistence/saveSchema.ts:31-33`. It checks `id !== null && id !== undefined` but does not check `isAbilityId(id)` or `slotBehavior === 'slot'`.
- Failure scenario: a v1 save with `equippedAbilities: ['bogus', null, null, null]` migrates to `slotsOwned = 1`. That grants a free slot.
- Fix: count an index only when `isAbilityId(id) && ABILITIES[id].slotBehavior === 'slot'`, matching the unlocked-list check below it.

**P3-2. Duplicate `case 'slotPurchased'` in `toastForEvent`.**
- Where: `src/ui/uiHelpers.ts:363` and `:365`. Vitest reports an esbuild warning on this file. The second case is unreachable.
- Fix: delete one of the two.

**P3-3. Module-level WeakMap is mutable state, against the AGENTS.md rule.**
- Where: `src/systems/HordeSystem.ts:66` (`belowCapFor`).
- Restart is safe today, because `Simulation.reset` creates a new `GameState` and so a new WeakMap key. `applySave` onto an existing state does not reset `atCapacity`, so the latch could carry over if that state object were ever reused.
- Fix: keep the re-arm counter on `GameState` (a field alongside `atCapacity`, reset by `createInitialState`), or on a per-sim context object.

**P3-4. The capacity notice fires for zombies behind walls.**
- Where: `src/systems/HordeSystem.ts` leader loop, around `:610-611`. `noteCapacityRefusal` latches before the `segmentBlocked` check.
- Failure scenario: the horde is at cap, and the leader walks past a compound wall with ambient zombies on the far side. The "HORDE CAPACITY REACHED" toast and the HORDE FULL badge show, although no zombie was actually refused.
- This matches the TD-0 "no LOS test" note, so it is a design choice. If the notice should mean a real refusal, run `segmentBlocked` only while `!atCapacity`. That costs one check per latch, not one per step.

**P3-5. Evicted toast nodes keep their timers until they fire.**
- Where: `src/ui/HUD.ts:1417-1420`. Nodes evicted by the 4-toast cap stay in `toastByEl` and `toastTimers` until their timer fires (at most 3.6 s), then clean up. No persistent leak.
- Fix: on eviction, clear the timer and delete the map entry.

**P3-6. Per-frame allocation in the touch slot path.**
- Where: `src/core/Game.ts` `updateTouchSlots` (called every `updateHud`) calls `abilitySlotView` per slot. `src/ui/TouchControls.ts:114` builds a signature string every frame.
- Cost is small. Compare fields directly, or cache the signature and rebuild only when `slotsOwned` or the equipped array changes.

**P3-7. A touch finger can be dropped silently by `lostpointercapture`.**
- Where: `src/core/InputController.ts:110` and `:466`. `lostpointercapture` maps to `onPointerCancel`, which for touch calls `onTouchUp(commit=false)`.
- Failure scenario: a browser drops capture while the finger is still down. That finger is removed from `touches` and stops orbiting. A two-finger pinch can drop to orbit with one finger.
- Fix: for touch, end a finger only on `pointerup` or `pointercancel`. Ignore `lostpointercapture`.

**P3-8. Cosmetic: pressed-state timer not cleared on dispose.**
- Where: `src/ui/TouchControls.ts:163`. The `setTimeout` that removes `is-pressed` is not tracked. It is harmless because it only touches a detached node.

## Areas checked and found clean

- **Capacity latch:** re-arms after a 4 s continuous dip and does not re-arm on a short dip. Pulses are consumed at cap (`pulseAt = -1`) and never left pending. Reset gives a fresh state with `atCapacity` false. Codex's in-memory run confirmed one notice across 60 s at cap.
- **buySlot:** biomass cannot go negative (checked before spending, plus `Math.max(0, …)`). Slot index is correct (`slot = owned`, cost `slotCosts[owned]`). Same-step buy plus activation is ordered correctly.
- **Unlock and equip into unowned slots:** denied or left unequipped. `isEquipped` ignores entries at or beyond `slotsOwned`. `canActivate` goes through `isEquipped`.
- **Pinch sign:** `(prev − dist) × scale` gives negative (zoom in) when fingers spread. `zoomTarget` grows the distance on positive input, so this matches wheel semantics.
- **Multi-touch tap suppression:** `touchMulti` stays set until the last finger lifts, so a pinch never fires a tap.
- **Stick input while modal:** ignored by `buildSimInput`.
- **Stronghold slot grant in `applySave`:** correct.
- **Listener cleanup:** `TouchControls.dispose` aborts its AbortController. `Game.dispose` removes the window capture listener and calls `touch.dispose()`.

## Verification Run

- `npx tsc --noEmit`: PASS (exit 0).
- `npx vitest run tests/capacity.test.ts tests/slots.test.ts tests/touchMath.test.ts tests/uiHelpers.test.ts tests/input.test.ts`: 5 files, 48 tests, all PASS. Vite logged an esbuild warning for the duplicate `case` in `uiHelpers.ts` (P3-2).
- Full `npm test` was not run by this review. Codex's read-only sandbox could not write Vite temp files, so the codex run could not do it either.
- Codex run 1 returned no output (exit 0). Codex run 2 returned the findings above. Neither run was a quota error.

## Memory Notes

- [TD-V2] Touch stick is not reset by `InputController.clear()` (blur, visibility, restart). Any new input reset path must also release `TouchControls`' stick.
- [TD-V2] Tap detection uses lift-off displacement only. Gesture-level travel must be tracked per finger.
- [TD-V2] `parseSave`/`applySave` must derive `slotsOwned` from the equipped array when the field is absent, before sanitising. `createSave` always writes it reconciled, so the gap is reachable only through malformed saves.
- [TD-V2] The v1→v2 migration must validate ability ids before counting slots.
- [TD-V2] `belowCapFor` WeakMap in HordeSystem is module-level mutable state; move it onto `GameState` if the no-module-state rule is enforced strictly.
