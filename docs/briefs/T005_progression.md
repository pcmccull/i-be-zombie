# T005 — Progression: biomass, unlocks, loadout, Frenzy, Brutes (codex)

Read first: `AGENTS.md`, `.agent-context/{ARCHITECTURE,MEMORY,PROGRESS}.md`, `docs/3_open_world.md` §4E, `src/core/types.ts`
(ProgressionState, AbilityDef/AbilityId, ZombieAgent `brute`, SimInput `abilitySlot`/`equip`, events `abilityUnlocked`, `abilityEquipped`,
`abilityUsed`, `abilityDenied`, `biomassGain`, `frenzyStart/End`, `bruteEvolved`), `src/core/contracts.ts` (ProgressionSystem section),
`src/content/abilities.ts`, `src/config/balance.ts` (`progression`, `frenzy`, `brute`, `nest`), the stub `src/systems/ProgressionSystem.ts`,
`src/systems/ConquestSystem.ts` (`isNestActive` — read only), `src/entities/Zombie.ts`.

## Locked files
`src/systems/ProgressionSystem.ts`, `src/entities/Zombie.ts`, `tests/progression.test.ts` (new). Nothing else.

## Deliver (all exports listed in contracts.ts, same signatures)
- `addBiomass` (keep), `isUnlocked`, `isEquipped`, `canActivate` → `AbilityDenyReason | null` in order: `empty`/unknown, `locked`, not
  activatable (`locked`), `cooldown`, `biomass`, `noTarget` (brute: no eligible non-brute follower or `maxBrutes` reached).
- `activateAbility(ctx, id)`: atomic check ⇒ spend ⇒ cooldown ⇒ effect; emits `abilityUsed` or `abilityDenied{reason}`; returns success.
  - `horde_frenzy`: `frenzyTimeLeft = frenzy.duration`, emit `frenzyStart{pos, radius}`. `hordeSpeedMultiplier` / `hordeAttackRateMultiplier`
    return `frenzy.speedMultiplier` / `attackRateMultiplier` while active, else 1 (HordeSystem/Combat call them; radius filtering is a
    HordeSystem concern — note it in the report).
  - `brute_evolution`: converts up to `brute.maxPerActivation` nearest non-brute followers (bounded by biomass: `costPerBrute` each, and by
    `maxBrutes` living brutes) via a new `evolveToBrute(z)` in `Zombie.ts` (brute = true, hp/maxHp `brute.maxHp`, radius `brute.radius`,
    speedScale × `brute.speedMultiplier`); spends `costPerBrute × converted`; emits `bruteEvolved` per brute. Partial affordability converts
    fewer; zero ⇒ denied `biomass`.
- `unlockAbility(ctx, id)`: idempotent; false if already unlocked; innate abilities are always unlocked; slot abilities auto-equip into the
  first empty slot; emits `abilityUnlocked{abilityId, slot}` exactly once.
- `equipAbility(ctx, slot, id|null)`: valid slot index; id unlocked with `slotBehavior 'slot'`; leader alive and within `nest.equipRadius` of an
  active nest (`isNestActive`); equipping an ability already in another slot moves it (no duplicates); emits `abilityEquipped`; denied ⇒
  `abilityDenied{reason:'notAtNest'|'locked'}` and false.
- `updateProgression(ctx, dt, input)`: tick cooldowns (clamp 0), `input.abilitySlot` ⇒ activate the equipped ability (empty slot ⇒ denied
  `empty`; non-activatable like alpha_claws ⇒ no-op, no event), `input.equip` ⇒ `equipAbility`, frenzy timer ⇒ `frenzyEnd` once.
- Invariants (test them): biomass never negative; no double spend when activated twice in one step; cooldown can't be bypassed; unlock once;
  equipped length always `progression.slots`.
- `tests/progression.test.ts` using `new Simulation()` (legacy layout has a start nest at `playerStart`).

## Done when
`npx tsc --noEmit` and `npm test` pass. Report `.agent-context/reports/T005-codex.md` (AGENTS.md format), MEMORY notes.
