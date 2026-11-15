# TD-F1b — orchestrator (save fixes from TD-V2, while F1a ran)
**Status:** COMPLETED
**Completed Work:**
- V2 P2-3: `parseSave` and `applySave` now sanitize the loadout against all 4 slots first, then `reconcileSlots(raw slotsOwned, unlocked, loadout)`, then trim — a missing or too-low `slotsOwned` raises ownership to cover the saved loadout instead of wiping it (ARCHITECTURE TD-0 "never lose a loadout"). `reconcileSlots(owned: unknown, …)` clamps non-integers to 0.
- V2 P3-1: v1→v2 migration counts only valid `slot` abilities in `equippedAbilities` (garbage ids / innate ids no longer mint slots).
- tests/slots.test.ts: replaced "applySave drops entries beyond owned" (old wipe behaviour) with "never wipes a valid loadout"; added "v2 save missing slotsOwned keeps its loadout" and "v1 migration ignores garbage/innate ids".
**Remaining Work:** none.
**Verification Run:** `npx vitest run tests/slots.test.ts tests/persistence.test.ts` 22/22; tsc: no errors in saveSchema/slots test.
**Memory Notes:** Save rule: ownership is reconciled UP to the loadout, never the loadout trimmed DOWN to a saved count. A hand-edited save can therefore grant slots; acceptable (saves are local and createSave always writes consistent values).
