# T007 Report (claude failover)
**Task ID & Agent:** T007 / claude-worker (resumed from codex QUOTA_EXHAUSTED)
**Status:** COMPLETED
## Completed Work
Audited src/systems/HordeSystem.ts against brief items 1-7; no gaps found, no code edits needed. Item 1 move/attack/regroup/follow (applyHordeCommands, per-ctx move fields, arrival/expiry in finishMove), 2 frenzy cohort at frenzyStart edge + rushChaseFactor, 3 followerCap sole cap read, 4 dormant skipped, 5 brutes use ctx.navGrid/never crawl/prefer gate+structure, 6 fallbackWalk + catchUpHidden. tests/hordeCommands.test.ts (20 tests) covers every listed case.
## Remaining Work
None. (PROGRESS.md untouched per lock; orchestrator should mark T007 VERIFIED.)
## Public Interfaces/Exports Added
None new beyond existing exports; followerCap is module-internal.
## Verification Run
npx tsc --noEmit: pass. npx vitest run: 35 files / 367 tests pass.
## Memory Notes
Appended T007 entries to MEMORY.md; T003 straggler follow-up is resolved.
