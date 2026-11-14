# T006 — Persistence (agy; fallback claude)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, `docs/3_open_world.md` §4H, `src/core/types.ts`
(`WorldSave`, `PlayerSave`, `GameState` open-world fields, `StrongholdState`, `DistrictState`, `DiscoveryState`), `src/core/contracts.ts`
(persistence section, `StorageLike`), `src/config/balance.ts` (`save`, `progression`), `src/content/abilities.ts`, the stubs
`src/persistence/{saveSchema,SaveStore}.ts`, and `src/sim/createInitialState.ts` + `src/systems/StructureSystem.ts` for how structures are destroyed.

## Locked files
`src/persistence/saveSchema.ts`, `src/persistence/SaveStore.ts`, `tests/persistence.test.ts` (new). Nothing else. `saveSchema.ts` is
`[pure]`: no three, no DOM, no `Date.now()` (callers pass `savedAt`), no `Math.random()`.

## Deliver
- `createSave(state, seed, savedAt = 0): WorldSave` — canonical data only: player (biomass, unlocked, equipped, `selectedNestId` =
  `state.activeNestId`), every district state, strongholds keyed by id (`id, captured, objectivesDone, reinforcementsSpent`), destroyed
  structure ids, `gateDestroyed`, `discoveryBits` (base64 of `state.discovery.bits`), `acquiredUpgrades` (unlocked minus innate), version
  `BALANCE.save.version`. Must be JSON-safe (no typed arrays, no Infinity, no references into state).
- `parseSave(raw: unknown): WorldSave | null` — accepts a parsed object; validates every field's type/range (statuses from TerritoryStatus,
  ability ids from `ABILITIES`, numbers finite, 0..1 fields clamped, biomass ≥ 0, equipped length = slots); version > current ⇒ null;
  version < current ⇒ run a `MIGRATIONS: Record<number, (old) => unknown>` chain (empty today; structure it so v2 is a one-line addition);
  anything malformed ⇒ null. Never throws.
- `applySave(ctx, save)` on a freshly created state (`new Simulation(layout, save.seed)`): restore progression (unlocked ∪ innate; equipped
  keeps only unlocked, slot-behaviour, non-duplicate abilities), `activeNestId` (fall back to the start nest if unknown), district states,
  strongholds by id (unknown ids ignored; objective ids filtered to the def's), destroyed structures/gate **silently** (hp 0, destroyed,
  `destroyedAt` 0, `collision.setEnabled(id,false)`, held zombies `heldBy = 0`; then `navGrid.rebuild()` + `crawlNavGrid.rebuild()` once if
  anything changed; no events), humans with `strongholdId` of a captured stronghold removed from `state.guards`, discovery bits + `revealed`
  recount, and leader + live followers moved to the active nest (followers on walkable points around it, deterministic ring). Followers are
  never saved.
- `encodeBits/decodeBits` — own base64 implementation (no Buffer/btoa dependency), round-trips any length.
- `SaveStore(storage: StorageLike | null, key = BALANCE.save.storageKey)`: `load()` (JSON.parse + parseSave, null on anything wrong),
  `save(s)` (true/false), `clear()`. Every storage access in try/catch (quota, SecurityError, null storage) — never throws.
- `tests/persistence.test.ts` with an in-memory `StorageLike`. Build a fixture layout from `buildLegacyDistrictLayout()` with added
  `strongholds`/`nests` entries pointing at its existing structures (e.g. a stronghold whose objective is the pen gate, plus the gate) — do not
  depend on `buildDistrictLayout()` (another worker is replacing it). Cover: round trip (create → JSON → load → apply ⇒ same progression,
  districts, strongholds, structures destroyed + colliders disabled, discovery bits); applying twice is idempotent; corrupt JSON / wrong types /
  future version / null storage / throwing storage ⇒ null or false, no throw; equipped sanitising; biomass never negative; captured
  stronghold defenders removed; discovery ≠ conquest (discovered district keeps status 'human').

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T006-agy.md` (format in AGENTS.md), MEMORY notes.
