# TD-T002 (claude, fallback for codex)
Status: COMPLETED
Completed: src/systems/HordeSystem.ts - atCapacity latch (emit capReached + flash 1.5 only on false->true), re-arm after capNoticeRearm s continuously below cap (WeakMap<GameState,number>, once per updateHorde), at-cap early-outs in passive and rally recruitment (no segmentBlocked), pulses at cap consumed without scanning. New tests/capacity.test.ts (3 tests: 60 s hold = 1 event; short dip no re-emit / long dip re-arms; zero segmentBlocked calls at cap incl. pulse, contrast below cap > 0). Existing locked tests needed no change.
Remaining: none.
Interfaces: none new exported.
Verification: npx tsc --noEmit clean; targeted 5 files 49/49 pass; full npm test see lead summary.
Notes: at cap, recruitPulse event still emitted with recruits 0.
