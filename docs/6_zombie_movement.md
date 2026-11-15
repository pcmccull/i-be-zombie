# AI Coding Agent: Zombie Character Animation and Visual Polish

## Objective

Upgrade the existing zombie character models, textures, and animation systems to achieve polished, professional-quality movement and appearance.

**Zombies are the visual centerpiece of this game.** Unlike distant background NPCs, the player zombie and their followers remain visible throughout gameplay, often at close range. Their animation quality, silhouettes, materials, and movement personality must reflect this importance.

The goal is to create zombies that feel like shambling, lurching, physically deteriorated humans rather than ordinary characters walking slowly.

Maintain the existing **Three.js, low-poly, stylized 3D aesthetic** with a colorful tropical Miami-inspired environment.

Do not replace the existing game architecture unnecessarily. Inspect the current character rendering, animation, and movement systems before implementing improvements.

---

## 1. Zombie Movement Personality

The most important requirement is that zombies must not move like healthy humans.

Their movements should communicate:

- Poor balance and coordination
- Uneven, irregular footsteps
- Forward-leaning posture
- Stiff or partially immobilized joints
- Delayed reactions and momentum
- Asymmetrical body movement
- Occasional stumbling and recovering
- An unnatural but recognizable walking rhythm

### Lurching Locomotion

Implement a distinctive zombie locomotion system.

**Body posture**
- Torso leans forward approximately 8–18 degrees, varying by zombie.
- Head hangs slightly forward or tilts to one side.
- Shoulders are uneven and slightly hunched.
- Arms hang asymmetrically or reach loosely forward.
- Knees remain slightly bent.

**Walking**
- Uneven stride lengths.
- One leg may drag or swing outward.
- Footsteps have slight irregular timing.
- Torso shifts side-to-side with each step.
- Hips rotate subtly to compensate for poor balance.
- Head movement lags behind torso movement.
- Arms swing with imperfect coordination.

**Lurching**
- Periodically shift the upper body forward as though losing balance.
- Follow with a quicker corrective step.
- Use smooth transitions rather than sudden position jumps.
- Avoid excessive bouncing or exaggerated cartoon motion.
- Keep movement readable and controlled.

**Movement speed**
- Slow movement should feel heavy and unstable.
- Normal movement should resemble a determined zombie shuffle.
- Fast movement should feel like an uncontrolled, aggressive stagger rather than a human sprint.

The player must remain responsive to controls even when the animation visually suggests poor coordination.

### Procedural Animation

Use a hybrid of skeletal animation and procedural adjustments where practical.

Consider:
- Sinusoidal gait cycles with asymmetric phase offsets
- Layered torso sway
- Secondary head motion
- Shoulder rotation
- Arm lag
- Foot planting and ground alignment
- Subtle randomized movement variation

Avoid a single shared animation that makes every zombie move identically.

Use deterministic per-zombie parameters so movement personality remains stable instead of changing randomly every frame.

---

## 2. Animation State System

Implement or improve a reusable animation state machine.

Required states:

| State | Animation behavior |
|---|---|
| Idle | Unsteady stance, breathing, head droop, occasional twitch |
| Walk | Slow uneven shuffle with foot dragging |
| Fast Walk | Aggressive forward lurch with longer strides |
| Turn | Torso and head rotate with subtle delayed follow-through |
| Attack | Reach, swipe, bite, or overhead strike |
| Hit Reaction | Directional stagger and partial loss of balance |
| Stunned | Temporary imbalance and recovery |
| Knockdown | Fall to ground with appropriate body movement |
| Get Up | Awkward, uncoordinated recovery |
| Death | Collapse with varied believable poses |
| Horde Follow | Walking while maintaining awareness of leader |
| Horde Attack | Aggressive movement toward nearby human targets |

### Animation Blending

All transitions should blend smoothly.

Requirements:
- No snapping between animation states.
- No sudden limb rotation resets.
- No teleporting feet during transitions.
- Avoid feet sliding excessively across the ground.
- Preserve continuous movement when changing direction.
- Blend animation intensity based on actual movement speed.
- Attack animations must synchronize with gameplay hit timing.

Prioritize the states most frequently seen during normal gameplay: **idle, walking, turning, fast walking, and attacking**.

---

## 3. Improve Character Models and Silhouettes

Inspect the current zombie models and improve their visual quality.

Maintain low-poly geometry but introduce enough anatomical detail for convincing close-up animation.

### Model Requirements

- Recognizable head, neck, shoulders, torso, pelvis, arms, and legs.
- Properly articulated elbows, knees, wrists, and ankles where supported.
- Hands should be distinguishable from simple blocks.
- Clothing should have visible shape and layering.
- Limbs should have believable proportions, with some intentional zombie deformities.
- Avoid rigid, toy-like silhouettes.
- Preserve consistent scale and collision behavior.

### Zombie Variations

Introduce visual variation through modular features and material choices.

Examples:
- Former beach tourist wearing a Hawaiian shirt
- Office worker with torn business clothing
- Lifeguard wearing faded beach attire
- Construction worker with damaged safety vest
- Casual city resident in shorts and a T-shirt
- Police officer with damaged uniform
- Athletic zombie in sportswear

Variation should also affect movement.

Examples:
- Injured-leg zombie drags one foot.
- Stiff-armed zombie holds one arm unnaturally.
- Heavy zombie has pronounced torso sway.
- Thin zombie has a twitchier, more irregular gait.
- Recently infected zombie moves faster and more deliberately.

Avoid creating entirely separate animation systems for every variation. Prefer configurable animation profiles.

---

## 4. Texture and Material Improvements

Upgrade character materials to look polished when viewed close to the camera.

The desired appearance is **stylized low-poly with high-quality materials**, not photorealistic horror.

### Skin

Implement variation in zombie skin tones and deterioration.

Use:
- Desaturated green-gray skin
- Pale bluish skin
- Sickly yellow-green tones
- Muted purple-gray undertones
- Darkened areas around eyes
- Subtle discoloration around wounds

Skin should have controlled roughness and soft shading.

Avoid uniform flat green materials.

### Facial Details

Faces should remain readable at typical gameplay camera distances.

Add:
- Sunken or darkened eye sockets
- Cloudy or asymmetrical eyes
- Uneven mouth shapes
- Slightly exposed teeth
- Small facial wounds
- Distinctive brow and cheek shapes

Do not rely on tiny details that disappear at gameplay scale.

### Clothing

Clothing should communicate the character's former human identity.

Improve:
- Fabric color variation
- Torn edges and damaged hems
- Dirt and grime
- Faded patterns
- Subtle blood stains
- Wrinkles through geometry or textures
- Separation between clothing and skin materials

Use tropical colors that contrast with the deteriorated zombie appearance.

### Material Quality

Prefer `MeshStandardMaterial` or compatible physically based materials.

Where appropriate, support:
- Albedo/base color
- Roughness
- Normal maps
- Ambient occlusion
- Limited emissive effects for special zombie types

Avoid excessively glossy, plastic-looking surfaces.

Use texture atlases and shared materials where beneficial to performance.

---

## 5. Secondary Motion and Character Personality

Add subtle animation details that make zombies feel alive—or technically undead.

### Idle Behaviors

Each zombie should occasionally perform variations such as:
- Head twitch
- Jaw opening
- Shoulder spasm
- Unsteady weight shift
- Brief forward slump
- Arm twitch
- Slow head rotation
- Slight backward sway followed by recovery

These should be occasional and independently timed.

Avoid constant exaggerated twitching.

### Head and Upper Body

The head should have subtle delayed movement when the character turns.

The torso should react to:
- Acceleration
- Deceleration
- Sharp turns
- Attacks
- Collisions
- Knockback

Use spring-like interpolation or damped procedural offsets where appropriate.

### Attack Motion

Zombie attacks should feel forceful but uncoordinated.

For example:
1. Zombie notices a nearby human.
2. Torso leans forward.
3. Shoulder and arm pull backward.
4. Zombie lunges and reaches toward target.
5. Arm follows through.
6. Zombie briefly loses balance.
7. Zombie recovers into movement or another attack.

Include visual anticipation and follow-through.

Hit detection must occur at the correct point in the animation, not simply when the attack starts.

---

## 6. Horde Animation Variety

A major goal is making groups of zombies look like a chaotic undead crowd rather than synchronized soldiers.

### Requirements

Each zombie should have persistent variation in:
- Walking cycle phase
- Stride length
- Torso lean
- Head tilt
- Arm position
- Walking speed
- Sway amplitude
- Stumble frequency
- Animation playback rate

Use subtle differences that preserve the overall zombie identity.

### Horde Behavior

When following the player:
- Zombies should move independently.
- They should not walk in synchronized formation.
- They should naturally turn toward their destination.
- They should avoid overlapping where practical.
- They should not repeatedly stop and restart animations.
- Followers should maintain continuous gait cycles while navigating.

When the player stops:
- Followers should gradually settle.
- Some should continue shifting weight.
- Others may twitch or look around.
- The horde should feel restless rather than frozen.

---

## 7. Player Zombie: Hero-Level Polish

The player-controlled zombie requires the highest animation quality.

The player character is always visible and should receive additional attention.

### Player-Specific Requirements

- Smooth movement transitions
- Responsive turning
- High-quality attack animation
- Distinctive idle stance
- Visually clear movement speed
- Convincing upper-body motion
- Improved facial and clothing detail
- Strong silhouette against city environments

### Responsiveness

The animation must never make controls feel sluggish.

Use visual anticipation and follow-through without adding unnecessary input latency.

The player should respond immediately to directional input, while the torso, arms, and head may exhibit delayed secondary motion.

Do not introduce animation-driven movement that conflicts with existing player controls unless the current architecture explicitly supports it.

---

## 8. Performance and Rendering

The game is a browser-based Three.js experience and must support sizable zombie hordes.

### Optimization Strategy

Use multiple quality levels.

**Near camera**
- Full skeletal animation
- Detailed materials
- Procedural secondary movement
- Facial details
- Higher-quality geometry

**Medium distance**
- Simplified animation
- Reduced secondary motion
- Lower-detail meshes
- Shared materials

**Far distance**
- Simplified geometry
- Minimal animation updates
- Reduced material complexity
- Instancing where practical

Avoid creating large numbers of unnecessary draw calls or unique textures.

Reuse:
- Geometry
- Materials
- Animation clips
- Texture atlases
- Skeleton definitions where appropriate

Implement distance-based update scheduling for expensive procedural animation.

Do not sacrifice nearby character quality merely to support distant hordes.

### Performance Target

Aim for smooth 60 FPS on a typical desktop browser with at least 50 visible zombies, subject to the existing game's rendering budget.

Measure performance rather than assuming optimizations are effective.

---

## 9. Implementation Approach

### Phase 1: Audit

Inspect:
- Existing character geometry
- Animation implementation
- Player movement controls
- Horde movement logic
- Material definitions
- Texture handling
- Existing animation assets
- Rendering and performance characteristics

Identify which systems can be improved and which need replacement.

### Phase 2: Movement Foundation

Implement:
- Improved zombie posture
- Asymmetric gait
- Torso sway
- Head lag
- Arm motion
- Smooth turning
- Animation state blending

Validate with the existing player zombie before applying to the entire horde.

### Phase 3: Visual Upgrade

Improve:
- Character proportions
- Skin materials
- Facial features
- Clothing details
- Texture quality
- Zombie variants

### Phase 4: Horde Integration

Apply the improved animation system to followers.

Introduce persistent variation and animation profiles.

Preserve existing pathfinding, targeting, and gameplay behavior.

### Phase 5: Performance Optimization

Profile and optimize the upgraded system.

Implement appropriate LOD and animation update strategies.

### Phase 6: Final Polish

Review characters at:
- Idle
- Slow movement
- Fast movement
- Sharp turns
- Attacking
- Following in a large horde
- Taking damage
- Dying

Inspect at both normal gameplay zoom and close-up camera distances.

---

## 10. Acceptance Criteria

The implementation is complete when:

- [ ] Zombies visibly lurch and shuffle rather than walking like normal humans.
- [ ] Walking is asymmetrical and physically convincing.
- [ ] Torso, head, arms, and legs exhibit coordinated but imperfect movement.
- [ ] Feet remain reasonably planted without obvious sliding.
- [ ] Animations transition smoothly without snapping.
- [ ] The player character remains responsive.
- [ ] Nearby zombie models look polished rather than primitive.
- [ ] Skin and clothing materials show visible detail.
- [ ] Zombie variations are visually distinct.
- [ ] Zombies in a horde do not move in synchronization.
- [ ] Attacks have anticipation, impact, and follow-through.
- [ ] Idle zombies continue subtle movement.
- [ ] Existing combat and navigation functionality remain intact.
- [ ] Performance remains acceptable with 50 or more visible zombies.
- [ ] No new browser console errors are introduced.

---

## 11. Visual Quality Standard

The target should feel like a polished indie action game with expressive, stylized 3D characters.

Avoid:
- Generic humanoid walking cycles
- Perfectly synchronized crowds
- Rigid arms and legs
- Floating or sliding feet
- Excessive procedural jitter
- Plastic-looking materials
- Identical character silhouettes
- Animation transitions that snap
- Overly exaggerated cartoon movement
- Unnecessary photorealistic detail

**The key visual test:**

If the player watches ten zombies walking across the street without any combat occurring, their movement alone should immediately communicate that they are zombies.

Each should appear to have its own damaged body, uneven gait, and unsettling personality.

The movement should be entertaining to watch even when nothing else is happening.

---

## 12. Agent Execution Instructions

Implement improvements directly in the existing codebase.

1. Inspect the current architecture before making changes.
2. Reuse existing systems and assets where appropriate.
3. Prioritize the player character and nearby followers.
4. Implement a reusable zombie animation controller.
5. Keep animation parameters configurable rather than hard-coded throughout the codebase.
6. Do not break existing controls, combat, navigation, or progression.
7. Avoid introducing heavyweight dependencies unless clearly justified.
8. Add appropriate tests for animation transitions and movement integration.
9. Profile rendering performance after implementation.
10. Provide a summary of modified files, new systems, performance observations, and any remaining limitations.

**Priority order:**

1. Convincing lurching movement
2. Smooth and responsive animation
3. Improved close-up character models
4. Better skin and clothing materials
5. Distinctive zombie variations
6. Horde animation diversity
7. Performance optimization

Do not consider this task complete after simply adding random head bobbing or changing character colors. The objective is a substantial improvement in the perceived quality of the zombies.