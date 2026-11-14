# FINAL-VERIFICATION (V3) - Open World milestone

**Agent:** claude-worker. **Date:** 2026-11-14. **Branch:** open-world, HEAD 8f2d722.

## Verdict: PASS

tsc clean, 39 files / 410 tests green twice (no flakes) on the working tree and once on a clean HEAD export, production build OK. No P1 findings open. Caveats under "Known limitations" and "Open decision".

## Environment
Windows 10 Home 10.0.19045, Git Bash, Node v22.12.0, vitest `run` (node env, no WebGL). Uncommitted at start (not touched): `docs/todos.md`, `src/ui/HUD.ts`.

## Command results

| Command | Tree | Result |
|---|---|---|
| `npx tsc --noEmit` | working tree | exit 0, no errors, 5.7 s |
| `npm test` run 1 | working tree | 39 files, 410 tests passed, vitest 71.5 s (wall 72.9 s) |
| `npm test` run 2 | working tree | 39 files, 410 tests passed, vitest 70.9 s (wall 72.3 s) |
| `npm run build` | working tree | OK in 2.5 s (wall 7.9 s): `dist/index.html` 0.94 kB (gzip 0.49), `assets/index-*.css` 18.45 kB (gzip 4.31), `assets/index-*.js` 872.09 kB (gzip 238.53). Vite warns of a chunk over 500 kB (single bundle; non-blocking) |
| `npx tsc --noEmit` | clean HEAD | exit 0 |
| `npm test` | clean HEAD | 39 files, 410 tests passed, 71.8 s |

Clean HEAD: `git worktree add <scratchpad>/wt HEAD --detach`, with a junction to the repo's `node_modules`. The junction was removed first, then `git worktree remove --force`. Afterwards `git worktree list` shows no scratch worktree and `node_modules` is intact. Because HUD.ts is not covered by tests, HUD.ts cannot change results (tests import only pure modules). Both trees are identical in outcome. `dist/` is gitignored.

Cleanup check: I started no browser or dev server. Still running, not mine: a Vite dev server on 127.0.0.1:5173 (PID 37924, `vite.js` from this repo) and several `chrome.exe` processes. They pre-date this task (likely the T016 playtest or the user). I did not kill them. Stop them if unwanted. Other linked worktrees (`i-be-zombie-fixa`, `-p2a`, etc.) are old milestone worktrees, not mine.

## Test inventory (410)
ai 28, alphaCombat 23, cameraMath 9, cascade 7, civilianChase 3, collision 14, combat 13, conquest 18, conversion 8, discovery 6, engagement 11, fixes-horde 8, fixes-nav 8, followup 7, horde 14, hordeCommands 20, input 9, layout 13, momentum-integration 7, momentum 7, movement 7, navigation 23, navScale 5, opening 2, openWorld 14, persistence 8, picking 9, pointerLock 6, population 14, progression 20, r4d 2, recruitment 5, respawn 10, structures 6, todos 9, uiHelpers 8, utils 11, victory 6, world 12.

### Spec section 10 items 1-12 -> tests/openWorld.test.ts
| Item | Test (line) |
|---|---|
| 1 seamless city, suburbs to every stronghold | "item 1: seamless city..." (148) |
| 2 fog reveal != conquest | "item 2" (175) |
| 3 Alpha-killed civilian rises as follower | "item 3" (193) |
| 4 Alpha LMB kills police, takes damage | "item 4" (213) |
| 5 attack order engages target | "item 5" (244) |
| 6 police station capture, objectives once, Claws once | "item 6" (269) |
| 7 nest equip, Claws, Frenzy, Brute Evolution | "item 7" (291) |
| 8 mall before station, coherent rewards | "item 8" (341) |
| 9 save/load round trip | "item 9" (380) |
| 10 death respawn at nest, progression kept | "item 10" (416) |
| 11 10 sim-minutes bounded actors | "item 11" (468) |
| 12 no duplicate rewards / negative biomass / victory-defeat | "item 12" (498) |
| extra | industrial yard capture e2e (355, added in F1); opening pacing (442) |

## Per-task status

| Task | Agent actually used | Status |
|---|---|---|
| T001 contract skeleton | orchestrator | VERIFIED |
| T002 world layout | codex | VERIFIED |
| T003 nav at world scale | codex | VERIFIED |
| T004 Alpha combat | codex | VERIFIED |
| T005 progression | codex | VERIFIED |
| T006 persistence | agy (headless, default mode) | VERIFIED |
| T007 horde | codex partial, finished by claude (codex quota) | VERIFIED |
| T008 humans + population | codex partial, finished by claude (codex quota) | VERIFIED |
| T009 conquest + respawn | codex partial, finished by claude (codex quota exhausted mid-task) | VERIFIED |
| T010 world rendering | agy partial, finished by claude (agy quota) | VERIFIED |
| T011 characters + FX | claude (agy quota failover) | VERIFIED |
| T012 sim integration | claude | VERIFIED |
| T013 UI + audio | claude (agy failover) | VERIFIED |
| T014 client integration | claude | VERIFIED |
| T015 docs / cleanup | orchestrator (rush/victory removal descoped; kept as legacy test fixture) | VERIFIED |
| T016 browser playthrough + tuning | orchestrator | VERIFIED |
| V1 spec audit | claude read-only (agy quota failover) | VERIFIED |
| V2 adversarial review | claude read-only (codex quota failover) | VERIFIED |
| F1 review fixes | claude | VERIFIED |
| V3 this report | claude | COMPLETED |

Quota: codex exhausted during T009 (retry ~4:29 PM); agy exhausted during T010/T011 (429, resets ~154 h).

## Open findings carried forward

Fixed in F1: V1 P2-1 (yard e2e test), V1 P2-3 (patrols stand down in infected districts; `capturedPatrolFactor` handled), V2 P2-1/2/3, V2 P3 items 1, 4, 5 and the SaveStore version guard.

Open, not fixed:
- V1 P2-2 / P2-4 (evidence only): no manual GPU playthrough of real police/mall/yard capture or Frenzy/Brute/Claws visuals, and no 10-minute browser run with memory/fps at 1280x720 (T016 used 1024x768, 53-97 fps, short session).
- V1 P3: debug overlay lacks player position, scene object count and mission flags; no automated draw-call/object growth check; attack orders on living unreachable targets never expire; no police cover behaviour; map does not show a stronghold's unlock reward; no standalone smoke checklist; item 11 test does not assert captured bases survive a long roam.
- V2 P3 (items 2, 3, 6, 7, 8): cooldowns, frenzy timer and `lastReinforcementAt` not persisted (reload gives free cooldown reset); `applySave` does not validate that the selected nest is active (hand-edited saves only); `HordeRenderer.maxInstances = 220` can clip when ambient (160) + followers (40) + corpses exceed it; `followerSwingTarget` O(G^2); no `pagehide` save.

## Known limitations
- Rush, victory and checkpoint fields remain in the contracts as an isolated legacy-district test fixture (gated by `layout.strongholds.length === 0`).
- Guard rigs keep the soldier look after capture flips role (cosmetic).
- Headless tests do not exercise rendering, pointer lock or GPU; browser evidence is T016's single short session.
- Single 872 kB JS bundle (no code-splitting).
- Suite takes about 72 s (combat balance runs dominate).

## Open decision for the user: uncommitted `src/ui/HUD.ts`
Author unknown (flagged in T016 and V1). The diff is 4 insertions / 4 deletions of pointer-lock UX copy only:
- `showCaptureHint = false` (was `!locked && activePlay`), so the "click to capture mouse" hint is permanently hidden.
- Help rows: LMB text drops "First click captures the mouse"; camera row changes from "Mouse (captured)" to "Left / Right-Drag: orbit & tilt camera".
- Unlocked bottom-right hint drops "Click to capture mouse" and adds "Drag/Z/X look".

This is consistent with a drag-to-orbit fallback but contradicts the T014 locked-mouse model, where the first LMB click captures the pointer. Tests are unaffected either way. Decide whether to commit or discard it. Uncommitted `docs/todos.md` (6 lines changed) is the user's notes. I left both untouched.
