# HUD-T003 Report (agy-worker)

**Task ID & Agent:** HUD-T003 / agy-worker (dispatched via `agy --model "gemini-4-hydrogen" -p`, verified by orchestrator wrapper)

**Status:** COMPLETED

**Completed Work:**
- `src/ui/hudPanels.css`: rewritten in token terms (help panel, modal/overlay with entrance keyframes, intro keys, begin prompt, stats grid, restart/respawn, pause menu, world map frame + legend + side list, nest panel incl. eyesight). Old `.ibz-btn` base removed (now in hudTheme.css); `.ibz-btn-danger` (coral) and `.ibz-btn-small` kept.
- `src/ui/PauseMenu.ts`: icon + label spans on buttons; `setMuted`/`refreshVision`/`refreshGraphics` now write `.ibz-btn-label`; controls table uses `.hz-key` caps and mouse icons; playful pitch + Controls heading.
- `src/ui/WorldMap.ts`: map icon in title; markup otherwise unchanged (canvas drawing untouched).
- `src/ui/NestPanel.ts`: nest icon in title, eye icon on eyesight section, `.hz-key` slot badges, ability icons (`abilityIcon`), ability rows as icon + text column. All data-* attributes and state classes kept.
- `src/ui/CinematicOverlay.ts` / `src/ui/intro.css`: token-based skip pill (`hz-key` Esc), title `I BE <span>ZOMBIE</span>`, pin icon on objective tag, `hz-soft-pulse` begin prompt. `.ibz-hud.is-cinematic > * { visibility: hidden !important; }` kept.
- `src/ui/TouchControls.ts` / `src/ui/touch.css`: cartoon buttons with icons (attack=bite, regroup=megaphone, follow=recall, map, pause, recenter=camera); slot buttons get `abilityIcon()` (ability id resolved by matching `ABILITIES[id].name` to the slot view name, `null` -> lock). `.ibz-touch-sweep` still first child. Phone-layout position rules left unchanged.

**Remaining Work:**
- Orchestrator should check that `HUD.ts` (now imports both `hudTheme.css` and `hudPanels.css`) and `hudOpenWorld.css` / `hud.css` do not duplicate `.ibz-btn`, `.ibz-overlay`, `.ibz-modal`, `.ibz-pause*`, `.ibz-worldmap*`, `.ibz-nest-*` rules with conflicting values; duplicates there are outside this task's locked files.
- No browser/GPU visual check was run (headless only).

**Public Interfaces/Exports Added:** none (no exported signatures changed).

**Verification Run:**
- `npx tsc --noEmit`: pass (exit 0).
- `npm test`: pass, 62 files / 701 tests.
- Line endings: all edited files remain CRLF.

**Memory Notes:**
- `hudPanels.css` was previously imported nowhere (dead CSS). It and `hudTheme.css` are now imported by PauseMenu/WorldMap/NestPanel/CinematicOverlay/TouchControls (and HUD.ts).
- Touch slot icons are derived from the slot's display name via `ABILITIES`; if an ability is renamed, the icon falls back to lock. `TouchSlotView` API was not changed.
- `setMuted`/`refreshVision`/`refreshGraphics` must write `.ibz-btn-label`, not the button's textContent, or the icon is wiped.
