# CU-T003 — Living City: event dressing, district transformation visuals, companion looks, audio + VFX cues

Spec: `docs/11_cityupgrade.md` §2.5, §2.6, §2.9, §4.1.B, §6 (world cues). Conventions: `AGENTS.md` (visual conventions,
vision limit rule: anything always-visible must cull itself past `hiddenBeyond`). Read `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md` first.

The sim side is done by the orchestrator in parallel (do NOT edit sim/systems/core/content/balance/types/Game.ts).
Contracts you consume (already in `src/core/types.ts`):

- `ActiveDynamicEvent.props: CityEventProp[]` — `{ kind: CityEventPropKind; pos: Vec2; facing: number }`, kinds
  `'bus' | 'foodTruck' | 'volleyNet' | 'stage' | 'partyLights' | 'wreck' | 'convoyTruck' | 'barricade'`. Props appear when an
  event starts (`state.cityEvents`) and vanish when it resolves (events are culled from the array). Render-only; the sim
  never collides with them. Facing convention: forward = (sin a, cos a), `rotation.y = a`.
- `DistrictState.control?: 'humanControlled' | 'contested' | 'zombieInfluenced' | 'zombieControlled'` on `state.districts[id]`.
- `state.companions: { id: CompanionId; zombieId: number | null }[]` — the zombie in `state.zombies` that IS the companion.
  `CompanionId = 'larry_lifeguard' | 'chef_brainsley' | 'grandma_rot'`.
- `SECRETS` in `src/content/rewards.ts`: a secret with `shortcutTo` is a storm-drain shortcut between `pos` and `shortcutTo`,
  usable once `state.rewards.discoveredSecretIds` contains its id.
- New GameEvents: `cityEventStarted {kind,pos,label}`, `cityEventEscalated {kind,pos}`, `cityEventResolved {kind,outcome,pos}`,
  `worldInteractable {kind: 'trashCan'|'carAlarm'|'fireHydrant'|'shopWindow'|'sirenPost'|'constructionBarrier', pos}`,
  `companionPerk {companionId,pos,label}`, `companionRecruited {pos}`, `shortcutUsed {from,to}`, `suppliesLooted {pos,heal}`,
  `rewardGranted {rewardType}`, `secretDiscovered {pos}`, `hideoutUnlocked {pos}`, `vehicleMounted/vehicleDismounted {pos}`,
  `districtAlertChanged {alert, prev}`, `brainsGain {amount,pos?}`.

## Work

1. **New `src/visuals/CityEventProps.ts` [3D]** — `class CityEventProps { constructor(scene); update(state, focusX, focusZ, hiddenBeyond, time); dispose() }`.
   Low-poly flat-shaded meshes from primitives (shared geometries/materials, palette from AGENTS.md, bright tropical):
   tour bus (~10 × 2.6 × 3 m, windows strip, "TOURS" stripe), food truck (with serving hatch + awning + a giant taco/cone on the roof),
   beach volleyball net (2 posts + net + ball), small stage with speakers, `partyLights` (string of 6–10 coloured bulbs on 2 poles,
   bulbs pulse with `time`), wreck (crumpled sedan, tilted, a smoke puff ok via a static grey blob), convoy truck (olive box truck with a
   crate), barricade (sawhorses + sandbags). Pool groups per kind (create lazily, reuse; ≤ 4 per kind), hide unused, hide any prop
   farther than `hiddenBeyond` from the focus. Root `userData.noVisionHaze = true` is NOT wanted here: these props should haze like
   the city, so leave the default (Game re-patches materials via VisionFog — expose `get root(): THREE.Object3D` so Game can patch it once).
   No per-frame allocation in `update`. No shadows needed (castShadow false).
2. **`src/visuals/CityVisuals.ts`** (extend, keep existing behaviour):
   - Companion accessories that follow each companion's zombie (`state.companions[].zombieId` → `state.zombies` pos/facing):
     Larry = red rescue tube on the shoulder + whistle, Chef = tall white toque, Grandma = white hair bun + purple handbag. Head height
     ≈ 1.65 m. Hidden when the zombie is missing/dead or past `hiddenBeyond`. Keep it readable but small.
   - District transformation: for each district with `control === 'zombieControlled'` draw 6 zombie banner poles (green flag with a
     simple skull/hand shape via 2–3 boxes) and 6 graffiti ground decals (flat coloured quads slightly above y=0, random rotation)
     at that district's `layout.districts[].spawnPoints` (deterministic choice). `zombieInfluenced` gets 2 graffiti decals only.
     The constructor needs the layout: change it to `constructor(scene, layout?: DistrictLayout)` (optional so old calls compile).
     Rebuild only when the set of controlled districts changes (signature string). Instanced meshes preferred (≤ 4 draw calls).
   - Storm-drain shortcut markers: once the secret is discovered, a dark grate disc + a green arrow sign at both `pos` and
     `shortcutTo` (vision-culled).
3. **`src/audio/AudioSystem.ts`** — add `switch` cases (synthesized Web Audio, mute-safe, positional via the existing
   pan/gain helpers if present, throttle repeats): reward chime for `rewardGranted`/`secretDiscovered`/`companionRecruited`/
   `hideoutUnlocked` (bright 3-note arpeggio, distinct from `abilityUnlocked`); `cityEventStarted` per kind (bus/convoy: air-brake
   hiss + horn; festival/block party: short muffled bass "party" loop of ~2 s; volleyball/food truck: crowd murmur blip; car_accident: crunch
   + horn); `cityEventEscalated`: short distant siren whoop; `worldInteractable` per kind (trash can metal clang, car alarm 2 s wail,
   hydrant hiss, siren post whoop, barrier clatter, shop window glass tinkle); `companionPerk` (whistle tweet / pan clang / thwack);
   `shortcutUsed` (sewer slosh); `vehicleMounted` (engine putter); `suppliesLooted` (crate open + chime). Respect distance: skip
   positional sounds > 90 m from the listener. `districtAlertChanged` to panic/lockdown: one soft low alarm tone (subtle, §2.3).
4. **VFX** (`src/graphics/vfx/vfxRules.ts`, `VFXManager.ts` only if needed): map `worldInteractable` → dust burst (trash/barrier),
   water spray upward (hydrant, blue), glass sparkle (shopWindow), `shortcutUsed` → dust at both ends, `companionPerk` → small ring,
   `rewardGranted`/`secretDiscovered`/`companionRecruited` → reuse the unlock sparkle near the Alpha. Add any new emitter config to
   `EMITTERS`; keep `tests/vfx.test.ts` green (extend it for the new mappings).

## Done when

`npx tsc --noEmit` and `npm test` pass; report at `.agent-context/reports/CU-T003-agy-worker.md` (AGENTS.md format) listing the
public API of `CityEventProps` and the new `CityVisuals` constructor. Do not touch `Game.ts` — the orchestrator wires it.
