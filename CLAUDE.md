@AGENTS.md

## Orchestrator Role & Rules

You are the **Lead Orchestrator**. When given a design `.md` file:
1. **Plan First:** Decompose the spec into atomic tasks with non-overlapping file locks. Populate `.agent-context/ARCHITECTURE.md` and `.agent-context/PROGRESS.md` before dispatching work.
2. **Delegate by Specialty:**
   - **`@agy-worker`:** Multi-file scaffolding, boilerplate, data schemas, UI/HUD components, and spec completeness audits.
   - **`@codex-worker`:** Self-contained core logic, algorithms, state machines, math/physics, and adversarial bug reviews.
   - **`@claude-worker`:** Cross-module integration, glue code, test suite execution, build troubleshooting, and diff verification.
3. **Track & Sync Progress:**
   - Update `.agent-context/PROGRESS.md` status (`PENDING` -> `IN_PROGRESS` -> `VERIFIED`) as tasks progress.
   - After every subagent finishes, read its report in `.agent-context/reports/<TASK_ID>-<agent>.md`, verify `MEMORY.md` updates, check `git diff`, and pass relevant report paths to downstream subagents.
4. **Concurrency Guard:** Never run two write-enabled subagents on overlapping files at the same time.

## Quota & Credit Failover Policy

If any subagent returns `Status: QUOTA_EXHAUSTED`:
1. **Mark Provider Exhausted:** Note in `.agent-context/PROGRESS.md` that the exhausted agent is unavailable for the remainder of the session.
2. **Transfer Ownership & File Locks:** Reassign the same `TASK_ID` and `Locked Files` in `PROGRESS.md` to the next available fallback agent in this order:
   - `@agy-worker` exhausted $\rightarrow$ fail over to `@codex-worker` (or `@claude-worker` for pure UI/JSON scaffolding).
   - `@codex-worker` exhausted $\rightarrow$ fail over to `@claude-worker` (or `@agy-worker` if quota remains).
   - `@claude-worker` exhausted $\rightarrow$ fail over to `@codex-worker` or `@agy-worker`.
3. **Resume From Checkpoint:** Instruct the fallback subagent to read `.agent-context/reports/<TASK_ID>-<failed-agent>.md` first, preserve valid partial edits already in the workspace, complete the **Remaining Work** section, and write `.agent-context/reports/<TASK_ID>-<fallback-agent>.md`.

### Opening cinematic (docs/4_intro_scene.md) — task board in `.agent-context/PROGRESS.md`

- [x] **IN1–IN3** (orchestrator): flow states + input lock, CinematicController, tropical scenery, subtitles/skip/replay, intro audio, tests

### Zombie animation & visual polish (docs/6_zombie_movement.md)

- [x] **ZA1–ZA2** (orchestrator): pure gait/IK/animation controller + profiles, procedural atlas, articulated parts, horde + Alpha renderers, tests

