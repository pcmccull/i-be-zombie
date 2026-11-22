# EW-T004 — Scale navigation & collision to the 4×4 world (codex)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5 at the top), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, upstream reports `.agent-context/reports/EW-T001-orchestrator.md` and
`.agent-context/reports/EW-T002-codex.md` (real content: 212 buildings, 434 colliders, 328 humans).

## Locked files (edit ONLY these)
- `src/world/NavigationGrid.ts`, `src/world/CollisionWorld.ts`
- `tests/navScale.test.ts`, `tests/navigation.test.ts`, `tests/collision.test.ts`

Never edit types/contracts/balance/content, layout files, systems or other tests. Another worker (EW-T006) is editing
`src/systems/ProgressionSystem.ts`, `src/persistence/saveSchema.ts` and tests progression/persistence/slots/visionProgression
in parallel: failures there are not yours; report them. Keep every public API in `contracts.ts`
(`ICollisionWorld`, `INavigationGrid`, `IFlowField`) unchanged — signature-compatible, same semantics.

## Goal
The world grew from 400 × 320 m to 840 × 680 m (`BALANCE.openWorld.bounds`), so nav grids are ~4.5× larger (two grids:
`navGrid` + `crawlNavGrid`). Make the hot paths scale with the work they do, not with world size:
1. **Flow fields:** no whole-array `fill` per rebuild. Bounded fields (bound radius / max cost) must reset only the cells
   they touched last time (touched-cell list / generation stamps). Results must equal the current algorithm's output
   (same distances, directions, goal indices) — add an equivalence test against a reference full build on a small grid
   and a real-layout sample.
2. **Grid build / rebuild:** rasterize from enabled blocksMove colliders efficiently (per-collider cell ranges, typed
   arrays, no per-cell allocation). `rebuild()` after a gate/structure destroy must stay cheap; consider a dirty-rect
   rebuild for a single disabled collider if it keeps results identical to a full rebuild (test it).
3. **`findPath` / LOS:** bounded node budget, no per-call allocation of world-size arrays (reuse with stamps).
4. **CollisionWorld broad phase:** grid cell size sensible for 434+ colliders over the new bounds; queries allocation-free.
5. Boot cost: `new CollisionWorld(layout.bounds, layout.colliders)` + both nav grids for `buildDistrictLayout()` should be
   well under the old budget per cell; measure and report numbers (ms) before/after in your report.

## Tests
- `tests/navScale.test.ts`: update to the real 4×4 layout. Standalone and under-load thresholds (keep them generous enough
  for CI noise, e.g. ×3 headroom over your measured median, and say so in the report): world build, 20 bounded field
  rebuilds, one full field, findPath across the world, rebuild after disabling a structure collider.
- Equivalence tests (bounded/incremental vs reference) as above.
- Keep `tests/navigation.test.ts`, `tests/collision.test.ts` green; extend where you change behaviour.
- Heavy tests: explicit timeouts (≥ 60 s) and yield in long loops (`await new Promise(r => setTimeout(r, 0))`, MEMORY [T012 Tests]).

## Done when
`npx tsc --noEmit` and `npm test` pass (all files). Write `.agent-context/reports/EW-T004-codex.md` (AGENTS.md format, with
timing numbers) and append Memory Notes to `.agent-context/MEMORY.md`.
