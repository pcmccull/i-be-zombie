# VP2-T008 — Zombie clips, animation states, body shapes (codex attempt)

- **Task ID & Agent:** VP2-T008 / codex (run via `codex exec --sandbox workspace-write`; brief at `C:\Users\phil\AppData\Local\Temp\claude\ac7191ca6e6527a7\456ecca9-3db5-4549-b05d-b06a901312ab\scratchpad\vp2t008_prompt.txt`)
- **Status:** QUOTA_EXHAUSTED

**Completed Work:**

- Nothing from the T008 scope was written. Codex read the context files and then stopped with `ERROR: You've hit your usage limit ... try again at 11:36 AM`.
- A check after the run found no edits by this run to the locked files:
  - `src/graphics/characters/characterClips.ts` does not exist. `src/graphics/characters/` still holds only `bodyMeshMath.ts`, `characterTypes.ts`, `humanoidRig.ts` (VP2-T001/T002).
  - `src/visuals/zombieAnimation.ts`: working tree equals the index. Its 92-line difference from HEAD is a pre-existing staged change from another session, not from this run.
  - `src/visuals/zombieProfiles.ts`, `tests/characterClips.test.ts`, `tests/zombieAnimation.test.ts`: untouched.
  - `.agent-context/MEMORY.md`: no `[VP2-T008]` bullet. Its uncommitted changes belong to other sessions.
- Two earlier codex launches in this session were stopped or failed before doing work. The first used a brief path that was not on disk. The second was killed by PID because it had no brief.

**Remaining Work:** the entire brief, unchanged. Brief sections are in the scratchpad file above.

1. `src/graphics/characters/characterClips.ts` (new, [pure]): `PoseClip` per ARCHITECTURE VP2-1; `CLIPS` with 8 clips (celebrate, bite, hitReact, turnL, turnR, lunge, idleLook, riseFlourish); `applyClip(out, clip, t, weight, variation)`; `clipDuration(name, variation)` (±12 % speed); export a bite snap-time constant and a hit-direction sign helper.
2. `src/visuals/zombieAnimation.ts`: add states `bite | hit | celebrate | turn` to `ZombieAnimStateName`; overlay clips on the existing IK gait with grounding reapplied after overlays (planted feet within 1 cm); new optional inputs `celebrate?`, hit/hitDir → hitReact, `ATTACK_STYLE.bite` → jaw snap on the cd→0 strike key, turn from yaw rate at low speed, occasional idleLook; ≥ 0.12 s cross-fades; per-id clip speed/amplitude/phase; Alpha personality (bigger celebrate, upright swagger).
3. `src/visuals/zombieProfiles.ts`: `bodyShape: BodyShapeId` on `ZombieProfile` (hashId, ~35/18/17/15/15 split; brute ⇒ heavy; heavy gait ⇒ heavy/shortRound; thin ⇒ tallSkinny/lanky); `alphaProfile()` ⇒ `'alpha'`. Existing look/gait outputs unchanged.
4. `tests/characterClips.test.ts` (new) and extended `tests/zombieAnimation.test.ts` per VP2-5 #3 (determinism, finite, loop continuity, variation, weight 0, additive vs blend, new states, bite snap step, planted feet, 240 Hz vs 960 Hz snap check, bodyShape distribution, brute ⇒ heavy, Alpha ⇒ alpha).
5. Verification: `npx tsc --noEmit` (HordeRenderer/EntityRenderer unchanged), `npx vitest run tests/characterClips.test.ts tests/zombieAnimation.test.ts`, then one full `npx vitest run`.
6. Append the `[VP2-T008]` bullet to `.agent-context/MEMORY.md` and rewrite this report to COMPLETED when done.

Fallback owner: per the quota policy the orchestrator should reassign T008 to `@claude-worker` (codex is exhausted until 11:36 AM for this session). `src/visuals/zombieAnimation.ts` has the pre-existing staged change noted above, so the new owner should start from the working tree.

**Public Interfaces/Exports Added:** none. The planned exports are listed in Remaining Work.

**Verification Run:**

- Not run for T008 (no code produced). Codex's own run output reported only the usage-limit error (exit 0 wrapper, `ERROR: You've hit your usage limit`).
- `git diff -- src/visuals/zombieAnimation.ts` (working tree vs index): empty. `git diff HEAD --stat` for that file: 92 insertions, 1 deletion (pre-existing staged change, not from this run).

**Memory Notes:**

- The brief must live at a path codex can read. A path that is not on disk makes codex run without the brief. Write the brief with the Write tool, verify it exists, then launch.
- `codex exec` reads the prompt from the argument string. Long prompts with embedded quotes broke the Git Bash invocation (`unexpected EOF`). A short mandated-prefix prompt that points to a brief file works.
- Background `echo` "waiting" calls return at once. Wait with a real polling loop or wait for the task-completed notification.
