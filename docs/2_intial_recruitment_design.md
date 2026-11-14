# I BE ZOMBIE — Early Gameplay & Horde Recruitment Improvements

## Objective

Improve the opening gameplay of **I BE ZOMBIE**, a Three.js low-poly 3D zombie horde game set in a GTA-style urban environment.

Currently, the beginning feels too slow because the player spends too much time running around collecting individual zombies before engaging in combat.

**The goal is to make the first 60–90 seconds exciting by turning recruitment into a fast, satisfying outbreak that naturally transitions into combat.**

Implement the following improvements within the existing game architecture. Preserve working mechanics, visuals, controls, and systems wherever possible. Do not rebuild the game or introduce unnecessary dependencies.

## 1. Redesign the Opening Experience

The player should experience recruitment, combat, and human conversion almost immediately.

### Target opening sequence

| Time | Gameplay |
|---|---|
| 0–10 seconds | Player starts with 5 zombies and encounters 2 vulnerable humans |
| 10–25 seconds | Player recruits nearby zombies through a cascading chain reaction, growing to approximately 20 |
| 25–45 seconds | Player encounters a lightly defended barricade with 2 armed humans |
| 45–90 seconds | Player discovers a small fortified convenience store or checkpoint |

These times are pacing targets, not scripted requirements.

The gameplay should remain interactive and player-driven. Do not automatically teleport the player, force encounters, or spawn zombies directly into the player's horde to satisfy these targets.

### Implementation requirements

- Spawn the player with 5 zombies already following.
- Position an immediately visible encounter near the starting location.
- Arrange recruitment opportunities along natural routes toward the first outpost.
- Ensure players can quickly discover additional zombies without extensive searching.
- Keep the opening compact and action-oriented.
- Preserve freedom to explore and approach objectives differently.

**Acceptance criteria:** A new player should encounter meaningful activity within 10 seconds and be able to assemble approximately 30–50 zombies within the first minute through reasonably effective play.

## 2. Implement Cascading Zombie Recruitment

Replace exclusively player-proximity-based recruitment with a chain-reaction recruitment system.

### Desired behavior

When wandering zombies join the player's horde, they should briefly attract nearby unconverted, recruitable zombies.

Example:

1. Player approaches 3 wandering zombies.
2. Those zombies join the horde.
3. Their recruitment pulses attract 5 nearby zombies.
4. The newly recruited zombies attract additional nearby zombies.
5. The player experiences a visually satisfying outbreak spreading through the neighborhood.

### Implementation requirements

- Preserve existing player-proximity recruitment.
- Each newly recruited zombie emits one recruitment pulse.
- Recruitment pulses trigger after a short staggered delay, approximately 100–300 ms.
- Use a configurable pulse radius, initially 8–12 world units.
- Allow recruitment to cascade through nearby groups.
- Limit cascade depth to approximately 2–3 generations.
- Respect the existing maximum horde size.
- Prevent recruitment loops and repeated pulses from the same zombie.
- Avoid recruiting zombies through substantial solid barriers or inaccessible buildings.
- Use existing spatial queries or efficient nearby-entity lookups rather than checking every zombie against every other zombie each frame.

### Visual feedback

Recruitment should be noticeable and satisfying.

Add lightweight effects such as:

- Newly recruited zombies briefly flashing or highlighting.
- A subtle circular pulse originating from recruited zombies.
- Zombies turning toward and accelerating toward the horde.
- Small particle effects or a brief recruitment indicator.
- A responsive horde counter that visibly increases as recruitment spreads.

Keep effects consistent with the existing low-poly art style. Avoid excessive particle systems or post-processing that significantly reduces performance.

## 3. Add Environmental Recruitment Opportunities

Make city exploration more interactive by introducing locations that contain groups of zombies.

These should become recognizable opportunities to rapidly grow the horde.

### Abandoned bus

- Place an abandoned bus in an accessible area.
- Contain approximately 10–15 recruitable zombies.
- Allow the player or horde to break its doors or another obvious weak point.
- Release the zombies once the obstruction is destroyed.
- Released zombies automatically become eligible for recruitment.
- Provide visible damage feedback and a recognizable release animation.

### Locked alley

- Create an alley containing approximately 15–20 trapped zombies.
- Block access with a destructible gate or fence.
- Allow the horde to attack and destroy the obstruction.
- Released zombies become recruitable through normal mechanics.
- Ensure the alley remains navigable after the gate is destroyed.

### Civilian building

- Add a small storefront or shelter containing vulnerable humans.
- Allow the horde to breach an entrance.
- Humans react according to existing AI behavior.
- Defeated humans use the existing conversion mechanics.
- Converted humans join the player's horde.

Reuse the game's existing destructible structure, collision, navigation, and human conversion systems where possible.

### Design requirements

- Make these opportunities visible from nearby streets.
- Use environmental storytelling rather than lengthy tutorial prompts.
- Reward exploration without making recruitment feel like repetitive collection tasks.
- Avoid making players wait through long destruction animations.
- Ensure released zombies can navigate out of their containment areas.

## 4. Improve Zombie Distribution and Encounter Placement

The initial map should contain recognizable zombie clusters instead of evenly distributed wandering zombies.

Use the existing urban environment and adapt its spawn configuration.

### Target distribution

| Location | Zombie count | Risk |
|---|---:|---|
| Starting intersection | 5 followers | None |
| Parking lot | 12 | Low |
| Abandoned bus | 15 | Low |
| Locked alley | 20 | Medium |
| Police barricade | 10 trapped | High |

Counts are balancing targets and may be adjusted to fit the existing map.

### Placement rules

- Concentrate zombies around intersections, parking lots, abandoned vehicles, and buildings.
- Place early groups along likely player routes.
- Make at least one large recruitment opportunity visible from the starting area.
- Use zombie animations, sounds, and movement to draw attention toward groups.
- Avoid excessive empty travel time between encounters.
- Preserve meaningful navigation choices and multiple approaches to outposts.

The player should regularly see an interesting destination while moving through the city.

## 5. Implement Outbreak Momentum

Introduce a lightweight momentum mechanic that rewards continuous aggressive play.

Momentum increases through recruitment, conversions, and successful attacks.

It gradually decreases during inactivity.

### Momentum values

Use a normalized range of 0–100.

Suggested gains:

| Event | Momentum gained |
|---|---:|
| Recruit wandering zombie | +1 |
| Convert human | +3 |
| Defeat armed human | +5 |
| Destroy defensive structure | +10 |

Prevent double-counting events. If defeating a human and converting them are separate events, awarding both is intentional.

### Momentum effects

Use continuous scaling rather than abrupt permanent bonuses.

At 100 momentum:

- Recruitment radius increases by up to 50%.
- Horde movement speed increases by up to 20%.

Example formulas:

```typescript
const recruitmentMultiplier = 1 + momentum * 0.005;
const speedMultiplier = 1 + momentum * 0.002;
```

Momentum should decay gradually following a short inactivity grace period.

Make gain, decay, and multiplier values configurable.

### HUD

Add a compact momentum indicator near the horde counter.

Use three descriptive states:

- **Dormant:** 0–29
- **Growing Outbreak:** 30–69
- **Full Outbreak:** 70–100

Display smooth meter changes and clear feedback when momentum increases.

Do not clutter the screen or obscure combat.

**Important:** Momentum should reward aggressive play without creating an exhausting timer. Players must still be able to slow down, scout defenses, and make tactical decisions.

## 6. Improve Horde Responsiveness

As recruitment becomes faster, ensure the horde can keep up with the player.

Review the existing follower movement system and address the following:

- Newly recruited zombies should quickly move toward the player.
- Followers should maintain natural separation without forming long single-file lines.
- Zombies should navigate around buildings, cars, and barricades.
- Fast-moving players should not permanently lose followers because they fall behind.
- Zombies should regroup after combat.
- Horde movement should remain stable when dozens of zombies join simultaneously.
- Avoid excessive crowd jitter, clustering, and collision deadlocks.

Use shared navigation, spatial partitioning, and lightweight steering where appropriate.

Do not implement expensive independent pathfinding for every zombie every frame.

Preserve the game's existing movement and navigation architecture unless a targeted improvement is necessary.

## 7. Performance Requirements

The game uses Three.js with low-poly 3D characters and a stylized GTA-like urban setting.

The new mechanics must remain performant as horde sizes increase.

Requirements:

- Maintain a target of 60 FPS with approximately 100 zombies on a typical desktop.
- Avoid per-frame allocations where practical.
- Use efficient proximity queries for recruitment.
- Avoid redundant navigation calculations.
- Reuse visual effects and temporary objects through pooling where appropriate.
- Avoid unnecessary dynamic lights and expensive particle systems.
- Prevent memory leaks from timers, event listeners, effects, and removed entities.
- Ensure recruitment chains and momentum events do not produce runaway processing.

Where possible, extend existing performance tests or add stress tests for large recruitment events.

## 8. Implementation Order

Implement the changes in the following order, ensuring the game remains playable after each stage.

### Phase 1 — Opening pacing

- Start with 5 followers.
- Add an immediate human encounter.
- Move early zombie groups closer to the starting area.
- Reduce empty travel time.

### Phase 2 — Recruitment chain reactions

- Implement cascading recruitment.
- Add recruitment pulse effects.
- Improve horde-counter feedback.
- Verify recruitment limits and obstacle behavior.

### Phase 3 — Environmental encounters

- Add abandoned bus recruitment.
- Add locked alley recruitment.
- Add a civilian building encounter.
- Update local navigation after obstacles are destroyed.

### Phase 4 — Outbreak Momentum

- Implement momentum events and decay.
- Apply recruitment and movement bonuses.
- Add momentum HUD.
- Tune balance with the faster opening.

### Phase 5 — Polish and testing

- Improve follower responsiveness.
- Tune the first 90 seconds.
- Test large recruitment chains.
- Fix collision, navigation, and combat issues.
- Verify consistent performance.

## 9. Acceptance Criteria

Consider the implementation complete when all of the following are true:

- [ ] Player starts with 5 zombies already following.
- [ ] The first human encounter is accessible within approximately 10 seconds.
- [ ] Recruitment can cascade naturally through nearby zombie groups.
- [ ] Recruitment never exceeds the horde capacity.
- [ ] Chain reactions do not create infinite loops.
- [ ] An abandoned bus can release recruitable zombies.
- [ ] A locked alley provides an additional recruitment opportunity.
- [ ] A civilian building allows combat and human conversion.
- [ ] Zombie groups are positioned around meaningful city landmarks.
- [ ] Momentum responds to recruitment, combat, and conversions.
- [ ] Momentum bonuses and decay operate correctly.
- [ ] Horde navigation remains functional with rapid recruitment.
- [ ] A reasonably effective player can build a horde of 30–50 zombies in approximately 60 seconds.
- [ ] The original outpost assault gameplay continues to work.
- [ ] The game runs without new console errors or significant performance regressions.

## 10. Implementation Constraints

Follow these rules throughout development:

1. **Inspect the existing codebase first.** Understand current player controls, AI, horde behavior, combat, spawning, navigation, and HUD systems before modifying them.
2. **Build on existing systems.** Do not rewrite working components unnecessarily.
3. **Preserve the visual style.** All additions must match the low-poly Three.js environment and existing character designs.
4. **Keep gameplay player-driven.** Do not use scripted cinematics or automatic battle outcomes to simulate engaging gameplay.
5. **Use configurable balancing values.** Keep radii, cooldowns, damage, momentum values, and recruitment limits centralized rather than scattering magic numbers throughout the code.
6. **Avoid feature creep.** Do not introduce crafting, inventory, multiplayer, additional levels, or unrelated progression systems.
7. **Test the full gameplay loop.** Verify recruitment, movement, attacking, conversion, death, and victory conditions together.
8. **Complete the implementation.** Do not stop at scaffolding, placeholder functions, or partially connected gameplay systems.

## 11. Final Deliverables

When implementation is complete:

- Provide a concise summary of changes made.
- Identify the primary files and systems modified.
- Document any new controls.
- Report build, test, and lint results.
- Identify any known limitations or incomplete functionality.
- Confirm that the game can be launched and played using the existing project workflow.

## Final Design Principle

**Collecting zombies should feel like causing an outbreak, not collecting coins.**

The player should spend the beginning of the game creating chaos, growing their army, fighting humans, and making meaningful choices.

The early experience should transition naturally from a small group of zombies into a threatening horde capable of overwhelming fortified human positions.

Prioritize responsiveness, visual satisfaction, fast recruitment, and engaging combat over additional features.