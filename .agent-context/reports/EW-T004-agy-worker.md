# EW-T004 — agy-worker slot (work done by the Claude wrapper, not agy)

- **Task ID & Agent:** EW-T004 / @agy-worker failover from @codex-worker. The wrapper finished the work itself and never
  called `agy`; the report below was persisted by the orchestrator from the worker's hand-back message.
- **Status:** COMPLETED
- **Completed Work:**
  - NavigationGrid: incremental `rebuild()` (per-collider raster ranges, only changed footprints re-rasterized, ±1-cell
    connection recompute; a collider-count change forces a full build). `walkableCount` is maintained incrementally.
    `findPath` and `buildFlowField` reset through touched-cell lists, falling back to a bulk fill when a search touches
    more than 1/4 of the grid. Connectivity is cached as 8-bit masks.
  - CollisionWorld: compressed typed-array buckets (8 m), DDA `segmentBlocked` with stamp dedupe, allocation-free
    `queryAABB`.
  - Tests:
    - collision: 4000 random segments checked against a brute-force reference.
    - navigation: incremental rebuild vs a fresh full build after 60 toggles; reused vs fresh flow fields.
    - navScale: 6 tests on the real 4×4 layout (timings with under-load budgets; incremental toggles vs fresh builds).
- **Timings (real layout, 672×544 cells/grid, before → after):**
  - world build 29 → 12 ms
  - gate rebuild (both grids) 24.2 → 0.38 ms
  - structure rebuild 23.6 → ~0.5 ms
  - findPath across the world 10–18 → 9–12.5 ms
  - full flow field: parity, ~55–75 ms
- **Budgets:** asserted at the under-load tier (`npm test` runs files in parallel, ~7× slower than in isolation): world
  build 450 ms, bounded ×20 40 ms, full field 800 ms, findPath 150 ms. Structure rebuild must be < 0.5× a full rebuild.
- **Public Interfaces/Exports Added:** none (contracts unchanged).
- **Verification Run:**
  - worker: tsc 0, nav tests 51/51, npm test 559/559.
  - orchestrator re-run 08:28: tsc 0, npm test 50 files / 559 pass (128 s).
- **Not done:** broad-phase cell-size experiment; mutation check on the reset paths.
- **Memory Notes:** appended to `.agent-context/MEMORY.md` by the worker.
