# HH-T003 — claude-worker

**Status:** NEEDS_REVIEW (implementation complete; 5 tests in tests/shielding.test.ts, owned by HH-T004, now fail because damageLeader is real)

## Completed Work
- CombatSystem.damageLeader: guards (alive/playing/amount>0, isHordeShielded) -> hitFlash/hitStun/damage event -> Last Brain finishing hit (finishLastBrain) else applyAlphaDamage. No l.hp writes; killLeader no longer writes hp.
- Simulation: updateHordeHealth after updateConquest / before updateRespawn (open world); after momentum / before checkVictory (legacy). Runs every step incl. the first.
- RespawnSystem: resetHordeHealth(state) replaces hp refill.
- ShopSystem / CityActivityDirector: heal -> restoreStrength(units = heal * alphaDamageMultiplier / unitHp); refused (not consumed) when coreDamage <= 0.01; pickup event heal = units applied, hp = state.horde.strength.
- ZombieLeader: speed x lastBrainSpeedMultiplier.
- saveSchema: player.alphaCoreDamage written; on apply clamped [0, alphaCore], missing/non-finite -> 0 (sanitizeCoreDamage; also in parseSave); no version bump.
- Tests updated (intent kept): ai, combat, emerge, respawn, beachStart, victory, openWorld (god() helper = core full + Last Brain off), expandIntegration, followup, todos10to12 (drink units, hostile rammer via alphaDamageTaken). Added: respawn real-depletion tests (Last Brain -> shielded entry grace -> finishing hit -> respawn refills core; expiry), persistence alphaCoreDamage round-trip + tampered values.
- Respawn-mechanics tests now call killLeader (death via real depletion wipes followers, so it is covered by the two dedicated tests).

## Remaining Work
- tests/shielding.test.ts (not mine): 5 failures (coax/mg/rifle/tower "fire over a follower near themselves", "does not intercept with a follower beside the line..."). Cause: they spy `damageLeader` without mocking, so the real call now pours damage into the nearby follower (expected z.hp == maxHp; got 15/27.5/32.5). Fix: `.mockImplementation(() => {})` on the spies (or assert on the spy only) / keep followers out of shareRadius 6 m.
- HH-T008: createLeader still initialises hp/maxHp (type requirement).

## Public Interfaces/Exports Added
None (internal `sanitizeCoreDamage` in saveSchema).

## Verification Run
- `npx tsc --noEmit`: clean (no errors at all at run time).
- `npm test` (vitest run): 989 passed, 5 failed (all tests/shielding.test.ts above); 84/85 files pass; no VP2 failures at run time.
- grep leader.hp/l.hp in src: only src/core/types.ts and ZombieLeader.createLeader init.

## Memory Notes
See MEMORY.md `[HH-T003]` lines.
