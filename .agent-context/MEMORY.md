# Shared Agent Memory & Decisions

Record architectural decisions, library quirks, solved bugs, and conventions here so no agent repeats a solved mistake.

- **[Init]** All subagents must read `AGENTS.md`, `ARCHITECTURE.md`, `MEMORY.md`, and `PROGRESS.md` before executing.
- **[Tooling]** `codex exec` hangs on "Reading additional input from stdin" unless stdin is redirected (`< /dev/null`).
- **[Tooling]** `agy -p` headless auto-denies its `command` tool unless `~/.gemini/antigravity-cli/settings.json` has `"toolPermission": "always-proceed"`; allow-rules alone were not enough. Never use `--dangerously-skip-permissions`.
- **[Tooling]** Dev server port 5173 may be held by another session; `.claude/launch.json` has `vite-5174` (auto-moves to a free port).
- **[Process]** Baseline trick: orchestrator `git add -A` after verifying a phase, so the next worker's changes show as unstaged `git diff`. Nothing is committed to master without the user.
- **[Process]** Worktrees need a commit base; R3 used branch `r3-visuals` with a snapshot commit, merged back as a patch (`git diff <snapshot>` excluding contract files) instead of a branch merge.
- **[Design]** Structures are generic `TargetRef {kind:'structure', id}`; the checkpoint gate stays its own special case. Visuals must derive landmark geometry from `layout.structures` + tagged colliders — never literal coordinates or structure ids (R3 fix round).
- **[Design]** Victory = gate destroyed AND all `post==='checkpoint'` humans DEAD. Civilians/barricade soldiers don't block victory.
- **[Design]** Momentum: only `MomentumSystem` mutates `state.momentum`; multipliers read live. Start followers give no momentum.
- **[Bug]** Tests that clear `state.zombies` must also reset `followerCount` (5 start followers exist now).
- **[Tests]** Long full-world sims (opening autopilot, 5400 steps) need ≥ 30 s timeout under parallel suite load; perf assertions belong in the dedicated stress test.
- **[Persistence]** `applySave` only triggers `navGrid.rebuild()` + `crawlNavGrid.rebuild()` when a structure or gate transitions from intact/enabled to destroyed/disabled, keeping repeated `applySave` calls idempotent (including `navGrid.version`). `encodeBits`/`decodeBits` use a pure lookup-table Base64 implementation (no `Buffer`/`btoa`) and normalize `DiscoveryState.bits` to `0 | 1` with a full `revealed` recount on load.
