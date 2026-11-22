# HH-T008 — orchestrator

- **Task ID & Agent:** HH-T008, orchestrator
- **Status:** COMPLETED

## Completed Work
- `src/core/types.ts`: `LeaderState extends Omit<MobileBase, 'hp' | 'maxHp'>` — any leftover Alpha HP read is now a compile error.
- `src/config/balance.ts`: removed `leader.maxHp` and the unused `guard.leaderTargetChance` (T004 made guards always pick the nearest threat).
- `src/entities/ZombieLeader.ts`: `createLeader` no longer initialises hp/maxHp.
- `tests/shielding.test.ts` (T004 file, after T003): `damageLeader` spies now `mockImplementation` where they assert follower
  hp is untouched (the real `damageLeader` shares damage to nearby followers since T003); the clear-line test keeps a real spy.
- Docs: AGENTS.md (directory map, "Horde Strength" conventions, step order 12a), README (leader row), CLAUDE.md checkbox,
  ARCHITECTURE §HH status.

## Browser playtest (dev :5173, open world)
- Beach solo: HUD "HORDE STRENGTH 6 / 6"; `damageLeader(40)` ⇒ coreDamage 2.5, strength 3.5, bar shows 4/6.
- Depletion ⇒ Last Brain: red vignette + "LAST BRAIN STANDING! 6… FIND A BRAIN!", counts down; finishing hit after entry
  grace ⇒ leaderDied ⇒ respawning ⇒ respawn with core full (6/6).
- Nest claim ⇒ 10 followers, strength/max 16/16; `damageLeader(10)` ⇒ nearest follower (2.3 m) 40 → 15 hp, core untouched.
- Mobile 375 × 812 with touch layout: strength bar + text clear of objective/countdown. Without `ibz-touch-active` (narrow
  desktop window) the objective/minimap overlap the top-left card — pre-existing desktop-narrow layout, not HH.
- No console errors.

## Verification Run
- `npx tsc --noEmit`: 0 errors on HH files (remaining errors only in concurrent VP2 in-progress files).
- HH suites (hordeStrength, hordeHealth, shielding, respawn, persistence, hudModel): 128/128.
- `grep -rn "leader\.hp\|leader\.maxHp" src tests`: empty.

## Memory Notes
- Full-suite failures in world/expansion/trafficControl/carAttack/buildingPlan/landmarkPlans/environmentPopulation during HH
  came from VP2-T006 layout passes (on by default); carAttack passes 9/9 with the passes off.
