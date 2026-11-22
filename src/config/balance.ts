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
    /** todos #8: seconds the horde must stay below cap before capReached can fire again. */
    capNoticeRearm: 4,
    recruitBoostTime: 2, // seconds a newly recruited zombie gets the catch-up boost + highlight
    recruitBoostMultiplier: 1.35, // speed multiplier during recruitBoostTime
    regroupDistance: 22, // followers farther than this from the leader ignore spacing and use the follow field at catch-up speed
    // Climbing over car-height obstacles (cars, dumpsters, barriers, sandbag/low walls): every follower and the Alpha
    crawlMaxHeight: 1.8, // vehicle/prop/wall colliders at or below this height are climbable (a car is 1.7 m)
    crawlSpeedMultiplier: 0.6, // follower speed while on top of an obstacle
    leaderClimbSpeedMultiplier: 0.8, // Alpha speed while on top of an obstacle
    crawlClimbSpeed: 10, // m/s up onto a car roof (todos #11: fast enough that no one is drawn inside the car)
    moveOrderTime: 20, // seconds before a ground move order reverts to follow (open world)
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
    shopDoor: { maxHp: 60 }, // todos #10b corner shop: the Alpha alone breaks it in ~4 s
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
    // EW: 4 x 4 districts. bounds = play area grown by boundaryBand; the band holds the indestructible world edge.
    minX: -420,
    maxX: 420,
    minZ: -500,
    maxZ: 180,
    /** Walkable area inside the boundary band (layout.playArea). The original 2 x 2 world is x [-200,200], z [-160,160]. */
    play: { minX: -400, maxX: 400, minZ: -480, maxZ: 160 },
    boundaryBand: 20,
    /** District grid lines (x columns west->east, z rows north->south); districts tile bounds. */
    gridX: [-420, -200, 0, 200, 420] as readonly number[],
    gridZ: [-500, -320, -160, 0, 180] as readonly number[],
    /** Base horde cap for the open world. 0: the Alpha starts alone on the beach and can't recruit until a nest is claimed. */
    maxFollowers: 0,
    /** Extra horde cap per unlocked nest (captured stronghold; the start nest does not count). */
    followersPerNest: 10,
    /** Followers at t=0 in the open world (the legacy district keeps horde.startFollowers). */
    startFollowers: 0,
    /** Free followers that rise around the Alpha when it walks into (claims) the first walk-in nest by the bus. */
    firstNestHorde: 10,
    /** Start with every walk-in nest already claimed (no horde grant). Off in the game; the pre-beach test economy turns it on. */
    startNestClaimed: false,
  },
  chunks: {
    size: 80, // meters; EW 840 x 680 world => 11 x 9 = 99 chunks
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
    maxHumans: 420, // hard cap on living humans in state.guards (all 16 districts; dormant beyond activeRadius)
    maxAmbient: 400, // hard cap on ambient (non-follower) zombies
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
    damage: 5, // T016 playtest: 6 let three suburb police kill a full-HP Alpha in ~10 s (spec: early danger, not instant death)
    range: 16,
    fireCooldown: 0.9,
    hitChance: 0.55,
    aimDelay: 0.5, // seconds from acquiring a target to the first shot
  },
  /** Heavy stronghold weapons (HeavyWeapon): stationary soldier crews at the hard capture points. */
  heavy: {
    mg: {
      maxHp: 90, // behind sandbags; flank it through the open back
      range: 28,
      damage: 5,
      hitChance: 0.42,
      shotInterval: 0.11, // seconds between rounds inside a burst
      burstRounds: 9,
      reloadTime: 1.6, // pause between bursts (the window to rush it)
      aimDelay: 0.7,
      eyeHeight: 1.25,
    },
    tank: {
      maxHp: 900,
      radius: 2.4, // melee reach: anyone touching the 3.2 x 5.6 m hull can claw the crew
      hullWidth: 3.2,
      hullLength: 5.6,
      hullHeight: 2.4,
      eyeHeight: 2.3,
      cannonRange: 40,
      cannonMinRange: 6, // the main gun can't depress onto attackers hugging the hull
      cannonCooldown: 4.2,
      cannonAimDelay: 1.2,
      splashRadius: 4,
      splashDamage: 42, // centre; falls off to 35 % at the edge (a walker has 40 HP)
      splashLeaderDamage: 28,
      coaxRange: 20,
      coaxInterval: 0.22,
      coaxDamage: 3,
      coaxHitChance: 0.5,
    },
  },
  progression: {
    slots: 4, // Q E R F
    /** todos #9: biomass price of slot i (slot 0 is granted free by the first unlock). */
    slotCosts: [0, 40, 70, 110],
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
    claimRadius: 3, // walk within this distance of a walk-in (claim) nest's centre to claim it
    replenishRadius: 14,
    replenishInterval: 4, // seconds per free follower spawned at a nest while the leader is near and horde < replenishTarget
    replenishTarget: 10,
    teleportTime: 2.6, // nest teleport: seconds from the order until the party crawls out of the destination nest
    teleportDiveTime: 0.8, // each zombie's leap + plunge into the hole (followers must reach it teleportTime - this in)
    teleportHoleRadius: 1.4, // within this of the nest centre a zombie stops and dives in
    teleportGatherSpeed: 1.7, // × walker speed while running to the hole (faster when needed to make it in time)
  },
  respawn: {
    delay: 4, // seconds dead before respawning
    followers: 5, // fresh followers spawned at the nest on respawn
    emergeTime: 2.6, // seconds the Alpha spends climbing out of the ground (start at last nest / respawn); no control
    emergeOffset: 3.2, // the Alpha climbs out this far from the nest centre (beside the mound, never inside it)
    emergeStagger: 0.4, // nest-spawned followers stay buried up to emergeTime × this longer, so they claw out one by one
  },
  discovery: {
    cellSize: 20,
    revealRadius: 45,
    revealHz: 4,
  },
  /** HH: Horde Strength replaces Alpha HP (docs/13_hode_health.md, ARCHITECTURE §HH-1). */
  hordeHealth: {
    alphaDamageMultiplier: 2.5, // incoming Alpha damage × this = shared HP poured into followers / core
    unitHp: 40, // HP per strength unit (core units; followers use their own hp)
    alphaCore: 6, // Alpha's own reserve units (solo Alpha survives ≈ 6·40/2.5 = 96 damage)
    capUnitsPerFollower: 1,
    values: { walker: 1, companion: 2, brute: 3 },
    shareRadius: 6, // m — followers this close absorb first, nearest first
    maxRecipients: 4,
    criticalFrac: 0.2,
    lastBrain: { duration: 6, speedMultiplier: 1.35, entryGrace: 0.4, recoveryGrace: 1.5 },
  },
  save: {
    storageKey: 'ibz.openworld.save',
    version: 4, // v2: slotsOwned; v3: visionTier + 16 districts + 42x34 fog; v4: living city rewards + district alert/control
  },
  /** EW: stronghold biomass reward by threat tier (index = tier) for the 12 new strongholds. */
  expansion: {
    rewardByTier: [0, 15, 25, 35, 50, 70] as readonly number[],
  },
  /** EW zombie eyesight (docs/5_expand_world.md §4). Index = tier - 1. Distances in meters from the Alpha. */
  vision: {
    tiers: [
      { name: 'Rotten Eyes', clearRadius: 12, hazeRadius: 30, hazeStrength: 0.9, movingDetectRadius: 0, defenseRadius: 0, reinforcementRadius: 0 },
      { name: 'Predator Sight', clearRadius: 28, hazeRadius: 64, hazeStrength: 0.62, movingDetectRadius: 40, defenseRadius: 0, reinforcementRadius: 0 },
      { name: 'Hunter Vision', clearRadius: 42, hazeRadius: 84, hazeStrength: 0.42, movingDetectRadius: 56, defenseRadius: 70, reinforcementRadius: 0 },
      { name: 'Apex Vision', clearRadius: 60, hazeRadius: 110, hazeStrength: 0.22, movingDetectRadius: 75, defenseRadius: 95, reinforcementRadius: 140 },
    ] as readonly { name: string; clearRadius: number; hazeRadius: number; hazeStrength: number; movingDetectRadius: number; defenseRadius: number; reinforcementRadius: number }[],
    /** Biomass price of reaching tier i + 1 from tier i (index = current tier; [0] unused). */
    tierCosts: [0, 20, 60, 120] as readonly number[],
    alwaysRadius: 6, // humans this close are always identified (no LOS)
    engagedMemory: 3, // s a human stays identified after shooting/hitting the Alpha or a follower
    movingSpeed: 0.5, // m/s; above this a human counts as moving (tier 2 detection)
    eyeHeight: 1.6,
    updateHz: 5,
    maxLosChecksPerUpdate: 48,
    reinforcementFuzzFactor: 0.35, // tier 4 siren cues are this much more precise
    tierBlendTime: 1.2, // s for the haze to ease to a new tier
    hazeColor: 0x9fb3a8,
  },
  /**
   * Permanent nest traits (bought with biomass at an active nest). Each level costs more than the last.
   * speed: Alpha walk/sprint + horde movement; attack: Alpha windup/recovery + follower swing cooldown.
   */
  traits: {
    speed: { name: 'Running Speed', perLevel: 0.07, costs: [25, 50, 90, 140, 200] as readonly number[] },
    attack: { name: 'Attack Speed', perLevel: 0.1, costs: [25, 50, 90, 140, 200] as readonly number[] },
  },
  /** EW nonvisual awareness cues (docs/5_expand_world.md §5). */
  senses: {
    maxCues: 8,
    aggregateRadius: 25,
    crowdScanHz: 1,
    crowdCellSize: 30,
    crowdMinHumans: 6,
    kinds: {
      gunshot: { range: 140, ttl: 2.5, fuzzFrac: 0.18, fuzzMin: 6, fuzzMax: 30 },
      scream: { range: 70, ttl: 3, fuzzFrac: 0.22, fuzzMin: 6, fuzzMax: 25 },
      siren: { range: 200, ttl: 5, fuzzFrac: 0.25, fuzzMin: 10, fuzzMax: 45 },
      crowd: { range: 90, ttl: 4, fuzzFrac: 0.3, fuzzMin: 10, fuzzMax: 35 },
    },
  },
  /** todos #10a: ambient zombies / civilians spawn on sidewalks, never on the carriageway. */
  sidewalkSpawn: {
    inset: 0.6, // keep spawns this far inside the sidewalk strip
  },
  /** todos #10b: corner shops with healing drinks (ShopSystem). Only the Alpha drinks. */
  shops: {
    size: [8, 6] as readonly number[], // footprint (x, z) in meters
    wallHeight: 3.2,
    doorWidth: 2.6,
    perDistrict: 1,
    drinks: 3, // per shop, each heals drinkHeal
    drinkHeal: 35,
    pickupRadius: 1.4,
    restockTime: 150, // s after the last drink is taken before the shelf refills
  },
  /** todos #12: simulated traffic. Cars throw and hurt zombies they hit; hostile drivers ram the horde. */
  traffic: {
    maxCars: 7, // live cars around the Alpha
    spawnInterval: 2.2, // s between spawn attempts while below maxCars
    spawnMin: 55, // spawn this far (along the lane, upstream) from the Alpha ...
    spawnMax: 95,
    despawnDistance: 140,
    cruiseSpeed: 9,
    accel: 6,
    brake: 14,
    brakeDistance: 9, // ambient cars brake for humans this far ahead in their lane
    carLength: 4.4,
    carWidth: 2,
    collisionRadius: 1.15, // circle used for off-lane movement against buildings/walls
    hitMinSpeed: 3, // below this a car just shoves agents aside
    hitCooldown: 0.8, // s before the same car can hit the same agent again
    damagePerSpeed: 2.2, // zombie damage per m/s of impact speed
    leaderDamageFactor: 0.5,
    bruteDamageFactor: 0.5,
    throwSpeedFactor: 0.9, // knockback m/s per m/s of impact
    throwTime: 0.55, // s airborne
    throwHeightPerSpeed: 0.09, // arc apex (m) per m/s
    speedLossPerHit: 0.2, // fraction of speed a car loses per body it hits
    leaderSpeedLoss: 0.55, // fraction lost when it hits the Alpha (the Alpha plants its feet)
    bogPerHit: 0.5, // s the car cannot accelerate after each body it hits (stacks up to bogMax)
    bogMax: 2.5,
    bogDrag: 1.6, // 1/s speed decay while bogged (a car that ploughs into the horde rolls to a stop beside it)
    carHp: 60, // driver's grip; zombie claws wear it down, at 0 the driver is dragged out
    clawSlow: 0.12, // fraction of speed a car loses per claw landed on it
    clawBog: 0.35, // s of bog per claw landed
    pulledDriverHp: 0.5, // dragged-out driver keeps this share of its hp ...
    pulledDriverStagger: 1.2, // ... and is dazed this long
    alphaDamageFactor: 1.5, // Alpha claws/bites vs. the driver's grip
    engageReach: 2.5, // followers this close to a live car's footprint mob it on their own
    stallTime: 2.5, // s stopped (blocked or swarmed) before the driver bails
    quietDespawnDistance: 60, // a jammed car farther than this from the Alpha just despawns instead of stalling
    fadeTime: 6, // stalled cars linger this long, then despawn
    // Traffic control (systems/trafficControl.ts): lights on main/core junctions, 4-way stops elsewhere.
    signals: { green: 9, yellow: 2.5, allRed: 1.5 }, // s per phase; N-S then E-W
    stopLineGap: 1, // m cars stop short of the junction box
    stopHold: 0.7, // s a car stands at a stop sign before it may go
    junctionPatience: 12, // s a car waits at a junction before it creeps through anyway (never gridlocks)
    pedestrianPatience: 6, // s stopped for people standing in the road before the driver U-turns
    followGap: 2.5, // m bumper-to-bumper gap kept behind the car ahead
    swerveRate: 2.5, // m/s sideways when steering around a wreck
    swerveSpeed: 4, // m/s while passing a wreck in the oncoming lane
    crashMinSpeed: 5, // m/s closing speed for a car-on-car accident
    crashWreckSpeed: 10, // m/s closing speed at which the out-of-control car is wrecked as well
  },
  /** Vehicle body types: footprint (m), cruise/accel scale, crash mass, spawn weight, can it be a rammer. */
  vehicleModels: {
    sedan: { length: 4.4, width: 2, speed: 1, accel: 1, mass: 1, weight: 30, rammer: true },
    hatchback: { length: 3.8, width: 1.85, speed: 1, accel: 1.1, mass: 0.8, weight: 18, rammer: true },
    pickup: { length: 5.2, width: 2.1, speed: 1, accel: 0.95, mass: 1.3, weight: 14, rammer: true },
    van: { length: 5, width: 2.1, speed: 0.95, accel: 0.85, mass: 1.4, weight: 10, rammer: false },
    boxTruck: { length: 7.6, width: 2.5, speed: 0.85, accel: 0.6, mass: 2.6, weight: 8, rammer: true },
    bus: { length: 11, width: 2.6, speed: 0.8, accel: 0.5, mass: 3.5, weight: 5, rammer: false },
    police: { length: 4.7, width: 2, speed: 1.1, accel: 1.2, mass: 1.1, weight: 7, rammer: false },
  },
  /** todos #12: hostile drivers (resistance level >= rammerFromLevel). */
  rammer: {
    fromLevel: 2,
    chance: [0, 0, 0.3, 0.4, 0.5] as readonly number[], // share of spawned cars, by resistance level
    detectRadius: 38, // sees the Alpha/horde this close (LOS) -> rams
    speed: 13,
    turnRate: 1.6, // rad/s
    overshoot: 1.4, // s driving on after passing the target
    maxPasses: 3,
    damageFactor: 1.4, // hits harder than oblivious traffic
    // Any driver clawed by zombies panics and runs the horde down (no resistance level needed).
    panicBackup: 0.9, // s reversing out of the mob before charging
    reverseSpeed: 7,
    panicBogAccel: 0.4, // share of accel a panicking driver still gets while bogged (a big mob still pins the car)
    panicTargetRadius: 22, // aims at the middle of the zombies (+ Alpha) this close to the car
  },
  /** todos #12: citizens fight back as strongholds fall. level = number of thresholds reached. */
  resistance: {
    levelAtCaptures: [1, 2, 4, 7] as readonly number[],
    labels: ['', 'Citizens grab bats', 'Drivers are running zombies down', 'Citizens are armed with pistols',
      'Citizens bring shotguns'] as readonly string[],
    // Share of civilians carrying each weapon, by level (cumulative thresholds on a per-id roll).
    shotgun: [0, 0, 0, 0, 0.12] as readonly number[],
    pistol: [0, 0, 0, 0.18, 0.3] as readonly number[],
    bat: [0, 0.3, 0.4, 0.5, 0.6] as readonly number[],
  },
  armedCivilian: {
    fleeHpFraction: 0.35, // below this, armed civilians drop the fight and run
    chargeRadius: 8, // bat carriers charge threats this close
    chargeSpeed: 3.2, // slower than a walking zombie
    batRange: 1.5,
    batDamage: 12,
    batLeaderDamage: 8,
    batCooldown: 1.1,
    keepAway: 3.5, // gun carriers back off from threats this close
    backOffSpeed: 2.4,
    pistol: { range: 14, damage: 5, hitChance: 0.45, fireCooldown: 1.1, aimDelay: 0.6 },
    shotgun: { range: 9, damage: 14, hitChance: 0.8, fireCooldown: 1.6, aimDelay: 0.5 },
  },
  /** todos #7 touch controls (px / ms / multipliers). */
  touch: {
    stickRadius: 56,
    deadZone: 0.12,
    sprintThreshold: 0.85,
    tapMaxMove: 12,
    tapMaxMs: 280,
    orbitSensitivity: 1.0,
    pinchZoomScale: 2.5,
    lowDpr: 1.0,
  },
  /** Living City & Expanded Rewards (docs/11_cityupgrade.md). */
  city: {
    heatMax: 100,
    heatDecayPerSecond: 1.4,
    heatOnShot: 6,
    heatOnGuardKill: 9,
    heatOnConversion: 10,
    heatOnVehicleCrash: 8,
    heatOnInteractable: 5,
    alertThresholds: {
      concerned: 18,
      panic: 42,
      lockdown: 70,
    },
    policeDispatchCooldown: 18,
    policeMaxExtraActive: 6,
    eventCheckInterval: 4, // s between CityActivityDirector scheduling evaluations
    eventMinSpawnDist: 38, // never pop directly in front of the player
    eventMaxSpawnDist: 88,
    eventMaxConcurrent: 3,
    eventDespawnDist: 135,
    /** Hard cap on humans the director has in the world (live events + released stragglers + uncleared corpses). */
    eventMaxHumans: 14,
    /** Events spawn at least this far past the rendered vision limit (never pop in view). */
    eventSpawnBeyondVision: 6,
    /** s between tourists stepping off a tourist bus. */
    busUnloadInterval: 0.9,
    /** s after a car accident before the police show up. */
    accidentPoliceDelay: 9,
    /** s after a festival/food-truck crowd is disturbed before police are called. */
    disturbedPoliceDelay: 6,
    /** Responders walk in from this far away. */
    responderArriveDist: 26,
    /** Intercepting a supply convoy heals the Alpha by this much. */
    convoySupplyHeal: 45,
    /** Larry's whistle pulls in up to N ambient zombies within the radius. */
    larryWhistleRadius: 14,
    larryWhistleRecruits: 3,
    /** Grandma Rot's handbag: stagger + damage to humans within reach. */
    grandmaReach: 3.2,
    grandmaDamage: 12,
    grandmaStagger: 1.1,
    /** Shortcut entrances: interact within this range. */
    shortcutRange: 3.2,
    shortcutCooldown: 3,
    interactRange: 3.0,
    interactableTriggerCooldown: 12,
    hordeMicrobehaviorFraction: 0.25,
    hordeMicrobehaviorCooldown: 4.5,
    maxActiveCompanions: 2,
    companionRecoverTime: 20,
    companionSkillCooldown: 10,
    /** The Alpha's own vehicle hitting things (PlayerVehicleSystem.collidePlayerVehicle). */
    playerVehicleImpact: {
      hitMinSpeed: 3, // m/s: below this the vehicle just nudges people / props / cars
      hitCooldown: 0.8, // s before the same human / car / prop can be hit again
      humanDamagePerSpeed: 3, // human damage per m/s of impact (Alpha kill ⇒ always converts)
      humanThrowPerSpeed: 0.18, // m a struck human is knocked away per m/s
      humanSpeedLoss: 0.2, // fraction of speed lost per human hit
      carDamagePerSpeed: 2.5, // driver's grip lost per m/s of closing speed (0 ⇒ driver dragged out)
      carBounce: 0.25, // speed kept after hitting a car
      propSmashSpeed: 4, // m/s: faster than this the vehicle smashes through a prop (and sets it off)
      propSpeedLoss: 0.3, // fraction of speed lost smashing through a trash can / hydrant
      propBlockSpeed: 0.4, // speed kept when a slow vehicle bumps a prop it can't smash
      selfDamagePerSpeed: 0.6, // vehicle hp lost per m/s of car impact (cosmetic wear, never below 1)
    },
    playerVehicles: {
      golf_cart: { maxSpeed: 12.5, reverseSpeed: 5.5, accel: 16, brake: 22, turnRate: 2.6, radius: 1.15, maxHp: 80, label: 'Golf Cart' },
      scooter: { maxSpeed: 15.0, reverseSpeed: 4.5, accel: 20, brake: 26, turnRate: 3.2, radius: 0.75, maxHp: 55, label: 'Beach Scooter' },
      ice_cream_truck: { maxSpeed: 11.5, reverseSpeed: 5.0, accel: 12, brake: 18, turnRate: 2.0, radius: 1.45, maxHp: 140, label: 'Ice Cream Truck' },
      parade_float: { maxSpeed: 10.5, reverseSpeed: 4.0, accel: 10, brake: 16, turnRate: 1.7, radius: 1.65, maxHp: 180, label: 'Zombie Parade Float' },
    },
  },
} as const;

export type Balance = typeof BALANCE;
