# T013 — HUD, minimap, world map, pause menu, nest panel, debug overlay, audio (claude-worker; agy unavailable)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md` (input model §4), reports `T005`, `T007`, `T009`, `T011`, `T012`,
`docs/3_open_world.md` §4F, §7 "Controls", `src/core/types.ts` (open-world state + events), `src/content/{abilities,strongholds,districts}.ts`,
`src/systems/ConquestSystem.ts` (`objectiveStatus`, `isNestActive` — read only), current `src/ui/{HUD.ts,hud.css}`, `src/audio/AudioSystem.ts`.

## Locked files
`src/ui/**` (new files allowed: `Minimap.ts`, `WorldMap.ts`, `PauseMenu.ts`, `NestPanel.ts`, `DebugOverlay.ts`, `mapRender.ts`),
`src/audio/AudioSystem.ts`. Nothing else — Game/Input wiring is T014; expose APIs + callbacks only. Plain DOM/CSS/Canvas2D, no framework.

## Deliver
1. **HUD**: Alpha health, follower count `n/40` (+ brute count), biomass, 4 ability slots (Q E R F) with icon/name, cooldown sweep, cost,
   locked/empty states and "denied" flash on `abilityDenied`; active objective tracker (nearest/most relevant stronghold: name, tier, objectives
   with progress from `objectiveStatus`); toasts for `objectiveComplete`, `strongholdCaptured` (+ unlock), `abilityUnlocked` ("New mutation:
   Alpha Claws — equipped in slot Q"), `districtDiscovered`, `reinforcements`, `nestActivated`, `autosave` (small "Saved" tick). Replace the
   victory/defeat overlays in the open world with a respawn overlay (`phase === 'respawning'`, countdown, keep legacy overlays for the legacy
   layout). Update help text/key hints to the new input model. Readable at 1280×720.
2. **Minimap** (corner, Canvas2D, heading-up or north-up, ~180 px): roads/buildings in revealed fog cells only (from `layout` + `state.discovery`),
   unknown masked, territory tint per district status (separate layer from discovery), strongholds icons colored by ownership/tier, nests, leader
   arrow, followers dots (cheap), waypoint marker. Redraw static layer only when discovery/status changes.
3. **World map** (`M`, full screen overlay, pauses nothing): same layers large + district names/landmarks, stronghold annotations (name, tier,
   unlock, captured/contested), legend that explains discovery vs control. Click on the map sets a waypoint (callback `onWaypoint(p | null)`).
4. **Pause menu** (`Esc` via T014): Continue, Save, Reset Save (confirmation step), mute toggle, controls list. Callbacks only.
5. **Nest panel**: when the leader is within `nest.equipRadius` of an active nest, a panel lists unlocked slot abilities and the 4 slots; clicking
   assigns (callback `onEquip(slot, ability|null)`); keyboard hint. Never mutates state.
6. **Onboarding**: short overlay at first start (no save): WASD/LMB/RMB/Space/QERF/M in one card; dismissed on first input.
7. **DebugOverlay** (F3): fps, frame ms, draw calls, loaded chunks, active/dormant humans + zombies, followers, district states, phase.
   Data passed in by Game (`update(stats)`).
8. **Audio**: cues for attackSwing (bite/claw), abilityUsed (frenzy roar, brute evolve), abilityDenied (soft blip), strongholdCaptured (sting),
   objectiveComplete, districtDiscovered (soft chime), reinforcements (siren), leaderRespawned, nestActivated. Web Audio synth only, mute-safe.
9. Pure helpers (map projection, objective selection) go in a `[pure]` file with a small Vitest test (`tests/uiHelpers.test.ts` — allowed).

## Done when
`npx tsc --noEmit`, `npm test`, `npm run build` pass. Report `.agent-context/reports/T013-claude.md` (AGENTS.md format) listing every public
method/callback T014 must wire, MEMORY notes.
