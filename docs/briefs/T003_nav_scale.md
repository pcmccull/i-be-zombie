# T003 — Navigation at world scale (codex)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, `src/core/contracts.ts` (INavigationGrid.buildFlowField
now takes optional `maxDistance`), `src/config/balance.ts` (`nav`, `openWorld`), `src/world/NavigationGrid.ts`, `src/world/CollisionWorld.ts`,
`src/systems/NavigationSystem.ts`.

## Locked files
`src/world/NavigationGrid.ts`, `src/world/CollisionWorld.ts`, `src/systems/NavigationSystem.ts`, `tests/navigation.test.ts`,
`tests/fixes-nav.test.ts`, `tests/navScale.test.ts` (new). Nothing else. Another worker is building the open-world layout in parallel
(`src/world/districtLayout.ts` currently returns the legacy district) — build your own large synthetic fixture in the test instead.

## Deliver
1. `NavigationGrid.buildFlowField(goals, reuse?, maxDistance?)`: bounded Dijkstra — stop expanding cells whose cost exceeds `maxDistance`;
   those cells read as unreachable (`sample` false + out (0,0), `distanceAt` Infinity). Omitted ⇒ unchanged behaviour. Reused fields must not
   leak stale values from a previous, larger build (reset only touched cells or whole arrays — measure).
2. `NavigationSystem`: pass a bound for follow and attack fields: follow field `BALANCE.nav.flowFieldMaxDistance`; attack/squad fields
   `max(flowFieldMaxDistance, straight distance leader→target + 60)` so far-away explicit orders still resolve. Keep every legacy test green.
   Followers beyond the field fall back to existing direct steering (that logic lives in HordeSystem — do not edit it; if it needs a change,
   report it).
3. Check `CollisionWorld` broad-phase scales to a 400 × 320 m world with ~1500 colliders (cell size / query allocation); fix only if measured.
4. `tests/navScale.test.ts`: synthetic 400 × 320 world (grid of ~1000 building/prop colliders with streets); (a) bounded field equals unbounded
   field within the bound and is unreachable beyond it; (b) reuse after a bigger build has no stale cells; (c) average follow-field rebuild
   time at world scale with the bound < 6 ms over 20 builds (log the number; make the assertion generous enough for a loaded CI: < 25 ms);
   (d) findPath across the synthetic world succeeds.

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T003-codex.md` (format in AGENTS.md, include measured ms), MEMORY notes.
