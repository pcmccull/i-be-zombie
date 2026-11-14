# T007 — Horde: commands, move orders, frenzy, cap, dormancy, brutes, stragglers (codex)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md` (input model §4), reports `T003-codex.md` and `T005-codex.md`,
`docs/3_open_world.md` §4C, §7 "Horde interaction", `src/core/types.ts` (`HordeOrder` move, `HordeCommand`, `SimInput.hordeCommand`,
ZombieAgent `dormant`/`brute`, events `moveOrder`), `src/config/balance.ts` (`horde`, `openWorld.maxFollowers`, `nav.farCatchUp*`, `frenzy`,
`brute`), `src/systems/ProgressionSystem.ts` (read only: `hordeSpeedMultiplier`, `isFrenzyActive`), `src/systems/HordeSystem.ts`.

## Locked files
`src/systems/HordeSystem.ts`, `tests/{horde,cascade,recruitment,engagement,fixes-horde,todos,r4d,opening,momentum-integration}.test.ts`,
`tests/hordeCommands.test.ts` (new). Nothing else.

## Deliver
1. `applyHordeCommands` consumes `input.hordeCommand` (new model) **in addition to** the legacy `rally/rush/recall/attackTarget` fields
   (both must work until T015 removes the legacy ones; legacy tests stay green):
   - `{type:'attack', target, additive:false}` ⇒ replace the selection with this single target (clear squads);
     `additive:true` ⇒ existing toggle/split behaviour (`toggleTarget`).
   - `{type:'move', point}` ⇒ `order = {type:'move', point, expiresAt: time + horde.moveOrderTime}`, clear squads, emit `orderChanged` + `moveOrder`. Followers path to the point with the follow
     field logic re-targeted (use `ctx.navGrid`/`crawlNavGrid.buildFlowField` with the T003 bound, rebuilt only on order change), spread
     around it, auto-engage enemies within `autoEngageRadius` on the way, and revert to follow on arrival (80 % of the group within 6 m) or expiry.
     `ctx.nav` has no move field slot: keep the move field in your module's per-ctx scratch (WeakMap keyed by ctx, like the existing Scratch).
   - `{type:'regroup'}` ⇒ existing rally; `{type:'follow'}` ⇒ existing recall.
2. Speed: follower speed × `hordeSpeedMultiplier(state)` for followers within `frenzy.radius` of the leader **at frenzy start** (record the
   buffed ids in scratch on the `frenzyStart` edge: `isFrenzyActive` became true this step) — keep the legacy rush multiplier until T015.
   todos #5 civilian chase rule: treat Frenzy like Rush (`rushChaseFactor`) for buffed followers.
3. Cap: use `BALANCE.openWorld.maxFollowers` when `ctx.layout.strongholds.length > 0` (open world), else the legacy `horde.maxFollowers`
   (legacy tests rely on 100). Single helper `followerCap(ctx)`, used everywhere the cap is read in this file.
4. Dormancy: skip `dormant` ambient zombies entirely (no wander, no hash insert); followers are never dormant.
5. Brutes: steer like followers with their own radius/speed (already on the agent); prefer gate/structure targets when an attack order
   includes one; never crawl.
6. Stragglers (T003 follow-up): where `followField.sample()` returns false (beyond the bounded field) in the far/regroup and blocked-follow
   branches, fall back to `navGrid.findPath` toward the leader (cache per zombie, replan ≤ 1 Hz, bounded count per step) or direct steering.
   Followers farther than `nav.farCatchUpDistance` from the leader, not engaged and with no LOS to the leader, teleport to a walkable point
   behind the leader at `nav.farCatchUpOffscreen` (deterministic choice, emits nothing; never inside a stronghold's bounds).
7. `tests/hordeCommands.test.ts`: move order (go, auto-engage, revert on arrival/expiry), non-additive attack replaces selection, additive
   splits, regroup = rally, follow = recall, frenzy speeds up only buffed followers, open-world cap 40 vs legacy 100, dormant ambient untouched,
   straggler beyond bound catches up, brutes never crawl.

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T007-codex.md` (AGENTS.md format), MEMORY notes.
