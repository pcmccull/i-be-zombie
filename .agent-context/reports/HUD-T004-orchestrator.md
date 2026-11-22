# HUD-T001/T002/T004 — orchestrator
- **Status:** COMPLETED
- **Completed Work:** `src/ui/hudTheme.css` (tokens, --hz-u, surfaces, keys, buttons, keyframes, reduced motion), `src/ui/hudIcons.ts`
  (SVG icon family), `src/ui/hudModel.ts` (+ `tests/hudModel.test.ts`, 18 tests), rebuilt `src/ui/HUD.ts` (same public API +
  `setReducedMotion`, `HudExtras.cameraYaw`), `hud.css`, slimmed `hudOpenWorld.css` (mode toggles, debug, sense arcs), circular
  centered `Minimap.ts`, `mapRender.ts` palette (+ exported FOG_COLOR), SVG icons in `SenseIndicators.ts`, Game wiring
  (camera yaw, reduced motion), menu CSS split into `hudPanels.css` (restyled by HUD-T003), touch HUD-layout rules moved to hud.css.
- **Verification:** `npx tsc --noEmit` 0; `npm test` 62 files / 701 tests; `npm run build` OK; browser at 1366×768, 1920×1080,
  2560×1440, 375×812 touch: no overlaps, no console errors. Banner, recruit popup, loss floater, damage arc, hit marker,
  slot states, pause-modal hide, Tab-expanded objective and world map checked by injecting events into the live HUD.
- **Not verified:** full intro cinematic → HUD slide-in on a fresh save (code path only), real stronghold capture in play.
- **Memory Notes:** see MEMORY.md HUD entries.
