# T012 — Simulation integration + open-world headless tests (claude-worker)

Read first: `AGENTS.md` (Open world section + open-world step order), `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, all reports
`T002…T009` in `.agent-context/reports/`, `docs/3_open_world.md` §10, `src/sim/{Simulation,createInitialState}.ts`, `src/systems/VictorySystem.ts`.

## Locked files
`src/sim/Simulation.ts`, `src/sim/createInitialState.ts`, `src/systems/VictorySystem.ts`, `tests/victory.test.ts`, `tests/openWorld.test.ts` (new).
Small fixes in another system file are allowed **only** if a cross-module bug blocks integration — list each in the report with the reason.

## Deliver
1. `Simulation` step order per AGENTS.md "Open-world order": `updatePopulation`, `applyHordeCommands`, `updateProgression`, `updateLeader`
   (skipped while `phase==='respawning'`), `updateNavigation`, `updateHorde`, `updateHumanAI`, `updateCombat`, `updateConversion`,
   `updateStructures`, `updateMomentum`, `updateConquest`, `updateRespawn`, timers. The world keeps simulating while respawning; systems must
   tolerate `leader.alive === false` (verify, fix in place if trivial).
2. Legacy vs open world: when `layout.strongholds.length === 0` (legacy district) keep calling `checkVictory` and keep victory/defeat phases so
   legacy tests stay green; in the open world never call it (no victory/defeat; death ⇒ respawning via RespawnSystem).
3. `new Simulation(layout?, seed?, save?: WorldSave | null)` and `reset(seed?, save?)`: after `createInitialState`, `applySave(ctx, save)` when
   given. `createInitialState`: guards with `strongholdId` set the stronghold elevations from `layout.checkpoint.towers` as today; initial
   discovery reveal around the start (call `revealAround`) so the start district reads `human`/discovered at t=0.
4. `tests/openWorld.test.ts` — headless versions of spec §10 using `buildDistrictLayout()` and scripted `SimInput` (helper that steers the
   leader along `navGrid.findPath` waypoints; issue `hordeCommand`s): (1) walk from start to each stronghold area without leaving the sim
   (world continuous); (2) fog reveal ≠ conquest; (3) infect a civilian ⇒ follower; (4) Alpha kills a police officer with LMB presses and takes
   damage; (5) attack order ⇒ followers engage; (6) capture police_station (you may raise the horde with recruits + brief god-mode helpers
   that only touch test state, e.g. setting leader hp) ⇒ Alpha Claws unlocked exactly once; (7) equip at nest + frenzy + brute evolution;
   (8) mall before police coherent; (9) createSave → JSON → parseSave → new Simulation(layout, seed, save) restores everything;
   (10) death ⇒ respawn at nest with progression kept; (11) 10 sim-minutes roaming keeps `guards`, `zombies`, `followerCount ≤ 40` bounded;
   (12) no duplicate rewards / negative biomass. Opening pacing: with a simple scripted opening (walk toward civilians + LMB), ≥ 10 followers
   within 30 s. Use ≥ 60 s test timeouts for long runs.

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T012-claude.md` (AGENTS.md format), MEMORY notes.
