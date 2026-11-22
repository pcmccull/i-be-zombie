# EW-T006 — Eyesight progression + save v3 (agy-worker)

- **Task ID & Agent:** EW-T006, agy-worker (dispatched via `agy --model gemini-4-argon -p`; agy returned quota error before editing; report written by the Claude wrapper per the quota fallback step)
- **Status:** QUOTA_EXHAUSTED

## Completed Work
- None. agy exited on the first call with `RESOURCE_EXHAUSTED (code 429): Individual quota reached ... Resets in 134h51m23s` (error_id 5dde4ff8-5eb8-460e-986a-1b660e665a99-8). No work was written.
- Workspace check after the failure (`git status --short`, `git diff --stat`): none of the locked files has unstaged or new changes.
  - `src/systems/ProgressionSystem.ts`: unchanged (no `visionCost` / `buyVision` yet).
  - `src/persistence/saveSchema.ts`: only the T001 staged shim (`MIGRATIONS[2]` with visionTier and 12 district defaults, no fog remap). No unstaged diff.
  - `tests/progression.test.ts`, `tests/persistence.test.ts`, `tests/slots.test.ts`: unchanged.
  - `tests/visionProgression.test.ts`: does not exist.
  - `.agent-context/MEMORY.md`: has unstaged lines, but they were added by the orchestrator, not by this task.
- Nothing was run for verification (no `tsc` / `npm test` run by this task).

## Remaining Work (exact, for the fallback agent)
1. `src/systems/ProgressionSystem.ts`
   - Add `export function visionCost(state: GameState): number | null`: returns `BALANCE.vision.tierCosts[state.progression.visionTier]`, and `null` when `visionTier >= 4`.
   - Add `export function buyVision(ctx: SimContext): boolean`. Use a `deny(reason)` helper, as `buySlot` does, that emits `abilityDenied { abilityId: null, reason }`. Checks in order:
     1. `phase === 'playing'` and leader alive with `hp > 0`, else `'locked'`.
     2. `visionTier < 4`, else `'maxVision'`.
     3. `leaderAtActiveNest(ctx)`, else `'notAtNest'`.
     4. `biomass >= cost`, else `'biomass'`.
   - On success: `biomass = max(0, biomass - cost)`, `visionTier++`, emit `{ type: 'visionUpgraded', tier, cost }` then `{ type: 'autosave', reason: 'equip' }`, return `true`.
   - In `updateProgression`, add `if (input.buyVision) buyVision(ctx);` next to the `buySlot` edge.
   - Do not touch `state.vision`.
2. `src/persistence/saveSchema.ts` (CRLF; keep it)
   - In `MIGRATIONS[2]`, remap `discoveryBits`: decode with `decodeBits(s, 20 * 16)`, where the v2 grid is 20 cols × 16 rows (cellSize 20, origin x −200 / z −160). For every set bit at `row * 20 + col`, set bit `(row + 17) * 42 + (col + 11)` in a `Uint8Array(42 * 34)`, then `encodeBits`. The v3 grid is 42 × 34 (origin −420 / −500). If `discoveryBits` is not a string, leave it unchanged. Never throw.
   - Add default stronghold records to the v2→v3 migration (`STRONGHOLDS` ids that are missing). Parse already fills defaults; the migration should do so too for consistency.
   - Verify that `parseSave` keeps the chain v1→v2→v3 working and that `visionTier` round-trips through create/parse/apply (already present; verify with tests).
3. Tests
   - NEW `tests/visionProgression.test.ts`: fresh tier 1; `visionCost` 20/60/120/null; `buyVision` denials (`notAtNest`, `biomass` with biomass unchanged, `maxVision` at tier 4, `locked` while respawning or dead); success spends exactly the cost once (two inputs in one step, or two steps with just enough biomass, yield one upgrade) and emits `visionUpgraded` + `autosave`; input edge via `updateProgression`; tier persists through `createSave` → JSON → `parseSave` → `applySave`.
   - `tests/persistence.test.ts`: hand-built v2 save loads with tier 1 and 16 district records; set bit at v2 (c, r) lands at v3 (c+11, r+17) with no other bits; v1 save still loads; corrupt fog string yields `null`.
   - `tests/progression.test.ts` / `tests/slots.test.ts`: update only if the new edge changes them.
4. Run `npx tsc --noEmit` and `npm test`. Failures in `tests/navScale`, `navigation`, `collision` belong to EW-T004 and must be reported, not fixed.
5. Append Memory Notes to `.agent-context/MEMORY.md` (file is CRLF).

## Public Interfaces/Exports Added
- None yet. Planned: `visionCost(state): number | null` and `buyVision(ctx): boolean` in `src/systems/ProgressionSystem.ts`.

## Verification Run
- `agy --model "gemini-4-argon" -p "<EW-T006 brief prompt>" </dev/null`: FAILED, `RESOURCE_EXHAUSTED (code 429)`, reset in 134h51m.
- `git status --short` / `git diff --stat` on locked files: no edits by this task.
- `tsc` and `npm test`: not run (no code changes).

## Memory Notes
- **[EW-T006 quota]** agy-worker hit `RESOURCE_EXHAUSTED` 429 on 2026-11-15 with a 134h reset before touching files. Fallback per policy: `@claude-worker` or `@codex-worker` takes EW-T006 from Remaining Work above. Orchestrator should mark `@agy-worker` unavailable in PROGRESS.md for this session.
- **[EW-T006 fog remap]** v2 fog is 20 × 16 (origin −200/−160, index row*cols+col). The v3 grid is 42 × 34 (origin −420/−500), so the offset is col +11, row +17. The current `MIGRATIONS[2]` does not remap fog, so v2 bits land in the wrong cells (no crash).
