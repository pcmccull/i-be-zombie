# VP-T001/T004/T005/T006/T007 — orchestrator report (docs/8_visual_polish.md)

- **Task ID & Agent:** VP-T001, VP-T004, VP-T005, VP-T006, VP-T007 — orchestrator (Claude). VP-T002 codex, VP-T003 agy (own reports).
- **Status:** COMPLETED (see "Not verified" below)

## Completed Work
- T001: `src/graphics/performance/GraphicsQuality.ts` (presets low/medium/high, reducedMotion, storage `ibz.graphics.v1`,
  shake/flash scale), ARCHITECTURE §VP-0…VP-4 (art bible, contracts, invariants), briefs, board.
- T004: `src/graphics/materials/{surfaceDetailMath,SurfaceDetail}.ts` — tileable detail atlas (grain/cracks/joints/blotch,
  512² DataTexture, mipmapped, anisotropic, linear), world-space patch keyed by an `aSurface` vertex attribute (asphalt,
  sidewalk, grass, building stucco/roof, concrete, sand), distance fade 45–80 m; foliage wind (palms, city trees).
  CityDistrict: `paintGeometry` writes `aSurface`, ground/building materials patched, striped sloped awnings, apartment
  balconies (railing, planters). TropicalScenery: sand detail + palm wind.
- T005: `LightingController` (warm sun + hemi + cool fill, shadow size per preset), `PostProcessingPipeline`
  (display-referred: canvas render → copyFramebufferToTexture → grade + saturated-only bloom quad; falls back to the plain
  render on any error), `frameStats`, `GraphicsDiagnostics` (F3 panel), `benchmark` (`?bench=1|2`, cap-respecting, never saved).
- T006: Game wiring (settings load/save, presets, reduced motion → shake/flash/particles/wind/bloom, VFXManager consume +
  update with vision-culled events and `hiddenBeyond`, diagnostics, benchmark, `graphicsStats` getter), PauseMenu buttons
  "Graphics: Low/Medium/High" + "Reduced motion: On/Off". EntityRenderer (after T003 finished): humans cast shadows only within
  22–26 m of the Alpha (cut bench=1 draw calls ~1260 → ~320–420).
- T007: README (what's new, performance table), AGENTS.md (directory map + visual conventions), CLAUDE.md checkbox, captures in
  `docs/captures/` (before: `vp-before-gameplay.jpg`; after: gameplay, plaza detail, bench crowd with VFX + new humans).

## Spec deviations (documented in ARCHITECTURE §VP-0)
- No glTF/GLB/KTX2: the repo forbids remote/downloaded assets and requires code-generated art; procedural geometry + generated
  atlases replace it. Load failure is impossible, so the only fallback is flat colour when the atlas canvas is missing (tests/Node).
- No SSAO / soft particles: ambient occlusion is approximated by hemisphere + fill lighting and the existing blob shadows;
  particles fade near the ground plane instead of reading depth.
- No sunset/night variant (optional in spec).

## Verification Run
- `npx tsc --noEmit` 0 errors; `npm test` 61 files / 683 tests pass (before the EntityRenderer shadow tweak; final re-run below);
  `npm run build` OK (existing chunk-size warning only).
- Browser (built-in pane, :5181): boot, surface detail visible (plaza joints, grass mottling), diagnostics panel, bench=1/2,
  particles live (124/768 during rally), civilians panic, archetypes visible (hard hats, varied outfits), no console errors.
- Benchmark numbers: README §Performance.

## Not verified
- Real display frame rate: the Claude window was not on screen, so the numbers come from a script-driven loop (CPU +
  gl.finish). No 1080p or midrange-GPU measurement.
- Close-up look of the reworked Alpha at gameplay zoom: in every capture it stood inside the nest bush.
- Reduced-motion and low-preset visuals were checked only through counts, not by eye.

## Memory Notes
See MEMORY.md VP entries (case-insensitive file collision, display-referred post, cache keys, HUD rebuild order, bench perf).
