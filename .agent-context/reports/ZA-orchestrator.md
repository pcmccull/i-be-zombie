# ZA — Zombie animation & visual polish (docs/6_zombie_movement.md)

- **Task ID & Agent:** ZA1–ZA2 · orchestrator (Claude)
- **Status:** COMPLETED (not committed)

## Completed Work
- `src/visuals/zombieRig.ts` [pure] — skeleton (hips → spine → head/jaw/arms with elbows; thighs → knees → ankles), `ZombiePose`, leg FK, `groundedHipY`.
- `src/visuals/zombieProfiles.ts` [pure] — deterministic per-id profile: 8 archetypes (tourist, office, lifeguard, construction, resident, police, athlete, soldier; converted guards → police/soldier) × 6 body types (regular, injuredLeg, stiffArm, heavy, thin, fresh) + brute override; Alpha hero profile; atlas tile ids.
- `src/visuals/zombieAnimation.ts` [pure] — `animateZombie(state, profile, input, pose)`: distance-driven gait with planned foot targets + 2-bone soft IK (planted feet), limp phase warp / toe drag / circumduction, inverted-pendulum hip arc, sway / hip twist / counter-rotation, speed-blended idle ↔ walk ↔ fast stagger, springs (inertial lean, turn lag torso < head, hit impulses), lurches/stumbles, 8 idle twitch kinds, aggressive horde-attack posture, look-at-leader, 5 attack styles with anticipation → strike (= damage step) → follow-through, stun, climb, 3 death styles, rise. `ANIM_TUNING` holds the constants.
- `src/visuals/zombieTextures.ts` — 25-tile seamless canvas atlas (skin ×3, Hawaiian ×2, office, tee, tank, hi-vis, police, lifeguard, sport, denim, khaki, slacks, board shorts, leather, hair, Alpha jacket, fatigues, plain) + Sobel normal map.
- `src/visuals/zombieModel.ts` — articulated part geometry (faces: sunken sockets, mismatched cloudy eyes, crooked nose, teeth gap, wounds; hands with curled fingers + dirty claws; tattered hems/sleeves), 9 accessories, MeshStandard atlas patch (per-instance tile/skin/tint, glow), `composeBones`, `createZombieHeroRig`.
- `src/visuals/HordeRenderer.ts` — rewritten on the above: side-table of profiles + anim states, 3-tier camera LOD (far drops jaw + small accessories, no twitches/lurches), shot-direction hit reactions, paused-sim freeze, `updateMs`/`lodCounts` stats. ~20 draw calls for the horde.
- `src/visuals/EntityRenderer.ts` — Alpha uses the hero rig + controller (combo step → bite / right claw / left claw / overhead; hit stun → stun; death/respawn → death/rise).
- `src/visuals/LowPolyCharacters.ts` — zombie code removed (humans only).
- `src/core/Game.ts` — `horde.setCamera/setLeader`, real frame dt to the horde, `hordeStats` getter. `src/main.ts` — dev-only `window.game` handle.

## Remaining Work
- None required. Not done: knockdown/get-up as a distinct state (the sim has no zombie knockdown; death/rise cover fall/get-up), geometry LOD meshes (far zombies use the same parts with fewer accessories).

## Public Interfaces/Exports Added
`animateZombie`, `createAnimState`, `createAnimInput`, `applyAttackPose`, `attackKey`, `ANIM_TUNING`; `zombieProfile`, `alphaProfile`, `TILE`, `ATLAS_GRID`; `RIG`, `ZombiePose`, `createPose`, FK helpers; `composeBones`, `createZombieMaterial`, `createZombieHeroRig`, `LEADER_GLOW` (moved here); `HordeRenderer.setCamera/setLeader/updateMs/lodCounts`; `Game.hordeStats`.

## Verification Run
- `npx tsc --noEmit` → 0 errors · `npm test` → 49 files / 539 tests pass · `npm run build` → OK.
- Browser (5173): no console errors; 91 zombies drawn (LOD 18/28/45), horde update ≈ 0.8–1.0 ms/frame, horde = 20 draw calls / ~100 k tris; frame time identical with horde hidden vs shown (pane hidden → capped at 50 fps, so GPU headroom not measured precisely).
