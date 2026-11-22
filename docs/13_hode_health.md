# Implementation Task: Replace Alpha Health with Shared Horde Strength

## Objective

Refactor the existing zombie game's health and damage system so that **Horde Strength becomes the player's only health resource**.

Remove Alpha's individual health bar and replace it with a unified Horde Strength system.

The player controls Alpha, the leader of a zombie horde. Alpha's survival depends on the strength of the zombies following him. When zombies die, Horde Strength decreases. When Alpha takes direct damage, Horde Strength also decreases, at an increased rate.

**Core rule: The horde is Alpha's health.**

This is an implementation task for the existing Three.js game. Inspect the current architecture, reuse existing systems, and preserve working gameplay mechanics.

---

# 1. Core Gameplay Requirements

## 1.1 Remove Alpha's Individual Health

Completely eliminate Alpha's independent health system as a gameplay resource.

Requirements:

- Remove the individual Alpha health bar from the HUD.
- Remove the individual Alpha health bar from any character overlays.
- Replace all player-death checks based on Alpha's individual HP.
- Remove obsolete health regeneration mechanics that only apply to Alpha.
- Update damage handlers so Alpha takes damage through Horde Strength.
- Update abilities, pickups, upgrades, and enemy attacks that interact with player health.
- Remove obsolete health state and unused UI components where safe.
- Preserve existing attack, movement, animation, and ability systems.

Do not simply hide Alpha's health bar while continuing to use the old health system internally.

The gameplay logic must actually change.

## 1.2 Horde Strength Is the Shared Health Resource

Implement a single authoritative Horde Strength system.

Horde Strength represents the combined survivability of Alpha and the zombies currently belonging to his active horde.

The system must track:

- Current Horde Strength
- Maximum Horde Strength
- Active horde population
- Individual follower health
- Damage received by Alpha
- Damage received by followers
- Strength gained through recruitment
- Strength lost through zombie deaths

Horde Strength must never exceed its maximum or fall below zero.

### Important distinction

**Horde Strength is not necessarily identical to the number of zombies.**

Individual zombies should retain their own health and combat behavior.

For example:

- Basic Zombie: 1 strength unit
- Runner Zombie: 1 strength unit
- Armored Zombie: 2 strength units
- Brute Zombie: 3 strength units

These are initial balancing examples. Adapt them to the zombie types already implemented.

Do not create new zombie types merely to support this change.

# 2. Damage Mechanics

## 2.1 Damage to Regular Zombies

When a follower is attacked:

1. Apply damage to that zombie's individual health.
2. Play the appropriate damage reaction.
3. If the zombie survives, it remains part of the horde.
4. If the zombie dies, remove it from the active horde.
5. Reduce Horde Strength by that zombie's strength contribution.
6. Update the HUD immediately.

### Example

Alpha commands 30 basic zombies.

A soldier shoots and kills one follower.

Result:

- Active zombies: 29
- Horde Strength: 29/30, assuming a maximum strength capacity of 30

Do not subtract strength for every follower hit if the follower survives, unless the existing game already has a compatible partial-damage model that can be integrated consistently.

For the initial implementation, follower strength should be removed when the follower dies.

## 2.2 Direct Damage to Alpha

When Alpha is hit, damage must be transferred to the shared Horde Strength resource.

**Alpha must not have a separate health pool.**

Direct hits to Alpha should be more dangerous than equivalent damage to regular zombies.

### Initial balancing rule

```javascript
const ALPHA_DAMAGE_MULTIPLIER = 2.5;
```

Example:

```javascript
const strengthDamage =
  incomingDamage * ALPHA_DAMAGE_MULTIPLIER;

hordeHealth.applyAlphaDamage(strengthDamage);
```

Normalize incoming damage against existing weapon damage values. A normal bullet should not automatically remove several zombies unless that is consistent with the game's overall combat balance.

The multiplier must be configurable.

### Expected behavior

- Alpha receives an enemy attack.
- Alpha reacts to the impact.
- Horde Strength decreases.
- The HUD immediately reflects the damage.
- Nearby horde members visually react.
- If shared strength reaches zero, Alpha enters the terminal survival state.

Alpha's health is entirely dependent on Horde Strength.

## 2.3 Shared Damage Must Have Visible Consequences

Direct Alpha damage should not merely reduce an abstract number.

Implement a shared damage distribution mechanism.

When Alpha receives damage:

1. Convert incoming damage into Horde Strength damage.
2. Apply the damage to eligible active horde members.
3. Prefer nearby followers as visual and logical damage recipients.
4. Animate affected followers reacting to the damage.
5. Kill followers when their individual health is depleted.
6. Recalculate Horde Strength.

The system must avoid double-counting damage.

### Important architectural requirement

There must be only one authoritative method of calculating Horde Strength.

Do not independently subtract Horde Strength and then subtract it again when a follower dies.

Use a consistent model where direct Alpha damage is distributed through follower health or a clearly defined shared damage resource.

### Suggested initial approach

Represent shared damage as accumulated depletion against follower strength contributions.

Use actual follower casualties to represent this depletion whenever possible.

If partial shared damage remains, retain it in a shared damage accumulator until enough damage has accumulated to remove a strength unit.

The exact implementation may vary depending on the current entity and damage architecture.

The final behavior must remain predictable, testable, and synchronized.

## 2.4 Area-of-Effect Damage

Explosions and other area attacks must work correctly with the new model.

Requirements:

- Each follower hit receives its normal damage.
- Alpha receives shared Horde Strength damage if directly hit.
- Damage must not be counted twice for the same entity.
- Multiple zombies can die from one explosion.
- Horde Strength updates based on the resulting casualties and shared damage.
- Existing explosion particles, knockback, and animation behavior must remain functional.

An explosion hitting Alpha and several followers should be especially dangerous.

# 3. Alpha Protection and Positioning

Alpha should benefit from having zombies physically surrounding him.

## 3.1 Horde Shielding

Implement or preserve physical shielding behavior where possible.

- Enemies should be able to hit followers before hitting Alpha.
- Followers should intercept projectiles based on actual collision geometry.
- Bullets should not automatically pass through followers to hit Alpha unless piercing behavior is intended.
- Enemy targeting should consider nearby horde members.
- Alpha should be vulnerable when positioned ahead of his horde.

Avoid artificial invulnerability.

A large horde should make Alpha safer because zombies are physically between Alpha and enemy attacks, not because Alpha has an invisible shield.

## 3.2 Direct Hits Are Always Dangerous

Even with a large horde, direct damage to Alpha must reduce shared Horde Strength.

Do not allow a large horde to completely negate direct Alpha damage.

The intended gameplay is:

- Large horde: Alpha can survive more attacks.
- Small horde: Alpha must avoid direct combat.
- No horde: Alpha is nearly defenseless.

# 4. Horde Strength Calculation

Create or refactor a centralized Horde Strength manager.

Suggested interface:

```javascript
class HordeHealthSystem {
  getCurrentStrength() {}

  getMaximumStrength() {}

  getStrengthPercentage() {}

  getActiveZombieCount() {}

  applyAlphaDamage(amount, source) {}

  applyFollowerDamage(zombieId, amount, source) {}

  registerFollower(zombie) {}

  unregisterFollower(zombieId) {}

  handleFollowerDeath(zombieId) {}

  restoreStrength(amount) {}

  isDepleted() {}
}
```

This interface is illustrative.

Adapt it to the project's current TypeScript or JavaScript patterns, ECS implementation, event bus, and entity management system.

Do not create a parallel horde manager if an existing manager can be extended.

## 4.1 Strength Contribution

Each follower should expose a strength contribution.

```javascript
zombie.hordeStrengthValue = 1;
```

For example:

```javascript
const totalStrength = activeFollowers.reduce(
  (sum, zombie) => sum + zombie.hordeStrengthValue,
  0
);
```

This represents full strength before accounting for shared damage and any additional depletion rules.

The authoritative manager must calculate the actual remaining strength.

Avoid recalculating the full follower collection every frame if a cached, event-driven approach is more efficient.

## 4.2 Maximum Strength

Maximum Horde Strength should represent the current strength capacity available to the player.

It should be affected by relevant existing upgrades.

Example:

```javascript
maxHordeStrength = baseCapacity + upgradeBonus;
```

If the game currently has horde-size limitations, preserve those restrictions.

A larger capacity does not automatically mean the player has full health.

Example:

```text
Maximum Strength: 50
Current Strength: 23
```

The HUD displays:

```text
HORDE STRENGTH
23 / 50
```

## 4.3 Recruitment Restores Strength

Recruiting new zombies is the primary way to restore Horde Strength.

When a human is converted or a stray zombie joins:

1. Register the new follower.
2. Assign its strength contribution.
3. Add its contribution to current Horde Strength.
4. Clamp the result to the configured maximum.
5. Update horde population and HUD.
6. Play a positive recruitment effect.

Existing recruitment systems must continue to function.

Recruitment must not accidentally duplicate zombies, health contributions, or rewards.

## 4.4 Healing and Regeneration

Review existing health-related mechanics.

Any item, ability, or upgrade that previously restored Alpha's health must be evaluated.

Possible conversions:

| Existing mechanic | New behavior |
|---|---|
| Alpha healing pickup | Restores shared Horde Strength |
| Health regeneration upgrade | Restores limited shared strength |
| Max health upgrade | Increases maximum Horde Strength |
| Recruit zombie | Adds follower strength |
| Horde size upgrade | Increases strength capacity |
| Defensive ability | Reduces incoming shared damage |

Important: Healing must not create invisible health that contradicts the horde's physical population.

Prefer restoring damaged followers or adding eligible followers when healing represents recruitment.

If a healing ability would require generating zombies from nothing, preserve its intended effect through a clearly defined and visually understandable mechanism.

# 5. Alpha Death and Last Brain Standing

For this implementation, use a **Last Brain Standing** mechanic.

When Horde Strength reaches zero, Alpha does not immediately die.

Instead, Alpha enters a short, desperate survival state.

## 5.1 Trigger

When Horde Strength reaches zero:

- Transition Alpha into Last Brain Standing.
- Start a configurable survival timer.
- Make Alpha vulnerable to a finishing attack.
- Notify the HUD.
- Prevent repeated depletion events from restarting the timer.

Suggested configuration:

```javascript
const LAST_BRAIN_STANDING_DURATION = 6;
```

## 5.2 During Last Brain Standing

Alpha should:

- Move faster temporarily.
- Play exaggerated panic or lurching animations.
- Lose any shared damage protection.
- Be vulnerable to a direct enemy hit.
- Have an opportunity to recruit a human or zombie.
- Display a clear countdown.

Suggested HUD:

```text
LAST BRAIN STANDING!

6... 5... 4...

FIND A BRAIN!
```

Use the existing game's lighthearted visual style.

## 5.3 Recovery

If Alpha recruits at least one valid follower before the countdown expires:

- Restore Horde Strength through the recruitment event.
- Exit Last Brain Standing.
- Return to normal gameplay.
- Resume the regular Horde Strength HUD.

Avoid immediate repeated death/recovery loops by applying a very short configurable recovery grace period if necessary.

## 5.4 Death

Alpha dies if:

- The survival countdown expires without recovering Horde Strength.
- Alpha receives a valid finishing hit while in Last Brain Standing.

Use the existing game-over sequence.

Do not implement an entirely separate death or respawn system unless necessary.

# 6. HUD and User Interface

## 6.1 Remove Existing Alpha Health Bar

Locate all Alpha/player health UI components.

Remove the independent health bar and any duplicated player-health indicators.

Do not leave unused player health UI hidden in the application.

## 6.2 Horde Strength Is the Primary Health Bar

Create or update the main HUD to show Horde Strength prominently.

Suggested appearance:

```text
☠ HORDE STRENGTH

████████████░░░░░░░░

32 / 50
```

Requirements:

- Use the game's existing fun, polished visual style.
- Make the Horde Strength bar the main survival indicator.
- Display current and maximum strength.
- Animate strength changes smoothly.
- Show damage feedback when strength decreases.
- Show positive feedback when strength increases.
- Provide a visible warning when strength is critically low.
- Avoid excessive HUD clutter.

The bar must represent remaining strength, not merely horde population.

## 6.3 Damage Feedback

When Alpha is hit:

- Briefly flash or pulse the Horde Strength bar.
- Animate the strength reduction.
- Display a subtle red damage indicator.
- Play Alpha's existing damage reaction.
- Trigger appropriate horde reactions.

When a follower dies:

- Reduce the meter.
- Play the follower death animation.
- Update the count.
- Avoid excessive screen effects during large battles.

When a zombie is recruited:

- Increase strength.
- Show a short green pulse or equivalent positive effect.
- Preserve existing recruitment feedback.

## 6.4 Critical Horde Warning

At approximately 20% Horde Strength:

- Change the HUD to a warning appearance.
- Add a subtle pulse.
- Optionally trigger an occasional funny Alpha voice line.
- Avoid constant warning sounds.

When strength reaches zero, replace the normal status with the Last Brain Standing countdown.

The system must be readable on desktop and mobile screen sizes.

# 7. Enemy AI Integration

Review enemy attack targeting and projectile systems.

Ensure enemies can continue attacking both Alpha and followers.

Requirements:

- Existing enemy weapons must use the new damage system.
- Alpha damage must route through Horde Strength.
- Follower damage must continue using individual follower health.
- Enemy target selection must remain functional.
- Projectiles must resolve their actual hit target.
- Area attacks must handle multiple targets.
- Damage from hazards, traps, and environmental sources must also be routed correctly.

No damage source should continue subtracting from Alpha's obsolete health field.

# 8. Abilities and Upgrades

Audit all current abilities and upgrades for dependencies on player health or horde population.

Pay special attention to:

- Alpha defense abilities
- Horde upgrades
- Maximum horde-size upgrades
- Damage reduction
- Regeneration
- Recruitment bonuses
- Special zombie upgrades
- Temporary invulnerability effects
- Nest upgrades
- District progression rewards

Preserve existing player progression wherever possible.

Do not reset unlocks or alter unrelated progression systems.

If a previously existing health upgrade becomes obsolete, convert it to an equivalent Horde Strength upgrade rather than silently removing player progress.

# 9. Nests, Fast Travel, and Persistence

Ensure this system integrates with the existing nest and fast-travel mechanics.

Requirements:

- Fast travel must not duplicate Horde Strength.
- Fast travel must not restore Horde Strength unless an existing explicit nest mechanic does so.
- Horde membership must stay synchronized after teleportation.
- Existing followers must retain their health and strength contributions.
- Saving and loading must preserve the authoritative Horde Strength state.
- Death and respawn must follow the game's existing progression rules.

If save data previously includes Alpha health, implement a backward-compatible migration or safe fallback.

Older saves must not crash the game.

# 10. Animation and Visual Feedback

The game uses stylized Three.js zombie characters with polished animations.

Preserve this art direction.

## Alpha Hit Animation

A direct hit should cause:

- A brief stagger.
- A visible reaction proportional to damage.
- Optional green shared-energy pulse.
- Nearby follower reactions.
- Appropriate impact sounds.

## Horde Damage Reactions

When Alpha damage causes shared strength loss:

- Followers assigned to absorb the damage should react.
- Followers that die must play their normal death animation.
- Reactions should be distributed naturally.
- Avoid killing arbitrary zombies far from Alpha when nearby valid recipients are available.

## Performance

Avoid spawning expensive particle systems for every individual damage event.

Use existing particle pooling or object pooling where available.

The game must remain responsive during large horde battles.

# 11. Implementation Architecture

The AI orchestrator should delegate work to appropriate subagents when available.

Suggested responsibilities:

### Gameplay Systems Agent

- Refactor health and damage logic.
- Implement authoritative Horde Strength calculations.
- Handle Alpha direct damage.
- Implement follower damage integration.
- Implement Last Brain Standing.

### Enemy AI Agent

- Update enemy targeting.
- Update weapon/projectile collision handling.
- Verify AoE damage behavior.
- Ensure Alpha and follower damage are correctly routed.

### UI/UX Agent

- Remove Alpha health indicators.
- Implement Horde Strength health bar.
- Add low-strength warnings.
- Add Last Brain Standing countdown.
- Ensure responsive HUD behavior.

### Animation and Effects Agent

- Add Alpha damage reactions.
- Add shared horde damage feedback.
- Add strength gain/loss effects.
- Polish Last Brain Standing animations.

### QA Agent

- Verify damage calculations.
- Test recruitment and follower deaths.
- Test depletion and recovery.
- Check persistence and upgrades.
- Run regression tests.

Agents must coordinate changes to shared source files through the orchestrator.

Avoid conflicting implementations of health state.

# 12. Required Test Scenarios

Implement automated tests where the existing project supports them, plus practical gameplay verification.

| Test | Expected result |
|---|---|
| Alpha receives bullet damage | Horde Strength decreases using multiplier |
| Follower receives nonfatal damage | Follower HP decreases; strength remains consistent |
| Follower dies | Horde Strength decreases |
| Five followers die simultaneously | All five losses reflected exactly once |
| Alpha hit by explosion | Shared damage applied once |
| Explosion hits Alpha and followers | All valid damage accounted for without duplication |
| New zombie recruited | Horde Strength increases |
| Horde reaches capacity | Strength does not exceed maximum |
| Horde Strength reaches zero | Last Brain Standing begins |
| Alpha recruits during countdown | Normal gameplay resumes |
| Alpha hit during countdown | Alpha dies |
| Countdown reaches zero | Alpha dies |
| Alpha fast travels | Horde Strength remains consistent |
| Game saved and reloaded | Strength and follower state remain consistent |
| Horde maximum upgraded | New capacity applied |
| All enemies defeated | No unwanted health changes |
| Rapid consecutive hits | Damage calculation and hit protection behave consistently |

Also verify that no code path still uses Alpha's obsolete individual health resource.

# 13. Acceptance Criteria

The implementation is complete when:

- [ ] Alpha no longer has an independent health bar.
- [ ] Alpha no longer has independent gameplay HP.
- [ ] Horde Strength is the sole normal player-survival resource.
- [ ] Direct hits on Alpha damage Horde Strength.
- [ ] Alpha damage uses a configurable multiplier.
- [ ] Follower deaths reduce Horde Strength.
- [ ] Recruitment restores Horde Strength.
- [ ] Shared damage is never double-counted.
- [ ] Horde Strength cannot become negative or exceed capacity.
- [ ] Existing zombie types continue working.
- [ ] Last Brain Standing activates at zero Horde Strength.
- [ ] Alpha can recover through recruitment during Last Brain Standing.
- [ ] Alpha dies when the countdown expires or a finishing hit lands.
- [ ] HUD displays Horde Strength instead of individual Alpha health.
- [ ] Existing abilities, upgrades, nests, and fast travel remain compatible.
- [ ] Save/load functionality is compatible with the new system.
- [ ] Existing enemy combat remains functional.
- [ ] Automated tests and relevant regression checks pass.
- [ ] No unnecessary parallel health systems are introduced.

# 14. Implementation Instructions for the Orchestrator

Follow these steps:

1. **Inspect the existing codebase.** Identify the player health component, follower health system, horde manager, damage handlers, HUD components, abilities, save/load, and death logic.

2. **Document the current damage flow.** Determine where Alpha and follower damage originate, how hit events are processed, and how zombie deaths update the horde.

3. **Choose the authoritative health model.** Establish a single source of truth for Horde Strength. Resolve how partial damage, follower casualties, recruitment, and upgrades interact.

4. **Implement the gameplay refactor.** Remove Alpha's independent HP and route its damage into the shared horde resource. Preserve follower-level combat health.

5. **Integrate all damage sources.** Update enemy attacks, explosions, hazards, abilities, and any other sources of damage.

6. **Update the HUD.** Replace player health UI with the Horde Strength bar and Last Brain Standing feedback.

7. **Implement survival and death transitions.** Ensure normal play, depletion, recovery, and death are mutually consistent states.

8. **Integrate progression and persistence.** Update abilities, upgrades, recruitment, nest travel, and saved-game state.

9. **Run tests and gameplay verification.** Fix discovered regressions and ensure damage is never duplicated.

10. **Report the completed changes.** Summarize modified files, architecture decisions, test results, and any remaining limitations.

## Architectural Priorities

Prioritize, in order:

1. Correct damage and survival behavior.
2. Consistent authoritative game state.
3. Compatibility with existing gameplay.
4. Clear player feedback.
5. Animation and visual polish.
6. Performance and maintainability.

**Do not rebuild systems unnecessarily. Do not create a separate competing health implementation. Make the smallest coherent architectural changes that fully implement shared Horde Strength.**

## Final Gameplay Principle

The player should think:

**"My horde is my life. Every zombie I lose brings me closer to death, and every zombie I recruit makes me stronger."**

Alpha must feel like the leader of a living, vulnerable horde—not a traditional action-game character with followers who merely provide extra firepower.