# HH-T005 — agy-worker

- **Task ID & Agent:** HH-T005, agy-worker
- **Status:** COMPLETED

## Completed Work
- `src/ui/hudModel.ts`: Removed `HealthLevel`, `HealthView`, `LOW_HEALTH_FRAC`, `CRITICAL_HEALTH_FRAC`, and `healthView`. Added `LOW_STRENGTH_FRAC = 0.4`, `HordeStrengthView`, and `hordeStrengthView(state)` (NaN/Infinity-safe, clamped `frac`/`coreFrac`, `"X / Y"` rounding, `ok`/`low`/`critical`/`lastBrain` levels, `Math.ceil(timeLeft)` countdown + `"LAST BRAIN STANDING! N... FIND A BRAIN!"`). Updated `drinkNearby` to check `!state.leader.alive || state.horde.coreDamage <= 0.01`.
- `src/visuals/HealthBars.ts`: Removed the world-space Alpha health bar block (`leader.hp / leader.maxHp`) and updated the header comment; kept zombie and human/structure bars intact.
- `src/ui/HUD.ts`: Removed Alpha HP markup, refs, and `prevHp` tracking. Replaced with the primary `"HORDE STRENGTH"` widget using `icon('horde', 's')`, `hordeStrengthView(state)`, main fill (`strengthFill`), delayed loss ghost (`strengthLag`), Alpha core segment (`strengthCore`), and signature-cached DOM updates. Added `consume()` handlers for `hordeStrengthChanged` (red hit flash on `delta < 0`, green pulse on `delta > 0`), `sharedDamage` (hit flash, vignette, portrait hurt, directional damage arc), `lastBrainStart`, and `lastBrainEnd`. Added the centered `.hz-last-brain` takeover overlay inside `.hz-play` driven by `sv.level === 'lastBrain' && state.phase === 'playing'`. Reset transient classes on `reset()`.
- `src/ui/hud.css` & `src/ui/touch.css`: Removed `.hz-meter-hp` and `.hz-hp-num` rules. Styled `.hz-strength-head`, `.hz-meter-strength`, `.hz-meter-core`, `is-low`/`is-critical`/`is-last-brain`/`is-hit`/`is-gain` states, `.hz-vignette.is-last-brain`, and `.hz-last-brain` using `hudTheme.css` tokens and `calc(N * var(--hz-u))` sizes. Preserved reduced-motion behavior (`.hz-reduced-motion` and `@media (prefers-reduced-motion: reduce)`). Added `@media (max-width: 760px)` positioning in `hud.css` and `touch.css` so `.hz-last-brain` fits cleanly at 375x812 without overlapping `.ibz-top-center` or touch controls.
- `tests/hudModel.test.ts`: Removed `healthView`/`LOW_HEALTH_FRAC`/`CRITICAL_HEALTH_FRAC`/`leader.hp` tests. Added unit tests for `hordeStrengthView` (fresh state `coreFrac`, `"23 / 50"` rounding, clamping, 0-max and NaN/Infinity safety, level thresholds, `lastBrain` override, `ceil` countdown) and `drinkNearby` (`coreDamage === 0`, `coreDamage > 0.01`, dead leader).

## Remaining Work
- None.

## Public Interfaces/Exports Added
- Added in `src/ui/hudModel.ts`: `HordeStrengthView`, `hordeStrengthView`, `LOW_STRENGTH_FRAC`
- Removed from `src/ui/hudModel.ts`: `HealthView`, `HealthLevel`, `healthView`, `LOW_HEALTH_FRAC`, `CRITICAL_HEALTH_FRAC`

## Verification Run
1. `npx tsc --noEmit` — passed (0 errors, exit code 0).
2. `npx vitest run tests/hudModel.test.ts` — passed (1 file, 19/19 tests).
3. `npm test` — passed (81 files, 951/951 tests; 0 failures).
4. `Select-String -Path "src/ui/*","src/visuals/HealthBars.ts" -Pattern "leader\.hp|leader\.maxHp" -SimpleMatch:$false` — 0 matches.

## Memory Notes
- `hud.css` uses CRLF line endings; multi-line patches via Node scripts should preserve `\r\n` when `edit_file` hits line-ending/batching mismatches.
- `hordeStrengthView` treats `lastBrain.active` as overriding any `frac` level (`'lastBrain'`), and `.hz-last-brain` lives inside `.hz-play` so modals (`is-modal`) hide it automatically.
