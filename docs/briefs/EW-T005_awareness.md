# EW-T005 — AwarenessSystem: zombie vision + sense cues (codex)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-0…EW-5 at the top), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §4–5, `src/core/contracts.ts` (EW doc block = your spec),
upstream report `.agent-context/reports/EW-T001-orchestrator.md`.

## Locked files (edit ONLY these)
- NEW `src/systems/AwarenessSystem.ts`
- NEW `tests/vision.test.ts`, NEW `tests/senses.test.ts`

Do NOT wire it into `Simulation.ts` (EW-T010 does that) and do not edit any other file (types/balance/contracts are
final; if you need a contract change, stop and report). Other workers are rebuilding the world layout
(`src/world/districtLayout.ts`, `src/world/layout/**`, `src/world/boundaryLayout.ts`) in parallel: build your test
worlds with `buildLegacyDistrictLayout()` or small hand-made `DistrictLayout` fixtures so you're not affected; failures in
their test files are not yours.

## Implement (signatures exactly as contracts.ts)
`visionProfile(tier)`, `updateAwareness(ctx, dt, stepEvents)`, `isIdentified`, `isSeen`, `awarenessOf`, `canTarget`,
`isWorldPositionInSight`. Only this module writes `state.vision`. Rules are in contracts.ts; key points:
- Tier: copy `state.progression.visionTier` into `state.vision.tier` every call. `visionProfile` maps
  `BALANCE.vision.tiers[tier-1]` + booleans (`detectMovingHumans = movingDetectRadius > 0`, etc.).
- Rebuild `identified` / `seen` (sorted ascending EntityIds, disjoint) at `BALANCE.vision.updateHz` (accumulate dt; first
  call updates immediately). Candidates: living (`hp > 0`, not DEAD), non-dormant humans in `state.guards` within the
  largest radius of the current profile. Distances are XZ from `state.leader.pos` only — never camera data.
- LOS: `ctx.collision.segmentBlocked(leader.pos, guard.pos, { mode: 'sight', fromHeight: BALANCE.vision.eyeHeight,
  toHeight: 1.5 })` (tower guards: use their elevation, see HumanAISystem). At most `BALANCE.vision.maxLosChecksPerUpdate`
  calls per update: round-robin over candidates needing LOS (inside alwaysRadius needs none), cache the last LOS result
  per guard id between updates (side-table keyed by GameState via `WeakMap`, like ConquestSystem — no module-level
  mutable state otherwise), and treat a never-checked candidate as not-visible until checked.
- Engaged: a human that shot at (event `'shot'` with `to` near the leader/follower position, or `hit`) or damaged the leader
  or a follower within `engagedMemory` s stays identified while `dist <= 2 * clearRadius`. Read what the step events
  actually contain in `src/core/types.ts` (`GameEvent`) and pick the most precise signal.
- seen (tier extras): moving humans (speed from `vel` or pos − prevPos > `movingSpeed`) with LOS; stronghold defenders
  (`strongholdId != null`) within defenseRadius (no LOS); reinforcement-wave humans within reinforcementRadius — mark them
  from the `'reinforcements'` event (e.g. living `post==='patrol'` guards within 15 m of `ev.pos` whose ids are new) in the
  side-table.
- Leader dead or `phase === 'respawning'`: identified = engaged only, seen = [].
- `revision++` whenever identified or seen change.
- Cues (`state.vision.cues`, max `BALANCE.senses.maxCues`): from `stepEvents` and state, only for sources beyond the current
  clearRadius and within `senses.kinds[k].range`: `'shot'` → gunshot (source = shooter guard pos); civilian (`role ===
  'civilian'`) whose AI state changes into RETREAT/flee (track previous state in the side-table) → scream;
  `'reinforcements'` → siren (tier 4: fuzz × `vision.reinforcementFuzzFactor`); crowd scan at `senses.crowdScanHz`: cells of
  `crowdCellSize` with ≥ `crowdMinHumans` living humans → crowd (awareness 'sensed'; the others 'heard').
  `pos` = source + offset at a `ctx.rng` angle and radius `clamp(dist * fuzzFrac, fuzzMin, fuzzMax)` (fixed at creation /
  refresh; never the exact live position). Intensity = attenuated by distance / range (0..1). Aggregation: same kind within
  `aggregateRadius` of an existing cue ⇒ refresh (age 0, intensity max, count++, emit `senseCue` fresh:false); else new cue
  (`id = nextCueId++`, emit `senseCue` fresh:true). Age cues by dt, drop when `age >= ttl`; over cap ⇒ drop the weakest.
  Cues never add anyone to identified/seen.
- No per-agent allocation per step (reuse scratch arrays; rebuild the id arrays in place).

## Tests — ARCHITECTURE §EW-5 #4–5
`tests/vision.test.ts`: identification uses leader.pos only (moving a fake camera/zoom value changes nothing — there is
none to read: assert the function signature has no camera input and results equal for the same state); identified set grows
with tier; a human behind a building within clearRadius is not identified, within alwaysRadius is; engaged human stays
identified out to 2× clearRadius for engagedMemory s; seen humans are not targetable (`canTarget` false); tier 2 moving
detection, tier 3 defenses, tier 4 reinforcements; LOS checks per update ≤ maxLosChecksPerUpdate with 300 humans in range
(wrap/spy `ctx.collision.segmentBlocked`); dead/respawning leader; sorted + disjoint arrays; determinism.
`tests/senses.test.ts`: a shot beyond clearRadius makes one gunshot cue, pos ≠ shooter pos and within fuzzMax; a shot
inside clearRadius makes none; 50 shots in one area aggregate into ≤ 1 cue of that kind there; cues expire after ttl;
cap respected; direction from the leader changes as the leader moves while cue pos stays fixed; cues never change
identified; scream from a fleeing civilian; siren from reinforcements (tier 4 fuzz smaller); crowd sensing.
Build fixtures with `createInitialState` + `Simulation`/`SimContext` helpers already used in tests (see tests/ai.test.ts,
tests/conquest.test.ts for patterns).

## Done when
`npx tsc --noEmit` and `npm test` pass. Write `.agent-context/reports/EW-T005-codex.md` (AGENTS.md format) and append
Memory Notes to `.agent-context/MEMORY.md`.
