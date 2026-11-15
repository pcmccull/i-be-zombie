@currentdesigdoc is docs/docs/todos.md 

Read @currentdesigndoc along with `AGENTS.md`, `CLAUDE.md`, and everything in `.agent-context/`.

Act as the **Lead Orchestrator** to plan and implement `@currentdesigndoc` using our three subagents (`@agy-worker`, `@codex-worker`, and `@claude-worker`). Follow this exact execution loop:

### Phase 1: Contract & Task Board Setup (You)
1. Analyze `@currentdesigndoc` and update `.agent-context/ARCHITECTURE.md` with the directory map, core data structures, and locked module interfaces.
2. Break the implementation into numbered tasks (`T001`, `T002`, ...) with strict, non-overlapping file locks and write the full task table to `.agent-context/PROGRESS.md`.
3. Review the final task breakdown and file-lock plan and make any necessary changes before moving to Phase 2.

### Phase 2: Delegated Implementation Loop
Once approved, execute the tasks in dependency order:
- Dispatch scaffolding, data schemas, and UI/content tasks to **`@agy-worker`**.
- Dispatch core logic, math/physics, state machines, and isolated systems to **`@codex-worker`**.
- Dispatch cross-module wiring, integration glue, and test/build execution to **`@claude-worker`**.

**Mandatory Tracking Protocol for Every Task:**
1. Before invoking a subagent, mark its task `IN_PROGRESS` in `.agent-context/PROGRESS.md` and include the exact `TASK_ID`, `Locked Files`, upstream report paths, and required output report path (`.agent-context/reports/<TASK_ID>-<agent>.md`) in your delegation prompt.
2. Never run two write-enabled subagents concurrently on overlapping files.
3. Immediately after each subagent completes:
   - Read its report in `.agent-context/reports/<TASK_ID>-<agent>.md`.
   - Verify it updated `.agent-context/MEMORY.md` with any new discoveries or constraints.
   - Update `.agent-context/PROGRESS.md` with its final status (`VERIFIED` or `BLOCKED`) and summary notes.
   - If `BLOCKED` or failing tests, dispatch `@claude-worker` or `@codex-worker` to resolve before advancing.

### Phase 3: Final Verification Gate
After all implementation tasks are `VERIFIED`:
1. Run `@agy-worker` (read-only `plan` mode) to audit the codebase against `@currentdesigndoc` for missing requirements.
2. Run `@codex-worker` (`read-only` mode) for an adversarial bug and edge-case review.
3. Run `@claude-worker` to execute the full build and test suite and write `.agent-context/reports/FINAL-VERIFICATION.md`.
4. Update `.agent-context/PROGRESS.md` to complete and give me a final summary of all reports and changes.

Begin Phase 1 now.