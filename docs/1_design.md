# I BE ZOMBIE — Three.js Low-Poly Urban Prototype

**Implementation specification for an AI coding agent**  
**Version:** 2.0  
**Target:** Complete playable single-player desktop-browser vertical slice  
**Engine:** Three.js + TypeScript + Vite  
**Genre:** Third-person horde-action / reverse tower defense  
**Art direction:** Cohesive stylized low-poly 3D urban environment inspired by the *feel* of open-world crime/action city games (GTA-like setting), not their copyrighted maps, logos, assets, characters, or visual branding.

## 0. Mandatory instructions for the coding agent

**Implement the entire playable prototype. Do not stop after scaffolding, a scene mockup, or the first milestone.** Install dependencies, run the app, test it, fix errors, and verify a complete start-to-finish playthrough. If operating within an existing repository, first inspect the project and preserve useful working functionality; replace the old Phaser-oriented rendering architecture with Three.js rather than mixing game engines. Record decisions in `README.md`. Make reasonable implementation decisions without stopping for routine questions.

**Definition of done:** `npm install`, `npm run dev`, `npm run build`, and `npm test` work. In the browser, the player controls a visibly animated low-poly zombie in a 3D city, recruits wandering zombies that follow as a convincing swarm, approaches a fortified human checkpoint, orders an attack, breaches its gate, fights guards, converts some of them, and either wins or dies and can restart. All displayed controls work. No missing assets, broken imports, runtime errors, or placeholder buttons.

Build a **game**, not a tech demo: coherent graphics, environmental composition, sound/feedback, legible HUD, responsive controls, and reliable combat matter as much as feature checklists.

## 1. Game vision and design principles

The player **is** a zombie in a small open urban district. They run down streets and alleys, collecting stray zombies into an increasingly large crowd. Humans have barricaded a checkpoint in the district; the player must pick an approach, position the horde, survive guard fire, break through the gate, and convert defeated defenders into new zombies.

The experience should feel like controlling a character in a compact GTA-like city rather than controlling a top-down RTS cursor. The camera is **third-person, elevated and zoomable**, so that the player can see both the leader and the horde. It is **not a fixed orthographic top-down game** and **not a first-person game**.

Design pillars:

1. **Direct zombie control:** WASD movement and mouse camera, never point-and-click movement.
2. **The horde is the weapon:** Most damage comes from followers, not the leader.
3. **Immediate recruitment payoff:** Walking past a zombie causes it to turn and join the mass.
4. **Urban tactical choices:** Streets expose the horde; alleys and buildings provide alternate approaches and cover.
5. **Readable 3D action:** Clear silhouettes, selection indicators, damage effects, and visible horde movement at distance.
6. **Simple commands:** Follow, attack target, and rush; no squad micromanagement.
7. **Designed for scale:** Hundreds of zombies are an eventual goal, but v1 needs a reliable 100 active followers.

## 2. Scope and non-goals

### Required in prototype

- One **handcrafted low-poly 3D city district**, approximately **240 m × 180 m**, entirely within playable bounds.
- Streets, sidewalks, crossroads, alleys, blocky buildings, a small park or plaza, streetlights, street markings, street furniture, dumpsters, parked cars, debris, and a fortified checkpoint.
- An animated low-poly zombie leader with smooth WASD movement, sprint/stamina, health, and death.
- **Third-person follow/orbit camera** with right-drag rotation, wheel zoom, smart obstruction handling, camera collision avoidance where practical, and a useful zoomed-out horde view.
- **60 recruitable wandering zombies**, visually varied and distributed among city streets, courtyards, and alleyways.
- Passive recruitment, rally ability, following/separation, navigation around buildings and vehicles, and regrouping.
- Up to **100 active follower zombies**, independently behaving but efficiently simulated/rendered.
- Horde commands: **Follow**, **Attack**, and timed **Rush**.
- An outpost with perimeter barricades/walls, **one destructible gate**, **8 human guards**, and **2 occupied guard towers** (tower occupants included in 8).
- Guard patrol/detection/combat, gunfire with muzzle flashes/tracers, line of sight blocked by buildings and walls, guard death, zombie melee attacks, and structure destruction.
- Visible conversion of human casualties with **70% conversion chance** after death caused by zombie attacks.
- Victory/loss and full restart, onboarding/controls, leader health, stamina, horde count, ability cooldowns, order status, target feedback, and obvious gate damage.
- Effects, basic audio (synthesized/local assets), performance instrumentation, automated logic tests, and documented setup.

### Not required in prototype

No drivable vehicles, traffic AI, police wanted-level system, pedestrians beyond the outpost guards, full GTA-sized map, interiors, complex physics/ragdolls, networking, saves, persistence, world streaming, character customization, skill trees, crafting, weapons inventory, economy, missions beyond one checkpoint, day/night cycle, dynamic weather, loot, mobile/touch controls, multiple special zombie classes, procedural generation, or external services.

**Important scope rule:** “GTA-like setting” means the **dense low-poly urban environment and third-person traversal fantasy**, not implementing GTA's full feature set.

## 3. Technology and architecture

- **Three.js**, **TypeScript**, **Vite**. Use a stable compatible current version and pin versions via `package-lock.json`.
- **Vitest** for pure simulation/gameplay tests.
- Use one Three.js `WebGLRenderer`, one main scene and camera, a single `requestAnimationFrame` loop, and a fixed simulation timestep (recommend `1/60 s`) with a bounded accumulator. Rendering can interpolate visual transforms.
- All game positions use meters in the **X/Z ground plane**, with **Y up**. Never mix 2D pixel coordinates with world units. Character forward orientation uses the X/Z movement vector.
- Maintain logical state separate from Three.js meshes. Meshes should reflect entity state, not be the source of health, collision, AI, or gameplay truth.
- Use low-poly geometry/materials generated in code or include small locally licensed GLB models. **Do not require remote downloads/CDNs at runtime**. If no external assets are available, generate recognizable humanoids and buildings from primitives; do not settle for colored spheres as final characters.
- Prefer native Three.js geometric collision/raycasting and custom 2D X/Z gameplay collision. **Do not add Rapier, Cannon, Ammo, React, an ECS library, or a full navigation framework** merely for convenience. Add dependencies only if they materially solve a demonstrated problem.
- Implement lightweight pooled visual effects and spatial indexing. Avoid allocating new vectors/objects for each agent on each update where possible.
- Browser target: desktop Chromium/Firefox/Edge at 1280×720 or larger. Scale drawing buffer with capped device pixel ratio (e.g. ≤ 1.5 or adaptive).

### Recommended file layout

```text
/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── public/assets/                   # optional, local/license-compliant
├── src/
│   ├── main.ts
│   ├── config/balance.ts             # all tuning values
│   ├── core/Game.ts                  # init / loop / state
│   ├── core/InputController.ts       # keyboard, pointer, click vs drag
│   ├── core/ThirdPersonCamera.ts     # orbit, follow, zoom, collision
│   ├── world/CityDistrict.ts         # scene and authored district layout
│   ├── world/Checkpoint.ts
│   ├── world/CollisionWorld.ts       # footprint colliders & blockers
│   ├── world/NavigationGrid.ts       # path grid and shared flow fields
│   ├── entities/ZombieLeader.ts
│   ├── entities/Zombie.ts
│   ├── entities/HumanGuard.ts
│   ├── entities/Structure.ts
│   ├── visuals/LowPolyCharacters.ts  # geometry, colors, animations
│   ├── visuals/Effects.ts
│   ├── systems/HordeSystem.ts
│   ├── systems/NavigationSystem.ts
│   ├── systems/CombatSystem.ts
│   ├── systems/HumanAISystem.ts
│   ├── systems/ConversionSystem.ts
│   ├── ui/HUD.ts                     # HTML/CSS overlay, no framework
│   └── utils/{math,spatialHash}.ts
└── tests/
    ├── recruitment.test.ts
    ├── navigation.test.ts
    ├── combat.test.ts
    ├── ai.test.ts
    └── victory.test.ts
```

Folder boundaries can differ if the result stays modular and testable. Use well-named types/interfaces for entities, orders, teams, state transitions, and colliders.

## 4. Visual direction: stylized low-poly GTA-like city

**Target appearance:** Modern, polished, colorful but slightly gritty urban sandbox with clean hard-edged geometry and recognizable scale. Think miniature 3D city blocks viewed from an elevated third-person chase camera. Avoid a voxel/Minecraft look, untextured debug geometry, or realistic/gruesome gore.

### Environmental art requirements

- **Road network:** Asphalt roads (roughly 12–16 m wide), painted lanes, intersections, crosswalks, curbs, sidewalks, parking bays, cracked patches, storm drains.
- **City blocks:** 2–5-storey low-poly apartments, storefronts, warehouses, garage doors, roofs with AC units, exterior staircases as decorative geometry. Most buildings are non-enterable and have footprint colliders.
- **Props:** Streetlights, traffic lights/signs, benches, trash cans, dumpsters, fences, barriers, fire hydrants, utility poles, vegetation, parked cars, abandoned trucks.
- **Landmarks:** A park/plaza where the player begins, a commercial street, an alley with clustered recruits, a broken intersection, and a visually distinct survivor checkpoint.
- **Color/materials:** Muted blue/gray asphalt, sandy concrete, faded painted walls, warm human warning lights, desaturated green infected silhouettes, bold but controlled accents.
- **Lighting:** Hemisphere + directional sun, soft/fake contact shadows where practical, ambient occlusion impression from geometry and material variation. Use real shadow maps selectively; avoid 100 individual shadow-casting zombie lights/meshes.
- **Depth cues:** Building heights and cast shadows must make the city clearly three-dimensional. Camera obstruction handling must prevent buildings entirely hiding the leader for long stretches.
- **Readable enemies:** Humans visually distinct from zombies even when camera zoomed out. Provide subtle ally/enemy color markers, not huge floating labels.

### Low-poly character models

Build reusable articulated humanoids, not single boxes/capsules. At minimum each character has head, torso, pelvis, two arms, two legs, and a facing direction. Use flat-shaded geometry, a few materials, oversized/clear silhouettes, simple stylized faces, and minimal visible polygons. Optional GLB imports are fine if local, license-compliant, and working.

- **Zombie leader:** Distinct darker green skin, torn jacket, asymmetric posture, visual highlight/ring or distinctive accessory.
- **Walkers:** 4–6 palette/garment variants; green/gray skin, limp or shambling walk cycle, different proportions/accessories.
- **Guards:** Cohesive human uniform with skin tones, protective vest, helmet/cap, and a recognizable low-poly firearm.
- **Animations:** Procedural idle sway, walking leg/arm swings, faster sprint cadence, brief melee lunge, taking damage, falling/death, and delayed rising/conversion. Keep the animation system simple and consistent; skeletal rigging is optional.
- **Orientation:** Feet remain planted on the ground plane; characters rotate toward travel/combat targets smoothly; no visual sliding/teleporting.

Instancing is desirable when zombies grow numerous. An acceptable first implementation is pooled reusable meshes with shared geometries/materials if it meets performance targets. If using `InstancedMesh`, ensure animation and per-agent color/rotation remain visually readable.

## 5. City district layout (approximately 240 m × 180 m)

Create a **handcrafted bounded sandbox** with a roughly 3×3-block navigable street network and believable street scale. The player should recognize streets, alleys, and a checkpoint without a minimap. Keep sight lines clear and the assault reachable from multiple approach directions while preserving a single destructible gate.

Use world-space X/Z coordinates, with the city centered near `(0,0)` and ground at `Y=0`. Exact arrangement may vary to improve playability.

| Area | Purpose |
|---|---|
| Southwest park/plaza | Player starts alone, camera and controls introduction |
| Residential streets | Light clutter, first wandering zombie groups |
| Commercial block | Storefronts, parked cars, larger clusters of recruits |
| Service alleys | Narrow paths / shortcut toward outpost; tests crowd pathfinding |
| Main avenue | Fast open approach but exposed to gunfire |
| Northeast checkpoint | Fenced human compound and final objective |

### Checkpoint

- Approximately **42 m × 32 m** walled/fenced rectangular compound, inside the northeastern district.
- Perimeter obstructs walking and shots, except where geometry intentionally allows shots; one **front destructible gate** (facing the approach street) with **250 HP**.
- Two accessible **watchtowers**, one guard on each; tower occupants count toward eight total guards.
- Other six guards split between inside and around the compound. All must be reachable or exposed/able to descend so the player can win; do not place invulnerable guards on inaccessible rooftops.
- Clearly visible sandbags, warning signs, barricades, floodlights, defensive firing positions, and unique human faction colors.
- Gate visibly degrades (damage decals/color/segments) and on destruction immediately removes collision and navigation blocking. Destruction effect should be clear.
- **One gate**, not a hidden second entry. However, buildings, wrecked vehicles, and alley approaches should let the player flank guard firing angles and safely stage the horde.
- Provide one useful roadside open area for zombie staging and a path wide enough for the horde to flow through the gate after destruction.

### Navigation and collisions

- Static solid building footprints and most large props cannot be walked through. Cars and dumpsters are blockers. Small litter is decorative and nonblocking.
- Do not make every triangle a physics collider. Author simple 2D X/Z AABBs or polygonal footprints for game logic and use broad-phase spatial queries.
- Ground-height variations should be subtle; v1 movement occurs on mostly flat streets/sidewalks. No stairs, bridges, multilevel routing, or interior navigation required.
- The player and zombies should slide along buildings rather than getting stuck on corners. Maintain collision radius and world-edge bounds.
- Camera raycasts to simplified obstacle volumes to pull closer/raise when necessary, then ease back smoothly.

## 6. Third-person camera and controls

### Camera behavior

- Default **elevated third-person chase**: camera tracks the leader from behind at ~**14 m horizontal distance**, ~**11 m height**, pitched down enough to show a useful portion of the horde and streets.
- Player can **right-drag** to orbit camera yaw and adjust pitch within limits, without opening browser context menu. Camera can also follow heading with gentle smoothing when not dragged; prevent abrupt spins.
- Wheel zoom from **8 m close view** to **32 m tactical overview**, preserving recognizable perspective. The overview must show a large chunk of the horde, not become a 2D orthographic map.
- Camera should follow smoothly while remaining responsive, hold character around lower-middle screen space, and gracefully handle occlusion from buildings.
- Optional `C` recenter behind the leader. No need to support free-fly developer camera in regular play.

### Desktop input table

| Input | Action |
|---|---|
| `W A S D` / arrows | Move leader **relative to camera yaw**; diagonal input normalized |
| `Shift` | Sprint while stamina allows |
| Left-click visible enemy/guard/gate | Issue **Attack** order with 3D raycast and target confirmation |
| Left-click empty ground | World ping only; does not change direct leader control |
| Right-click on canvas | Immediately **Recall / Follow** (unless user dragged to orbit) |
| Right mouse drag | Orbit/tilt camera; distinguish drag from click with a pixel threshold |
| Mouse wheel | Camera zoom |
| `Space` | Trigger horde **Rush** if available |
| `E` | Trigger recruit **Rally** pulse if available |
| `C` | Recenter camera behind leader |
| `Tab` | Toggle a small controls/help overlay (not a separate strategic map) |
| `R` on game over | Restart complete game |

Click selection must raycast against a dedicated targetable layer/groups, not the world ground through an enemy. For large structures use accessible selection meshes. Provide hover highlight and/or reticle for valid targets. Prevent default browser scrolling/context menus when operating the game. Ignore gameplay keys when browser focus is outside the game or an overlay has focus.

### Leader statistics and actions

- Max health: **100 HP**.
- Walk speed: **5 m/sec**; sprint speed **7.4 m/sec**.
- Stamina max **100**, sprint drain **25/sec**, recovery **15/sec** while not sprinting; require at least **20** recovered to restart after exhaustion.
- Leader has short-range bite/claw attack on nearby foes, but followers must be the main damage source. For the prototype, leader attacks a nearby valid human automatically when within melee range and not sprinting, with clear melee animation.
- Recruit radius **9 m**; Rally `E` instantly recruits all eligible wandering zombies within **15 m**, **8-second cooldown**, with expanding pulse visual.
- Leader dies at zero HP; immediately ends run and disallows movement/orders until restart.

## 7. Entity initial balance

All values defined in `src/config/balance.ts`; tune as needed, document changes.

| Entity | HP | Attack | Range | Move speed | Attack cadence |
|---|---:|---:|---:|---:|---:|
| Zombie leader | 100 | 10 melee | 1.7 m | 5 m/s | 1.1 sec |
| Walker follower | 40 | 8 melee | 1.5 m | 3.7 m/s | 1.2 sec |
| Human guard | 50 | 10 ranged | 22 m | 3 m/s | 0.8 sec |
| Gate | 250 | none | — | — | — |

- Followers: **60 wandering at map start**, **100 max recruited active followers**; leader excluded. Conversions use a slot if capacity allows.
- Of the eight human guards, two start in towers.
- Projectiles can be hitscan for authoritative damage, with visible tracers and muzzle flash for readability.
- Zombie melee damage applies only within range and with line-of-access; **no attacking through walls, gates, cars, or buildings**.
- Ranged attacks require an actual unobstructed world-space line of sight; buildings/gates and solid walls block shots.
- Friendly fire disabled in v1.
- Leader gets clear hit flashes and damage indicators when shot. Guard health bars appear on damage or when targeted.

## 8. Horde behavior — highest priority system

### Recruiting

- Idle walkers wander slowly within spawn zones, occasionally stop, and play simple idle animation.
- Every simulation update (or at ~5–10 Hz with sufficient detection), eligible walkers within **9 m** of the leader join automatically, play a short join effect, and begin following.
- Rally `E` recruits within **15 m** immediately and shows cooldown.
- Recruited zombies **must never revert to ambient idle** unless dead or after reset. Dead followers do not respawn during the current attempt.
- Followers do not exceed 100 active entities; at capacity leave wandering zombies unassigned and show unambiguous cap feedback.
- HUD follower count always agrees with actual living followers. Conversion counts only after the new zombie stands and joins.

### Flocking

- Followers should form a **broad, organic moving pack** around/behind the leader, not a single-file snake or stacked sphere of characters.
- Steering combines attraction to a follow anchor, neighbor separation, velocity smoothing, and obstacle avoidance. Add mild per-zombie variance (offsets, limb phases, palette, speed) but maintain predictable response.
- Use a **spatial hash / uniform grid** for nearby zombie queries; do not perform O(N²) all-to-all neighbor checks.
- Close to the leader, followers should slow and spread; when separated they catch up without instant teleportation. Allow a limited movement-speed boost for lagging followers outside combat.
- Avoid followers repeatedly pushing the leader or each other into static geometry; simple soft personal-space forces are sufficient.
- On narrow alleys and gate openings, use shared routing guidance. Followers should funnel naturally and regroup after obstacles.

### Navigation

- Use a **2D nav grid on the X/Z plane**, resolution around **1–1.5 m/cell**, with building/vehicle/wall footprints dilated to keep agent centers off geometry. A* is acceptable for leader-independent guard patrol/path targets; use a **shared flow field or cached group path** for horde movement instead of running full A* on every zombie each frame.
- Steering must never be the sole navigation strategy behind large occluding buildings; zombies need a routed path around blocks and through alleys.
- Recalculate group flow/path when its target changes, the leader has moved meaningfully, or gate destruction changes walkability. Limit expensive recalculations (e.g. ≤ 5 Hz).
- Ensure path guidance and local collision agree. Prevent corner vibration, oscillation, unreachable target loops, and pathing through structures.
- Add a short stuck-detection recovery routine (replan / choose alternate reachable adjacent point). **No visible teleporting through walls**.
- World should remain navigable with 100 followers; ensure opening widths and AI radii allow actual passage.

### Follow command

Default state. Followers move toward moving leader, maintain separation, and defend themselves from nearby threats. Right-click recalls attackers: they disengage at a sensible time, clear their attack target, and rejoin the leader. A small portion may finish an ongoing attack swing; do not trap followers in permanent combat.

### Attack command

- Clicking a **visible, accessible** guard or destructible gate sets the horde target and displays a ground/mesh marker.
- Followers prioritize the order while remaining within reasonable engagement/pathing logic. If a target is outside melee access, move to reachable adjacent approach spots rather than pathing into collider centers.
- If target is destroyed/killed, clear explicit order or opportunistically acquire nearby enemy; never attack its dead corpse forever.
- If target cannot currently be reached (e.g. guard behind intact gate), followers should attack the gate **only if it is the necessary blocker**, rather than clustering forever against an indestructible wall.
- Clicking again can change target; right-click cancels. HUD shows `FOLLOWING`, `ATTACK: GATE`, `ATTACK: GUARD`, or equivalent.

### Rush ability (`Space`)

- Duration **4 sec**, cooldown **15 sec**, affects recruited followers (not ambient zombies).
- Followers gain **+45% movement speed** and **+25% attack rate** during Rush. Make it obvious with an outline/tint, pulsing ring, animation speed, and an audible cue.
- Rush **does not automatically change Follow vs Attack**; it amplifies current behavior.
- Cooldown visible and unspammable. Restart resets it.

## 9. Human guard AI

Each guard has a finite state machine: `PATROL`, `ALERT`, `COMBAT`, `RETREAT` (optional but desirable), `DEAD`.

- **Patrol:** Move between authored street/compound waypoints; idle look around on arrival.
- **Detect:** Periodic visibility checks within 22 m, with a forward-angle preference where practical; occlusion by solid buildings, walls, cars, and closed gate. Detection triggers alert indicator and nearby guard assistance.
- **Combat:** Face an in-range visible zombie, fire at cadence with hit effects. Prefer nearest/most threatening zombie; target the leader occasionally if it is exposed, but do not have all guards instantly focus the leader through a wall.
- **Retreat:** Low-health/outnumbered guard can move to a nearby cover/defensive point when available. Must not retreat into an unreachable position.
- **Dead:** Immediately cease firing/collision/path blocking as appropriate and start conversion resolution if killed by zombie attack.
- Guards must not shoot through buildings or attempt unending attacks without line-of-sight. Use cooldowns on expensive visibility tests.
- Tower guards gain long visibility but must still be targetable/defeatable: on sustained melee pressure near tower base, they can descend or the tower has a reachable attack proxy that damages the occupant. Pick one and communicate clearly; **unreachable tower guards are forbidden**.
- On initial approach, do not instantly alert all guards across the map. Let positioning around urban cover matter.

## 10. Combat, deaths, conversion

### Combat

- Check teams, range, cooldowns, visibility/clear melee access, and living state before applying damage.
- Zombie followers automatically attack nearby guards in their reachable engagement area, prioritizing explicit horde order over opportunistic targets.
- Zombies damage gate when ordered and within melee range. Multiple zombies can attack a gate concurrently; avoid all agents trying to occupy precisely one world point.
- Guard hits have directional muzzle flash/tracer, hit feedback, and brief zombie reaction. Avoid overly frequent or unreadable effects.
- Dead zombies fall or slump, are removed from the active horde count, and have pooled corpses that fade/despawn after a short time.

### Human conversion

- When a guard dies **from zombie melee**, roll a **70% conversion probability** using injectable RNG for tests.
- The body remains visible **2–4 seconds**, then if conversion succeeds plays rise animation/VFX and becomes a Walker follower if capacity permits. A conversion does not create duplicate entities or resurrect a living guard.
- If at horde capacity, do not add follower; corpse may remain dead or conversion is deferred only if implementation supports it reliably. Prefer deterministic simple behavior.
- Guard deaths caused by anything other than zombie attacks need not convert.
- Show a distinct, satisfying color/animation transition on conversion; update counter only when follower becomes active.

## 11. HUD and user experience

Use a polished HTML/CSS overlay anchored to viewport edges. Avoid React unless already present in an existing project and essential to reuse.

### Required HUD

- Top-left: **leader HP** and **stamina bars**.
- Top-center: objective `CAPTURE THE CHECKPOINT` and short status (`Find zombies` / `Break the gate` / `Eliminate the guards`).
- Top-right: **HORDE 34 / 100** plus a smaller alive-guard counter or outpost objective progress.
- Bottom-center/bottom-left: compact command status and cooldown indicators for **E Rally** and **Space Rush**.
- Persistent small control reminder; `Tab` expands detailed help.
- Over targets: hover/selected target highlight and accessible gate HP bar while damaged/targeted.
- Welcome/onboarding overlay at start, dismiss on movement/click; do not block action for long.
- Win screen: `CHECKPOINT OVERRUN` plus surviving follower count, conversions, losses, Restart.
- Loss screen: `THE LEADER HAS FALLEN` plus Restart.
- Responsive UI fit at 1280×720; game viewport remains unobstructed enough to see leader and horde.

### Essential feedback

- Clear recruitment sparkle/short sound and follower joining motion.
- Different zombie/guard colors and readable weapon effects.
- Light camera shake or impact VFX for breaking the gate, not constant shaking.
- Rush and Rally visibly activate; disabled abilities indicate remaining cooldown.
- Attack command creates an obvious world-space ring/pulse around selected target.
- Avoid overwhelming the screen with hundreds of individual health bars.
- Basic sound via Web Audio oscillators/noise or local properly licensed clips; sound should unlock after user gesture and fail gracefully if muted.

## 12. Win, loss, restart

### Victory

- Gate is destroyed **and** all eight guards are defeated (converted guards count as defeated immediately upon death).
- Display win overlay, freeze combat input, and preserve final scene for celebration/inspection.
- HUD counts remain internally consistent after victory.

### Loss

- Zombie leader HP reaches zero; followers may briefly idle/freeze. Show loss overlay with restart.
- Losing all followers is **not** itself an immediate loss. The leader may retreat and recruit remaining wandering zombies.

### Restart

- `R` or Restart button rebuilds or deterministically resets all mutable systems: guards, gate, ambient zombies, followers, ability cooldowns, health, stamina, conversion timers, projectiles, VFX pools, controls, navigation state, victory flags, and HUD.
- No duplicate render loops, event listeners, scene meshes, or accumulating memory leaks after repeated restart.

## 13. Performance and simulation quality

Minimum acceptance target: **60 FPS on a typical desktop browser with 100 living followers, 8 guards, all city geometry and combat VFX**. Avoid promising all hardware will achieve this; measure and document test machine.

Implementation guidelines:

- Fixed update delta; cap large frame delays so browser tab resume does not make agents tunnel through structures.
- Use shared geometries/materials, draw-call reduction, instancing/pooling where suitable, limited shadow-casting objects, frustum culling, and bounded particles/tracers.
- Avoid 100 skinned characters with heavyweight animation mixers if procedural transform animation suffices.
- Use grid/spatial hash for local queries; AI and LOS may tick at 5–10 Hz with smooth visual interpolation.
- Avoid per-frame full-array sorts and thousands of per-frame raycasts; use 2D obstacle collision/visibility for gameplay and Three.js raycast only for pointer selection/camera occlusion.
- Navigation rebuild triggered by gate destruction, not every frame.
- Add optional debug/performance overlay via `F3` with FPS, live zombies, guard count, and approximate draw calls (renderer.info.render.calls). It should be off by default.
- Test at a reduced 1280×720 viewport and ensure HUD scaling.

## 14. Implementation plan — execute all phases

### Phase A — 3D city and leader

1. Initialize Three.js/Vite/TypeScript app, render loop, renderer, lighting, ground and sky/haze.
2. Build city district with authored streets/blocks, non-enterable buildings, sidewalks, cars, props and collision footprints.
3. Build visually recognizable articulated low-poly zombie leader and idle/walk/sprint animations.
4. Implement camera-relative WASD, sprint/stamina, player collision and third-person camera orbit/zoom/obstruction.
5. Add HUD foundation and startup instruction overlay.

**Gate:** Player can comfortably run through convincing 3D urban streets without passing through buildings/vehicles, and see the zombie from behind.

### Phase B — wandering zombies and horde

1. Create reusable visually varied Walker models and animation.
2. Spawn 60 ambient walkers in sensible accessible zones.
3. Implement recruitment, Rally, count/cap, swarm steering, separation and follow.
4. Build shared navigation/path guidance through alleys, around cars/buildings and eventually through gate.
5. Add simple recruitment VFX/SFX and verify horde cannot get permanently stuck.

**Gate:** A player can recruit dozens, lead them around a block, through an alley, and back to an open street with the crowd mostly intact.

### Phase C — checkpoint, guards, combat

1. Build checkpoint geometry, barricades, gate HP/destruction, collision changes and valid approach points.
2. Spawn 8 human guards, tower positions and patrol waypoints.
3. Implement detection, LOS, guard shooting, zombie damage, deaths and readable feedback.
4. Implement horde target raycasting, Attack, Follow recall, gate targeting and accessible melee slots.
5. Tune attack and gate breach to make approach choices meaningful.

**Gate:** Horde follows explicit orders and reliably breaches gate rather than becoming stuck on wall; guards shoot only when LOS is valid.

### Phase D — conversion and abilities

1. Human death → delayed 70% conversion → new follower, respecting cap.
2. Rush boosts, visual/audio indication and cooldown; Rally cooldown.
3. Implement leader melee and damage/death behavior.
4. Improve target feedback, animations, visuals and audio.

**Gate:** Battle visibly changes as humans are converted and surviving zombies rejoin the group.

### Phase E — complete game and validation

1. Implement victory, defeat, restart and end-of-game overlays.
2. Complete responsive HUD, onboarding and settings needed to play.
3. Add automated tests, fix collision/navigation/AI edge cases.
4. Benchmark a 100-follower assault; optimize where needed.
5. Run build/tests, perform complete browser playthrough and provide README with exact controls and limitations.

**Gate:** All acceptance scenarios pass and gameplay is understandable without opening source code.

## 15. Automated test requirements

Use pure simulation logic so tests run in Node/Vitest without requiring WebGL.

At minimum tests should cover:

1. Recruit within passive radius; do not recruit outside it.
2. Rally extends recruitment range for its activation and respects cooldown.
3. No duplicates when follower and ambient pools overlap/recruit repeatedly.
4. Follower cap respected, leader excluded, dead followers removed from alive count.
5. Direction normalization ensures diagonal movement is no faster than cardinal movement.
6. Sprint drain, exhaustion latch, recovery threshold, normal speed behavior.
7. Attack range/cooldown and team filtering; dead entities cannot deal damage.
8. Gate HP reaches zero once, triggers blocker removal and navigation refresh.
9. LOS rejects shots obstructed by building/gate footprint.
10. Conversion only for zombie-caused guard deaths, and RNG boundaries around 70%.
11. Conversion waits required delay and respects follower cap.
12. Victory requires both gate destruction and all guards defeated; leader death triggers loss.
13. Restart restores counts, states, cooldowns and navigation blockers.
14. Pathfinding routes around a blocked city block and through the destroyed gate; no route passes through solid buildings.
15. Explicit command transitions: Attack target → Follow recall; destroyed targets stop being active orders.

## 16. Manual browser acceptance checklist

- [ ] `npm install && npm run dev` launches; no console exceptions or missing assets.
- [ ] A coherent low-poly **3D city** appears, with actual streets, buildings, alleys, cars, props, and checkpoint.
- [ ] The player is a recognizable animated zombie, not a placeholder sphere.
- [ ] WASD moves camera-relatively; shift sprints; input feels immediate.
- [ ] Camera is third-person perspective; right-drag orbits; wheel changes zoom; buildings do not permanently hide leader.
- [ ] Leader collides/slides against buildings and vehicles and stays inside world bounds.
- [ ] Idle zombies wander and automatically join when approached; recruited zombies are visibly distinguishable.
- [ ] At least 30 followers can move through a street intersection, around a block, and through a narrow alley without major crowd loss or permanent sticking.
- [ ] Horde does not become a single-file line or overlap into one blob in open ground.
- [ ] Rally recruits within larger radius and respects cooldown; Rush visibly boosts movement and attack rate.
- [ ] Attack command selects guards/gate using mouse raycast; Follow cancels it; UI communicates state.
- [ ] Guards patrol, detect visible zombies, fire; wall/building occlusion blocks shots correctly.
- [ ] Zombies breach a gate using melee, gate appearance degrades, and walkers flow through opening after destruction.
- [ ] Tower guards are defeatable; no unreachable guard prevents victory.
- [ ] Zombies and guards take damage, animate death; converted humans rise after delay and join horde.
- [ ] Hordes can grow mid-battle; losses and conversions correctly change HUD.
- [ ] Destroying gate and defeating all guards triggers win; leader death triggers loss.
- [ ] Restart works on both screens without extra render loops or corrupted state.
- [ ] UI remains legible at 1280×720; all inputs operate as documented.
- [ ] `npm run build` and `npm test` pass.
- [ ] 100-follower combat has reasonable frame rate and no obvious memory leak.

## 17. Initial game tuning / intended experience

- In first 30–60 seconds, player should recruit 10–20 walkers by exploring near spawn.
- Within 2–4 minutes, player can gather a substantial horde (~40–60) for the checkpoint assault.
- A hasty attack of 10–15 walkers should generally fail or suffer catastrophic losses.
- A coordinated attack with 40–60 walkers should have a plausible chance, particularly when using city cover and attack orders.
- Gate breach and human conversion should create satisfying acceleration during the battle.
- Total first playthrough target **5–10 minutes** (guideline, not an enforced timer).
- Do not make the objective impossible if human guards are split or tower occupants are unreachable; tune targeting/guard behavior first rather than inflating damage numbers.
- All mutable balance values should be centralized and simple to adjust.

## 18. Edge cases and explicit design decisions

- Three.js **fully replaces** Phaser. Do not retain Phaser scenes/cameras or switch back to a flat top-down game.
- Third-person **perspective** camera is intentional; a zoomed-out tactical view is still perspective, not a fullscreen strategy map.
- 3D buildings must meaningfully shape navigation and combat line-of-sight, not be visual-only decoration.
- No shooting through intact gates or solid buildings; guard trajectories use logical X/Z obstacle tests plus height rules as needed.
- No zombie attack damage through gate/walls except against the gate as an explicit target.
- Tower defenders must have a reachable defeat mechanic and provide visual feedback when attacked.
- Players cannot click an enemy through occluding geometry; show a visible selectable proxy when justified (e.g. targetable gate face).
- Camera orbit right-drag and right-click Follow must be disambiguated. A drag must **not** issue a recall.
- Clicking ground does not switch to click-to-move.
- Rush affects recruited followers only, not stray zombies.
- A conversion is only counted when the new follower successfully enters the living horde.
- No permanent horde loss on leader death because every run is an independent level attempt; restart resets level.
- Handle tab focus changes, large delta times and repeated restart without corrupted state.
- Do not import GTA branding, copyrighted maps, recognizable real-world characters, models ripped from commercial games, or externally hosted game assets.

## 19. Deliverables

1. A functioning locally runnable TypeScript + Three.js game with all required implementation files and any included asset licenses.
2. `README.md` with install/start/build/test commands, complete controls, objective and tuning notes.
3. Automated tests for gameplay logic and collision/navigation behavior.
4. A readable modular codebase with clear state separation from Three.js visual objects.
5. A compact summary of what was implemented, what was tested, and any remaining limitations **after the playable implementation is complete**.

## Final instruction to the coding agent

**Proceed with full implementation now, through a complete playable low-poly 3D urban checkpoint assault.** Do not stop at project scaffolding, simple cubes, screenshots, mock interfaces, or a half-finished level. The defining moment is the player's animated zombie running down a recognizable city street while a large horde follows, then leading that horde into a fortified human outpost. Optimize the quality and reliability of that moment above optional systems.
