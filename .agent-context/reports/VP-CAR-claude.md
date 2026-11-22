# VP-CAR — car & death VFX, car damage looks (claude, side session)

- **Status:** COMPLETED (uncommitted)
- **Completed Work:**
  - `src/visuals/vehicleLook.ts` [pure, new]: `vehiclePaint`, `vehicleWear`, `vehicleSmokeRate`, `doorOpenAngle`, `sinkStart`.
  - `src/graphics/vfx/vfxRules.ts`: 6 new emitters (`vehicle.claw|impact|glass|smoke`, `human.dazed`, `body.fall`),
    `clawPoint`, `dustColor`, mappings for melee-on-vehicle, vehicleHit, driverBailed(pulled), zombieDied, guardDied.
  - `src/graphics/vfx/EmitterPool.ts`: per-effect colour rules (sparks vs paint chips vs glass), dazed-star ring radius.
  - `src/graphics/vfx/VFXManager.ts`: per-car bonnet smoke/steam (`updateCarSmoke`, quality + reducedMotion scaled, culled).
  - `src/visuals/VehicleRenderer.ts`: wear grime tint, instanced driver door that swings open on stall.
  - `src/visuals/Effects.ts`: small camera shake on a pulled driver.
  - Tests: `tests/carVfx.test.ts` (new, 12), `tests/vfx.test.ts` updated (18 emitters, new mappings).
- **Verification Run:** `npx tsc --noEmit` clean; `npm test` 723/723; browser check on :5173 (frozen sim, staged car) — no console errors.
- **Memory Notes:** claw VFX are driven by `melee` (damage precedes melee and lacks the attacker side). Burst sizes below
  ~0.3 m are invisible at default zoom; smoke needs opacity ≥ 0.7 to read against grass.
