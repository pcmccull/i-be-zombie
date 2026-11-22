# Zombie Apocalypse — 3D Model, Texture & VFX Overhaul

## Mission
Upgrade the existing Three.js continuous-city reverse tower-defense zombie game from primitive low-poly visuals to polished, textured, stylized 3D art with expressive animation and responsive particle effects. Preserve all gameplay, collision, AI, district progression, camera, and controls. Deliver an incremental, testable implementation—not just concept art.

## Visual direction
- **Style:** stylized semi-realistic tropical Miami, readable from an elevated third-person/top-down gameplay camera; saturated but controlled colors, soft shapes, strong silhouettes, believable surface detail.
- **Tone:** humorous, mischievous zombie apocalypse, not horror or gore. Tourists and everyday residents should be recognizable through clothing and props.
- **Reference quality:** cohesive premium indie game, not raw primitives, noisy procedural textures, or photorealistic scans.
- **Readability:** prioritize silhouette, faction colors, movement and attack telegraphs over microdetail. The player's zombie must be recognizable without relying on hats or glasses; those are optional unlockable cosmetics.
- **Consistency:** enforce a shared palette, texel density, material roughness range, and lighting response across characters, props and districts.

## Non-negotiable engineering constraints
1. Audit the current repository and rendering pipeline first; identify Three.js version, bundler, existing loaders, animation rigs, pooling, instancing, shadow setup, and game state integration.
2. Retain existing entity IDs, transforms, collision footprints, navigation, spawn logic, abilities, hit timing, save format, and gameplay APIs. Build adapters where necessary.
3. Avoid generating all geometry every frame. Use cached geometries/materials, instancing for repeated static props, object pools for transient effects, and controlled LODs for crowds.
4. Prefer glTF 2.0/GLB assets with PBR materials, shared rigs where feasible, texture atlases, and compressed textures (KTX2/Basis where supported). Document any asset licensing and source files.
5. Provide graceful fallback assets when external models/textures fail to load. No invisible player or blocking load failures.
6. Do not introduce mandatory paid asset services, remote runtime asset generation, or unreviewed dependencies.
7. Keep combat effects comedic and non-graphic. Avoid realistic dismemberment and excessive blood.

## 1. Character art pipeline
### Player zombie — hero asset
- Unique outline from an asymmetric shoulder posture, exaggerated forward lean, uneven arm carriage, one distinctive oversized hand, and a playful shambling gait.
- Expressive face: large slightly mismatched eyes, slack grin, subtle cheek details; readable at normal camera zoom.
- Clothing: distressed but colorful tourist shirt and shorts with fabric folds, seams, stitching and tasteful dirt. No starting hat or glasses.
- Material breakup: skin subsurface-like softness (approximated with PBR color/roughness), fabric weave/normal detail, rubber shoes, eye gloss, restrained edge wear.
- Support modular cosmetic attachment slots for later hats, glasses, shirts, backpacks, and ability accessories without changing the base silhouette.
- Maintain selection/highlight indicator visible in dense hordes, but do not rely on it as the sole identification mechanism.

### Horde zombies
- At least 6 distinct body silhouettes, 8 clothing palettes, and several hair/skin/accessory variants; use deterministic variant seeds to reduce repetition.
- Shared skeleton and compatible animations when practical. Avoid creating unique high-cost skinned meshes for every distant follower.
- Zombie poses should be off-balance and lurching, with staggered timing and subtle head/arm offsets. Keep silhouettes friendly/funny rather than frightening.
- LOD tiers: near = full textured/skinned model; medium = reduced mesh/material complexity and animation rate; far = simplified impostor or lightweight animated model where visually acceptable.

### Humans
- Distinct tourist, local resident, worker, security guard, and defender archetypes.
- Readable outfit/material cues (Hawaiian shirts, beachwear, casual wear, uniforms, gear). Diversity in silhouettes, skin tones, hairstyles and accessories.
- Distinct run, panic, alert, attack, and hit reactions; maintain clear defender identification.

### Asset specifications (initial targets, adjust after profiling)
| Asset | Near triangle target | Textures | Notes |
|---|---:|---|---|
| Player | 8k–18k | 1–2 × 1024–2048 atlas | Highest fidelity, face detail |
| Near NPC | 4k–10k | 1 × 1024 atlas | Shared materials/rigs |
| Mid NPC | 1.5k–4k | 512–1024 | Reduced bones/materials |
| Far NPC | <1.5k or impostor | 256–512 | Minimize animation cost |
| Hero prop | 2k–8k | 512–1024 | Context-dependent |
| Repeated prop | 200–2k | Shared atlas | Instance when possible |

These are starting budgets, not blanket guarantees; frame-time profiling is authoritative.

## 2. Animation and secondary motion
- Blend idle → shamble → fast shamble → sprint/charge; include turns, acceleration, stops, hit recoil, knockback, attack windup, impact, recovery, and death/despawn.
- Separate locomotion and upper-body attacks where rig supports it. Keep foot contacts believable; reduce foot sliding with speed-aware animation playback.
- Randomize phase, cadence, torso sway, head bob and arm swing per zombie using seeded offsets.
- Add subtle facial expression and eye tracking for hero close-ups; disable expensive face motion at distance.
- Synchronize hit effects and sound with actual gameplay hit events, not arbitrary animation timestamps. Ensure animation never changes authoritative collision or damage calculations.
- Test dense crowd movement and avoid identical synchronized walking cycles.

## 3. Materials and textures
- Use physically based MeshStandardMaterial or MeshPhysicalMaterial selectively; define base color, roughness, normal, AO and metalness only where useful.
- Build coherent texture sets for skin, clothing, roads, sidewalks, stucco walls, glass, concrete, sand, foliage, metal and plastic.
- Roads: cracks, patches, lane paint, tire marks, curb grime. Sidewalks: joint lines, stains and edge wear. Buildings: sun-faded paint, window trim, signage, awnings and balconies.
- Tropical foliage: broad leaves, color variation, wind motion and well-controlled alpha overdraw.
- Avoid noisy detail that turns into visual shimmer from the gameplay camera. Use mipmaps, anisotropy where appropriate, and tuned normal strength.
- Correct color management: sRGB for color/emissive textures; linear for normal/roughness/metalness/AO. Validate tone mapping and exposure.
- Use texture atlases and compression; document texture memory and draw-call impacts.

## 4. Tropical city environment
- Upgrade the existing continuous 16-district city in place. Maintain district layout, traversable paths, outposts, gates, fences, debris, and map visibility/eyesight mechanics.
- Create modular building kits: hotels, beach shops, apartments, diners, gas stations, parking garages, security checkpoints and outposts.
- Add recognizable tropical details: palms, planters, pastel stucco, colorful awnings, streetlights, signage, beach umbrellas, parked cars and scattered litter.
- Each district gets a distinct palette and density profile without becoming a separate level. Dangerous districts should visually signal increased threat through barricades, floodlights, patrol equipment and damage.
- Map boundaries must be physically legible through fences, collapsed structures and debris—not featureless gray blocks.
- Use decal-like projected markings or mesh decals sparingly; prevent z-fighting.
- Implement reusable environmental prop variants and instanced placement where suitable.

## 5. Particle effects and combat feedback
Create a reusable pooled `VFXManager` with an event-based API and quality presets. Effects should be visible, punchy, colorful and brief.

| Event | Visual treatment | Behavior |
|---|---|---|
| Zombie footsteps | Tiny dust/sand puffs | Surface-aware; suppressed on clean interiors |
| Player attack swing | Short translucent motion arc | Follows actual attack direction; brief fade |
| Successful hit | Stylized impact burst, spark/star shapes | Emit at hit point; small screen shake only for nearby major hits |
| Zombie recruitment | Swirling green/teal wisps and quick pulse | Clearly distinguishes recruitment from damage |
| Horde rally | Expanding ring + upward arrows/wisps | Communicates area of influence |
| Horde charge | Trailing dust and short speed streaks | Scales with moving units; strict cap |
| Defender gunfire | Muzzle flash, limited smoke, shell glint | Short-lived; no overwhelming strobe |
| Bullet/environment impact | Dust, chips, brief sparks | Depends on struck material |
| Barricade destruction | Wood/concrete fragments and dust cloud | Use pooled debris with bounded physics |
| Vehicle explosion | Stylized flash, smoke, embers | Avoid long-lived expensive particles |
| Ability unlock | Distinct celebratory burst | Clear but does not obscure play |
| Ambient tropical city | Palm leaf motes, litter, insects, occasional mist | Low density; camera-aware |

### VFX implementation rules
- Favor instanced quads, batched meshes, shader-driven particles or a proven lightweight particle system compatible with the existing stack. Do not instantiate hundreds of separate Mesh objects per burst.
- Particle components: emitter config, spawn rate/burst, lifetime, position/velocity, gravity, drag, size/opacity/color over life, rotation, collision approximation, blend mode and max particle count.
- Use soft particles or depth fading if feasible; otherwise avoid hard intersection artifacts.
- Keep transparent overdraw and sorting under control. Prefer additive blending for sparse sparks; alpha blending for smoke/dust with low screen coverage.
- Recycle particles on completion. Despawn all effects on scene unload and district transitions.
- Add distance culling and per-effect budgets. Do not spawn individual footstep particles for every far zombie.
- Support low/medium/high quality presets and reduced-motion settings (less camera shake, flashes and screen effects).
- Make combat cues faction/ability-specific, not dependent on color alone.

## 6. Lighting, atmosphere and postprocessing
- Establish a warm Miami daytime baseline: directional sunlight, soft ambient/hemisphere fill, subtle contact grounding, realistic but stylized shadow contrast.
- Improve palm/tree/building shadow quality selectively. Only nearby important characters and structures should cast expensive dynamic shadows; bake or fake others.
- Add tasteful ambient haze and distance fog while respecting the game's gameplay visibility/eyesight restrictions. Never reveal hidden district geometry or enemies through atmospheric effects.
- Optional sunset/night palette variants with clear outpost lighting, but no forced dynamic day-night cycle unless one already exists.
- Postprocessing: restrained ambient occlusion, color grading, antialiasing and optional bloom on specific emissive effects. Avoid overbloom, strong chromatic aberration, motion blur or heavy depth of field during gameplay.
- Keep gameplay silhouettes legible against bright pavement and busy tropical backgrounds.

## 7. Performance and scalability
- Establish a repeatable benchmark scene with player, 100 nearby zombies, 100 humans, urban props, active combat and simultaneous VFX. Also test a heavier stress scenario with 250+ zombies.
- Target desktop 60 FPS at 1080p on a documented midrange GPU; provide a configurable 30 FPS fallback for lower-powered hardware. Treat these as targets to verify, not assumed results.
- Track median and 95th-percentile frame time, GPU time if available, draw calls, triangles, texture memory estimate, active skinned meshes, shadow casters and particle count.
- Use frustum/distance culling, instancing, shared materials, mesh LOD, reduced animation update frequency, and adaptive particle limits.
- Avoid shader compilation spikes during combat: prewarm common materials and effects when feasible.
- Load district assets progressively and dispose unneeded GPU resources safely; preserve a small cache for adjacent districts.
- Add a developer debug overlay and automated reproducible benchmark route or scripted scene.

## 8. Suggested architecture
```text
src/graphics/
  assets/AssetRegistry.ts
  assets/CharacterFactory.ts
  assets/EnvironmentFactory.ts
  materials/MaterialLibrary.ts
  animation/CharacterAnimationController.ts
  animation/AnimationLOD.ts
  vfx/VFXManager.ts
  vfx/EmitterPool.ts
  vfx/effects/*.ts
  lighting/LightingController.ts
  postfx/PostProcessingPipeline.ts
  performance/GraphicsQuality.ts
  performance/GraphicsDiagnostics.ts
```

Adapt names, language and paths to the actual codebase. Do not rewrite the game engine or introduce a second renderer.

Example integration contract (illustrative):
```ts
vfx.emit('zombie.recruited', { position, entityId, intensity: 1 });
vfx.emit('combat.hit', { position, normal, surface: 'cloth', faction: 'human' });
vfx.emit('horde.charge', { position, radius, unitCount });
```
Subscribe to existing game events; do not duplicate authoritative game state inside the rendering system.

## 9. Parallel AI-agent workstreams
### Agent A — Character models and materials
Audit current meshes; implement player, zombie and human model pipeline, variant system, asset registry, LOD-ready GLB imports, cosmetic attachment points and fallback models. Deliver visual comparison screenshots and memory/draw-call metrics.

### Agent B — Animation polish
Implement locomotion blends, lurching variation, attack synchronization, hit reactions and animation LOD. Coordinate skeleton/clip naming contracts with Agent A. Deliver side-by-side gameplay capture of idle, movement, turning and combat.

### Agent C — Environment art
Build modular tropical environment materials, buildings, roads, foliage, props and boundary debris. Maintain navigation/collision and existing district progression. Deliver a representative street benchmark scene.

### Agent D — Particle and combat VFX
Implement pooled VFXManager, recruitment/attack/hit/charge/destruction/ambient effects, quality scaling, event adapters and cleanup. Deliver effect gallery/test scene and worst-case particle metrics.

### Agent E — Lighting, postprocessing and optimization
Own tone mapping, shadows, fog, postprocessing, quality settings, LOD/culling integration, diagnostics and benchmark harness. Coordinate visual consistency and enforce performance gates.

### Orchestrator responsibilities
1. Audit existing code and publish interfaces, file ownership, event names, asset naming conventions and a shared art bible before parallel implementation.
2. Establish one integration branch and separate worktree/branch per agent. Prevent conflicting edits to shared render-loop and scene initialization files.
3. Integrate in order: asset pipeline → hero model → animation → environment → VFX → lighting/postprocessing → profiling and polish.
4. Require every agent to supply runnable code, tests, screenshots/captures, asset provenance, performance notes and integration instructions.
5. Run the actual game after each merge. Reject changes that break gameplay or fail resource cleanup.

## 10. Implementation phases
**Phase 0 — Baseline and art bible:** screenshot current game; capture frame-time metrics; inspect existing assets; lock palette, camera-distance readability, naming conventions, performance budgets and event interfaces.

**Phase 1 — Hero quality slice:** one polished player zombie, two horde variants, one human, one Miami street block, three effects (attack hit, recruitment, footsteps), baseline lighting. Validate art direction at actual gameplay zoom before scaling up.

**Phase 2 — Asset and animation expansion:** all character archetypes, variant combinations, shared rigs, animations, modular environment kits and district visual identities.

**Phase 3 — Full VFX and atmosphere:** complete event library, lighting, weather/ambient touches, destruction, ability visuals, quality presets and reduced-motion options.

**Phase 4 — Optimization and release gate:** benchmark dense crowds, fix leaks/stutters, tune LOD and particle budgets, verify lower-quality modes and document limitations.

## 11. Acceptance criteria
- [ ] Player is unmistakable without hats/glasses at normal gameplay zoom and within a dense horde.
- [ ] Characters no longer look like default primitives; visible model detail, intentional textures and cohesive PBR shading.
- [ ] Zombies lurch with varied timing and smooth movement/attack transitions; no obvious mass synchronization or severe foot sliding.
- [ ] Human archetypes and defenders are recognizable by silhouette and outfit.
- [ ] At least one polished representative tropical block demonstrates roads, buildings, palms, signage and environmental texture quality before mass rollout.
- [ ] All VFX listed above are event-driven, pooled, capped, and correctly cleaned up.
- [ ] Recruitment, damage, rally and charge effects are immediately distinguishable during active play.
- [ ] Existing 16-district map, vision progression, outposts, collision, saves, combat and controls remain functional.
- [ ] No visible asset-loading failures; fallback visuals work.
- [ ] Quality presets and reduced-motion options function.
- [ ] Performance results are measured and documented against the baseline and stress scene; regressions are explained or corrected.
- [ ] All new asset licenses/provenance and runtime dependencies are documented.

## Definition of done
This task is complete only when the improvements are integrated into the playable Three.js game, visible in actual gameplay at normal camera zoom, pass regression checks, and include before/after captures plus benchmark measurements. Concept mockups, disconnected demos and unintegrated asset files do not count as completion.
