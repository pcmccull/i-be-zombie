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
    // Beyond catchUpDistance a straggler moves at least this multiple of the leader's (momentum-scaled) walk speed,
    // so slow-rolled followers (speedScale < 1) can still close on a continuously walking leader.
    catchUpLeaderMargin: 1.12,
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
    // Sum of layout.spawnZones counts (free + held). Recruitment design §4 distribution.
    initialAmbient: 85,
    startFollowers: 5, // already following at t=0 (inside layout.startFollowerArea)
    recruitBoostTime: 2, // seconds a newly recruited zombie gets the catch-up boost + highlight
    recruitBoostMultiplier: 1.35, // speed multiplier during recruitBoostTime
    regroupDistance: 22, // followers farther than this from the leader ignore spacing and use the follow field at catch-up speed
    // Crawling over low obstacles (cars, dumpsters, barriers) when packed together
    crawlMaxHeight: 1.8, // colliders at or below this height (vehicle/prop) are crawlable
    crawlMinNeighbors: 4, // other followers within crawlNeighborRadius required to crawl
    crawlNeighborRadius: 2.6,
    crawlSpeedMultiplier: 0.6, // speed while on top of an obstacle
    crawlNavMinFollowers: 6, // horde paths through crawlable obstacles at this size
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
    towerMeleeReachBonus: 2.2, // zombies within this extra reach of the tower base start climbing
    towerClimbSpeed: 1.6, // m/s up the tower legs; only zombies on the platform can hit the occupant
    towerFallSpeed: 6, // m/s drop when a climber gives up / is pulled off
    towerMaxClimbers: 5, // simultaneous climbers per tower; the rest mob the base
    patrolIdleTime: 2,
  },
  gate: {
    maxHp: 400, // spec initial 250; raised after playtest (60 walkers broke 250 HP in ~6 s)
  },
  // Cascading recruitment (docs/2_intial_recruitment_design.md §2)
  recruitPulse: {
    radius: 10, // meters, scaled by momentum recruit multiplier
    delayMin: 0.1, // seconds after joining before the zombie's one pulse fires
    delayMax: 0.3,
    /** Highest generation a pulse can create. Zombies of this generation do not pulse (gen 0 -> 1 -> 2 -> 3). */
    maxGeneration: 3,
    maxRecruitsPerPulse: 8, // bounds a single pulse's work and keeps the spread visibly staggered
  },
  // Destructible landmark obstructions (§3). HP chosen so 10-20 zombies break them in ~3-6 s.
  structures: {
    busDoor: { maxHp: 90 },
    alleyGate: { maxHp: 140 },
    storeDoor: { maxHp: 110 },
    penGate: { maxHp: 120 },
    stationDoor: { maxHp: 240 }, // police station front doors (tier 2)
    securityShutter: { maxHp: 170 }, // mall security office shutter (tier 1)
    releaseScatter: 3, // meters past an approachOutside point that released zombies burst out to
    releaseSpeed: 2.6, // m/s during the release burst (faster than ambient shuffle)
    releaseDuration: 2.5, // seconds of steered burst before normal ambient wander resumes
  },
  civilian: {
    maxHp: 30,
    radius: 0.4,
    walkSpeed: 1.6,
    // todos #5: civilians outrun the horde unless it Rushes. Faster than the leader walk even at full momentum (5 x 1.2);
    // the leader can still sprint one down (7.4 m/s, ~4 s of stamina).
    fleeSpeed: 6.2,
    chaseSpeedFactor: 0.9, // followers chasing a civilian without Rush are capped at fleeSpeed x this
    rushChaseFactor: 1.15, // ... and during Rush move at least fleeSpeed x this
    panicRadius: 12, // sees a zombie/leader within this (with LOS) -> flees
    calmTime: 5, // seconds without a threat in panicRadius before returning to PATROL
  },
  outposts: {
    barricadeGuards: 2, // armed soldiers at the police barricade (post 'barricade')
    barricadeRange: 16, // their effective range (lighter than checkpoint guards)
    // "Lightly defended" (spec §1): pistols, not rifles. Two police at 10 dmg / 75% killed an idle 100 HP leader in ~5 s
    // during playtest; at 6 dmg / 55% that takes ~12 s, leaving time to order the horde in.
    barricadeDamage: 6,
    barricadeHitChance: 0.55,
  },
  // Outbreak Momentum (§5)
  momentum: {
    max: 100,
    gainRecruit: 1,
    gainConvert: 3,
    gainArmedKill: 5,
    gainStructure: 10,
    graceTime: 8, // seconds after the last gain before decay starts
    decayPerSecond: 1.5,
    recruitRadiusPerPoint: 0.005, // 1 + m*0.005 => +50% at 100
    speedPerPoint: 0.002, // 1 + m*0.002 => +20% at 100 (leader + followers)
    tierGrowing: 30,
    tierFull: 70,
    gainFlashTime: 0.6,
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

  // =========================================================================
  // Open world (docs/3_open_world.md, .agent-context/ARCHITECTURE.md)
  // =========================================================================
  openWorld: {
    // World bounds for buildDistrictLayout() (the legacy layout keeps world.minX.. above).
    minX: -200,
    maxX: 200,
    minZ: -160,
    maxZ: 160,
    /** Spec §7.horde cap for the open world; HordeSystem switches maxFollowers to this in T007. */
    maxFollowers: 40,
  },
  chunks: {
    size: 80, // meters; 400 x 320 world => 5 x 4 = 20 chunks
    loadRadius: 150, // render chunks whose rect is within this distance of the camera target
    unloadRadius: 190, // hysteresis: unload beyond this
  },
  nav: {
    flowFieldMaxDistance: 140, // meters; bounded Dijkstra for 5 Hz replans at world scale
    farCatchUpDistance: 60, // followers farther than this from the leader, out of combat ...
    farCatchUpOffscreen: 35, // ... and farther than this from the camera target may be teleported near the leader
  },
  population: {
    activeRadius: 110, // full AI within this distance of the leader
    dormantRefreshHz: 2,
    civilianRespawnDelay: 20, // seconds after a civilian dies before the district may respawn one
    minRespawnDistance: 60, // respawn points must be at least this far from the leader
    maxHumans: 140, // hard cap on living humans in state.guards (all districts)
    maxAmbient: 160, // hard cap on ambient (non-follower) zombies
  },
  alpha: {
    // LMB direct attack. Bite = base; damage routed through CombatSystem helpers.
    biteDamage: 14,
    biteRange: 1.9,
    biteWindup: 0.14,
    biteRecovery: 0.36,
    aimConeDeg: 100, // forgiving auto-aim cone
    aimRange: 3.2, // auto-aim reach (lunges/turns toward target)
    // Alpha Claws 3-hit combo
    clawDamage: [16, 16, 30] as readonly number[],
    clawRange: 2.3,
    clawWindup: 0.1,
    clawRecovery: [0.22, 0.22, 0.5] as readonly number[],
    comboWindow: 0.55, // seconds after recovery to chain the next hit
    staggerTime: 0.9, // combo finisher staggers humans (no move/shoot)
    structureDamageMultiplier: 1, // Alpha vs gates/structures
    hitStunDamage: 18, // a single hit >= this stuns the Alpha
    hitStunTime: 0.25,
    infectChance: 1, // humans killed by the Alpha always rise (spec "infect")
  },
  police: {
    // role 'police' (pistols); 'soldier' keeps BALANCE.guard (rifles).
    maxHp: 45,
    damage: 6,
    range: 16,
    fireCooldown: 0.9,
    hitChance: 0.55,
    aimDelay: 0.5, // seconds from acquiring a target to the first shot
  },
  progression: {
    slots: 4, // Q E R F
    startBiomass: 0,
    biomassInfect: 3, // civilian killed by the Alpha
    biomassKill: 4, // armed human killed by the horde/Alpha
    biomassConvert: 2, // conversion rises
    biomassStructure: 5,
  },
  frenzy: {
    duration: 8,
    cooldown: 25,
    radius: 22, // followers within this of the leader at activation are buffed
    speedMultiplier: 1.4,
    attackRateMultiplier: 1.5,
  },
  brute: {
    costPerBrute: 15, // biomass
    maxPerActivation: 2, // nearest non-brute followers converted per activation
    maxBrutes: 6,
    cooldown: 6,
    maxHp: 180,
    radius: 0.62,
    speedMultiplier: 0.85,
    attackDamage: 14,
    structureDamageMultiplier: 3.5, // vs gate / structures (siege)
  },
  conquest: {
    contestRadius: 30, // followers within this of a stronghold's bounds + damage => contested
    alertPerArmedKill: 0.12,
    alertPerStructureHit: 0.01,
    alertDecayPerSecond: 0.01,
    reinforcementAlert: 0.5, // alert level that triggers a wave
    reinforcementCooldown: 45, // seconds between waves per stronghold
    maxReinforcementWaves: 3, // per stronghold, ever (no endless spawns)
    reinforcementSize: 3,
    capturedPatrolFactor: 0.25, // captured districts keep this share of civilian budget and no patrols
  },
  nest: {
    equipRadius: 8, // must stand this close to an active nest to change the loadout
    replenishRadius: 14,
    replenishInterval: 4, // seconds per free follower spawned at a nest while the leader is near and horde < replenishTarget
    replenishTarget: 10,
  },
  respawn: {
    delay: 4, // seconds dead before respawning
    followers: 5, // fresh followers spawned at the nest on respawn
  },
  discovery: {
    cellSize: 20,
    revealRadius: 45,
    revealHz: 4,
  },
  save: {
    storageKey: 'ibz.openworld.save',
    version: 1,
  },
} as const;

export type Balance = typeof BALANCE;
