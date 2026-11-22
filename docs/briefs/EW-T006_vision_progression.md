# EW-T006 — Eyesight progression + save v3 (agy-worker)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5 at the top), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §4 (vision tiers), `src/core/contracts.ts` (EW doc block —
ProgressionSystem + saveSchema entries are your spec), upstream report `.agent-context/reports/EW-T001-orchestrator.md`.

## Locked files (edit ONLY these)
- `src/systems/ProgressionSystem.ts`, `src/persistence/saveSchema.ts`
- `tests/progression.test.ts`, `tests/persistence.test.ts`, `tests/slots.test.ts`, NEW `tests/visionProgression.test.ts`

Never edit types/contracts/balance/content or any other file. If you need a contract change, stop and report it. Another
worker (EW-T004) is editing `src/world/{NavigationGrid,CollisionWorld}.ts` and tests navScale/navigation/collision in
parallel: failures there are not yours; report them.

## Implement
1. `ProgressionSystem.ts` — mirror the existing `slotCost` / `buySlot` pattern (same file):
   - `export function visionCost(state: GameState): number | null` → `BALANCE.vision.tierCosts[state.progression.visionTier]`,
     `null` at tier 4.
   - `export function buyVision(ctx: SimContext): boolean` — checks in this order: leader alive & `phase === 'playing'`
     (else deny `'locked'`); tier < 4 (else `'maxVision'`); leader within `nest.equipRadius` of an active nest — reuse
     `leaderAtActiveNest` (else `'notAtNest'`); `biomass >= cost` (else `'biomass'`). On success spend exactly `cost` once,
     `visionTier++`, emit `{ type: 'visionUpgraded', tier, cost }` and `{ type: 'autosave', reason: 'equip' }` (check the
     exact autosave event shape in `types.ts`). Denial emits `abilityDenied { abilityId: null, reason }`. Biomass never negative.
   - `updateProgression`: `if (input.buyVision) buyVision(ctx);` next to the buySlot edge.
   - Do NOT touch `state.vision` (AwarenessSystem copies the tier itself).
2. `saveSchema.ts` (T001 already added `MIGRATIONS[2]`, `sanitizeVisionTier`, visionTier pass-through):
   - v2 → v3 fog remap: decode `discoveryBits` on the v2 grid (20 × 16 cells, origin x −200 / z −160, cellSize 20) and
     copy each set bit into the v3 grid (42 × 34, origin −420 / −500) at col + 11, row + 17; re-encode. Use the same bit
     order as `encodeBits`/`decodeBits` in the file. Keep the v1 → v2 → v3 chain working.
   - Missing district/stronghold ids in v2 saves get default records (already partly in MIGRATIONS[2]; verify all 16 +
     every STRONGHOLDS id); unknown ids are dropped; corrupt data ⇒ `null` (clean start), never a throw.
   - v3 `createWorldSave` / `parseWorldSave` / `applyWorldSave` round-trip `visionTier` (clamped 1..4).

## Tests — ARCHITECTURE §EW-5 #6
`tests/visionProgression.test.ts`: fresh state tier 1; `visionCost` 20/60/120/null; buyVision denied away from nest, without
biomass (biomass unchanged), at tier 4 (`maxVision`), while respawning/dead (`locked`); success spends exactly the cost once
(two `buyVision` inputs in one step / two steps with just enough biomass ⇒ one upgrade), emits visionUpgraded + autosave;
input edge through `updateProgression`; tier persists through create → JSON → parse → apply.
`tests/persistence.test.ts`: a hand-built v2 save loads with tier 1, 16 district records, and its fog bits at the shifted
cells (set bit at v2 (c, r) ⇒ v3 (c + 11, r + 17), no others); v1 save still loads; corrupt fog ⇒ null.
Update `progression/slots` tests only if the new edge changes them. Build fixtures like the existing tests do.

## Done when
`npx tsc --noEmit` and `npm test` pass (all files). Write `.agent-context/reports/EW-T006-agy-worker.md` (AGENTS.md format)
and append Memory Notes to `.agent-context/MEMORY.md`.
