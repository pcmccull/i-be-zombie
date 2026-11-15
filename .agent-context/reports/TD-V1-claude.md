# TD-V1 - claude (fallback for agy-architect), spec audit, read-only
**Status:** COMPLETED

## Completed Work
Audited `git diff HEAD` against docs/todos.md 7-9 and ARCHITECTURE TD-0..TD-4. All TD-0 decisions and TD-2 shapes are present. TD-4 invariants 1-9 all have tests.

## Findings
P1-1 Touch players cannot close the world map (parity break). `src/ui/touch.css:7` puts the touch root at z-index 12. `.ibz-worldmap` is `position:absolute; inset:0; z-index:20` (`src/ui/hudOpenWorld.css:387`), so it covers the MAP and PAUSE buttons. The map card has no close button (`src/ui/WorldMap.ts:76` says "M to close"). Esc and M are keyboard-only. Once a touch user opens the map they are stuck: the only hit targets are the waypoint canvas and "Clear waypoint". Fix: add a Close button (`data-ref="close"` plus an `onClose` callback) to the WorldMap header and wire it in HUD/Game to `hideMap()`. Optionally raise the touch root above 20 while the map is open. Owners: `src/ui/WorldMap.ts` (+ `src/ui/HUD.ts` wiring, `src/ui/hudOpenWorld.css`). Tapping outside the card is not enough, because the canvas click sets a waypoint.

P2-1 README.md:286 is stale. It still says "Desktop only ... There is no mobile or touch control", which contradicts the new Touch controls section (README.md:107-123). Fix: reword that limitations bullet. Owner: README.md.

P2-2 Nest panel on touch is only checked in an emulated 375x812 viewport. Equip and buy work by tap (click on `[data-slot]`, `[data-ability]`, `[data-buy]`). The keyboard hint `.ibz-nest-hint` is hidden under touch (touch.css:~247), but the `<em>(B)</em>` inside the buy button (`src/ui/NestPanel.ts` render) stays visible. Fix: hide `.ibz-nest-buy em` under `body.ibz-touch-active` in `src/ui/touch.css`. Do a real-device pass to confirm the panel does not overlap the slot buttons or ATTACK.

P2-3 No automated test for HUD toast dedupe or for Game wiring of buySlot (pendingBuySlot -> `SimInput.buySlot` for one step). Both were verified only in the T007 browser run. TD-4 does not require them, but the UI half of todo #8 rests on manual evidence. Fix: extract the dedupe decision into a pure helper in `src/ui/uiHelpers.ts` and unit-test it in `tests/uiHelpers.test.ts`.

P2-4 (known, from T007, unfixed) A tap or RMB whose ray first hits the Alpha or a follower issues no order (InputController "solid hit before ground" rule). On touch this is far more noticeable: taps just below screen centre, where the Alpha sits, do nothing. This weakens "tap-to-order" (todo #7). Fix: for touch taps, skip leader/follower hits and fall through to the ground or first enemy/structure. Owner: `src/core/InputController.ts` (touch tap path).

P3-1 Duplicate `case 'slotPurchased':` in `src/ui/uiHelpers.ts:363` and `:365`. tsc accepts it, but the second is dead code. Fix: delete one.

P3-2 NestPanel stays hidden at slotsOwned 0 (T004 did not show the "Capture a stronghold..." hint). Consistent with todo #9 (hide until first unlock); no action.

P3-3 The capacity latch timer is a module-level `WeakMap<GameState, number>` (`src/systems/HordeSystem.ts:66`). It is keyed by state, so restart is clean, but it is invisible in `GameState` and not saved. Acceptable; no action.

## Requirement-by-requirement check
- TD-0/TD-2 types and balance: present. `ProgressionState.slotsOwned`, `GameState.atCapacity`, `SimInput.buySlot`, event `slotPurchased{slot,cost}`, `PlayerSave.slotsOwned`, `AbilityDenyReason 'maxSlots'`. Balance: slotCosts [0,40,70,110], capNoticeRearm 4, touch.*, save.version 2.
- ProgressionSystem: `ownedSlotCount`, `nextSlotCost` (null at 0 or all owned), `buySlot` (denials locked/maxSlots/notAtNest/biomass; atomic spend; `slotPurchased` + autosave 'equip'). First slot unlock grants slot 1; auto-equip only into an owned empty slot; equip into an unowned slot denied 'locked'; activating one denied 'empty'. Matches TD-2.
- Save v2: `MIGRATIONS[1]` derives slotsOwned = max(highest equipped index + 1, any slot ability unlocked ? 1 : 0), clamped. create/parse/apply reconcile it. The stronghold-unlock grant path in applySave also grants slot 1.
- Capacity (todo #8): latch emits `capReached` only on false->true, rearms after 4 s continuously below cap, flash set only on the transition. At-cap early-outs skip `segmentBlocked` in passive and rally recruitment; pulses are consumed. HUD dedupe restarts the timer on identical text.
- Touch (todo #7): `touchMath`, `TouchControls` (API per TD-2), `InputController.setTouchSource/queueAttack/queueAbility/queueCommand`, 1-finger orbit, pinch zoom, tap -> horde order, stick sprint at threshold, lowDpr, viewport meta, boot detection by `(pointer: coarse)` plus first touch pointerdown. Game wires attack/regroup/follow/ability/map/pause/recenter and `setSlots` with owned slots only.
- UI bindings: HUD slot strip hidden at 0 and owned-only. Nest panel Buy button (dimmed but clickable when unaffordable; `B` key). `HUD.onBuySlot` -> `Game.pendingBuySlot`. `slotPurchased` toast and 'maxSlots' deny text. README documents slot purchase and touch (except the stale line, P2-1).
- Parity: touch can buy and equip at a nest (tap), open pause (II button; Continue/Save/Mute/Reset are tap-clickable; pause z-index 30 is above the touch root), open the map but NOT close it (P1-1), use owned ability slots, rally/follow/attack, recenter. Mute is reachable via pause.

## TD-4 invariant -> test
1. tests/capacity.test.ts "emits capReached exactly once while held at cap for 60 s"
2. tests/capacity.test.ts "does not re-emit after a short dip, and re-arms after a long one"
3. tests/capacity.test.ts "skips recruitment LOS scans at cap and still consumes due pulses" (with below-cap contrast)
4. tests/slots.test.ts "starts with no slots and no next cost", "first slot unlock grants slot 0 and equips there". The "HUD shows no slots" half is covered only via `visibleSlotCount` in tests/uiHelpers.test.ts; the DOM strip is untested (P2-3).
5. tests/slots.test.ts "a second unlock with one slot is unlocked but not equipped (slot null)"
6. tests/slots.test.ts "buySlot denials: locked (0 slots / dead), notAtNest, biomass, maxSlots", "buySlot spends exactly the cost, emits once, and walks all escalating costs", "exact-cost purchase leaves biomass at zero, never negative"
7. tests/slots.test.ts "slots >= slotsOwned cannot be equipped or activated"
8. tests/slots.test.ts "round-trips slotsOwned through createSave / parseSave / applySave", "migrates a v1 save with 3 equipped abilities to slotsOwned 3 with the same loadout" (+ clamp and other migration cases)
9. tests/touchMath.test.ts (forward/right, dead zone, clamp, sprint threshold)
No invariant is MISSING.

## Verification Run
- `npx tsc --noEmit`: clean.
- `npx vitest run`: 43 files, 446 tests passed.
- No source, test or doc files modified.

## Memory Notes
Appended a [TD-V1] bullet to MEMORY.md: the touch overlay (z-index 12) sits below full-screen modals (map z-index 20), so any modal opened from a touch button needs its own on-screen close control.
