# CU — Living City & Expanded Rewards (docs/11_cityupgrade.md) — orchestrator report

- **Task ID & Agent:** CU-T001…T005, orchestrator (CU-T003 by `@agy-worker`, cut off by a 429 before writing its report; finished/reviewed/wired by the orchestrator)
- **Status:** COMPLETED (with the gaps listed under Remaining Work)

## Starting point
An earlier unrecorded pass had already landed: CityActivityDirector (heat → 5-stage alert, control, 9 event kinds that all
spawned "4 civilians"), RewardSystem (unique grants, Brains, cosmetics, achievements, secrets), CompanionSystem (discovery,
slots, recovery; only Chef's perk), PlayerVehicleSystem (golf cart etc.), HideoutSystem (fast travel), save v4 + v3 migration,
CollectionPanel, CosmeticMeshes, BrainPickups, CityVisuals (vehicle + beacons), tests/cityUpgrade.test.ts.

## Completed Work (this milestone)
- **Events (CityActivityDirector rewrite):** per-kind staging with render-only dressing (`ActiveDynamicEvent.props`): tour bus
  unloading tourists one by one, volleyball net + two teams, food truck queue, festival stage + party lights + dancers, wrecks +
  gawkers, police patrol loop, supply convoy (escorts; intercept heals the Alpha), cornered zombie (rescue = recruit → completed),
  stray pack; post-conquest pools `zombie_block_party` / `survivor_raid` (`allowedControl`). Responders walk in from 26 m:
  accidents after 9 s, disturbed crowds after 6 s (once per event, capped). Spawn ring is past the rendered vision limit
  (tier-aware), no kind twice in a row, no repeat at a recent spot. Completion = 60 % of participants down / zombies taken in.
  Hard cap on director humans (live + stragglers + corpses, `eventMaxHumans` 14). Resolved participants become street people
  and are removed only once out of sight (never in view).
- **Interactables:** trash cans (beside benches) + hydrants (every 6th streetlight) generated → 165 props; `visuals/InteractableProps.ts`
  draws cans/hydrants and tips them over while on cooldown. V = nearest prop; attack / sprint-bump / cart-ram also trigger.
- **V priority** vehicle > storm drain > prop (sim) mirrored by `hudModel.interactPrompt` → HUD context action `V <verb>`;
  touch USE button (shown only when V would do something).
- **Shortcut:** boardwalk storm drain ↔ Maple Heights (`SecretDef.shortcutTo`), Alpha + horde crawl through; markers drawn.
- **Companions:** Larry whistle recruits ≤ 3 strays, Grandma handbag staggers/damages, Chef pan clang; `companionPerk` event;
  accessories (tube/whistle, toque, bun/handbag) follow the companion zombies.
- **District transformation:** zombie banners + graffiti on zombie-controlled districts (graffiti on influenced), instanced.
- **Audio/VFX (agy):** cues for event start per kind, escalation siren, interactables per kind, perks, rewards, shortcut,
  supplies, mount; VFX mappings for interactables, shortcut, perks, unlock sparkles.
- **HUD:** token-styled city strip (Brains, alert badge Calm/Concerned/Panic/Lockdown/Overrun, Collection button); toasts for
  escalation / shortcut / supplies; F3 overlay city lines (district alert/heat/control, hottest districts, live events,
  cooldowns, event humans, orphans, vehicle, companions, Brains).
- **Bug fixed in playtest:** CollectionPanel rebuilt its rows every frame, so Buy/Equip clicks were lost → signature-gated.
- **Perf:** lazy per-step lookup maps in CompanionSystem / director.

## Public Interfaces/Exports Added
types: `CityEventPropKind`, `CityEventProp`, `DynamicEventDefinition.allowedControl?`, `ActiveDynamicEvent.{props,pendingSpawns,
nextSpawnAt,escalated,disturbed}`, events `cityEventEscalated | companionPerk | shortcutUsed | suppliesLooted`, kinds
`zombie_block_party | survivor_raid`. Director: `visibleLimit`, `eventHumanCount`, `cityDirectorDiagnostics`. Hideouts:
`shortcutAt`, `useShortcut`. Interactions: `nearestInteractable`, `INTERACT_VERBS`. hudModel: `interactPrompt`. Visuals:
`new CityEventProps(scene).update(state, fx, fz, hiddenBeyond, time)`, `new CityVisuals(scene, layout?)`,
`update(..., alpha = 1)`, `new InteractableProps(scene, state).update(state)`. TouchControls: `onUse`, `setUseVisible`.

## Verification Run
- `npx tsc --noEmit` 0 errors; `npm run build` OK; `npx vitest run` 71 files / 803 tests pass (new: tests/cityEvents.test.ts 12,
  hudModel V-prompt test).
- Browser (built-in, desktop): city strip + V prompt; trash can tips; golf cart unlock → mount → 20 m in 2 s → safe dismount;
  storm drain discovery (+Brains) → crawl; Grandma discovery → follower with accessory; Collection purchase (22 → 2 Brains);
  tour bus with staggered tourists, festival stage/crowd, spontaneous Fender Bender event; save/reload kept Brains/unlocks/cart.

## Remaining Work / not done (do not count as finished)
- Civilian `curious` / `hide` states not added (existing PATROL/ALERT/RETREAT FSM is used); no new traffic types (golf carts,
  cyclists) in ambient traffic.
- Only the golf cart has an in-world source; scooter / ice cream truck / float are Brains purchases with shared arcade handling
  (no jingle lure, no float riding). One shortcut, four hideouts, three companions, eight cosmetics.
- Achievements use proxy stats with lower thresholds than the spec examples (e.g. Tourist Trap = 20 civilians).
- No zombie-run businesses / reopened shortcuts on conquest; neighborhood identity comes from event tag filters + existing
  archetype spawns, no per-district ambient audio.
- tests/openWorld item 11 (10-min roam) takes ~64 s vs ~43 s before this milestone (more humans near the route); passes, not root-caused.
- Grandma's bun floats slightly high on short body types. Mobile layout of the city strip not re-checked.

## Memory Notes
- agy-worker in this setup ran on Claude and shares the user's 5-hour limit; a 429 kills it without a report.
- Panels re-rendered from the HUD frame loop must diff a signature, or clicks land on removed buttons.
