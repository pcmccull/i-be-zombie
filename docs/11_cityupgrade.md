# I Be Zombie — Living City & Expanded Rewards

**Document type:** Implementation specification for an AI coding agent/orchestrator  
**Project:** I Be Zombie  
**Engine:** Existing Three.js browser game  
**Design:** Humorous third-person zombie action/strategy in a colorful tropical Miami-inspired open world  
**Priority:** High — address empty travel between outposts and diversify rewards beyond abilities/horde stat upgrades

## 0. Instructions to the AI Coding Agent

Inspect the existing project before making changes. Identify the current world/district manager, NPC/horde AI, combat/infection mechanics, mission/outpost state, HUD, save system, asset pipeline, controls, and performance infrastructure. **Extend existing systems; do not rebuild or replace working gameplay.** Follow established code conventions. If a feature already exists, integrate or improve it rather than duplicating it.

Implement in independent, testable slices with feature flags where practical. Keep the game fully playable at the end of each phase. Do not substitute static decorations for the specified dynamic systems. Avoid introducing backend requirements, major framework migrations, expensive third-party dependencies, or copyrighted assets. Use existing assets/animation tooling and placeholder art when needed, but build a clean content pipeline for later polished models, sounds, and VFX.

**Design principles:**
- The city is the game, not merely a collection of outpost arenas connected by streets.
- Wandering for 30–60 seconds should usually reveal an opportunity, surprise, discovery, or ambient incident; do not force continuous combat.
- Zombies are funny, expressive, and mischievous, not horror-oriented.
- A crowded city feels alive through interacting systems, not hundreds of expensive full-fidelity NPCs.
- The player chooses how to explore and which districts to tackle; **do not make progression linear**.
- City activity and rewards must reinforce the core loop: discover people → infect/recruit → grow horde → improvise chaos → attack human strongholds → alter district control → explore again.
- No time-gated daily quests, forced check-ins, grind walls, mandatory collectible hunts, or intrusive popups.

---

## 1. Problem and Outcome

**Current problem:** After attacking an outpost, the player can walk through mostly empty streets looking for the next target. Awards are heavily concentrated in new player abilities and horde upgrades, making the world feel less rewarding to explore.

**Target experience:** The player sees ordinary tropical-city life unfolding, disrupts it through infection and noise, notices human reactions, finds optional incidents and secrets, discovers lasting rewards, and watches neighborhoods evolve as the zombie takeover spreads. Major outposts remain meaningful but are not the only source of excitement or progression.

**Success criteria:**
1. Streets in populated areas contain believable pedestrian and traffic activity that reacts to zombie presence.
2. Ordinary exploration offers autonomous dynamic encounters, not just predetermined markers.
3. Infection/noise can trigger cascading, readable reactions without scripts.
4. Police/security response scales locally and does not overwhelm or soft-lock the player.
5. Each district feels distinct and changes visibly as its control state changes.
6. Rewards include cosmetics, companions, vehicles, hideouts, collectibles, money, discoveries, and world changes — not just powers.
7. World state and earned rewards survive save/reload.
8. Framerate remains acceptable; simulation prioritizes the area around the player.

---

## 2. Living City Systems

### 2.1 Ambient Civilian Simulation

Spawn NPCs from neighborhood-specific archetypes: tourists, selfie-takers, joggers, beachgoers, shoppers, restaurant workers, street performers, delivery drivers, construction crews, office workers, dog walkers, suburban residents, security guards, and emergency responders. All should use existing animation/AI systems where possible.

Implement simple states rather than full life simulations:
- `idle`: stand, chat, look at phone, watch performance, eat, queue.
- `wander`: short waypoint-based movement along sidewalks and open areas.
- `routine`: context-specific action at a tagged point of interest (POI).
- `curious`: look toward nearby commotion at a safe distance.
- `alert`: react to visible zombies, sound, damage, or fleeing civilians.
- `flee`: select a reachable safe direction, avoid threats and obstacles, optionally call for help.
- `hide`: enter a nearby storefront or safe-zone proxy if available.
- `infected`: hand off to existing infection/transformation process.

NPCs must react to players and roaming zombies, maintain sensible density, and avoid visibly popping into view. Make infected civilians eligible to join the player or ambient zombie population according to existing horde rules. Civilian routines should feel recognizable even with simple animation loops.

### 2.2 Traffic and Street Incidents

Introduce lightweight traffic compatible with existing streets and collision/nav systems: cars, delivery vans, buses, cyclists, and golf carts. Start with lane splines/waypoints and simplified vehicle behaviors; no requirement for realistic vehicle physics.

Behaviors: follow route, slow/stop for obstructions, honk, reroute/turn around when possible, flee from zombies, pull over, panic, trigger a collision event when conditions warrant. Traffic is ambient first, interactive when close enough. Avoid large permanent vehicle pileups or blockages that trap the player.

Potential outcomes: bus passengers flee after a stop, a vehicle horn attracts attention, a delivery van collision generates a crowd, a police car arrives at an incident. Treat all as optional sandbox interactions rather than mission requirements.

### 2.3 Dynamic Human Response and District Alert

Maintain **district-local alert level** as a five-stage state (optionally driven by continuous suspicion/heat internally):

| Level | Name | World behavior |
|---|---|---|
| 1 | Normal | Shops and traffic operate; minimal security; civilians behave routinely. |
| 2 | Concerned | Reports and suspicion; guards investigate; small groups begin fleeing. |
| 3 | Panic | Active fleeing, police patrols, disrupted traffic, evacuations. |
| 4 | Lockdown | Barricades, stronger responders, closed businesses, rescue operations. |
| 5 | Overrun | Human forces withdraw to strongholds; zombies dominate; survivor convoys and raids persist. |

Escalate using meaningful events: visible attacks, infection count, civilian reports, noise, outpost assaults, and sustained chaos. De-escalate or transition through territorial state at a configurable rate; avoid endless instant reinforcements. High alert should increase risk and change the mix of opportunities, not eliminate activities. Difficulty and alert are related but **not identical**: a hard district can remain hard even when calm.

The HUD should communicate major alert changes subtly (small badge/audio cue), without intrusive full-screen interruptions.

### 2.4 Emergent Chain Reactions

Use shared world events so systems can react independently. Example:

1. Player infects a tourist taking photos.
2. Nearby NPCs witness and flee; one calls for help.
3. Their screams attract ambient zombies and alert a patrol.
4. A passing van brakes or swerves; an accident makes noise.
5. Bystanders converge or run; a small incidental chase becomes a short street battle.
6. Player recruits followers and continues naturally toward the next objective.

Implement sensible caps and cooldowns to avoid infinite cascades, runaway spawning, and repetitive noise.

### 2.5 Mini-Event Library

Build a **data-driven event catalog** with conditions, location tags, weighted selection, cooldown, difficulty, duration, optional rewards, and cleanup behavior. Initial event types:

| Event | Trigger/location | Possible interaction |
|---|---|---|
| Tourist Bus | Bus stop / beachfront | Infect newly unloaded tourists. |
| Beach Volleyball | Beach recreation POI | Disrupt game; fleeing players scatter. |
| Police Patrol | Street with local alert | Fight, evade, distract, or lure patrol. |
| Food Truck Crowd | Food/cafe POI | Intercept a dense crowd or create a distraction. |
| Zombie in Trouble | Side street / parking lot | Rescue a zombie being chased; recruit follower. |
| Car Accident | Road intersection | Draw bystanders; attract emergency response. |
| Rooftop Party | Rooftop/venue POI | Find approach route to the crowd. |
| Supply Convoy | Arterial road | Optional interception with temporary reward. |
| Street Festival | Plaza / promenade | High-opportunity crowd with escalating response. |
| Rival Zombie Pack | Contested district | Recruit, compete with, or challenge rival group. |

Implement **at least six** diverse, functional event types in the first release; make the others straightforward to add via content definitions. Events must appear to happen within the city rather than always materialize at the player's feet. At least some should begin without requiring player activation and should be noticeable via sight or sound. Events may conclude without player interaction.

### 2.6 Environmental Interactions

Implement a reusable `Interactable`/`WorldAction` abstraction supporting conditions, interaction prompt/range, action result, visual/audio response, AI stimuli, cleanup, and optional cooldown.

Candidate interactions:
- Knock over a trash can → noise draws nearby zombies.
- Set off a car alarm → civilians panic, responders investigate.
- Break a fire hydrant → water spray/slippery visual gag.
- Smash a shop window → civilians inside flee; optional entry route.
- Activate a siren → crowd or zombies converge.
- Knock over construction barriers → short-lived road obstruction.
- Disrupt a pet shop / animal enclosure → comic crowd reaction.
- Startle pedestrians into moving through nearby traffic.

Prefer integrating the normal attack/movement/horde-command controls over adding many dedicated keybinds. Make effects readable, reversible where appropriate, and inexpensive to simulate.

### 2.7 Horde Personality Without Frustration

Give a fraction of followers ambient microbehaviors using a very lightweight state layer: curious investigation, clumsy stumble, short opportunistic chase, lazy pause, object distraction, aggressive posturing. Keep player intent dominant:
- Rally/recall must cancel nonessential behavior.
- During combat or targeted commands, followers prioritize combat orders.
- Avoid losing rare companions due to ambient wandering.
- Preserve existing follow formation/navigation, using limited-radius actions and return-to-horde timers.
- Low-cost animation and voice/groan variation can communicate personality even when behavior logic is minimal.

### 2.8 Neighborhood Identity

Differentiate districts through spawn tables, environmental POIs, soundtrack/ambient audio, activity density, traffic, security, loot, and unique secrets. Example archetypes:

| Archetype | Street life | Encounters/rewards |
|---|---|---|
| South Beach | Tourists, volleyball, parties, lifeguards, golf carts | Beach cosmetics, lifeguard companion, tourist bus. |
| Downtown | Office workers, dense traffic, police | Convoys, security incidents, traffic-related rewards. |
| Suburbs | Dog walkers, cookouts, lawn sprinklers | Grandma zombie, household gags, backyard shortcuts. |
| Industrial Port | Trucks, warehouses, forklift operators, guards | Strong resistance, supply loot, industrial vehicle. |
| Shopping/Arts | Cafes, performers, shopkeepers, festivals | Fashion cosmetics, mall safehouse, parade events. |

Use the existing 16+ non-linear district structure, if present. Do not hardcode progress order; reward discovery via geography, local difficulty, and risk-taking.

### 2.9 District Transformation

Outpost conquest should have a **visible, persistent** effect on its surrounding district, while preserving small pockets of danger and fun. Consider stages such as `humanControlled`, `contested`, `zombieInfluenced`, `zombieControlled` driven by existing systems.

Effects can include altered civilian/zombie mix, graffiti, banners, barricade swaps, ambient zombie gatherings, reopened shortcuts, hideout options, new event pools, survivor raids, and funny zombie-run businesses. Avoid expensive wholesale geometry changes. Use layers/variants, decals, spawn table overrides, and POI flags. Conquered areas must not become empty.

---

## 3. City Activity Director

Create or extend a centralized coordinator that schedules **nearby** ambient actions and events based on current district, proximity to POIs, mission/combat status, alert level, player movement, event history, and available budget.

### Required responsibilities
1. Maintain visible, believable pedestrians/traffic in populated spaces.
2. Choose location-appropriate events from weighted, data-driven definitions.
3. Control concurrent event count and spawn budgets.
4. Prefer offscreen spawning / believable arrival routes; never visibly spawn actors in front of the camera.
5. Suppress distractions during major mission set pieces or heavy combat.
6. Feed noise, infection, and civilian reports into local alert/response systems.
7. Despawn or simplify distant transient actors; preserve meaningful persistent results.
8. Avoid repetitive events in the same location by cooldowns and history.
9. Ensure nearby activity is recognizable, reachable, and doesn't interrupt navigation.

### Pacing targets (tunable, not mandatory timers)

| Type | Desired experience |
|---|---|
| Ambient civilians/traffic | Usually visible in populated districts. |
| Small encounter | Roughly every 15–30 seconds while casually exploring. |
| Noticeable spontaneous event | Roughly every 45–90 seconds. |
| Larger emergent incident | Roughly every 2–4 minutes. |
| Neighborhood secret | Every few blocks of curious exploration. |

Implement a pacing/interest budget and activity heatmap rather than blindly spawning at intervals. Count spontaneous cascades as active content. Silence/calm intervals remain valid when they create tension or contrast, especially in dangerous districts.

### Suggested modules (adapt to existing architecture)

```text
CityActivityDirector
  ├── DistrictStateService
  ├── AmbientPopulationManager
  ├── TrafficManager
  ├── DynamicEventScheduler
  ├── HumanResponseManager
  ├── WorldInteractionSystem
  └── WorldEventBus
```

**Event examples:** `civilianInfected`, `humanSpottedZombie`, `noiseCreated`, `vehicleIncident`, `policeCalled`, `eventStarted`, `eventFinished`, `outpostCaptured`, `districtControlChanged`, `rewardGranted`.

Prefer scoped typed events and predictable unsubscribe/cleanup to prevent duplicate listeners across reloads.

---

## 4. Expanded Reward Framework

Abilities and horde upgrades remain important **major progression rewards**, but they should no longer dominate all reward opportunities. Create a unified reward definition and grant pipeline with meaningful category-specific presentations.

### 4.1 Reward Categories

**A. Cosmetics / customization**  
Unlock hats, novelty sunglasses, Hawaiian shirts, swim trunks, shoes, backpacks, hats/props, infection particle variants, footstep styles, silly dances, victory poses, and walking style variations. The main character **starts without hat or glasses**, preserving a distinctive readable silhouette. Cosmetics should not require stats or change combat balance. Use independent equipment slots; prevent accessory clipping where feasible. Store unlocked/equipped states separately.

**B. Named collectible zombie companions**  
A small number of visually distinctive, persistent companions with personality and light utility. Suggested initial designs:
- **Larry the Lifeguard:** beach rescue station; float and whistle; comic water-related assist.
- **Chef Brainsley:** restaurant encounter; banging pans distracts humans occasionally.
- **Grandma Rot:** suburban encounter; handbags and stubborn follower behavior.

Companions are **not** ordinary disposable recruits. Provide a collection view and limited active-companion slots. If lost during an event, use a consistent recovery/respawn rule rather than permanent accidental loss. Keep utility balanced and avoid stacking overpowering buffs. Unique companion unlocks must persist.

**C. Vehicles / travel**  
Unlock discoverable or earnable, deliberately arcade-like transport:
- **Golf cart:** early-game, playful short-range travel.
- **Scooter:** quick solo roaming.
- **Ice cream truck:** noisy human-attraction gimmick.
- **Parade float:** later-game comedy vehicle accommodating followers.

Vehicles should meaningfully reduce travel downtime. Start with **one functional pilot vehicle** integrated with controls/camera/collision and a safe dismount path; add others through shared vehicle definitions. If large hordes cannot ride, they should trail/teleport/reassemble fairly rather than being stranded. Do not demand realistic driving physics.

**D. Hideouts / safehouses**  
Convert selected captured or discovered locations into persistent zombie bases (beach hotel, gas station, shopping mall, etc.). Hideouts can provide a wardrobe, garage, trophy shelf, companion collection, horde rally, and optional fast travel between unlocked locations. Keep it lightweight; no mandatory construction economy. Existing map unlocks should control fast-travel destinations as appropriate.

**E. Territory / world transformation rewards**  
The district itself changes after conquest: zombie banners, graffiti, population and event shifts, newly opened shortcuts, zombie-owned venues, new rallies/raids, and access to hideouts. These are rewards with tangible world impact — not merely achievement toast messages.

**F. Achievements and trophy collectibles**  
Implement event-driven achievements and optional showcase items. Examples:

| Achievement | Requirement | Reward |
|---|---|---|
| Tourist Trap | Infect 50 tourists | Oversized sunglasses. |
| Road Rage | Cause 10 traffic incidents | Traffic-cone hat. |
| Beach Bum | Recruit 25 beachgoers | Inflatable flamingo accessory. |
| Mall Walker | Discover shops in the mall | Shopping-cart display trophy. |
| Uninvited Guest | Crash five parties | Disco dance emote. |
| Zombie Crossing | Lead a 100-zombie horde across a major bridge | Horde banner. |
| Fine Dining | Infect 10 chefs | Chef hat. |
| Apocalypse Influencer | Interrupt 20 tourist selfies | Selfie victory pose. |

Use robust typed tracking based on events, not fragile string parsing. Make thresholds configurable and maintain achievement progress between saves. Avoid punishing players for doing events in different orders.

**G. Unlockable experiences / secrets**  
Find a zombie radio station with humorous broadcasts, sightseeing routes, recurring zombie beach parties, sewer shortcuts, a parade event, and a goofy temporary human disguise. These should be discoverable optional world content; not all require a dedicated collectible inventory item.

**H. Brains currency**  
Implement one simple earnable currency — **Brains** — from optional encounters, exploration challenges, special caches, and outposts. Spend primarily on cosmetics, vehicle personalization, hideout decorations, and animations. Keep essential mission-critical power out of mandatory grind purchases. Prevent infinite farming exploits, make costs discoverable, and use a simple shop/wardrobe interface compatible with the existing HUD style. No real-money mechanics.

### 4.2 Reward Sources

| Player behavior | Expected rewards |
|---|---|
| Explore streets, alleys, rooftops, shops | Cosmetics, secrets, rare companions, shortcuts, collectible trophies. |
| Infect/causally disrupt city life | Brains, achievement progress, optional temporary buffs, event outcomes. |
| Complete spontaneous events | Currency, cosmetic odds, discovery leads, occasionally unique rewards. |
| Attack/capture outposts | Major abilities, horde powers, control changes, hideouts, travel unlocks. |
| Take risks in harder nearby districts | Rare/interesting nonessential collectibles and advanced options. |
| Revisit controlled territory | New ambient scenes, community events, cosmetics, evolving world. |

**Illustrative reward-opportunity distribution (tune after playtesting):** 30% cosmetics/customization; 25% currency/collectibles; 15% hideouts/world changes; 15% companions/vehicles; 15% abilities/horde upgrades. This is a content mix guideline, **not** a hard per-player drop-rate or economy constraint. Do not lock unique companions or essential travel behind uncontrolled randomness; guarantee via discovery/challenges.

### 4.3 Reward Design Requirements

- Meaningful reward feedback: concise popup, icon, sound, and collection entry; no long blocking UI.
- Rewards have permanent, identifiable IDs and can be granted **exactly once** where intended.
- Separate item definitions from inventory ownership, visual equip state, and source/unlock rules.
- Do not award duplicates of unique items; use explicitly defined fallback only if desired.
- All unlocks appear in a discoverable collection/wardrobe/garage/achievement view.
- Hidden rewards may show silhouettes or hints instead of revealing secrets in advance.
- Every special reward has a reachable in-world source or an understandable challenge.
- Make new content data-driven and art-swappable without rewriting gameplay.
- Preserve progression across save/reload, including updates to the game's save schema.

---

## 5. Recommended Data Models (Illustrative)

Adapt interfaces to the project's language and architecture; these are contracts, not commands to migrate frameworks.

```ts
type DistrictAlert = 'normal' | 'concerned' | 'panic' | 'lockdown' | 'overrun';
type ControlState = 'humanControlled' | 'contested' | 'zombieInfluenced' | 'zombieControlled';
type RewardType = 'cosmetic' | 'companion' | 'vehicle' | 'hideout' | 'trophy' | 'experience' | 'currency' | 'ability' | 'hordeUpgrade';

interface DistrictState {
  id: string;
  alert: DistrictAlert;
  control: ControlState;
  heat: number;
  discoveredPOIs: string[];
  completedUniqueEvents: string[];
  unlockedShortcuts: string[];
  capturedOutposts: string[];
}

interface DynamicEventDefinition {
  id: string;
  weight: number;
  allowedDistrictTags: string[];
  requiredPOITags?: string[];
  allowedAlertLevels?: DistrictAlert[];
  cooldownSeconds: number;
  maxConcurrent: number;
  durationSeconds?: number;
  // Implement typed eligibility, spawn, lifecycle and resolution handlers.
}

interface RewardDefinition {
  id: string;
  type: RewardType;
  displayName: string;
  description: string;
  iconId?: string;
  assetId?: string;
  unique: boolean;
  sourceIds: string[];
  // Optional category-specific metadata for equip slots / vehicles / companions.
}

interface PlayerRewardState {
  brains: number;
  unlockedRewardIds: string[];
  equippedCosmeticIdsBySlot: Record<string, string | null>;
  activeCompanionIds: string[];
  achievementProgress: Record<string, number>;
  discoveredSecretIds: string[];
  unlockedHideoutIds: string[];
  unlockedVehicleIds: string[];
}
```

Ensure persistence writes happen at the right boundary (event resolution, capture, purchase), not every frame. Add schema migration/defaults for preexisting saves. Make purchases transactional in memory: check affordability and ownership, deduct currency, grant item, save; never double-charge on repeated clicks.

---

## 6. Presentation, UX, and Map Integration

The existing aesthetic is lighthearted, professionally polished 3D third-person gameplay with a bright tropical palette. Match the current HUD instead of making a separate visual style.

- **World cues:** human screams, car horns, police sirens, party music, animated crowds, smoke/dust, silly zombie groans, and readable VFX help players notice events naturally.
- **Minimap/world map:** nearby incidents may be shown subtly; don't spoil all discoveries with markers. Show revealed district control, hideouts, discovered POIs, and unlocked travel routes.
- **Reward UI:** unobtrusive discovery toast; collection screen with Cosmetics, Companions, Vehicles, Hideouts, Trophies, and Secrets (merge tabs if complexity dictates).
- **Interaction:** reuse standard controls for attacks, interaction, rally, and vehicles. Avoid `Ctrl` combinations that conflict with browser shortcuts. Ensure pointer lock, escape/menu behavior, and accessibility for basic controls.
- **Player readability:** do not bury the main zombie silhouette under large effects or cosmetics; preserve unique recognizable outline and camera focus.
- **Onboarding:** a short early free-roam situation should demonstrate infection, an environmental interaction, a spontaneous event, and finding a non-combat reward, with no lengthy tutorial overlays.

---

## 7. Technical Constraints and Performance

This is a browser-based Three.js game; implement **tiered simulation** rather than fully simulating the whole city.

- **Near zone:** complete AI, reactions, animation, collision, and interactions.
- **Mid zone:** simple movement/crowd behavior, reduced animation frequency, pooled objects.
- **Far zone:** abstract district/event state updates only; no per-frame NPC pathfinding or collision.
- Use object pooling for pedestrians, vehicles, temporary VFX, and incident props.
- Use instancing/LOD/batched rendering where current rendering architecture allows.
- Use spatial queries/cells for nearby threats, noise listeners, and active actors rather than global per-frame scans.
- Apply strict caps to active NPCs, traffic, incident participants, simultaneous responders, and concurrent dynamic events (configurable based on device quality).
- Prefer cheap state machines over heavyweight navigation or agent planners unless already in project.
- Restore/dismiss temporary entities cleanly on district transitions, death/respawn, mission start/end, and reload.
- Maintain deterministic or seeded event selection where practical for reproducible tests; do not require multiplayer synchronization unless project already supports it.
- Add debug overlays/counters for active NPCs, active vehicles, active events, alert level, current district, event cooldowns, and frame time.
- Preserve current input responsiveness, animation polish, camera handling, mission scripting, and horde command accuracy.

Do not invent fixed entity budgets without profiling. Expose defaults in config, profile target hardware, and adjust to protect frame time. Be especially cautious of draw calls, skinned meshes, pathfinding frequency, and shadow-casting lights.

---

## 8. Phased Implementation Plan for Parallel Agents

### Phase 0 — Audit and Integration Plan

**Owner:** Orchestrator/integration agent.
1. Inventory relevant existing systems, file paths, data schemas, and UI components.
2. Identify safe extension points for population, event bus, rewards, and persistence.
3. Produce short implementation map and any blocking issues.
4. Agree on shared event contracts/types before dispatching parallel tasks.

**Done when:** No duplicate engine subsystems are planned; build/tests pass at baseline.

### Phase 1 — Living Streets (highest impact)

**Agent A: Ambient city**
- Neighborhood-tagged pedestrian spawn and routines.
- Reactive fleeing and infection integration.
- Lightweight traffic pilot on existing roads.

**Agent B: World event contracts**
- Typed world events, noise/witness/incident signals.
- District-local alert and basic police response.
- Safe event subscriptions and throttling.

**Agent C: Reward framework**
- Reward definitions, unlock/inventory/save persistence, unique-grant behavior.
- Starter cosmetic catalog and wardrobe UI.
- Brains currency, with simple earn/spend flow.

**Done when:** The player can walk through a populated area, cause an infection that starts a local reaction, earn Brains, unlock/equip a cosmetic, and reload without losing progress.

### Phase 2 — Eventful Exploration

**Agent A: City Activity Director**
- Weighted event scheduling, location/POI filters, concurrency/cooldowns, spawn/cleanup, event diagnostics.

**Agent B: Event content**
- At least six initial dynamic events, including crowd, rescue, police, and traffic types.

**Agent C: Environmental interactions & horde**
- Shared world interactable API, at least four usable props, limited horde microbehaviors/rally override.

**Done when:** A tester can roam for several minutes and observe multiple distinct, believable, optional activities with no player-triggered mission; no runaway NPC growth or stuck player.

### Phase 3 — Meaningful Exploration Rewards

**Agent A: Collection/achievements**
- Achievements, progress tracking, trophy entries, a concise collection UI.

**Agent B: Discoveries/companions**
- At least two unique companion discoveries, persistent recruitment, limited active slots, recovery behavior.

**Agent C: Vehicle pilot/shortcuts**
- At least one usable vehicle with clear mount/dismount, horde handling, and saveable unlock; introduce at least one exploration shortcut.

**Done when:** Players can earn distinctive rewards from wandering without completing any outpost; companion and vehicle unlocks remain after reload.

### Phase 4 — Territorial Identity and World Change

**Agent A: District visuals**
- Two or more district archetypes with visibly different activity pools and POIs; phase in more districts via data.

**Agent B: Conquest effects/hideouts**
- Persistent control variants, at least one unlockable hideout, wardrobe/garage or fast-travel utility, and continuing post-conquest events.

**Agent C: Content polish**
- Tropical ambiance, comic audio, crowd cues, infection/VFX polish, event UI hints, balancing.

**Done when:** Capturing an outpost changes nearby streets in visible and systemic ways and unlocks a new persistent destination; previously cleared districts remain worth visiting.

### Phase 5 — Balancing and Hardening

- Tune encounter pacing, local threat escalation, rewards, spawn density, content variety, and quiet moments.
- Profile FPS, memory, draw calls, pathfinding, and GC churn during dense street incidents.
- Verify no event can trap the player, stall missions, or prevent outpost progression.
- Ensure duplicate/reload-safe rewards, old-save migration, and no earned-asset loss.
- Expand catalog with additional events, cosmetics, rare companions, vehicles, secrets, and hideouts once the systems are stable.

**Parallelization rule:** Agent-owned changes should be confined to separate modules where possible. Coordinate modifications to shared save schema, HUD, combat, and world manager through orchestrator-approved interfaces. Merge/test each phase before expanding scope.

---

## 9. Acceptance Tests and Playtest Scenarios

Automate logic where practical; supplement with manual 3D gameplay validation.

1. **Idle street:** Enter a populated district; civilians have contextual actions and traffic flows without player triggers.
2. **Infection cascade:** Infect one tourist; witnesses react; nearby zombies may investigate; police response follows at appropriate alert and after believable delay.
3. **Diverse roam:** Traverse several blocks without initiating missions; discover optional events without identical events repeating consecutively.
4. **No visible popping:** Spawn/despawn at camera edges/occluded distances; avoid actors appearing directly in front of the player.
5. **Alert escalation:** Local chaos increases district alert and changes human presence; adjacent districts do not all escalate identically without cause.
6. **Alert saturation:** At peak chaos, spawning remains capped, response is survivable, and the situation resolves or stabilizes.
7. **Conquest:** Clear an outpost; nearby control-related visuals/population/events update; revisit after save/reload and see the same control state.
8. **Cosmetic:** Find/earn a hat or sunglasses, equip/unequip without altering damage or abilities; maintain player silhouette.
9. **Achievement:** Track progress across multiple sessions; threshold grants the item exactly once.
10. **Currency:** Earn, spend, save, reload, and handle insufficient funds without duplicate items or charges.
11. **Companion:** Recruit named zombie, change active slots, recall during distraction, restore after reload.
12. **Vehicle:** Unlock and use transport, dismount safely, and rejoin/reassemble the horde reasonably.
13. **Mission safety:** Activity Director does not flood scripted outposts, steal mission NPCs, or obstruct critical paths.
14. **Cleanup:** Travel far away, reload, die/respawn, and revisit; no actor, listener, particle, or event timer leaks.
15. **Performance:** In high-density city and active-police chase, maintain existing game's reasonable target frame time on its supported device profile.
16. **Nonlinearity:** Hard and easy districts are accessible in an open pattern according to existing boundaries/visibility; no mandatory linear reward sequence is introduced.

**Human playtest question:** "While walking between two outposts, did you choose to stop and do something interesting?" If most testers answer no, improve systemic street activity before adding more mission markers.

---

## 10. Explicit Non-Goals / Scope Protection

- No full GTA simulation, real-world traffic laws, or city-scale AI for every invisible person.
- No wholesale engine rewrite, mandatory online service, or multiplayer redesign.
- No compulsory survival needs, food meters, daily login rewards, paid currency, or battle pass.
- No extreme realism, gore-heavy horror, or dark tone shift.
- No forced linear mission chain or opaque power grind.
- No requirement to build all vehicles, companions, and event examples immediately; architecture must support them, but phases specify minimum functional slices.
- No sprawling base-building system; hideouts are lightweight persistent social/customization/travel spaces.

---

## 11. Final Deliverables Expected from Coding Agent

1. Working implementation merged into existing game architecture.
2. Short architecture/implementation notes naming changed modules and event/reward APIs.
3. Editable content definitions for districts, encounters, rewards, cosmetics, achievements, and companion/vehicle unlock sources.
4. Save compatibility/migration handling, tested against existing save data if available.
5. Simple developer debug controls for event spawn, district alert, reward grant, and district-control transitions.
6. Automated tests where supported plus manual playtest checklist/results.
7. Report of actual completed features versus optional future content — **do not claim placeholder visuals or config-only examples as finished gameplay.**

### Priority Guidance

**Do these first:** pedestrians + infection response + local police + event scheduling + persistent cosmetics/currency. These create both a reason to explore and immediate rewards for interacting with the city. Then implement unique companions, a fun vehicle, district transformation, and hideouts. Expand content only after the underlying systems are reliable.

**North-star player story:** The player leaves a captured outpost, spots a tourist bus, infects a few passengers, triggers a chaotic police response, recruits a clumsy new zombie, discovers a lifeguard companion near the beach, earns goofy sunglasses, and arrives at the next stronghold with a larger, more colorful horde — all without accepting another mission.
