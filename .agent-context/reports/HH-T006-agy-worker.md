# HH-T006 — agy-worker

- **Task ID & Agent:** HH-T006, agy-worker (run headless via agy `gemini-4-hydrogen`; reviewed and verified by the Claude wrapper)
- **Status:** COMPLETED

## Completed Work
- `src/visuals/EntityRenderer.ts`: Alpha stagger spring (visual only). Sim pos/facing moved to a new `leaderAnchor` group; `leaderRig.root` now carries only the visual stagger and Last Brain panic offsets, applied after `animateZombie`. `consume()` sums `sharedDamage.incoming` (fallback: leader `damage`) into an impulse `clamp(incoming/25, 0.05, 1)`. Last Brain panic pose (lurch, 11–16 Hz jitter) while `lastBrain.active && alive && phase === 'playing'`. Reset on respawn, dead leader and `reset()`.
- `src/graphics/vfx/vfxRules.ts`: new VfxNames `horde.tether`, `horde.tetherGlint`, `horde.lastBrainAura`, `horde.recovery` with EMITTERS. `EVENT_MAP` adapters for `sharedDamage` (one tether + up to 4 glints from recipient positions) and `lastBrainEnd` ('recovered' only). `mapEvents` dedupes: ≤ 1 `horde.tether` and ≤ 4 `horde.tetherGlint` per batch.
- `src/graphics/vfx/VFXManager.ts`: continuous `horde.lastBrainAura` emitter while Last Brain is active (scaled by `burstScale`, halved under reducedMotion, pooled, culled by the existing `hiddenBeyond` path).
- `src/visuals/Effects.ts`: small addition (pooled path only, no per-burst meshes).
- `src/audio/sfxRules.ts`: `RECOVERY_SFX_ID` (`zombie_upgradetobrute`), `HeartbeatScheduler` (interval tightens 0.75 s → 0.28 s as timeLeft falls), `CriticalGroanGate` (cooldown 20 s), `RecruitCueGate` (0.6 s throttle); `SFX_TUNING` gains `heartbeatIntervalMin/Max`, `criticalGroanCooldown`, `recruitStrengthCooldown`, `recruitStrengthGain` (0.35).
- `src/audio/AudioSystem.ts`: synthesized heartbeat (`playHeartbeat`, sine thumps via `playTone`) while Last Brain is active, reset on `lastBrainEnd` / leader death / respawn / phase change; recovery cue on `lastBrainEnd` 'recovered'; `zombie_groan*` on `hordeCritical` gated 20 s; `zombie_collected` at reduced gain on `hordeStrengthChanged` cause 'recruit' with delta > 0, throttled. Existing unlock/mute guards are used.
- `tests/vfx.test.ts` (sharedDamage dedupe, 50-recipient wipe ≤ 1 tether / ≤ 4 glints, recovered vs expired/finished) and `tests/sfxRules.test.ts` (heartbeat cadence and reset, critical groan cooldown, recruit throttle, recovery id).
- Note: the same files also carry unstaged work from earlier sessions (shellBlast audio, heavy-weapon MG/tank rendering, court surface kind, leaderAnchor reset). Preserved, not part of HH-T006.

## Remaining Work
- `src/core/Game.ts` (outside lock): call `this.entities.setReducedMotion(this.graphics.reducedMotion)` from `Game.setQuality`. Until then the stagger/panic reduced-motion scale follows `prefers-reduced-motion` only. Candidate for HH-T007.
- Nothing else in HH-T006 scope is unfinished.

## Public Interfaces/Exports Added
- `EntityRenderer.setReducedMotion(on: boolean): void`
- `src/graphics/vfx/vfxRules.ts`: VfxName `'horde.tether' | 'horde.tetherGlint' | 'horde.lastBrainAura' | 'horde.recovery'`
- `src/audio/sfxRules.ts`: `RECOVERY_SFX_ID`, `class HeartbeatScheduler { update(now, timeLeft, duration): boolean; reset() }`, `class CriticalGroanGate { tryGroan(now): boolean; reset() }`, `class RecruitCueGate { tryPlay(now): boolean; reset() }`, plus the `SFX_TUNING` keys above.

## Verification Run
- `npx tsc --noEmit` (wrapper, after agy): exit 0, whole project.
- `npx vitest run tests/vfx.test.ts tests/sfxRules.test.ts`: 2 files, 84 tests passed.
- `npx vitest run` (full, wrapper): 80 files passed, 4 failed; 971 tests passed, 9 failed. All 9 failures are outside HH-T006 scope and belong to the concurrent HH sim work:
  - `tests/ai.test.ts` (2: guard cadence/leader damage; police pistol damage)
  - `tests/combat.test.ts` (1: friendly targets / dead leader filter)
  - `tests/persistence.test.ts` (1: `alphaCoreDamage` round-trip / clamp; saveSchema, HH-T003)
  - `tests/shielding.test.ts` (5: interception by followers; HH-T004)

## Memory Notes
- [HH-T006] Alpha stagger and panic are visual only: `EntityRenderer` splits `leaderAnchor` (sim pos/facing) from `leaderRig.root` (stagger + panic offsets, applied after `animateZombie`). Never write sim position from the renderer.
- [HH-T006] Shared-damage VFX dedupe lives in `vfxRules.mapEvents`: ≤ 1 `horde.tether` and ≤ 4 `horde.tetherGlint` per consume batch. A 50-follower wipe must not spawn 50 bursts.
- [HH-T006] Heartbeat is synthesized (`AudioSystem.playHeartbeat`), not a sample. Recovery cue reuses `zombie_upgradetobrute`; recruit cue reuses `zombie_collected` at gain 0.35.
- [HH-T006] `EntityRenderer.setReducedMotion` must be wired from `Game.setQuality` (Game is outside HH-T006's lock; HH-T007 candidate).
