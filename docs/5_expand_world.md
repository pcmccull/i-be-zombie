# I Be Zombie — World Boundaries and Zombie Vision

## AI Orchestrator Implementation Brief

**Project:** I Be Zombie  
**Engine:** Three.js, existing low-poly 3D GTA-like tropical city  
**Goal:** Replace artificial map-edge voids with believable physical barriers and add an upgradeable zombie eyesight system without breaking the freely explorable, mixed-difficulty 16-district world.

> **Orchestrator instruction:** Inspect the existing project first. Adapt all filenames, modules, engine integrations, and schemas to the actual codebase. Delegate work to independent subagents using the contracts below. Do not rebuild functioning systems or perform unrelated refactors. Integrate and test the completed work before marking it done.

## 1. Non-negotiable design requirements

1. **One continuous open world.** Maintain at least 16 connected districts in a Miami-inspired city with beaches, palm trees, canals, bridges, neighborhoods, downtown buildings, and fortified facilities.
2. **No linear difficulty path.** Intentionally place high-threat districts adjacent to easier ones. The player may explore, attack, retreat from, and conquer districts in any order. No district-level gates, sequential unlock requirements, or automatic enemy scaling to player level.
3. **No gray voids or arbitrary visible world edges.** Replace placeholders with convincing environmental boundaries: fences, debris, abandoned vehicles, concrete barriers, shipping containers, collapsed infrastructure, canals, mangroves, or quarantine walls.
4. **Outer boundaries are real obstacles.** Player, zombies, humans, and vehicles must not walk, path, or fall through the edge. It should be visually obvious why movement is blocked.
5. **Do not wall off districts.** Interior fences, roadblocks, and barricades are distinct from world-edge boundaries; they can be bypassed or destroyed where gameplay permits. Do not turn the city into a series of isolated arenas.
6. **Start with poor zombie vision.** Initially, the player can read immediate combat and navigation but has limited clarity and detection at greater distances.
7. **Eyesight is a permanent upgrade.** Four persistent mutation tiers gradually increase sight radius and tactical awareness.
8. **Vision must enhance gameplay, not punish basic controls.** UI, aiming feedback, local navigation, close enemies, and immediate combat remain readable. The first upgrade should be obtainable early without enforcing a specific conquest route.
9. **Separate discovered geography from current vision.** Previously explored streets remain on the world map; moving humans and combat threats require current visibility or a valid sound/sensory cue.
10. **Optimize for large hordes and mobile-capable browsers.** Avoid per-frame expensive work for every zombie or distant district.

## 2. City/district compatibility

Use the current city map as the source of truth. If the planned 16 districts are not yet implemented, preserve a data-driven structure accommodating the following **illustrative** districts and threat tiers. The numbering identifies districts, **not** mandatory completion order.

| District | Name | Threat tier (1–5) | Defining threat |
|---|---|---:|---|
| 1 | Palm Park | 1 | Park rangers, scattered security |
| 2 | Sunny Boardwalk | 1 | Beach patrols |
| 3 | Neon Nights | 2 | Private security, police |
| 4 | Arts District | 1 | Barricades, small armed groups |
| 5 | Oceanfront Hotels | 2 | Hotel security, elevated defenders |
| 6 | Luxury Marina | 2 | Armed crews, marina security |
| 7 | Golf Estates | 3 | Gated communities, mobile patrols |
| 8 | Mega Mall | 3 | Containment checkpoints |
| 9 | Residential Suburbs | 2 | Neighborhood militias |
| 10 | Medical Center | 4 | Quarantine and containment teams |
| 11 | Historic Downtown | 3 | Snipers, checkpoints |
| 12 | University Campus | 4 | Surveillance, tactical defenses |
| 13 | Industrial Port | 4 | Turrets, armored vehicles |
| 14 | Financial Core | 5 | Heavy coordinated resistance |
| 15 | International Airport | 5 | Military forces, aviation threats |
| 16 | Military Stronghold | 5 | Fortified military defenses |

**Spatial layout:** Ensure that tier-1 or tier-2 neighborhoods share traversable borders/roads with tier-4 or tier-5 facilities. A military base could overlook ordinary suburbs, for example. Use visual cues to convey danger before the player crosses a district boundary. Difficulty reflects defense composition and infrastructure, not distance from spawn. Do not impose invisible walls or level requirements at district transitions.

## 3. Workstream A — Physical boundaries and world dressing

**Owner:** World/environment subagent.

### Requirements

- Identify the currently playable world footprint and all exposed map-edge segments, including corners, coastlines, water boundaries, roads, and incomplete geometry.
- Replace gray blobs, placeholder meshes, abrupt terrain cutoffs, and visible emptiness with a coherent boundary system appropriate to the local environment:
  - **Urban:** Chain-link fencing, concrete jersey barriers, abandoned cars, fallen signs, construction debris, dumpsters.
  - **Industrial/port:** Containers, cargo stacks, security fencing, large gates, floodlights, concrete walls.
  - **Military/quarantine:** Reinforced fencing, guarded walls, watchtowers, razor-wire-like silhouettes, vehicle blockades.
  - **Coastal:** Water with valid shoreline geometry; impassable deep water, wreckage, docks, seawalls where appropriate.
  - **Wetlands/outskirts:** Dense mangroves, drainage canals, flooded terrain, downed trees and storm debris.
  - **Highways/bridges:** Collapsed structures, blocked ramps, damaged overpasses, abandoned evacuation traffic.
- Prefer reusable modular low-poly asset variants and seeded prop variation over individually hand-placing every object. Avoid monotonous repeated fence panels.
- Continue rendering a believable **non-interactive scenic backdrop** beyond the playable perimeter (distant skyline, vegetation, ocean, roads). Scenic terrain must not create unreachable interactive targets or appear traversable.
- Include appropriate materials, lighting, occlusion, LOD/instancing, and collisions. Reuse existing art style and systems.
- Outer boundaries remain impassable even after acquiring Horde Smash, Brutes, Juggernauts, or future destruction abilities. Mark them explicitly as **world boundary**, not simply as ordinary destructible barricades.
- Use physical colliders and matching pathfinding/navigation obstacles rather than collision-only invisible strips placed ahead of visible walls.
- Ensure collision continuity at corners, transitions, and along water/shoreline edges; prevent slipping between props or jumping out of bounds.

### Data contract (illustrative; adapt to project)

```ts
type BoundaryKind =
  | 'urban_fence' | 'concrete_debris' | 'vehicle_blockade'
  | 'shipping_containers' | 'military_perimeter'
  | 'deep_water' | 'mangrove_barrier' | 'collapsed_bridge';

interface WorldBoundarySegment {
  id: string;
  kind: BoundaryKind;
  points: Array<{ x: number; z: number }>;
  isWorldEdge: true;
  destructible: false;
  blocksPlayer: true;
  blocksNPCs: true;
  blocksVehicles: true;
  scenerySeed?: number;
}
```

**Note:** Interior barricades must be separately represented with their own destructibility and navigation properties. This contract is a proposed interface, not a directive to impose a new architecture unnecessarily.

### Acceptance tests

- A full perimeter walk/automated traversal does not encounter visible gray voids, seams, or broken mesh transitions.
- No player, zombie, human, or vehicle can escape the world bounds or path beyond them.
- Scenery remains visible past the perimeter, but there are no interactable off-map entities.
- All interior district-to-district routes intended by the existing map remain open or have navigable/destroyable alternatives.

## 4. Workstream B — Zombie eyesight and rendering

**Owner:** Vision/rendering subagent.

### Four eyesight stages

Values below are **initial design tuning targets**, measured in the game's world-space meters (or converted to existing scene units). Expose them in configuration rather than hardcoding into shader logic.

| Level | Upgrade name | Clear sight radius | Distant clarity | Awareness capability |
|---|---|---:|---|---|
| 1 | Rotten Eyes | 18 m | Heavy distance haze/blur | Clear nearby targets only |
| 2 | Predator Sight | 28 m | Moderate haze | Better moving-human detection |
| 3 | Hunter Vision | 42 m | Light haze | Recognize distant humans and defenses |
| 4 | Apex Vision | 60 m | Minimal haze | Extended tactical awareness/reinforcement detection |

### Rendering and visibility

- Implement world-space visibility based on player position and current vision tier, **not** a fixed-radius screen vignette independent of camera zoom.
- Use a gradual transition near the sight boundary. Beyond clear vision, distant scenery can remain as silhouettes/hazy environmental shapes rather than simply disappearing into black or gray.
- Avoid turning the entire view into an unusable blur. The player avatar, immediate nearby ground, directly engaged opponents, selection/command markers, menus, health bars, and essential HUD must remain readable.
- Retain normal camera panning and zoom controls, but do **not** allow zooming out to bypass gameplay sight limits.
- Apply entity reveal/targeting rules separately from cosmetic haze. Do not expose enemy labels, exact positions, health, or target selection outside valid sight just because their mesh happens to be drawn for scenery.
- Respect building/wall occlusion for tactical enemy identification where practical. Use a performant spatial query plus selective line-of-sight checks at bounded intervals; avoid raycasting to every enemy every frame.
- Nearby enemy attack telegraphs and projectiles must remain readable for fairness, even when visual style is degraded.
- Keep blur/postprocessing mobile-friendly; provide quality settings or graceful fallback if high-quality effects are expensive.

### Vision API contract (illustrative)

```ts
type VisionTier = 1 | 2 | 3 | 4;

interface VisionProfile {
  tier: VisionTier;
  name: string;
  clearRadius: number;
  hazeStrength: number;
  detectMovingHumans: boolean;
  detectDefenses: boolean;
  detectReinforcements: boolean;
}

interface VisibilityService {
  getProfile(): VisionProfile;
  canIdentifyTarget(targetId: string): boolean;
  canTarget(targetId: string): boolean;
  isWorldPositionInSight(x: number, z: number): boolean;
}
```

Use the game's existing unit conventions and event/entity architecture rather than introducing a parallel global state store.

### Acceptance tests

- Initial sight is visibly restricted but local movement and combat are usable.
- Sight radius and entity identification change when tiers change.
- Camera zoom does not expand the logical detection radius.
- Distant opponents cannot be selected/targeted without another valid ability.
- Occluded targets are not incorrectly identified through solid buildings unless intentionally allowed by an explicitly unlocked sense.
- UI/HUD remain sharp and responsive across tiers.

## 5. Workstream C — Sound and nonvisual awareness

**Owner:** AI/audio/gameplay subagent.

Poor eyesight should produce interesting decisions, not just frustration. Let the player hear or sense activities outside the clear vision radius.

### Sensory events

- Gunshots: short directional indicator, with intensity approximating distance.
- Civilian screams: approximate direction of panic or a crowd.
- Engines and sirens: moving sound source without automatically revealing an exact vehicle position.
- Large crowds: broad activity/scent indicator when appropriate to the zombie fantasy.
- Horde followers may react to sounds outside the player's personal vision **subject to existing group-command and AI rules**.

### Rules

- Represent unknown sources as **directional or fuzzy** cues, not an accurate live radar or wallhack.
- Use event lifetime, attenuation, cooldowns, and aggregation so a large battle does not flood the HUD with markers or audio cues.
- Distinguish `heard`, `sensed`, `seen`, and `identified` in gameplay logic if the existing code can support this cleanly.
- Define how cues affect targeting: hearing alone should not provide perfect aim or enemy stats.
- Avoid duplicating existing audio systems; integrate with the established sound/event bus.

### Acceptance tests

- Player receives useful approximate cues for loud events just beyond sight.
- Direction changes correctly when player moves or the source moves.
- Expired cues disappear and do not leak exact positions.
- Dense events do not cause significant update cost or visual spam.

## 6. Workstream D — Progression, persistence, map/UI

**Owner:** Progression/UI subagent.

### Upgrade progression

- Start every new game at `Rotten Eyes` (tier 1).
- Add `Predator Sight`, `Hunter Vision`, and `Apex Vision` as permanent mutations in the existing ability/progression interface.
- **Do not attach vision upgrades to one mandatory district completion sequence.** Use flexible unlock conditions (e.g. mutation points from any conquest, major objective, or accumulated infection) while keeping the upgrade cost and prerequisites configurable.
- Make the first upgrade available early, ideally during the first few meaningful player accomplishments.
- Clearly present the gameplay benefits: radius, improved awareness, and next upgrade cost.
- Save/load the eyesight tier with existing player progression. Handle missing values in older save files by defaulting to tier 1.
- Preserve existing ability unlocks and the ability to tackle districts in any order.

### Map discovery vs. current sight

- Track **explored map geography** independently of current visibility: explored roads/district outlines persist across travel and saves.
- Only reveal current enemy positions and tactical details when visible/identified, or show an explicitly fuzzy sensory cue.
- Previously visited terrain should remain navigable on the large map even when outside immediate vision.
- Ensure no world-map overlay reveals exact hidden enemies, fortifications, or reinforcements prematurely.
- Add minimal, in-world tutorial messaging explaining poor zombie sight and the first mutation opportunity. Keep the humorous tone of the zombie game, not a dense instructional popup.

### Acceptance tests

- Tier upgrades purchase/unlock and persist after reload.
- Existing saves migrate safely.
- Exploring one district and leaving it retains its geographic discovery but not omniscient visibility of its active inhabitants.
- The upgrade UI accurately reflects the active vision profile and cost.
- No single district is required to access the eyesight progression path.

## 7. Shared implementation contracts and ownership

Before subagents modify the code, the orchestrator should inspect the repository and agree on these integration touchpoints:

| Shared concern | Primary owner | Other consumers |
|---|---|---|
| World bounds, colliders, navigation obstacles | A | AI, movement, horde pathfinding |
| Vision config, sight tests, rendering masks | B | C, D, combat targeting |
| Sensory event type and cue lifecycle | C | B, D, existing audio/AI |
| Mutation unlocks, save schema, map state | D | B, existing player systems |
| Final integration, regressions, performance | Orchestrator | All |

**Parallelization rule:** Assign explicit file/module ownership after repository inspection. Avoid concurrent editing of core scene/bootstrap, global state, common types, or save files. If two agents need the same file, have one agent own integration and ask the other to supply an isolated module or patch proposal.

### Suggested execution sequence

1. **Repository inspection:** Orchestrator identifies current world edge implementation, scene units, camera, rendering/postprocessing pipeline, colliders/pathfinding, entity detection, AI event bus, upgrade system, save schema, district representation, and tests.
2. **Contract design:** Establish shared unit scale, boundary flags, visibility API, sensory event payloads, and save migration behavior. Make small integration stubs if necessary.
3. **Parallel work:** Run A/B/C/D concurrently on separate modules, each with tests and example usage.
4. **Integration:** Wire boundaries into collision/nav; vision into visibility/targeting/rendering; sound into awareness; progression into profile selection; save/load into all persisted state.
5. **End-to-end validation:** Test navigation, combat fairness, mixed-difficulty district access, save migration, performance, and visually inspect multiple biome/world-edge types.
6. **Polish and report:** Resolve inconsistencies, remove placeholders, document configuration knobs and remaining risks.

## 8. Global end-to-end acceptance criteria

The implementation is complete only when:

- [ ] The city has no visibly exposed gray/empty map edges during normal gameplay, driving/walking to the perimeter, or camera zooming.
- [ ] The entire exterior perimeter uses environment-appropriate visible obstacles with collision and pathfinding barriers.
- [ ] No boundary gap lets any entity leave the playable world; non-interactive scenery extends beyond the bounds.
- [ ] The city remains a continuous, freely explorable world with at least 16 districts and intentionally mixed nearby difficulty.
- [ ] A player can attempt an extreme-threat district early; failure/retreat is possible without artificial level locks.
- [ ] Newly infected players begin with limited but playable sight.
- [ ] Four eyesight tiers are configurable, visually distinct, and reflected in target detection.
- [ ] Player camera zoom, world map, and UI cannot bypass logical sight restrictions.
- [ ] Directional audio/sensory cues communicate nearby activity beyond sight without exposing perfect enemy coordinates.
- [ ] Explored geography persists separately from live enemy/tactical visibility.
- [ ] Eyesight upgrades integrate with existing progression and persistence, including older saves.
- [ ] High NPC/horde counts do not cause costly per-entity-per-frame line-of-sight checks.
- [ ] Desktop and supported mobile graphics paths remain usable; reduced-quality rendering mode exists where needed.
- [ ] Existing district traversal, horde following, combat, and unlock mechanics still work.

## 9. Required orchestrator deliverables

Produce a final change report containing:

1. Files/modules added or modified, grouped by workstream.
2. The shared contracts and where each is wired into the current game.
3. How boundaries are generated and what defines an indestructible world edge.
4. All vision tier parameters and where designers can tune them.
5. How nonvisual awareness differs from true visual detection.
6. How eyesight upgrades are unlocked, saved, and migrated.
7. Test results, manual playtest scenarios, and observed performance impact.
8. Remaining limitations or follow-up polish items.

**Do not stop at a planning document.** Implement the work, integrate the independent contributions, run available tests, and deliver a playable result consistent with the existing game.
