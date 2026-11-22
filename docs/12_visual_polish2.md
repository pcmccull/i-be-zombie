# AI Coding Agent Task: 3D Geometry, Character Rigging & City Environment Overhaul

## 1. Objective

Transform the existing Three.js zombie game from a basic low-poly environment into a **polished, stylized 3D open-world city** with smooth character meshes, skeletal animation, modular architecture, and rich environmental detail.

The game is a lighthearted, humorous zombie action/strategy game set in a colorful, tropical, Miami-inspired city.

**The goal is not photorealism.** The desired visual quality is a polished, stylized 3D game with appealing proportions, expressive characters, detailed buildings, smooth geometry, and a believable, densely populated urban environment.

The current environment feels too primitive, with box-shaped buildings, simple geometry, repetitive houses, and insufficient environmental detail.

Improve the actual geometry and world composition rather than attempting to hide primitive models behind better materials.

### Core requirements

1. Replace visibly primitive character geometry with smooth, cohesive 3D meshes.
2. Implement skeletal rigs with bones and skinning for characters.
3. Build a reusable, modular building construction system.
4. Create varied architecture using shared geometry components.
5. Increase urban density and environmental storytelling.
6. Improve streets, sidewalks, landscaping, and transitions between buildings.
7. Maintain excellent browser performance with large zombie hordes.
8. Preserve existing gameplay, collision systems, navigation, and world progression.

---

## 2. Art Direction

### Visual target

Create a visual style combining:

- Smooth, stylized 3D character geometry.
- Exaggerated, cartoon-like proportions.
- Colorful tropical urban architecture.
- Detailed environments without excessive visual clutter.
- Soft, attractive lighting and shadows.
- Expressive character animations.
- High-quality but performance-conscious geometry.

Think of a polished animated 3D world rather than a collection of geometric primitives.

### Geometry standards

Avoid using individual cubes, spheres, and cylinders as the final visible representation of complex objects.

Primitive geometry may be used as a starting point or as invisible collision geometry, but finished visible assets should have intentional silhouettes and appropriately modeled details.

Use:

- Custom BufferGeometry where appropriate.
- Smooth vertex normals and controlled hard edges.
- Bevels on architectural elements.
- Curved geometry where visually appropriate.
- Proper mesh topology.
- Shared and instanced geometry.
- Procedural mesh generation for repeatable structures.
- LOD systems for distant geometry.

**Important:** Smooth shading alone does not fix poor silhouettes. Improve mesh topology and geometry where necessary.

---

# 3. Character Geometry Overhaul

## 3.1 Replace Primitive Character Models

Refactor existing character generation into a reusable character construction system.

Characters should have:

- Smooth, rounded heads.
- Properly shaped torsos.
- Defined shoulders and hips.
- Organic arms and legs.
- Hands and feet.
- Necks and joints.
- Expressive facial geometry.
- Distinct silhouettes.

Avoid characters that look like disconnected spheres and cylinders.

Create cohesive meshes with anatomically plausible, stylized proportions.

### Zombie design

Zombies should look funny and approachable rather than frightening.

Visual characteristics:

- Slightly oversized heads.
- Rounded shoulders.
- Slouched posture.
- Long, dangling arms.
- Asymmetrical body shapes.
- Comically awkward proportions.
- Large, expressive eyes.
- Slightly exaggerated hands and feet.
- Varied clothing and body types.

Create multiple zombie body archetypes, such as:

- Average zombie.
- Tall, skinny zombie.
- Short, round zombie.
- Heavy zombie.
- Fast, lanky zombie.

Use the same underlying animation architecture where practical.

### Player character

The player zombie must have a distinctive silhouette that remains recognizable even when surrounded by dozens of followers.

Use unique body proportions, posture, head shape, and animation personality.

Do not rely exclusively on clothing color to distinguish the player.

The initial player character should not have a hat or glasses. These may be introduced later as collectible cosmetic items.

---

# 4. Skeletal Rigging and Animation

## 4.1 Implement Real Skeletal Animation

Replace rigid, disconnected limb animation with proper skeletal animation.

Use Three.js:

- `THREE.Bone`
- `THREE.Skeleton`
- `THREE.SkinnedMesh`
- `THREE.SkeletonHelper`
- `THREE.AnimationMixer`
- `THREE.AnimationClip`
- `THREE.AnimationAction`

Build a reusable humanoid rig.

### Suggested bone hierarchy

```text
Root
└── Hips
    ├── Spine
    │   └── Chest
    │       ├── Neck
    │       │   └── Head
    │       ├── LeftShoulder
    │       │   └── LeftUpperArm
    │       │       └── LeftForearm
    │       │           └── LeftHand
    │       └── RightShoulder
    │           └── RightUpperArm
    │               └── RightForearm
    │                   └── RightHand
    ├── LeftUpperLeg
    │   └── LeftLowerLeg
    │       └── LeftFoot
    └── RightUpperLeg
        └── RightLowerLeg
            └── RightFoot
```

Add additional bones only where they meaningfully improve animation.

## 4.2 Skinning Requirements

Character geometry must deform naturally around joints.

Implement:

- Appropriate vertex skin weights.
- Smooth deformation at shoulders.
- Smooth elbow bending.
- Proper knee bending.
- Hip and torso deformation.
- Neck movement.
- Shoulder rotation.

Avoid visible gaps between body segments.

Avoid rigid limbs rotating like mechanical components.

Procedurally generated meshes must include correct skin indices and weights. Alternatively, use properly rigged GLB assets where that produces better results.

## 4.3 Animation Library

Create reusable animations for:

| Animation | Description |
|---|---|
| Idle | Subtle swaying, breathing, head movement |
| Walk | Slow, uneven zombie shuffle |
| Run | Comical, uncontrolled forward movement |
| Attack | Lunging arms and upper-body movement |
| Bite | Forward head and torso motion |
| Hit reaction | Stagger and recoil |
| Death | Exaggerated collapse |
| Rise | Getting up from the ground |
| Celebrate | Funny victory movement |
| Follow | Walking with slight individual variation |
| Turn | Natural torso and head rotation |

### Animation quality

Animations should include:

- Secondary motion.
- Weight shifting.
- Anticipation.
- Follow-through.
- Asymmetrical movement.
- Smooth state transitions.
- Slight timing variations between zombies.

Do not animate every zombie identically.

Use deterministic variations in animation speed, phase, posture, and movement style.

### Performance

Large hordes must remain efficient.

Investigate:

- Shared animation clips.
- Animation LOD.
- Reduced update frequency for distant characters.
- GPU skinning.
- Instanced skinned meshes where supported.
- Batched animation updates.

Do not assume ordinary `InstancedMesh` provides independent skeletal animation. Implement a compatible technique or use a proven library if required.

---

# 5. Modular Building Architecture System

## 5.1 Replace Box-Based Buildings

The city currently looks like a handful of boxy houses.

Replace this with a modular procedural building system.

Buildings should have architectural identity, recognizable silhouettes, and meaningful geometric detail.

**Do not simply place windows on rectangular boxes and consider the building complete.**

Develop a library of reusable components that can be combined into different building styles.

## 5.2 Reusable Building Components

Create reusable components for:

### Structural geometry

- Foundations.
- Floor sections.
- Wall panels.
- Corner sections.
- Roof systems.
- Parapets.
- Columns.
- Balconies.
- Staircases.
- Exterior corridors.
- Overhangs.
- Canopies.
- Awnings.
- Terraces.

### Facade details

- Window frames.
- Window sills.
- Window trim.
- Recessed windows.
- Glass storefronts.
- Doors and door frames.
- Garage doors.
- Decorative wall panels.
- Railings.
- Shutters.
- Building signs.
- Exterior lighting.
- Air-conditioning units.
- Drainpipes.
- Roof vents.

### Roof components

- Flat roofs.
- Sloped roofs.
- Tile roofs.
- Rooftop mechanical equipment.
- Water tanks.
- Satellite dishes.
- Solar panels.
- Rooftop patios.

Components should expose configurable dimensions, materials, orientation, and placement rules.

## 5.3 Building Archetypes

Implement at least the following reusable building archetypes.

| Archetype | Visual characteristics |
|---|---|
| Tropical bungalow | Porch, sloped roof, shutters, landscaping |
| Art Deco hotel | Rounded corners, vertical accents, stepped roofline |
| Apartment building | Multiple floors, balconies, repeating windows |
| Convenience store | Large storefront windows, signage, awnings |
| Restaurant | Outdoor seating, patio, decorative entrance |
| Office building | Glass sections, structured facade, rooftop equipment |
| Warehouse | Loading bays, industrial doors, ventilation |
| Gas station | Canopy, pumps, convenience store |
| Beachfront shop | Colorful facade, awnings, signs |
| Parking garage | Open floors, ramps, guardrails |
| Luxury villa | Terraces, pool, decorative walls |
| Municipal building | Larger footprint, prominent entrance |

Each archetype should support procedural variation.

## 5.4 Procedural Building Generator

Create a configurable generator.

Example:

```typescript
interface BuildingConfig {
  archetype: BuildingArchetype;
  width: number;
  depth: number;
  floors: number;
  floorHeight: number;
  roofStyle: RoofStyle;
  facadeStyle: FacadeStyle;
  colorPalette: string;
  windowPattern: WindowPattern;
  balconyFrequency: number;
  entranceStyle: EntranceStyle;
  seed: number;
}
```

The generator should construct buildings from reusable geometry modules.

### Variation requirements

Support variation in:

- Footprint.
- Height.
- Roof silhouette.
- Facade composition.
- Window placement.
- Balcony arrangement.
- Building color.
- Decorative trim.
- Entrances.
- Signage.
- Rooftop details.

Avoid randomization that produces architecturally nonsensical structures.

Use archetype-specific constraints so each generated building remains believable.

**Buildings should look intentionally designed, not randomly assembled.**

---

# 6. Increase World Density

## 6.1 Make the City Feel Complete

The environment should resemble a believable urban neighborhood rather than isolated buildings on a flat surface.

Increase the density of:

- Buildings.
- Street furniture.
- Landscaping.
- Sidewalk details.
- Storefronts.
- Parking areas.
- Utility infrastructure.
- Architectural decorations.

Use coherent urban planning rules rather than uniformly distributing objects.

## 6.2 Street-Level Environment

Implement reusable assets for:

### Roads and sidewalks

- Curbs.
- Sidewalk segments.
- Crosswalks.
- Lane markings.
- Manholes.
- Storm drains.
- Road patches.
- Driveways.
- Intersections.
- Median strips.
- Traffic islands.

### Street furniture

- Streetlights.
- Traffic signals.
- Road signs.
- Bus stops.
- Benches.
- Trash cans.
- Mailboxes.
- Newspaper stands.
- Bicycle racks.
- Fire hydrants.
- Bollards.
- Planters.

### Tropical vegetation

- Multiple palm tree varieties.
- Flowering shrubs.
- Decorative bushes.
- Grass clusters.
- Tropical flowers.
- Hedge sections.
- Planter boxes.
- Vines.
- Small ornamental trees.

Vegetation should have smooth, attractive shapes with appropriately modeled leaves and trunks.

Avoid making trees from a single cylinder and a few flat triangles.

### Urban clutter

Add tasteful, context-aware details:

- Dumpsters behind businesses.
- Trash bags in alleys.
- Delivery crates.
- Outdoor restaurant tables.
- Patio umbrellas.
- Parked bicycles.
- Shopping carts.
- Utility boxes.
- Construction barriers.
- Fences.
- Decorative signs.

These details should help communicate what each location is used for.

---

# 7. District-Level Architectural Identity

The game contains a large, non-linear city with at least 16 districts.

Districts should not all look the same.

Create reusable district style configurations controlling:

- Building archetype distribution.
- Building density.
- Average building height.
- Road widths.
- Sidewalk styles.
- Color palettes.
- Vegetation density.
- Signage styles.
- Street furniture.
- Environmental clutter.

Examples:

**Beachfront District:** Pastel hotels, restaurants, palm trees, beachfront shops, outdoor patios.

**Residential District:** Bungalows, apartments, driveways, fences, gardens.

**Downtown District:** Taller commercial buildings, dense storefronts, parking garages, narrow alleys.

**Industrial District:** Warehouses, loading docks, storage yards, utility infrastructure.

**Entertainment District:** Clubs, restaurants, neon signs, outdoor seating, colorful storefronts.

Each district should have recognizable landmarks and visual identity.

Use district-specific styles while maintaining a consistent overall art direction.

---

# 8. Improve World Composition

## 8.1 Eliminate Empty Spaces

Identify large, visually empty areas.

Fill them with purposeful content appropriate to the surrounding district.

Examples:

- Small parks.
- Parking lots.
- Courtyards.
- Alleyways.
- Outdoor markets.
- Construction sites.
- Basketball courts.
- Gas stations.
- Plazas.
- Small commercial clusters.

Avoid filling every empty space with random props.

Use density, composition, and recognizable landmarks to create interesting exploration.

## 8.2 Better Building Placement

Buildings should form coherent streets and blocks.

Implement:

- Consistent street frontage.
- Reasonable building setbacks.
- Shared walls where appropriate.
- Varied building heights.
- Corner buildings.
- Narrow side alleys.
- Courtyards.
- Parking access.
- Logical entrances.

Do not scatter isolated buildings across large empty lots unless the area specifically calls for that arrangement.

## 8.3 Vertical Detail

Improve visual complexity through multiple height layers.

For example:

- Street-level props.
- Ground-floor storefronts.
- Upper-floor balconies.
- Rooftop structures.
- Signs and overhead infrastructure.

The environment should feel detailed when viewed both from street level and from the game's normal third-person camera.

---

# 9. Materials, Lighting and Geometry Integration

Although this task focuses on geometry, materials and lighting must support the new mesh quality.

Use:

- Appropriate roughness and metalness.
- Smooth shading on organic surfaces.
- Hard normals on intentionally sharp edges.
- Subtle material variation.
- Ambient occlusion where practical.
- Soft shadows.
- Consistent color palettes.
- Proper UV mapping.

Use bevels and actual geometry to catch highlights.

Do not use excessive textures to compensate for weak geometry.

Avoid expensive material features that offer little improvement at the normal gameplay camera distance.

---

# 10. Performance and Scalability

The city must remain performant in a browser.

The game may contain many active zombies and a large number of visible buildings.

### Required optimization techniques

Implement where appropriate:

- Shared `BufferGeometry`.
- `InstancedMesh` for repeated static objects.
- Geometry merging for compatible static meshes.
- Frustum culling.
- Distance-based LOD.
- Spatial chunking.
- Chunk-based loading and unloading.
- Texture atlases.
- Shared materials.
- Reduced draw calls.
- Animation LOD.
- Asset caching.
- Object pooling.

### Geometry budgets

Define measurable budgets for:

- Player character.
- Nearby zombies.
- Distant zombies.
- Small buildings.
- Large buildings.
- Street furniture.
- Vegetation.
- Visible city chunks.

Determine budgets using profiling rather than arbitrary polygon targets.

Maintain a higher level of detail for the player and nearby characters.

### Chunk management

The existing city is large and continuous.

New building systems must integrate with the current world streaming architecture.

Use deterministic generation so reloaded chunks reproduce the same buildings and environmental details.

Avoid regenerating geometry unnecessarily.

---

# 11. Reusable Code Architecture

Organize the new systems into reusable modules.

Suggested structure:

```text
src/
  graphics/
    geometry/
      MeshUtils
      GeometryFactory
      SmoothMeshBuilder
      GeometryCache

    characters/
      CharacterFactory
      CharacterMeshBuilder
      CharacterRig
      CharacterAppearance
      CharacterAnimationController
      CharacterLOD

    buildings/
      BuildingFactory
      BuildingGenerator
      BuildingArchetypes
      BuildingComponents
      FacadeGenerator
      RoofGenerator
      BuildingMaterials

    environment/
      RoadGenerator
      SidewalkGenerator
      StreetFurnitureFactory
      VegetationFactory
      UrbanDetailGenerator

    world/
      DistrictStyleConfig
      CityBlockGenerator
      EnvironmentPopulation
      ChunkGeometryManager
      WorldLODManager
```

Adapt these modules to the existing project architecture rather than blindly creating a duplicate system.

Prefer composition over large inheritance hierarchies.

Each visual component should have a clearly defined interface and be reusable across multiple assets.

---

# 12. Preserve Existing Gameplay

This is a visual and architectural improvement project, not a gameplay rewrite.

Do not break:

- Player movement.
- Zombie following behavior.
- Horde mechanics.
- Combat.
- Human AI.
- Outpost attacks.
- District progression.
- Collision detection.
- Navigation and pathfinding.
- Camera controls.
- Nest locations.
- Fast travel.
- Save/load functionality.

If visual geometry changes, keep collision geometry and navigation data synchronized.

Use simplified invisible collision geometry where appropriate.

Do not use complex visual meshes as physics colliders unless necessary.

---

# 13. Implementation Strategy

Implement incrementally rather than rewriting the entire rendering system at once.

## Phase 1 — Audit

Inspect the existing codebase.

Identify:

- Primitive character geometry.
- Existing animation architecture.
- Building generation code.
- Repeated meshes.
- World generation logic.
- Rendering bottlenecks.
- Existing collision dependencies.

Document findings and identify components that can be reused.

## Phase 2 — Character Geometry

Create a polished player zombie mesh.

Implement proper topology, skeletal rigging, and animation blending.

Validate deformation during movement and attacks.

Use the player as the quality benchmark for other humanoid characters.

## Phase 3 — Reusable Character System

Extend the character system to followers and humans.

Implement body variations and shared rigs.

Optimize animation for large hordes.

## Phase 4 — Building Component Library

Create modular architectural components.

Build several visually distinct buildings using shared components.

Verify that components can be recombined without visible seams or architectural inconsistencies.

## Phase 5 — Procedural Building Generation

Implement archetypes and controlled variation.

Replace existing primitive buildings while preserving their gameplay positions and collision behavior.

## Phase 6 — Urban Environment

Improve roads, sidewalks, landscaping, and street furniture.

Add context-aware environmental details.

Increase density without blocking gameplay routes.

## Phase 7 — District Identity

Apply distinct architectural styles across the city.

Add recognizable landmarks and neighborhood-specific details.

## Phase 8 — Optimization and Polish

Profile rendering and animation performance.

Implement LOD, instancing, caching, and chunk optimization.

Correct visual artifacts, animation problems, and environmental inconsistencies.

---

# 14. Visual Quality Acceptance Criteria

The implementation is not complete until these conditions are satisfied.

### Characters

- [ ] Player geometry is smooth and cohesive.
- [ ] Character silhouettes are visually appealing.
- [ ] Arms and legs deform naturally.
- [ ] Characters use skeletal animation.
- [ ] Zombies have expressive, varied movements.
- [ ] Player remains recognizable inside a large horde.
- [ ] No obvious gaps appear at animated joints.

### Buildings

- [ ] Buildings no longer resemble plain rectangular boxes.
- [ ] At least 12 distinct building archetypes are supported.
- [ ] Architectural components are reusable.
- [ ] Buildings have meaningful geometric detail.
- [ ] Roofs, entrances, windows, and facades are varied.
- [ ] Building generation is deterministic.
- [ ] Buildings have recognizable architectural styles.

### Environment

- [ ] Streets feel like part of a real city.
- [ ] Sidewalks contain appropriate urban details.
- [ ] Large empty areas have purposeful content.
- [ ] Vegetation is varied and visually polished.
- [ ] Districts have recognizable visual identities.
- [ ] Building placement follows believable urban patterns.
- [ ] The city feels substantially fuller at normal gameplay camera distance.

### Engineering

- [ ] Geometry is reused where possible.
- [ ] Rendering remains performant.
- [ ] Existing gameplay is preserved.
- [ ] Collision and navigation remain functional.
- [ ] World generation remains deterministic.
- [ ] Existing saves remain compatible or are safely migrated.
- [ ] No significant memory leaks are introduced.

---

# 15. Required Validation

Before declaring completion:

1. Capture before-and-after screenshots from identical camera positions.
2. Compare the player and follower characters up close.
3. Inspect animated joints for deformation problems.
4. Compare residential, commercial, and downtown environments.
5. Test building variation across multiple generated city blocks.
6. Test large zombie hordes during active combat.
7. Profile frame time, draw calls, triangle counts, and memory usage.
8. Test world chunk loading and unloading.
9. Verify navigation and collision after building replacements.
10. Test save/load and nest fast travel across districts.

Provide a short implementation report identifying completed work, remaining limitations, and measured performance changes.

---

# 16. Final Direction to the AI Coding Orchestrator

**Prioritize visible improvements to geometry and city composition over superficial effects.**

The primary problem is that the current game looks like simple primitive shapes placed on a mostly empty map.

The finished game should feel like a complete, colorful, professionally designed 3D zombie world.

Characters should have smooth geometry, expressive skeletal animation, and recognizable personalities.

Buildings should be constructed from reusable architectural components with meaningful variation, not simply resized cubes.

The city should have dense, interesting streets, distinctive neighborhoods, believable urban layouts, and environmental details that reward exploration.

Do not stop after creating a few demonstration assets. Integrate the new systems into the actual playable world.

Preserve the game's humorous identity, existing mechanics, and browser performance throughout the implementation.