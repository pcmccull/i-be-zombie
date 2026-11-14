# R4c — Browser playthrough (orchestrator)

Status: COMPLETED (one full run start → victory → restart on the merged build, dev server :5176, Chrome in the Claude
desktop browser pane, 992×1172 viewport, DPR 1).

Harness: leader movement injected via a wrapper on `InputController.buildSimInput` (synthetic key events lose held state when
the pane isn't OS-focused); **all target selection went through real pointer events + the game's own picking**.
Note: the game pauses while its window is blurred (`Game.onBlur`, pre-existing) — not a bug, but synthetic `focus` spam resets
its clock, so the harness must not dispatch focus every frame.

## Checklist (R4_review.md R4c)

| # | Check | Result |
|---|---|---|
| 1 | Boot & start | PASS — 5 followers, HORDE 5/100, DORMANT 0%, GUARDS 8/8, objective "Free the bus horde", bus visible |
| 2 | First encounter | PASS — civilians reached in ~3 s; both flee (RETREAT); park-edge group cascades (4–5 cascade recruits by 3.3 s) |
| 3 | Bus | PASS — real click picks BUS DOOR; broken 4.5 s after order; 15 released; burst out the door |
| 4 | Cascade | PASS — pulses 8 + 3 recruits off the bus group, later pulses 0 (gen limit / nobody in range); never through shell |
| 5 | Pacing | PASS — 11 @ 3 s, 26 @ 12.8 s, 38 @ 31 s, **49 @ 53.9 s** (spec ~20 by 25 s, 30–50 by 60 s) |
| 6 | Barricade | PASS after tuning — both police selected (order + squad split), dead in 3.0 s, pen gate 5.3 s, 10 released. **Found:** an idle leader near the police died in ~5 s → barricade damage/hit tuned |
| 7 | Store | PASS — click on civilian *through the glass* → order guard, effectiveTarget = store door; door 4.1 s; civilians flee inside, die, convert ("HUMAN CONVERTED TO HORDE!") |
| 8 | Alley | PASS — gate 3.0 s, 20 released, recruited (72 followers, 38 cascade) |
| 9 | Momentum | PASS — GROWING at 53.8 s (pen break), decays to DORMANT after idle travel, GROWING again; meter/label/colour update |
| 10 | Responsiveness | PASS (observed) — 80-follower horde followed through 4 routes without stragglers; packs tight around leader |
| 11 | Checkpoint | PASS — 80 followers; gate fell 6.9 s after click + Rush; victory at 3:15; end screen shows Outbreak spread 45, Barriers broken 4 |
| 12 | Restart | PASS — `R` from victory: all 4 breakables intact (door pivots 0, glass visible, rubble hidden, pick targets back), 45 held, 5 followers, momentum 0, geometries 255 → 255 |
| 13 | Performance | PASS — 94 live zombies (72 following): frame 9.97 ms avg / 10.1 p95 (100 Hz display cap, pane visible), sim step 0.72 / 0.90 ms, render 1.35 / 2.1 ms, 38 draw calls, 59k tris |

Console: no game errors (only `setPointerCapture` errors from the harness's synthetic pointer ids, before it stubbed capture).

## Fixes made from this playthrough

1. **HUD objective skipped ahead** (`src/ui/HUD.ts` `chooseObjectiveText`): follower-count thresholds made a fast cascade
   jump from "Free the bus horde" to "Open the locked alley", skipping barricade and store. Now: first intact landmark in route
   order while < 50 followers, then "Break the gate".
2. **Barricade police too lethal for "lightly defended"** (`balance.outposts.barricadeDamage` 6, `barricadeHitChance` 0.55;
   `HumanAISystem` fire uses them for `post === 'barricade'`): ~19 → ~6.6 DPS for the pair; idle leader survives ~12 s.
   Checkpoint guards unchanged. Autopilot after: 38/50/74.

## Not covered / limits

- Single run, one route; human-played numbers will vary. Audio not evaluated (muted pane). Mobile not supported (by design).
