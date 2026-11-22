# 10 — Field Tips: a tutorial that never takes the wheel

Teach two skills — **collecting zombies** and **splitting the horde across several targets** — without a single forced step.
No pause, no input lock, no "press X to continue", no scripted spawns, no blocked progress. The game plays exactly the same
with tips on, off, ignored or already mastered.

Builds on: `docs/2_intial_recruitment_design.md` (recruitment, cascades, held zombies), `docs/4_intro_scene.md`
(`FIRST_OBJECTIVE` card), `docs/5_expand_world.md` (vision gate), `docs/9_hud_redesign.md` (tokens, icons, `hudModel`).

---

## 1. Design principles

1. **Observe, then offer.** A tip appears only when the situation for it already exists in the world *right now*
   (recruitable zombies in reach, two targets in view). Never in the abstract, never because a timer ran out.
2. **Doing it is the dismissal.** Each tip completes on the real game event, not on a button. A player who does the thing
   before the tip would have appeared gets it silently ticked off — experienced players see nothing.
3. **One voice at a time.** At most one tip on screen; a global cooldown between tips; never during the cinematic, modals,
   respawn, or when the Alpha is in trouble.
4. **Ignoring is allowed.** An ignored tip fades on its own, comes back at most twice with growing gaps, then retires.
   Retired tips stay readable in the Field Guide.
5. **Reward the discovery.** Some lessons (cascades) are taught *after* the player triggers them: "You did that — here's why."
6. **Truthful.** Tips use the same vision helpers as the HUD (`isIdentified` / `canTarget`): never point at an unidentified
   human, never anchor past the vision limit, never describe a state the sim doesn't have.
7. **Client-only.** No sim, `types.ts`, `contracts.ts` or `balance.ts` change. Tip progress is a UI preference
   (`localStorage`), not part of `WorldSave`.

## 2. What we teach (current mechanics)

| Skill | Real mechanic | Input (desktop) | Input (touch) |
|---|---|---|---|
| Recruit by walking | Ambient, unheld zombie within `horde.recruitRadius` (9 m × momentum) with a clear segment joins | WASD | stick |
| Cascades | Every new recruit (gen < max) pulses once, pulling nearby ambient zombies in | — (passive) | — |
| Infect humans | Humans killed by the horde roll conversion; killed by the Alpha always convert | LMB bite | ATTACK |
| Free held zombies | Zombies `heldBy` a structure can't be recruited until it breaks | RMB on structure | tap structure |
| Send the horde | Attack order on a target / move order on the ground | RMB | tap |
| Recall | Whole horde (all squads) follows the Alpha | Space / G | FOLLOW |
| **Split targets** | E + RMB toggles a target in/out of the selection; followers split evenly across all selected | **hold E + RMB** | **long-press (new, §6)** |
| Drop a split target | E + RMB on an already-selected target removes it (squad rebalances) | hold E + RMB | long-press |

## 3. The lessons

Two short tracks. Tracks are independent; within a track a lesson only becomes *eligible* once its prerequisite is done
(or retired). Every lesson has: **trigger** (when it may show), **anchor** (where it points), **text**, **complete** (event
that ticks it), and **skip-if** (silently done).

### Track A — Collect

**A1 · Walk up to them**
- Trigger: ≥ 1 ambient, unheld, non-dormant zombie within 25 m of the Alpha and in the rendered vision area; A1 not done.
- Anchor: soft green chevron over the nearest such zombie + card.
- Text: "Wandering zombies join you when you walk close. **WASD** to go say hi." (touch: "Walk close with the stick…")
- Complete: first `recruited` event with `generation === 0 && !viaRally` after play starts.
- Skip-if: already true by the time the tip would show (the 5 start followers do **not** count — they aren't recruited).
- Relation to `FIRST_OBJECTIVE`: the objective card stays as-is; A1 does not show while the card is expanded, and its
  chevron is the only thing it adds if the player hasn't recruited 8 s after the card collapses.

**A2 · Chains** *(reveal tip — shown after the fact)*
- Trigger: first `recruitPulse` with `recruits > 0`.
- Anchor: the pulse position (already drawn as a ring by Effects); card only.
- Text: "New recruits **call others nearby** — walk into a crowd and the horde snowballs."
- Complete: shown once = done (no action required).

**A3 · Bite the living**
- Trigger: A1 done, an **identified** human within 15 m, no conversion seen yet.
- Anchor: card; small bite icon over the human (only while `isIdentified`).
- Text: "Humans you bite (**Left Click**) rise as zombies. Your bites always turn them."
- Complete: first `converted` event.
- Suppress while leader hp < 40 % (don't encourage brawling at low health).

**A4 · Trapped zombies**
- Trigger: ≥ 3 held zombies (`heldBy !== 0`) within 30 m and in view, their structure intact; A1 done.
- Anchor: outline pulse on the holding structure (it is geography → always targetable).
- Text: "Zombies are trapped inside. **Right-click** the {structure label} to send the horde — break it and they join the hunt."
- Complete: `structureDestroyed` whose `released` count > 0 (or any `released` event).

### Track B — Command

**B1 · Sic 'em**
- Trigger: followers ≥ 3 and a valid target (identified human, structure, gate, live vehicle) under the pointer
  **or** within 20 m and on screen; B1 not done.
- Anchor: reuses the existing context action "Sic 'em: …" (RMB keycap) — B1 adds a one-line card above it.
- Text: "**Right-click** a target to send the horde. Right-click the ground to move them."
- Complete: `orderChanged` to an attack order (move order also counts as "commanded" but only ticks B1's ground half).

**B2 · Call them home**
- Trigger: B1 done, horde away (`order !== follow || squads.length > 0`) for ≥ 8 s.
- Anchor: the existing recall hint under the horde counter (`recallHint`) — B2 *is* that hint's first appearance; after B2
  completes the hint keeps working as before.
- Text: "**Space** calls the whole horde back."
- Complete: order returns to `follow` via the player's recall input.

**B3 · Split the horde** *(the multi-select lesson)*
- Trigger, all of:
  - B1 done; followers ≥ 8 (fewer than ~4 per group feels pointless);
  - **two or more** valid targets on screen, all `canTarget`, within 35 m of the Alpha and ≥ 6 m apart
    (e.g. two guards, a guard + a barricade, a car + a pedestrian);
  - the horde is currently on a single target or following.
- Anchor: the current attack target (if any) gets its normal marker; each *candidate* second target gets a dashed
  "ghost ring" with a small `+` badge (culled past the vision limit, never on an unidentified human).
- Text: "Hold **E** and **right-click** another target to split the horde. Each target gets an equal share."
  (touch: "**Long-press** another target to split the horde.")
- Complete: `state.squads.length ≥ 1` after an additive command.
- Follow-up micro-cards (each shown once, immediately, while the split is live, same card slot):
  - **B3b** "Selected targets show how many zombies each one has. **E + right-click** a selected target to drop it."
    Complete: a squad removed by an additive toggle.
  - **B3c** "**Space** recalls every group at once." Complete: recall while `squads.length ≥ 1` (or after 12 s, shown = done).
- Skip-if: the player has created a split before (stored), e.g. found it in the Tab help panel.

**B4 · Split on the fly** *(optional reveal)*
- Trigger: first time a split target dies and its squad is auto-reassigned/rebalanced (observed: squad count drops without
  player input).
- Text: "When a target falls, its group rejoins the others automatically."
- Shown once = done.

## 4. Scheduling rules (anti-nag)

- **Visibility gate:** only while `gameFlow === PLAYING`, `phase === 'playing'`, no pause/map/nest modal, not respawning,
  intro cinematic finished, objective card collapsed, leader hp ≥ 25 %, no `capReached` toast in the last 3 s.
- **One slot:** a single tip card; a queued tip waits. Priority: reveal tips (A2, B4) > follow-ups (B3b/c) > Track B > Track A
  (command lessons are rarer opportunities, so they win when both are eligible).
- **Cooldown:** 20 s between the end of one tip and the start of the next (follow-ups B3b/B3c exempt — they chain).
- **Lifetime:** a tip shows up to 10 s (reveal tips 6 s), or until completed, or until its trigger stops holding for 2 s
  (the opportunity walked away — no stale advice).
- **Backoff:** an ignored tip may return after 60 s, then after 180 s; after its 3rd ignored showing it is **retired**.
- **Session cap:** at most 6 tip showings per 10 minutes of play.
- **Hover dismiss:** clicking the card's ✕ (or pressing nothing at all) is enough; ✕ retires that tip immediately.

## 5. Presentation

- **Tip card:** bottom-centre above the ability bar, inside `.hz-play` (auto-hidden under modals/cinematic). Uses
  `hudTheme.css` tokens and `calc(N * var(--hz-u))` sizing; icon from `hudIcons.ts` (`recruit`, `target`, `recall`, a new
  `split` icon); key caps via the existing `.hz-key` style. One line of text, at most two. Slide-in 180 ms, no sound beyond
  the existing soft UI tick (muted under reduced motion: fade only).
- **World anchors:** pooled DOM pips projected from world positions (same approach as `SenseIndicators`), max 3 at once,
  off-screen candidates are simply not anchored (no edge arrows — tips are about what you can see).
- **Field Guide:** a "Tips" section appended to the Tab controls panel listing every lesson with a check (done), dot
  (pending) or dash (retired), plus the one-line text — so nothing is ever lost by ignoring it.
- **Settings (Pause → Settings):** `Field tips: On / Off` and `Reset tips`. Default On. Off hides cards and anchors but keeps
  silently recording completions.

## 6. Touch parity: long-press to split

Touch currently has no additive target input, so B3 would be untrue on phones. Add one gesture:

- **Long-press** (single finger, ≥ 380 ms, ≤ the existing tap move tolerance) on a pickable target issues
  `{ type: 'attack', target, additive: true }` — same command E + RMB produces. Short tap unchanged.
- A filling ring under the finger from 150 ms → 380 ms shows the press is registering; releasing early = normal tap.
- Long-press on ground / on nothing = no command (don't invent a meaning).
- Pure decision lives in `core/touchMath.ts` (or `cameraMath.ts` beside `touchTapAllowed`): `touchLongPressAllowed(...)`.
- Help panel and B3 touch copy updated accordingly.

## 7. Architecture

| File | Kind | Role |
|---|---|---|
| `src/tutorial/tutorialRules.ts` | [pure] | Lesson table (id, track, prereq, trigger predicate, completion predicate, text desktop/touch, anchor kind), scheduler state machine (eligible → showing → done/ignored/retired), cooldown/backoff/session cap. Inputs: `GameState`, drained `GameEvent[]`, a small `TipContext` (dt, now, hover target, modal/flow flags, touch, vision helpers). Output: `TipView | null` + `TipAnchor[]`. |
| `src/tutorial/tutorialStore.ts` | [pure] | `TutorialProgress` schema (`version`, per-lesson `done`/`showings`/`retired`, `enabled`) + parse/migrate, injectable `StorageLike` (like `SaveStore`), key `ibz.tutorial.v1`, never throws. |
| `src/ui/TutorialTips.ts` | DOM | Renders the card + pooled anchor pips; writes DOM only on signature change (HUD pattern). |
| `src/ui/hudIcons.ts` | edit | `split` icon. |
| `src/ui/HUD.ts` | edit | Field Guide rows in the Tab panel; hosts the TutorialTips root in `.hz-play`; B2 reuses `recallHint`. |
| `src/ui/PauseMenu.ts` | edit | Field tips toggle + Reset tips. |
| `src/core/InputController.ts`, `src/core/cameraMath.ts` | edit | Long-press additive target (§6). |
| `src/core/Game.ts` | edit | Owns `TutorialDirector` instance; feeds it the same drained events as HUD/audio each frame; projects anchors. |
| `tests/tutorial.test.ts` | test | See §9. |

Notes:
- Predicates run at ≤ 4 Hz (cheap scans over nearby agents via spatial queries already exposed, or bounded loops with early
  exit); completion checks run on every drained event batch.
- No module-level mutable state; the director is an instance, reset on `Reset tips` and unaffected by world reset
  (tips are about the player, not the save). New Game after a save reset does **not** re-show done tips.
- Legacy layout (tests / `new Simulation()`): director disabled.

## 8. Opportunity check (no forced content)

The tutorial adds no spawns, so the opening must already offer each lesson naturally. Verify with the open-world layout:
- ≥ 6 ambient, unheld zombies reachable within 40 m of `startFollowerArea` (A1, A2).
- ≥ 1 civilian within 60 m (A3) and a pair of targets ≥ 6 m apart within 35 m of each other inside the first district (B3).
- ≥ 1 structure holding zombies in the first district (A4).
If a check fails, adjust layout data — never add tutorial-only entities.

## 9. Acceptance criteria & tests

Pure tests (`tests/tutorial.test.ts`):
1. A tip never becomes visible while modal / cinematic / respawning / hp < 25 %.
2. Doing the action before eligibility marks the lesson done and it is never shown (silent skip) — per lesson.
3. Start followers do not complete A1; a leader-proximity `recruited` event does.
4. B3 is not eligible with one target, with targets < 6 m apart, with an unidentified human as the second target, or with < 8
   followers; becomes eligible when all conditions hold; completes on `squads.length ≥ 1`.
5. B3 anchors never reference a guard for which `canTarget` is false and never lie past `hiddenBeyond`.
6. Only one tip visible at a time; cooldown 20 s respected; follow-ups chain without cooldown.
7. Ignore × 3 → retired; ✕ → retired immediately; retired lessons never show again until Reset.
8. Session cap (6 / 10 min) holds under a scripted stream of eligible triggers.
9. Store: corrupt / missing / old-version JSON → defaults, never throws; round-trip preserves progress.
10. `touchLongPressAllowed`: duration and movement thresholds, multi-touch rejected.
11. Layout opportunity checks from §8.

Playtest (browser):
- Fresh profile: play 10 minutes without touching any tip — no blocked input, no tip repeats more than 3 times, game state
  identical in behaviour to tips Off.
- Fresh profile, deliberate: recruit → chains → bite → break a structure → sic 'em → recall → E + RMB split → drop → recall;
  every card ticks off as it happens, Field Guide shows all done.
- Veteran path: split targets before any tip — B3 never appears.
- Touch emulation: long-press splits; short tap still orders.

## 10. Task breakdown

| ID | Owner | Locked files |
|---|---|---|
| TU-T001 | codex | `src/tutorial/tutorialRules.ts`, `src/tutorial/tutorialStore.ts`, `tests/tutorial.test.ts` |
| TU-T002 | agy | `src/ui/TutorialTips.ts`, `src/ui/hudIcons.ts`, tip CSS in `src/ui/hud.css` |
| TU-T003 | claude | `src/core/cameraMath.ts`, `src/core/InputController.ts` (long-press) + its tests |
| TU-T004 | orchestrator | `src/core/Game.ts`, `src/ui/HUD.ts`, `src/ui/PauseMenu.ts` wiring; layout checks (§8); playtest; docs |

T001–T003 can run in parallel (disjoint files); T004 integrates after.
