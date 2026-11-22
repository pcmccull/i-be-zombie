# EW-T006 — Eyesight progression + save v3 (claude-worker, failover from agy)

- **Task ID & Agent:** EW-T006, claude-worker
- **Status:** COMPLETED (locked-file scope; see Verification for full-suite note)

## Completed Work
- `src/systems/ProgressionSystem.ts`: `visionCost`, `buyVision` (order locked -> maxVision -> notAtNest -> biomass; spends once; emits visionUpgraded + autosave 'equip'), `updateProgression` handles `input.buyVision`. `state.vision` untouched.
- `src/persistence/saveSchema.ts` (CRLF kept): `MIGRATIONS[2]` now also remaps fog 20x16 -> 42x34 (col+11,row+17; invalid base64 left as-is so parse returns null) and fills default stronghold records.
- NEW `tests/visionProgression.test.ts` (8 tests); `tests/persistence.test.ts` gained a v2->v3 migration describe (3 tests). progression/slots tests unchanged.

## Remaining Work
- None.

## Public Interfaces/Exports Added
- `visionCost(state): number | null`, `buyVision(ctx): boolean` in ProgressionSystem.

## Verification Run
- `npx tsc --noEmit`: pass.
- `npx vitest run` visionProgression, persistence, progression, slots: 53/53 pass.
- Full `vitest run`: see orchestrator note below if updated; failures in navScale/navigation/collision belong to EW-T004.

## Memory Notes
- v2->v3 fog remap implemented in MIGRATIONS[2]; fog "bits" are one byte per cell (Uint8Array), encoded as base64.
- Full suite is slow (>3 min) while EW-T004 is in flux.
