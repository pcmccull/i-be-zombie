# VP2-T007 — environmentPopulation (pure placement)

- **Task ID & Agent:** VP2-T007, codex (dispatch by claude wrapper; codex hit its usage limit before writing any file)
- **Status:** QUOTA_EXHAUSTED

## Completed Work

- Nothing written for this task. Codex ran `codex exec --sandbox workspace-write` and stopped at the start with
  "You've hit your usage limit ... try again at 11:36 AM". No files were created.
- Confirmed after the stop (`git status --short`, `ls`): `src/graphics/world/` does not exist,
  `tests/environmentPopulation.test.ts` does not exist, no `VP2-T007-codex.md` existed before this report.
- Workspace is clean for this task. `.agent-context/MEMORY.md` shows a 17-line modification, which is from the
  concurrent HH session (`[HH-T002]` bullets), not from this task. No `[VP2-T007]` bullet was appended.
- Codex log: `C:\Users\phil\AppData\Local\Temp\claude\ac7191ca6e6527a7\456ecca9-3db5-4549-b05d-b06a901312ab\scratchpad\vp2-t007-codex.log`
  (full prompt is in `...\scratchpad\vp2-t007-prompt.txt`, same folder).

## Remaining Work

Everything in the VP2-T007 brief is outstanding. Exact steps for the fallback agent:

1. Create `src/graphics/world/environmentPopulation.ts` [pure, no `three`, no `Math.random`]:
   - `export interface DressingInstance { kind: DressingKind; x; y; z; rotY; scale; sx?; sz?; variant; tier: 0|1|2 }`
     (contract: ARCHITECTURE §VP2-1; kinds from `src/graphics/environment/environmentKinds.ts`).
   - `export function populateChunk(layout: DistrictLayout, chunkId: number): DressingInstance[]`: candidates from
     `chunkRect(layout, id)`, keep items whose centre is inside that rect and inside `layout.playArea`; deterministic
     per chunk via `mulberry32` seeded by FNV-1a(constant, chunkId); result sorted by (kind, x, z); ≤ 900 items with
     tier 0 = essential ordering.
   - `export function populationStats(items: readonly DressingInstance[])`: counts per kind, per tier, total.
   - Per-layout index in `WeakMap<DistrictLayout, Index>` (colliders, buildings, ground patches (road/sidewalk/park/
     plaza/lot/court), spawn zones, guard waypoints, nests, props). No module-level mutable state.
   - Content rules: curbs / curb ramps at crosswalks + driveways / drains / manholes / road patches / median hatching
     (≥ 12 m roads) / traffic islands (FLAT_KINDS only on road surfaces); sidewalk strip (outer 1.2 m) streetlights (skip
     within 6 m of a layout streetlight), palms from `DISTRICT_STYLES[id].palms` (every 2nd tier 0), furniture from
     `style.furniture` near storefronts/corners; building edge vines/hedges/planters/clutter (back side, ≥ 1.5 m free)/
     restaurant patio clusters; park/court trees, bushes, grass, basketball hoops on `court` patches.
   - Hard exclusions: collider footprint intersection (per-kind radius table; wall-mounted ≤ 0.8 m margin only); tall
     (> 0.5 m) only in allowed zones; START_BEACH and playerStart→nest_start segment (±2 m) and nest claim circle
     (`BALANCE.nest.claimRadius` + 1.5 m); non-flat items off traffic lanes (`buildTrafficNetwork`); ≥ 1.2 m from guard
     waypoints.
2. Create `tests/environmentPopulation.test.ts` covering VP2-5 #6 over all chunks of `buildDistrictLayout()`
   (yield with `await new Promise(r => setTimeout(r, 0))` every few chunks; `it(..., 60000)`): determinism (same chunk,
   fresh layout, different chunk ids differ), no collider intersection, tall-item zones, road items FLAT only, ≤ 900 per
   chunk, sorted, inside playArea and chunk, palms per district, curbs along sidewalks, nothing on START_BEACH or in nest
   claim circles, `populationStats` consistency, runtime reported.
3. Verify: `npx tsc --noEmit`; `npx vitest run tests/environmentPopulation.test.ts`;
   `npx vitest run tests/world.test.ts tests/intro.test.ts`. Measure per-chunk time (cold + warm; target < 15 ms
   for a dense chunk) and item counts per kind across the default world; record in the report.
4. Write this report's successor `.agent-context/reports/VP2-T007-<agent>.md` and append one `[VP2-T007]` bullet to
   `.agent-context/MEMORY.md` (not done here).

## Public Interfaces/Exports Added

None (nothing written). Planned: `populateChunk`, `populationStats`, `DressingInstance` (contract, VP2-1).

## Verification Run

- `codex exec --sandbox workspace-write "<VP2-T007 prompt>"`: FAILED at startup, usage limit (exit 1). No tsc or vitest run
  was started for this task because there was nothing to verify.
- Not run: `npx tsc --noEmit`, `npx vitest run tests/environmentPopulation.test.ts`, `tests/world.test.ts`,
  `tests/intro.test.ts`. The `tests/world.test.ts` and `tests/intro.test.ts` suites are unaffected because no layout file
  was touched.

## Memory Notes

- Codex's usage limit resets at 11:36 AM (per its message). Re-dispatch to codex only after that, or fail over to
  `@claude-worker` (VP2 board fallback for `VP2-T007`).
- Codex warns that `AGENTS.md` (38 KB) exceeds the 32 KB project-instruction budget and only 32768 bytes load
  (`project_doc_max_bytes`). The tail of AGENTS.md (VP2/HH conventions near the end) may not reach codex; include the
  needed VP2-T007 rules in the prompt itself, as this brief did.
- Codex also warns about an unrecognised `windows_wsl_setup_acknowledged` key in `C:\Users\phil\.codex\config.toml`
  (harmless).
