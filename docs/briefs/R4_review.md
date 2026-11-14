# Brief R4 — Review, audit & playtest (after R1 + R2 + R3 are merged in the main checkout)

Three independent passes, run on the **merged** main checkout. R4a and R4b are **read-only**: they must not create, edit,
stage or commit anything, and may run in parallel because neither writes. Findings go back to the orchestrator, who triages
them and assigns fixes in R4d (file ownership as in R2/R3 briefs). R4c is the orchestrator's own browser pass.

Reference docs: `docs/2_intial_recruitment_design.md` ("recruitment spec"), `docs/1_design.md`, `AGENTS.md`,
`src/core/types.ts`, `src/core/contracts.ts`, `src/config/balance.ts`, briefs `R1`–`R3` in `docs/briefs/`.

Report format for R4a/R4b — one finding per entry, ranked most severe first:

```
[P1|P2|P3] <file>:<line> — <one-sentence defect>
  Scenario: <concrete inputs/state → wrong result>
  Evidence: <code path / quoted line numbers; a failing test sketch if possible>
  Suggested fix: <one or two lines>
```

P1 = crash, soft-lock, wrong win/lose, invariant break, runaway processing. P2 = spec requirement unmet or noticeably wrong
behaviour. P3 = polish, perf headroom, maintainability. Say "verified" only for findings checked by reading the actual
code path or running a command; otherwise mark "suspected". No style nits.

---

## R4a — Adversarial logic review (codex, read-only sandbox)

Hunt for logic bugs, edge cases and state desyncs in `src/sim`, `src/systems`, `src/entities`, `src/world/{CollisionWorld,
NavigationGrid,districtLayout}.ts`, and the sim→visual seams in `src/core/Game.ts`. You may run `npx vitest run`, `npx tsc
--noEmit` and throwaway scripts **outside the repo** (e.g. a temp dir) to probe behaviour; do not add files to the repo.

Must check:

1. **Invariants every step:** `followerCount === followers.length`; `followers + rising <= maxFollowers` across leader
   recruit + rally + every pulse in the same step + conversions finishing; dead never deal damage / block / get targeted;
   recruited never return to ambient; held zombies (`heldBy ≠ 0`) never recruited by any path.
2. **Cascade termination & cost:** every zombie pulses at most once; no pulse beyond `maxGeneration`; pending pulses of
   zombies that die / are killed the same step; pulse work bounded (`maxRecruitsPerPulse`, hash queries only — no O(n²));
   behaviour when 40+ pulses fall due on one step; determinism (same seed ⇒ same result; only `ctx.rng`).
3. **Structures:** destroy happens exactly once (simultaneous hits from leader + many followers in one step, damage after
   hp ≤ 0); collider disabled + both nav grids rebuilt exactly once; release only of matching `heldBy`; released zombies can
   physically exit (doorway width vs radius, nav snapping) and never re-enter/oscillate; structure targets dropped from
   `order`/`squads` and succession to sheltered humans; picking/ordering a destroyed structure; shelter redirect when the door
   is already broken; restart (`reset`) restores colliders, nav versions, held flags.
4. **Momentum:** exactly one gain per qualifying event (no double count via shared death paths, conversion + kill both
   intended), no gain for start followers / civilian kills / non-defensive structures; decay grace; multipliers applied live
   (leader + followers + recruit radii), never cached on agents; phase ≠ playing freezes it.
5. **Humans:** civilians never shoot or emit `shot`; flee stays inside `homeArea` and never pushes into colliders / out of
   bounds; sheltered civilians can't leave an intact store; barricade soldiers' range; alert-assist doesn't chain across the
   map; conversion of civilians and barricade soldiers respects the cap; victory ignores non-checkpoint humans; defeat intact.
6. **Navigation & responsiveness:** flow-field replans still ≤ navReplanHz after the extra structure fields; no per-step
   allocation in hot loops (new arrays/objects/closures per agent); regroup/catch-up can't make followers outrun the leader
   permanently or jitter at the boundary; crawl rules don't let zombies cross `breakable`/bus shell colliders.
7. **Event contracts:** every new `GameEvent` emitted with the exact shape in `types.ts` (`generation`, `kind`, `role`,
   `recruits`, `count > 0` for `released`); no event spam per step (e.g. `structureDamaged` per zombie hit is fine, but
   `momentumTier` must not flap at a threshold every step).
8. **Tests quality:** tests in `tests/cascade|structures|momentum*|opening|layout` actually exercise the claims (no tautologies,
   no assertions weakened vs. the pre-R1 versions — compare with `git diff --cached` baseline and `git show HEAD:tests/...`).

Deliverable: ranked findings list + a short "looked at, found nothing" list so coverage is visible.

---

## R4b — Spec & cross-file consistency audit (agy, `--mode=plan`, read-only)

Audit the merged code against the recruitment spec and the contracts. Do not review low-level logic (R4a does that).

1. **Acceptance checklist** — for each item in recruitment spec §9 give **Met / Partially / Not met / Can't tell statically**
   with file:line evidence. Include §1 pacing table, §2 visual-feedback bullets, §3 design requirements (visible from street,
   no long destruction, released zombies can exit), §4 distribution table vs actual `layout.spawnZones` counts and positions,
   §5 momentum values/tiers/HUD, §6 responsiveness bullets, §7 performance bullets, §10 constraints (no new deps, no
   remote assets, no `Math.random` in pure code, balance values centralised — list any new magic gameplay numbers outside
   `balance.ts`).
2. **Contract conformance:** every module listed in `AGENTS.md` exists and exports what the directory table / contracts.ts
   say; `[pure]` modules import no `three`; contract files changed only by the orchestrator (compare `git diff --cached`).
3. **Sim ↔ visual seams:** every `GameEvent` variant emitted by the sim has a consumer (Effects / Audio / HUD) and vice versa
   (no consumer for an event the sim never emits); every `StructureKind`, `LandmarkKind`, `HumanRole`, `MomentumTier` handled
   in HUD labels, audio, Landmarks; Landmarks geometry derived from layout (no literal landmark coordinates, no hardcoded
   structure ids); `Game.dispose()` and restart clean up Landmarks/Effects pools/listeners.
4. **Docs drift:** `AGENTS.md` step order, directory table and recruitment rules vs the code; README controls/objectives vs
   HUD help text; anything the README must now mention (landmarks, momentum, start horde).

Deliverable: the §9 checklist table, then ranked findings in the shared format.

---

## R4c — Browser playthrough (orchestrator)

`npm run dev` via the preview tools, desktop viewport, sound muted. Watch the console throughout (no new errors/warnings).

| # | Check | Pass criterion |
|---|---|---|
| 1 | Boot & start | 5 followers visible around the leader; HUD horde 5, momentum DORMANT 0 |
| 2 | First encounter | 2 civilians visible from start; reach and catch one within ~10 s; it flees, dies, may rise |
| 3 | Bus | visible from start; held zombies visibly inside / bus rocks; click door → horde breaks it in ≤ ~6 s; zombies burst out; cascade rings spread; counter "+N" pops |
| 4 | Cascade | rings expand from recruits, staggered; spread stops after ~3 generations; never through the bus shell / walls |
| 5 | Pacing | horde ≈ 20 by 25 s and 30–50 by 60 s with direct play (note the times actually observed) |
| 6 | Barricade | 2 soldiers fire with shorter range; pen gate breakable; 10 freed |
| 7 | Store | civilians visible through glass and clickable (order redirects to door); door breaks; civilians flee inside, convert |
| 8 | Alley | gate rattles while full; breaks; 20 freed and recruitable; alley navigable afterwards |
| 9 | Momentum | meter rises with recruits/kills/breaks, tier label + colour change, decays after idling ~5 s, leader visibly faster at FULL |
| 10 | Horde responsiveness | sprint away and back: no permanent stragglers; no long single-file lines; regroups after fights |
| 11 | Checkpoint | original assault still winnable; victory requires only checkpoint guards; victory/defeat screens show new stats |
| 12 | Restart | `R` restores everything (structures intact, held zombies back, momentum 0, 5 followers) with no duplicate meshes |
| 13 | Performance | ~100 zombies on screen: frame time steady (record via `performance.now()` sampling in the page); draw calls via `renderer.info` |

Record pass/fail, screenshots for 1, 3, 7, 9, 11, and measured numbers for 5 and 13.

---

## R4d — Fix round

Orchestrator triages R4a/R4b/R4c into P1/P2 fixes (P3 only if cheap), assigns by ownership (sim → codex, visuals/HUD → agy,
small/integration → Claude), re-runs `npx tsc --noEmit`, `npm test`, `npm run build`, repeats R4c items affected, then
updates README (summary of changes, controls, known limitations — recruitment spec §11) and ticks R1–R4 in `AGENTS.md`.
