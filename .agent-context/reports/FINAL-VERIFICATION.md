# FINAL VERIFICATION — TD-V3

**Milestone:** TD (docs/todos.md items 7–9: mobile controls, capacity notice dedupe, purchasable ability slots). Branch `open-world`, base HEAD 572d264.
**Agent:** claude-worker. **Verdict: PASS**

## Commands & results

| # | Command | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | 0 errors |
| 2a | `npm test` (run 1) | 43 files / 449 tests passed |
| 2b | `npm test` (run 2) | 43 files / 449 tests passed (no navScale flake in either run) |
| 3 | `npm run build` | success, built in 2.71 s; `dist/assets/index-DG6E9Jsv.js 889.37 kB (gzip 243.30 kB)`, css 23.48 kB (gzip 5.25 kB); only the usual >500 kB chunk warning |
| 4 | `git diff --cached HEAD -- src \| grep -nE "console\.(log\|debug)\|debugger\|TODO\|FIXME"` (added lines; also checked `git diff HEAD -- src`) | 0 hits |
| 5 | PROGRESS.md TD board / docs/todos.md | TD-T001..T007, V1, V2, F1 all VERIFIED; TD-V3 IN_PROGRESS (this task). todos items 7, 8, 9 are `[x]` |

## Per-task summary

- TD-T001 (orchestrator): contracts — `slotsOwned`, `atCapacity`, `buySlot`, `slotPurchased`, balance `slotCosts`/`capNoticeRearm`/`touch.*`, save v2.
- TD-T002 (claude): `atCapacity` latch + rearm in HordeSystem; one `capReached` per entry, no recruit scans at cap; tests/capacity.test.ts.
- TD-T003 (claude): `buySlot`/`nextSlotCost`, first unlock grants first slot, equip/activate respect `slotsOwned`, save v1→v2 migration; tests/slots.test.ts (10).
- TD-T004 (claude): HUD toast dedupe, owned-slot-only strip, nest panel "Buy slot" button, `slotPurchased` toast; uiHelpers tests.
- TD-T005 (orchestrator): `touchMath.ts`, `TouchControls.ts`, `touch.css` (stick, action/ability buttons, safe areas); touchMath tests (10).
- TD-T006 (claude): InputController touch pointers (tap orders, orbit, pinch), Game wiring (coarse pointer/first touch, DPR 1.0, `onBuySlot`), viewport meta, README.
- TD-T007 (orchestrator): browser playtest desktop + 375x812 emulation; phone-layout fix in touch.css; todos 7–9 ticked.
- TD-V1 (claude): spec audit — 1 P1 (world map uncloseable on touch), 4 P2, 1 P3.
- TD-V2 (codex): adversarial review — no P1, 3 P2, 8 P3.
- TD-F1a/F1b (claude/orchestrator): 11 review fixes (map close button, tap-near-Alpha, drag-back no tap, stick reset on blur, etc.) + save fixes; 449/449 and build OK.

## Known limitations

- Touch controls verified only in browser emulation (375x812, coarse pointer); gestures were synthesized PointerEvents, not a real phone.
- Tap-near-Alpha blocked rule: F1a item 4 (`tapGroundBlocked`, only non-target occluders count as cover) is a best-effort fix; V1's root cause was not confirmed from code reading and needs a device check.
- V2: a malformed v2 save with `slotsOwned` 0 drops the equipped ability before reconcile (noted in T003; F1b addressed save fixes).
- V2 design note: `noteCapacityRefusal` latches before the `segmentBlocked` check, so the cap notice can fire without line of sight (matches TD-0 "no LOS test").
- Bundle is 889 kB (single chunk warning, pre-existing).

## Files changed (`git diff --cached HEAD --stat`, excluding assets/ and docs/4_intro_scene.md)

48 files changed, 2217 insertions(+), 82 deletions(-). Source (18 files, +1168/-68): `src/config/balance.ts`, `src/core/{Game,InputController,cameraMath,contracts,touchMath(new),types}.ts`, `src/persistence/saveSchema.ts`, `src/sim/createInitialState.ts`, `src/systems/{HordeSystem,ProgressionSystem}.ts`, `src/ui/{HUD,NestPanel,TouchControls(new),WorldMap,uiHelpers}.ts`, `src/ui/{hudOpenWorld,touch}.css`. Tests: alphaCombat, capacity(new), input, openWorld, persistence, progression, rush, slots(new), touchMath(new), uiHelpers. Other: `index.html`, `README.md`, `docs/todos.md`, `docs/prompt_template.md`, `.claude/agents/{agy-architect,agy-worker}.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md` and 11 `reports/TD-*.md`.

Previous milestone (OW) verdict: PASS, see git history
