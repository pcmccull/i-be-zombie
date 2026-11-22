# VP2-T008 — Zombie clips, animation states, body shapes (claude-worker, failover from codex)

- **Task ID & Agent:** VP2-T008 / claude-worker
- **Status:** COMPLETED (full-suite result noted under Verification Run)

**Completed Work**
- `src/graphics/characters/characterClips.ts` (new, pure): `PoseClip`, `CLIPS` (celebrate, bite, hitReact, turnL, turnR (mirrored turnL), lunge, idleLook, riseFlourish), `applyClip` / `applyClipAuthored`, `clipDuration`, `BITE_SNAP_T` (0.3), `hitSign`.
- `src/visuals/zombieAnimation.ts` (built on the existing staged version): states `bite | hit | celebrate | turn` reachable; optional input `celebrate?`; per-id clip variation; overlays: celebrate (loop, smoothed weight, Alpha gain 1.3, hop lifts pelvis after grounding), hit stagger (direction-signed, from `hitImpulse` + `hitFromX/Z`), turn-on-spot (smoothed turn rate > 1.3 rad/s while slow), idle look (7-16 s of stillness, hash-scheduled, no rng use), lunge (charging engaged zombie), rise flourish (after `rise`), bite clip time-warped over windup/recovery so the jaw snap lands exactly at the strike key. Alpha swagger (more upright, bigger hip roll). Pelvis tilt (lean spring/hit) is compensated in the thighs, so planted feet stay planted. Removed the old hit-reaction knee flex (it slid the feet).
- `src/visuals/zombieProfiles.ts`: `bodyShape: BodyShapeId` (salt 41; brute -> heavy; heavy gait -> heavy/shortRound; thin -> tallSkinny/lanky; Alpha -> 'alpha'); `pickBodyShape` exported.
- Tests: `tests/characterClips.test.ts` (new), `tests/zombieAnimation.test.ts` extended (VP2 body shapes + clip states).

**Remaining Work:** none for T008. Not wired (T009): HordeRenderer / EntityRenderer do not yet pass `celebrate` and do not read `bodyShape`.

**Public Interfaces/Exports Added:** `characterClips.ts` (above); `ZombieAnimInput.celebrate?`; `ZombieAnimStateName += 'bite' | 'celebrate'` ('hit'/'turn' already existed); `ZombieAnimState` clip fields (`clipVar`, `celW`, `hitClipT`, `turnClipT`, `idleLookT`, `lungeT`, `flourishT`, ...); `ANIM_TUNING` clip keys; `ZombieProfile.bodyShape`; `pickBodyShape`.

**Verification Run:** `npx tsc --noEmit` clean (HordeRenderer/EntityRenderer unchanged). `npx vitest run tests/characterClips.test.ts tests/zombieAnimation.test.ts`: 29/29 pass. Full `npx vitest run`: see final message.

**Memory Notes:** see the [VP2-T008] bullet in MEMORY.md.
