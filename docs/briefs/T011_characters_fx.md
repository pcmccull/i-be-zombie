# T011 — Characters & effects (agy)

Read first: `AGENTS.md` (Visual conventions), `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, reports `T004-codex.md`, `T005-codex.md`,
`docs/3_open_world.md` §4G, `src/core/types.ts` (HumanRole 'police', ZombieAgent `brute`/`dormant`, LeaderState attack fields, events
`attackSwing`, `frenzyStart/End`, `bruteEvolved`, `strongholdCaptured`, `moveOrder`, `nestActivated`, `leaderRespawned`, `abilityUsed`),
and the current `src/visuals/{LowPolyCharacters,HordeRenderer,EntityRenderer,Effects,HealthBars}.ts`.

## Locked files
`src/visuals/**`. Nothing else (Game.ts is wired in T014; expose APIs only).

## Deliver
1. Readable factions: **police** (navy uniform, cap, pistol), **soldier** (olive/orange vest, helmet, rifle), **civilian** (varied casual
   colors), **Alpha** (bigger, hunched, distinct color + subtle glow), **brute** variant in `HordeRenderer` (≈ 1.5× scale, broad shoulders,
   darker skin — via per-instance scale or a separate instanced set; stay under 40 zombie draw calls).
2. Leader animation for `attackPhase` windup/recovery (bite lunge; claws: alternating arm swipes by `comboStep`, finisher overhead), hit stun
   flinch, death and respawn rise.
3. Render-radius culling: zombies/humans farther than `population.activeRadius` from the camera focus (or `dormant`) are not drawn; instance
   counts stay bounded; no per-frame allocation.
4. Effects (pooled): claw swipe arc on `attackSwing` (bite = small bite flash), Horde Frenzy aura (red pulse ring at start + red tint on
   buffed followers while `frenzyTimeLeft > 0` — use `state.progression.frenzyTimeLeft`), brute evolve burst, stronghold capture burst
   (green column), move-order ground marker (fades at arrival/expiry), nest activation pulse, respawn burst. Remove/retire Rush visuals only
   if they are trivially re-pointed to Frenzy; leave legacy code paths compiling.
5. API surface for T014: `Effects.consume(events)` (or the existing entry point) handles the new events; any new per-frame `update` takes
   `(state, alpha, dt)`.

## Done when
`npx tsc --noEmit`, `npm test` and `npm run build` pass. Report `.agent-context/reports/T011-agy.md` (AGENTS.md format), MEMORY notes.
