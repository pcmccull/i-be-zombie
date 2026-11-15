# TD-T001 — orchestrator
**Status:** COMPLETED
**Completed Work:** types.ts (`ProgressionState.slotsOwned`, `GameState.atCapacity`, `SimInput.buySlot` + emptyInput, `abilityDenied` reason `maxSlots`, event `slotPurchased{slot,cost}`, `PlayerSave.slotsOwned`); contracts.ts (`AbilityDenyReason` + `maxSlots`, ProgressionSystem doc block for slots); balance.ts (`progression.slotCosts [0,40,70,110]`, `horde.capNoticeRearm 4`, `touch.*`, `save.version 2`); createInitialState defaults (`atCapacity:false`, `slotsOwned:0`). Shims: saveSchema `MIGRATIONS[1]` (version bump only), slotsOwned written/parsed/applied (default 0); InputController `buySlot:false`.
**Remaining Work:** none (behaviour lands in T002–T006).
**Public Interfaces/Exports Added:** see ARCHITECTURE §TD-2.
**Verification Run:** `npx tsc --noEmit` 0 errors; `npm test` 40 files / 415 passed.
**Memory Notes:** ProgressionSystem ignores `slotsOwned` until T003, so pre-T003 behaviour is unchanged.
