# EW-T009 — Sense indicators, eyesight panel, map gating, cue audio (agy-worker)

Read first: `AGENTS.md`, `.agent-context/ARCHITECTURE.md` (§EW-3 vision/sense types), `.agent-context/MEMORY.md`,
`.agent-context/PROGRESS.md`, `docs/5_expand_world.md` §4–6, `src/systems/AwarenessSystem.ts`, `src/systems/ProgressionSystem.ts`
(`visionCost`, `buyVision`), upstream reports `.agent-context/reports/EW-T005-codex.md`, `EW-T006-claude-worker.md`.
Look at how the slot purchase was added (`onBuySlot`, `slotPurchased` toast, `maxSlots` deny text) and mirror it.

## Locked files (edit ONLY these)
- NEW `src/ui/SenseIndicators.ts`
- `src/ui/HUD.ts`, `src/ui/NestPanel.ts`, `src/ui/uiHelpers.ts`, `src/ui/Minimap.ts`, `src/ui/WorldMap.ts`,
  `src/ui/mapRender.ts`, `src/ui/hudOpenWorld.css`, `src/audio/AudioSystem.ts`, `tests/uiHelpers.test.ts`

**`src/ui/HUD.ts` already has uncommitted edits from another session (mouse-capture hint removed). Keep them exactly;
make your HUD changes additive on top.**

Never edit:
- `Game.ts`, `InputController.ts`, `PauseMenu.ts` (EW-T010 wires you);
- types, contracts, balance, content.

These run in parallel and are owned by other tasks: `src/world/**` (EW-T007); `src/visuals/**` and
`src/core/visionMath.ts` (EW-T008).

## Implement
1. `SenseIndicators` (DOM): `export class SenseIndicators { constructor(root: HTMLElement); update(state: GameState,
   cameraYaw: number, dt: number): void; dispose(): void }`.
   - One screen-edge arc per `state.vision.cues` entry, using at most `BALANCE.senses.maxCues` pooled nodes.
   - Each arc is placed by the direction from the leader to `cue.pos`, relative to camera yaw (yaw convention in AGENTS.md).
   - Opacity follows intensity and fades with age/ttl.
   - Icon/colour per kind: gunshot, scream, siren, crowd (crowd = scent).
   - Never a map dot, never exact positions.
   - Pure angle/opacity math goes in `uiHelpers.ts` and is tested.
2. `NestPanel`: an "Eyesight" section in the same style as the slot buy.
   - Shows the current tier name, clear radius and what it detects.
   - Shows the next tier's cost, or "MAX".
   - Buy button → `onBuyVision?: () => void` callback, disabled/greyed when not affordable.
3. `HUD`:
   - Toast on `visionUpgraded` ("Eyes adjust — Predator Sight").
   - Deny text for `abilityDenied` with reason `'maxVision'` (`abilityId: null`).
   - On district change, a district-entered banner with threat-tier pips (threatTier and threat text from `content/districts.ts`).
   - Humorous one-time tips: first session (poor sight), and the first time an upgrade is affordable. Track them in the
     HUD instance; no persistence needed.
   - Add a mount point or hook for SenseIndicators if it fits naturally; otherwise leave it to T010 and document that.
4. `Minimap` / `WorldMap` / `mapRender`:
   - Humans are drawn only when identified (`isIdentified`); seen = grey dot; others not at all.
   - Stronghold defenders and reinforcements are never revealed unless identified.
   - Cues show as soft fuzzy arcs at the map edge or a blurred blob, never a precise dot.
   - Discovery fog unchanged.
5. `AudioSystem`:
   - Play cue sounds on `senseCue` events: fresh cues only, with a per-kind cooldown.
   - Stereo-pan by direction relative to camera yaw; attenuate by distance/range.
   - Synthesized Web Audio, mute-safe.
   - Expose `playSenseCue(kind, pan, gain)` or consume events in the existing event handler, and document the call T010 must make.

## Tests (`tests/uiHelpers.test.ts`)
- Cue screen angle for leader/cue/yaw cases: front, left, right, behind.
- Opacity vs intensity and age.
- Map visibility rule: identified / seen / none.
- Threat pip count.
- Eyesight panel view model: cost, MAX, affordable.

## Done when
`npx tsc --noEmit`, `npm test`, `npm run build` pass. Write `.agent-context/reports/EW-T009-agy-worker.md` (AGENTS.md
format, exact public API + required Game wiring for T010) and append Memory Notes to `.agent-context/MEMORY.md`.
