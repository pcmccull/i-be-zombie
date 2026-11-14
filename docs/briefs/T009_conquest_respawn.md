# T009 — Conquest, territory, discovery, nests, respawn (codex)

Read first: `AGENTS.md` (Open world section), `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, reports `T002-codex.md`, `T005-codex.md`,
`T006-agy.md`, `docs/3_open_world.md` §4D, §7 "Conquest logic", §10 items 2, 6, 8, 10, 12, `src/core/types.ts` (StrongholdDef/ObjectiveDef/
NestDef/DistrictDef, StrongholdState, DistrictState, DiscoveryState, events), `src/core/contracts.ts` (Conquest/Respawn sections),
`src/config/balance.ts` (`conquest`, `nest`, `respawn`, `discovery`, `progression`), `src/content/strongholds.ts`, stubs
`src/systems/{ConquestSystem,RespawnSystem}.ts`, `src/systems/StructureSystem.ts`, `src/systems/ProgressionSystem.ts` (read only).

## Locked files
`src/systems/ConquestSystem.ts`, `src/systems/RespawnSystem.ts`, `src/systems/StructureSystem.ts`,
`tests/{conquest,discovery,respawn}.test.ts` (new). Nothing else — `tests/structures.test.ts` is being edited by T004; put new StructureSystem
assertions in `tests/conquest.test.ts`. (Simulation does not call your systems yet — T012 wires the step order;
your tests call `updateConquest`/`updateRespawn` explicitly after `sim.step`.)

## Deliver
1. **Discovery** (`revealHz`): reveal fog cells within `discovery.revealRadius` of the leader (`revealAround`, keeps `revealed` in sync). A
   district becomes `discovered` the first time any of its cells is revealed ⇒ status `unknown → human`, emit `districtDiscovered` +
   `districtStatus` + `autosave{discover}`. Discovery never sets contested/infected.
2. **Objectives** per stronghold (skip captured): `destroyStructure` done when that structure is destroyed; `destroyGate` when the gate is;
   `killDefenders` when every human with that `strongholdId` and an armed role is DEAD; `holdPoint` progresses while ≥ `minZombies` followers
   are inside the radius and no living armed defender of that stronghold is inside (decays at 2× when broken, reset when no zombies), done at
   `holdTime`; `requires` gates progress. Emit `objectiveComplete` once each; `objectivesDone` order = completion order.
3. **Contested**: when an objective takes damage or completes, or ≥ 6 followers are within `conquest.contestRadius` of the bounds while a
   defender is fighting ⇒ `contested = true`, district `human → contested`, emit `strongholdContested` + `districtStatus`. Reverts to `human`
   (contested false) after 30 s with no followers within contestRadius and no objective progress.
4. **Capture** (all objectives done): exactly once — `captured = true`, `contested = false`, `unlockAbility(def.unlock)` (if any),
   `addBiomass(def.biomassReward, 'capture')`, nest activated (`nestActivated`), `state.activeNestId` = that nest if the player has not chosen
   another, district `infected` + `strongholdCaptured = true` + `infection = 1`, remaining defenders of that stronghold flee/become civilians
   (role civilian, post street) — never re-spawned, emit `strongholdCaptured` + `districtStatus` + `autosave{capture}`. Any order of strongholds.
5. **District metrics** (1 Hz): `humanStrength` = living armed humans in district / armed humans at start; `infection` from killed/converted
   share; `alertLevel` += `alertPerArmedKill` per armed human killed in the district, `alertPerStructureHit` per structure/gate hit, decays at
   `alertDecayPerSecond`. **Reinforcements**: district not captured, alert ≥ `reinforcementAlert`, cooldown elapsed, `reinforcementsSpent` <
   `maxReinforcementWaves` ⇒ spawn `reinforcementSize` police (`createGuard`, post 'patrol', waypoints [point, stronghold center], respects
   `population.maxHumans`) at the reinforcement point farthest from the leader; emit `reinforcements`. Captured districts never spawn waves.
6. **Nests**: `isNestActive`; while the leader is alive within `nest.replenishRadius` of an active nest and followers < `nest.replenishTarget`,
   spawn one follower (gen 0, no pulse, not counted in `stats.recruited`, keeps `followerCount` invariant) every `nest.replenishInterval`.
7. **StructureSystem**: `damageStructure` on a structure referenced by a stronghold objective marks it contested via a hook the
   ConquestSystem reads (e.g. `lastHitAt` in your module scratch — no contract change), `addBiomass(progression.biomassStructure,'structure')`
   on destroy, and alert increments.
8. **RespawnSystem**: leader `!alive` while `phase === 'playing'` ⇒ `phase = 'respawning'`, `respawnTimer = respawn.delay`, `deaths++`,
   order = follow; at 0 ⇒ leader at the active nest (nearest active nest to the death point if the chosen one is somehow inactive), full hp,
   stamina, `alive = true`, anim reset, `respawn.followers` new followers around it (cap respected), `phase = 'playing'`, emit
   `leaderRespawned` + `autosave{respawn}`. Surviving followers stay followers. Progression/territory/discovery untouched. Never touch legacy
   `victory/defeat` (VictorySystem still runs in legacy tests).
9. Tests (open world `buildDistrictLayout()`): discovery ≠ conquest; each objective kind; capture once + unlock once + biomass once even when
   conditions stay true for many steps; any capture order (mall before police); reinforcement waves bounded; captured district no waves;
   nest replenishment invariant; death → respawn at nest keeps unlocks/biomass/territory; respawn at newly captured nest.

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T009-codex.md` (AGENTS.md format), MEMORY notes.
