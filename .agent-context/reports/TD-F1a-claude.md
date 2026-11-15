# TD-F1a - claude
**Status:** COMPLETED

## Completed Work
1. WorldMap Close button (44px, data-ref=close) + `onClose`; HUD wires to hideMap (Game uses hud.isMapVisible; no Game change). "M to close" kept.
2. `TouchControls.reset()`, optional `TouchSource.reset?()`, called from `InputController.clear()` (blur/visibility/modal/map paths).
3. Per-touch `moved` flag; `touchTapAllowed(..., moved=false)`; tests added.
4. Touch tap path: only non-target occluders count as cover (`tapGroundBlocked` pure helper + tests). Caveat: Alpha/followers are not in the pick candidate list, so V1's root cause is not confirmed by code reading; needs device check.
5. `lostpointercapture` ignored for touch pointers.
6. 4-toast eviction clears timer + toastByEl.
7. Duplicate `slotPurchased` case removed.
8. `toastDedupe` helper in uiHelpers + test; HUD uses it.
9. touch.css hides `.ibz-nest-buy em` under touch.
10. README limitation line updated.
11. setSlots compares counts/keys/names in a loop (no string build).

## Remaining Work
None. No Game.ts patch needed.

## Public Interfaces
`WorldMap.onClose`, `TouchControls.reset`, `TouchSource.reset?`, `touchTapAllowed(...,moved)`, `tapGroundBlocked`, `toastDedupe`.

## Verification Run
tsc clean; npm test 43 files / 449 tests pass; npm run build OK.

## Memory Notes
Appended [TD-F1a] to MEMORY.md.
