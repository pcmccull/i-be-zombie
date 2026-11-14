# T003 implementation report

**Task ID & Agent:** T003 / codex

**Status:** COMPLETED

**Completed Work:**

- Modified `src/world/NavigationGrid.ts`: implemented optional `maxDistance` in meters. Dijkstra never enqueues cells with a larger path cost; unreachable cells retain Infinity distances and zero directions. Omission retains full-grid propagation. Zero is supported; negative/NaN limits throw RangeError.
- Retained whole-array resets for reused fields and search buffers. Added a reusable visited-cell buffer so direction generation visits only finalized cells, cached legal adjacency on grid rebuilds, and avoided general vector-length calculations for unit grid steps. No per-cell/per-agent allocations in the field search.
- Modified `src/systems/NavigationSystem.ts`: follow fields use `BALANCE.nav.flowFieldMaxDistance`; main/squad guard, structure, and gate attack fields use `max(flowFieldMaxDistance, distance(leader, target) + 60)`. Distant gate redirection tests gate access with the explicit-order bound rather than the shorter follow field, retaining the gate field without building it twice. Legacy throttling, shelter redirects and guard-field storage separation remain intact.
- Extended `tests/navigation.test.ts`: exact cutoff inclusion, fractional/zero bounds, invalid limits, and obstacle-detour path cost coverage.
- Extended `tests/fixes-nav.test.ts`: main/squad distant guard orders, structure orders, minimum bounds, distant gate redirection and direct gate orders.
- Created `tests/navScale.test.ts`: independent 400 x 320 m synthetic city with 1024 colliders/continuous streets and an additional 1536-collider broad-phase fixture. Tests compare full/bounded guidance at walkable cell centers, verify reuse clears distance/direction/goal-index data, benchmark 20 follow-field rebuilds, find a safe path across the world, and compare reusable local collision queries against brute-force overlaps.
- Measured `CollisionWorld` without changing it: the existing 8 m cells, stamped deduplication and caller/scratch output arrays scale adequately. Final standalone measurement: 20000 local queries in 16.25 ms (0.81 microseconds/query), averaging 0.86 matching colliders/query.
- Appended T003 decisions and the out-of-scope horde integration finding to `.agent-context/MEMORY.md`. No changes to contracts, tuning, dependencies, branches, commits or other workers' files.

**Remaining Work:**

- No remaining work within the T003 brief's locked implementation/test scope.
- Follow-up for T007/HordeSystem owner: `updateHorde` currently ignores the false return from `ctx.nav.followField?.sample(...)` in the far/regroup and blocked-follow branches (around lines 573-579). `FlowField.sample` correctly zeros output when beyond the bound; these branches consequently provide no direct steering for an out-of-bound straggler. The existing catch-up multiplier only changes speed, and no far offscreen teleport exists there. Add the required fallback/catch-up behavior in that owner's scope. T003 explicitly prohibited editing HordeSystem and requested reporting this finding. `SimContext` currently supplies no camera position; any future teleport visibility condition should use the architecture's camera-target/leader convention or be resolved by the integration owner.

**Public Interfaces/Exports Added:**

- `NavigationGrid.buildFlowField(goals, reuse?, maxDistance?)` implements the already published `INavigationGrid` signature. No contract changes or new exported symbols.
- Existing concrete `FlowField.buildDirections` accepts optional visited-cell/count/connectivity arguments for internal bounded-build optimization; its no-argument behavior remains supported.

**Verification Run:**

- `npx vitest run tests/navScale.test.ts tests/navigation.test.ts tests/fixes-nav.test.ts`: PASS, 3 files / 36 tests.
- Final `npx tsc --noEmit`: PASS, exit 0, no diagnostics. Earlier attempts observed missing modules in the concurrently edited `src/world/layout/**`; those files subsequently landed and the final check passed without modifying them.
- Final `npm test`: PASS, 27 files / 234 tests, no failed or skipped tests (21.83 s). Includes all pre-existing tests and the concurrent persistence tests present at run time.
- Final standalone `npx vitest run tests/navScale.test.ts`: PASS, 1 file / 5 tests, no skipped tests. Bounded 320 x 256 field, 1024 colliders, 140 m bound: **5.46 ms average over 20 builds**, below the 6 ms target. Whole-array resets are included in the measurement. Full concurrent suite measurement: **18.99 ms average**, below the required loaded-CI assertion of 25 ms.
- `git diff --check -- src/world/NavigationGrid.ts src/world/CollisionWorld.ts src/systems/NavigationSystem.ts tests/navigation.test.ts tests/fixes-nav.test.ts tests/navScale.test.ts`: PASS; only informational CRLF normalization warnings for the two modified source files.

**Memory Notes:**

- Flow bounds are path costs in meters, not a straight-line radius. Reset all field arrays on reuse to avoid stale finite distances/directions/goal indices after shrinking a bound or changing goals.
- Repeated bounded replans benefit from caching no-corner-cutting adjacency on raster rebuild and generating directions only for finalized cells. Whole-array resets are acceptable at 81920 cells with the measured 5.46 ms standalone average.
- Do not infer far gate reachability from the 140 m follow field; use explicit attack-order bounds for both sides of a gate redirect.
- Existing 8 m collision broad-phase needs no scale-specific change at approximately 1500 colliders.
- T007 must handle failed bounded follow-field samples explicitly; current HordeSystem has speed catch-up but no direct fallback in the relevant branch and no offscreen teleport.
