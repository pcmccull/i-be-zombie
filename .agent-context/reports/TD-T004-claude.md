# TD-T004 - claude (fallback for agy)

**Status:** COMPLETED (UI scope). Full `npm test` has 2 failures in files owned by other running tasks (see Verification).

## Completed Work
- uiHelpers.ts: `visibleSlotCount`, `nextSlotPrice`, `hasEmptyOwnedSlot`; deny text `maxSlots`; toast for `slotPurchased`; `toastForEvent(ev, state?)` gives "buy or free a slot at a nest" when no empty owned slot.
- HUD.ts: toast dedupe (same text restarts timer + `is-pulse`, 4-toast cap kept); slot strip hidden at 0 owned, only owned slots shown (open world only, updated on count change); `HUD.onBuySlot(cb)`.
- NestPanel.ts: owned slots only, "Buy slot <KEY> - N BIO" button (dimmed if unaffordable, still clickable), `onBuySlot`, `B` key, keys 1..N limited to owned. Panel opens when owned>0 and (equippable abilities or a slot to buy). Hint text for 0 owned is not shown, since the panel stays hidden at 0 owned (strip is hidden too).
- hudOpenWorld.css: buy button, hidden strip, toast pulse.
- tests/uiHelpers.test.ts: 4 new tests (12 total pass).

## Remaining Work
- TD-T006 wiring (below). The "Capture a stronghold..." hint requested for slotsOwned===0 is not visible because the panel is hidden then; say if you want it shown.

## Public Interfaces/Exports Added
`visibleSlotCount(state)`, `nextSlotPrice(state)`, `hasEmptyOwnedSlot(state)`, `toastForEvent(ev, state?)`, `NestPanel.onBuySlot(cb)`, `HUD.onBuySlot(cb)`.

Game.ts wiring needed:
```ts
let pendingBuySlot = false;
hud.onBuySlot(() => { pendingBuySlot = true; });
// when building SimInput for a step:
input.buySlot = pendingBuySlot; pendingBuySlot = false;   // exactly one step
```
Existing `handleNestKey` path already routes `B` through HUD nest key forwarding (key 'b'/'B' is consumed when a slot is buyable); make sure Game forwards lowercase/uppercase `b` to it while `isNestPanelVisible`.

## Verification Run
- `npx tsc --noEmit`: clean.
- `npx vitest run tests/uiHelpers.test.ts`: 12/12 pass.
- `npm test`: 429 pass, 3 fail at first run; failures are tests/slots.test.ts (v1 save migration, saveSchema - TD-T003) and tests/capacity.test.ts (HordeSystem latch - another task), none in UI files.
- `npm run build`: see coordinator summary (run at end).

## Memory Notes
Appended [TD-T004] bullet to MEMORY.md.
