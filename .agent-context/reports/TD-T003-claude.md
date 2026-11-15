# TD-T003 (claude-worker, fallback for codex)
**Status:** COMPLETED
## Completed Work
- ProgressionSystem.ts: ownedSlotCount, nextSlotCost, buySlot (denials locked/maxSlots/notAtNest/biomass; spends exact cost; slotPurchased + autosave{equip}); unlock grants slot 1 and auto-equips only into owned empty slots; equip denies slot >= owned; abilitySlot >= owned => 'empty'; updateProgression handles input.buySlot; isEquipped ignores unowned slots; shared leaderAtActiveNest helper.
- saveSchema.ts: real MIGRATIONS[1]; create/parse/apply handle slotsOwned with reconcile; sanitizeEquipped takes owned count; 4b stronghold unlock grant also grants slot 1.
- tests/slots.test.ts new (10 tests); existing tests in progression, persistence, rush, openWorld, alphaCombat set slotsOwned = 4 in setup.
## Remaining Work
None.
## Public Interfaces/Exports Added
ownedSlotCount(state), nextSlotCost(state), buySlot(ctx) from ProgressionSystem.
## Verification Run
- npx tsc --noEmit: clean. npx vitest run: 443/444 passed; sole failure tests/capacity.test.ts (T002 file, mid-edit by another worker) passed on isolated rerun (3/3). hordeCommands/uiHelpers not broken.
## Memory Notes
See MEMORY.md [TD-T003].
