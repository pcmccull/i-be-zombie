# T011 Characters & effects (claude failover from agy)

**Task ID & Agent:** T011 / claude-worker (failover; agy quota exhausted)
**Status:** COMPLETED

## Completed Work (all in src/visuals/)
- LowPolyCharacters.ts: police (role 'police' or legacy barricade soldier: navy, peaked cap, pistol), soldier now olive fatigues + orange vest + helmet + rifle, civilian unchanged (varied palettes), Alpha rig bigger (1.22), more hunched, back spikes + 2nd shoulder plate, baseline glow `LEADER_GLOW`. New pose overlays: bite lunge, claw swipes (hit1 right arm, hit2 left arm, hit3 overhead slam), hit-stun flinch, human claw-finisher stagger. `composeZombiePartMatrix` gained optional `widthScale`.
- HordeRenderer.ts: brute variant (1.5x scale, 1.22 width, dark palette, gold marker ring) in the same instanced meshes (no extra draw calls); dormant + beyond-radius culling with compacted instance indices; frenzy red tint/pulsing marker for the cohort; zero per-frame allocation.
- EntityRenderer.ts: attack-phase/combo/hit-stun params to the leader pose, death fall + respawn rise via renderer timers, frenzy emissive + red rings, human culling (lazy rig creation), police/soldier kind selection, stagger pose.
- Effects.ts: pooled claw/bite arcs (`attackSwing`), frenzy start burst + persistent aura + periodic pulses + end ring, brute evolve burst/pillar, stronghold capture green light pillar + rings, move-order marker (state driven, fades at arrival/expiry) + ground ping on `moveOrder`, nest activation pulse/pillar, respawn burst/pillar. Legacy rush/rally/order markers untouched.

## Remaining Work
- T014 wiring only (see below). No browser playtest was run (headless only).

## Public Interfaces/Exports Added (for T014)
Per-frame order suggested: `entities.consume(events)` + `effects.consume(events, state)` + `horde.consume(events, state.zombies)` (all consume the drained events once), then
1. `horde.setView(cam.focus.x, cam.focus.z, state.progression.frenzyTimeLeft[, radius])`; `horde.update(state.zombies, alpha, state.time, rushActive)` (existing signature).
2. `entities.setView(cam.focus.x, cam.focus.z[, radius])`; `entities.update(state, alpha, time, dt)` (dt now used; pass real frame dt).
3. `effects.update(dt, state, alpha)` (alpha new, optional, default 1).
Once per layout: `effects.setWorld(layout)` (needed for `strongholdCaptured` position).
Events consumed: Effects: attackSwing, frenzyStart, frenzyEnd, bruteEvolved, strongholdCaptured, moveOrder, nestActivated, leaderRespawned (plus existing). HordeRenderer: frenzyStart, frenzyEnd. EntityRenderer: leaderRespawned (plus existing conversion events). `HordeRenderer.drawnCount` exposes culled draw count. New export `LEADER_GLOW`.
Without setView calls nothing is culled (back compat).

## Verification Run
- `npx tsc --noEmit`: PASS
- `npm test`: PASS (35 files / 371 tests)
- `npm run build`: PASS

## Memory Notes
Appended to MEMORY.md ([T011 Visuals], [T011 Looks]).
