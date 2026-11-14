// All gameplay tuning values live here. Systems must read from BALANCE rather than
// hard-coding numbers. Spec: docs/1_design.md §6, §7, §8, §10.

export const BALANCE = {
  sim: {
    fixedDt: 1 / 60,
    maxFrameDt: 0.25, // clamp for tab resume
    maxStepsPerFrame: 8,
    aiTickHz: 10, // guard perception / LOS checks
    navReplanHz: 5, // max shared flow-field recomputes per second
    seed: 1337,
  },
  world: {
    // District bounds (meters). North = -Z, East = +X, Y up.
    minX: -120,
    maxX: 120,
    minZ: -90,
    maxZ: 90,
    navCellSize: 1.25,
    navAgentRadius: 0.45,
  },
  leader: {
    maxHp: 100,
    radius: 0.45,
    walkSpeed: 5,
    sprintSpeed: 7.4,
    accel: 40, // m/s^2 toward desired velocity
    turnRate: 12, // rad/s facing smoothing
    staminaMax: 100,
    sprintDrain: 25,
    staminaRecovery: 15,
    exhaustedRecoverThreshold: 20,
    attackDamage: 10,
    attackRange: 1.7,
    attackCooldown: 1.1,
    recruitRadius: 9,
  },
  rally: {
    radius: 15,
    cooldown: 8,
  },
  rush: {
    duration: 4,
    cooldown: 15,
    speedMultiplier: 1.45,
    attackRateMultiplier: 1.25,
  },
  walker: {
    maxHp: 40,
    radius: 0.4,
    speed: 3.7,
    ambientSpeed: 0.9,
    catchUpMultiplier: 1.35, // lagging followers outside combat
    catchUpDistance: 14,
    attackDamage: 8,
    attackRange: 1.5,
    attackCooldown: 1.2,
    speedVariance: 0.12, // +/- fraction per zombie
    separationRadius: 1.1,
    separationStrength: 6,
    followRingMin: 2.2, // followers slow & spread within this distance of anchor
    followRingMax: 6,
    autoEngageRadius: 6, // defend-self radius in follow mode
    corpseFadeTime: 6,
    stuckTime: 1.5,
  },
  horde: {
    maxFollowers: 100,
    initialAmbient: 60,
  },
  guard: {
    count: 8,
    towerCount: 2,
    maxHp: 50,
    radius: 0.42,
    speed: 3,
    damage: 10,
    range: 22,
    fireCooldown: 0.8,
    hitChance: 0.75,
    eyeHeight: 1.5,
    towerEyeHeight: 5.2,
    towerRange: 30,
    detectionFovDeg: 140, // forward cone preference; close-range (< 6 m) ignores cone
    closeDetectRange: 6,
    alertAssistRadius: 18,
    alertToCombatTime: 0.6,
    loseTargetTime: 4,
    leaderTargetChance: 0.25, // when leader is visible and in range
    retreatHpFraction: 0.3,
    towerMeleeReachBonus: 2.2, // zombies at tower base can claw the occupant
    patrolIdleTime: 2,
  },
  gate: {
    maxHp: 250,
  },
  conversion: {
    chance: 0.7,
    delay: 3, // seconds body stays down (spec: 2-4 s)
    riseDuration: 1.2,
  },
  targetHeights: {
    zombieTorso: 1.1,
    guardTorso: 1.2,
    gate: 1.4,
  },
} as const;

export type Balance = typeof BALANCE;
