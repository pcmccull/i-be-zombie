# T008 — Humans (police/soldier/civilian) and population (codex)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, reports `T002-codex.md`, `T004-codex.md`,
`docs/3_open_world.md` §4C, §4D (patrols), §9, `src/core/types.ts` (HumanRole 'police', HumanPost 'stronghold'|'patrol', GuardAgent
`strongholdId`/`dormant`/`staggerTime`, DistrictDef budgets/spawnPoints), `src/config/balance.ts` (`police`, `guard`, `civilian`, `population`),
`src/systems/HumanAISystem.ts`, `src/entities/HumanGuard.ts`, the stub `src/systems/PopulationSystem.ts`, `src/world/worldQueries.ts`.

## Locked files
`src/systems/HumanAISystem.ts`, `src/systems/PopulationSystem.ts`, `src/entities/HumanGuard.ts`, `tests/{ai,civilianChase}.test.ts`,
`tests/population.test.ts` (new). Nothing else.

## Deliver
1. Roles: everything that today means "armed" (`role === 'soldier'`) also applies to `'police'` (shooting, alert assist, retreat, targeting).
   Police use `BALANCE.police` (hp via `createGuard`, damage, range, fireCooldown, hitChance) and wait `police.aimDelay` after acquiring a
   target before the first shot (soldiers keep current behaviour). Legacy `post:'barricade'` numbers stay as they are.
2. `staggerTime > 0` ⇒ the human neither moves nor shoots; tick it down.
3. Posts: `'stronghold'` defenders behave like checkpoint guards for their stronghold (patrol their waypoints, alert-assist only defenders of
   the same `strongholdId` plus nearby patrols, retreat stays inside the stronghold bounds when the layout has it); `'patrol'` police walk their
   waypoint loop through the district and engage like soldiers but give up pursuit after `loseTargetTime` and return to their route.
   Reinforcement squads spawned by ConquestSystem (T009) are `'patrol'` with `waypoints` = [spawn point, stronghold center]; they must path
   there and engage on the way.
4. Dormancy: skip `dormant` humans entirely (no perception, movement, shooting).
5. `PopulationSystem.updatePopulation(ctx, dt)`: at `population.dormantRefreshHz` set `dormant` for humans and ambient zombies beyond
   `population.activeRadius` of the leader (followers/rising never dormant; while the leader is dead use the active nest position). Budgeted
   respawns: per district not `'infected'`, if living civilians of that district < `civilianBudget` (× `conquest.capturedPatrolFactor` when the
   stronghold is captured), one per `civilianRespawnDelay` s respawns at a `spawnPoint` ≥ `minRespawnDistance` from the leader and not visible
   to it; same top-up for free ambient zombies (`ambientBudget`). Respawned entities use `createGuard`/`createZombie` with `ctx.newId()` and
   district-appropriate `homeArea`/`spawnZone`. Hard caps `population.maxHumans` / `maxAmbient`. Remove long-dead human corpses
   (`deathTime` older than 30 s and not pending conversion) so `state.guards` stays bounded. Legacy layout (budgets 0) ⇒ no respawns.
   Population is deterministic (ctx.rng only).
6. todos #8 (bonus, only if simple): street civilians may leave their `homeArea` while fleeing; zombies stop chasing a civilian they've lost
   sight of for 2 s.
7. `tests/population.test.ts` on `buildDistrictLayout()` (open world, from T002): dormant flags match radius; dormant humans don't move;
   respawn respects delay, distance and caps; captured district respawns fewer; walking the leader around all districts for 3 sim-minutes keeps
   `state.guards.length` and ambient count bounded; police shoot after aim delay; staggered police don't shoot.

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T008-codex.md` (AGENTS.md format), MEMORY notes.
