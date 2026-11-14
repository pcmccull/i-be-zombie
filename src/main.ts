import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AudioSystem } from './audio/AudioSystem';
import { BALANCE } from './config/balance';
import type {
  DistrictLayout,
  GameEvent,
  GameState,
  GateState,
  GuardAgent,
  LeaderState,
  ZombieAgent,
} from './core/types';
import { HUD } from './ui/HUD';
import { Effects } from './visuals/Effects';
import { EntityRenderer } from './visuals/EntityRenderer';
import { HordeRenderer } from './visuals/HordeRenderer';
import { CheckpointVisual } from './world/Checkpoint';
import { CityDistrict } from './world/CityDistrict';
import { buildDistrictLayout } from './world/districtLayout';

function createFakeState(layout: DistrictLayout): GameState {
  let nextId = 1;

  const leader: LeaderState = {
    id: nextId++,
    pos: { x: layout.playerStart.x, z: layout.playerStart.z },
    prevPos: { x: layout.playerStart.x, z: layout.playerStart.z },
    vel: { x: 0, z: 0 },
    facing: layout.playerStartFacing,
    prevFacing: layout.playerStartFacing,
    radius: BALANCE.leader.radius,
    hp: BALANCE.leader.maxHp,
    maxHp: BALANCE.leader.maxHp,
    attackCooldown: 0,
    anim: 'walk',
    animTime: 0,
    hitFlash: 0,
    alive: true,
    stamina: BALANCE.leader.staminaMax,
    exhausted: false,
    sprinting: false,
  };

  const zombies: ZombieAgent[] = [];

  // 40 followers walking in a loose pack circle near the start
  for (let i = 0; i < 40; i++) {
    const ring = 2.0 + (i / 40) * 6.5;
    const angle = i * 1.15;
    const x = layout.playerStart.x + Math.cos(angle) * ring;
    const z = layout.playerStart.z + Math.sin(angle) * ring;
    zombies.push({
      id: nextId++,
      pos: { x, z },
      prevPos: { x, z },
      vel: { x: 1.5, z: -1.5 },
      facing: layout.playerStartFacing,
      prevFacing: layout.playerStartFacing,
      radius: BALANCE.walker.radius,
      hp: BALANCE.walker.maxHp,
      maxHp: BALANCE.walker.maxHp,
      attackCooldown: 0,
      anim: 'walk',
      animTime: i * 0.13,
      hitFlash: 0,
      state: 'follower',
      variant: i % 6,
      speedScale: 1.0,
      followOffset: { x: Math.cos(angle) * ring, z: Math.sin(angle) * ring },
      engageTarget: null,
      spawnZone: 0,
      wanderTarget: null,
      wanderTimer: 0,
      stateTime: 2.0,
      stuckTimer: 0,
      isConverted: i < 3,
    });
  }

  // 30 ambient walkers distributed across spawnZones
  for (let i = 0; i < 30; i++) {
    const zoneIdx = i % layout.spawnZones.length;
    const zone = layout.spawnZones[zoneIdx].rect;
    const u = ((i * 37) % 100) / 100;
    const v = ((i * 73) % 100) / 100;
    const x = zone.minX + 1.0 + u * Math.max(1, zone.maxX - zone.minX - 2.0);
    const z = zone.minZ + 1.0 + v * Math.max(1, zone.maxZ - zone.minZ - 2.0);
    const facing = (i * 1.7) % (Math.PI * 2);
    zombies.push({
      id: nextId++,
      pos: { x, z },
      prevPos: { x, z },
      vel: { x: Math.sin(facing) * 0.8, z: Math.cos(facing) * 0.8 },
      facing,
      prevFacing: facing,
      radius: BALANCE.walker.radius,
      hp: BALANCE.walker.maxHp,
      maxHp: BALANCE.walker.maxHp,
      attackCooldown: 0,
      anim: 'walk',
      animTime: i * 0.2,
      hitFlash: 0,
      state: 'ambient',
      variant: i % 6,
      speedScale: 1.0,
      followOffset: { x: 0, z: 0 },
      engageTarget: null,
      spawnZone: zoneIdx,
      wanderTarget: null,
      wanderTimer: 2.0,
      stateTime: 5.0,
      stuckTimer: 0,
      isConverted: false,
    });
  }

  // 4 dead corpses near start plaza
  for (let i = 0; i < 4; i++) {
    const x = layout.playerStart.x + 8 + i * 2.1;
    const z = layout.playerStart.z - 5 + (i % 2) * 2.2;
    zombies.push({
      id: nextId++,
      pos: { x, z },
      prevPos: { x, z },
      vel: { x: 0, z: 0 },
      facing: i * 1.4,
      prevFacing: i * 1.4,
      radius: BALANCE.walker.radius,
      hp: 0,
      maxHp: BALANCE.walker.maxHp,
      attackCooldown: 0,
      anim: 'dead',
      animTime: 1.2,
      hitFlash: 0,
      state: 'dead',
      variant: i % 6,
      speedScale: 1.0,
      followOffset: { x: 0, z: 0 },
      engageTarget: null,
      spawnZone: 0,
      wanderTarget: null,
      wanderTimer: 0,
      stateTime: 1.2,
      stuckTimer: 0,
      isConverted: false,
    });
  }

  // 2 rising zombies near start plaza
  for (let i = 0; i < 2; i++) {
    const x = layout.playerStart.x + 5.5 + i * 2.4;
    const z = layout.playerStart.z - 2.5 - i * 1.8;
    zombies.push({
      id: nextId++,
      pos: { x, z },
      prevPos: { x, z },
      vel: { x: 0, z: 0 },
      facing: 2.2,
      prevFacing: 2.2,
      radius: BALANCE.walker.radius,
      hp: BALANCE.walker.maxHp,
      maxHp: BALANCE.walker.maxHp,
      attackCooldown: 0,
      anim: 'rise',
      animTime: 0.4,
      hitFlash: 0,
      state: 'rising',
      variant: (i + 2) % 6,
      speedScale: 1.0,
      followOffset: { x: 0, z: 0 },
      engageTarget: null,
      spawnZone: 0,
      wanderTarget: null,
      wanderTimer: 0,
      stateTime: 0.4,
      stuckTimer: 0,
      isConverted: true,
    });
  }

  // 8 guards at layout.guards positions/elevations
  const guards: GuardAgent[] = layout.guards.map((gs) => {
    const isTower = gs.tower !== null;
    return {
      id: nextId++,
      pos: { x: gs.pos.x, z: gs.pos.z },
      prevPos: { x: gs.pos.x, z: gs.pos.z },
      vel: { x: 0, z: 0 },
      facing: gs.facing,
      prevFacing: gs.facing,
      radius: BALANCE.guard.radius,
      hp: BALANCE.guard.maxHp,
      maxHp: BALANCE.guard.maxHp,
      attackCooldown: 0,
      anim: 'idle',
      animTime: 0,
      hitFlash: 0,
      state: 'PATROL',
      stateTime: 0,
      tower: gs.tower,
      towerColliderId: null,
      elevation: isTower ? 4 : 0,
      waypoints: gs.waypoints,
      waypointIndex: 0,
      path: [],
      pathIndex: 0,
      idleTimer: 0,
      perceptionTimer: 0,
      target: null,
      lostTargetTimer: 0,
      lastDamageSource: 'zombie',
      deathTime: null,
    };
  });

  const gateRect = layout.checkpoint.gate.rect;
  const gate: GateState = {
    colliderId: 0,
    rect: gateRect,
    center: {
      x: 0.5 * (gateRect.minX + gateRect.maxX),
      z: 0.5 * (gateRect.minZ + gateRect.maxZ),
    },
    hp: BALANCE.gate.maxHp,
    maxHp: BALANCE.gate.maxHp,
    destroyed: false,
    hitFlash: 0,
  };

  return {
    time: 0,
    phase: 'playing',
    nextEntityId: nextId,
    leader,
    zombies,
    guards,
    gate,
    order: { type: 'follow' },
    abilities: {
      rallyCooldown: 0,
      rushCooldown: 0,
      rushTimeLeft: 0,
    },
    pendingConversions: [],
    stats: {
      recruited: 40,
      conversions: 2,
      losses: 0,
      guardsKilled: 0,
    },
    followerCount: 40,
    capReachedFlash: 0,
  };
}

function bootVisualPreview(): void {
  const appEl = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  if (!appEl || !hudEl) return;

  appEl.innerHTML = '';

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  appEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = 0x8ea9bd;
  scene.background = new THREE.Color(skyColor);
  scene.fog = new THREE.Fog(skyColor, 95, 290);

  // Hemisphere + Directional sun covering the district
  const hemiLight = new THREE.HemisphereLight(0xdbe8f4, 0x5c574f, 0.78);
  hemiLight.position.set(0, 80, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff1d6, 1.45);
  sunLight.position.set(-70, 115, 65);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 310;
  sunLight.shadow.camera.left = -135;
  sunLight.shadow.camera.right = 135;
  sunLight.shadow.camera.top = 115;
  sunLight.shadow.camera.bottom = -115;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  const layout = buildDistrictLayout();
  const state = createFakeState(layout);

  // Camera + OrbitControls starting elevated behind playerStart looking NE
  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.5,
    450,
  );
  const startX = layout.playerStart.x;
  const startZ = layout.playerStart.z;
  camera.position.set(startX - 11, 12.5, startZ + 11);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(startX + 4, 1.2, startZ - 4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 6;
  controls.maxDistance = 140;
  controls.update();

  // Build visual modules
  const city = new CityDistrict(layout);
  scene.add(city.group);

  const checkpoint = new CheckpointVisual(layout);
  scene.add(checkpoint.group);

  const entityRenderer = new EntityRenderer(scene);
  const hordeRenderer = new HordeRenderer(220);
  scene.add(hordeRenderer.group);

  const effects = new Effects(scene);
  const audio = new AudioSystem();
  const hud = new HUD(hudEl);

  // Hide intro overlay automatically after 2 seconds
  window.setTimeout(() => {
    hud.hideIntro();
  }, 2000);

  window.addEventListener('pointerdown', () => {
    audio.unlock();
  });

  let showDebug = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      hud.toggleHelp();
    } else if (e.code === 'F3') {
      e.preventDefault();
      showDebug = !showDebug;
    } else if (e.code === 'KeyM') {
      audio.setMuted(!audio.muted);
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Expose preview handle for debugging
  (window as unknown as { __preview: unknown }).__preview = {
    renderer,
    scene,
    camera,
    controls,
    city,
    checkpoint,
    entityRenderer,
    hordeRenderer,
    effects,
    hud,
    state,
  };

  let prevTime = performance.now() * 0.001;
  let shotTimer = 0;
  let smoothFps = 60;
  const fakeEvents: GameEvent[] = [];

  function frame(nowMs: number): void {
    requestAnimationFrame(frame);

    const now = nowMs * 0.001;
    const dt = Math.min(0.1, Math.max(0.001, now - prevTime));
    prevTime = now;
    state.time += dt;
    smoothFps = smoothFps * 0.9 + (1 / dt) * 0.1;

    // Animate leader in a small patrol figure-8 near playerStart
    const t = state.time;
    const leaderCx = layout.playerStart.x + Math.sin(t * 0.7) * 4.2;
    const leaderCz = layout.playerStart.z - Math.cos(t * 0.7) * 3.5;
    const leaderVx = (leaderCx - state.leader.pos.x) / dt;
    const leaderVz = (leaderCz - state.leader.pos.z) / dt;
    state.leader.prevPos.x = state.leader.pos.x;
    state.leader.prevPos.z = state.leader.pos.z;
    state.leader.prevFacing = state.leader.facing;
    state.leader.pos.x = leaderCx;
    state.leader.pos.z = leaderCz;
    state.leader.vel.x = leaderVx;
    state.leader.vel.z = leaderVz;
    state.leader.facing = Math.atan2(leaderVx, leaderVz);
    state.leader.anim = 'walk';
    state.leader.animTime += dt;

    // Animate zombies (40 followers orbiting in a pack, 30 ambient wandering, 2 rising looping)
    for (let i = 0; i < state.zombies.length; i++) {
      const z = state.zombies[i];
      z.prevPos.x = z.pos.x;
      z.prevPos.z = z.pos.z;
      z.prevFacing = z.facing;
      z.animTime += dt;

      if (z.state === 'follower') {
        const orbitAngle = t * 0.55 + i * 0.65;
        const radius = 2.4 + (i % 7) * 0.85;
        const nx = state.leader.pos.x + Math.cos(orbitAngle) * radius;
        const nz = state.leader.pos.z + Math.sin(orbitAngle) * radius;
        z.vel.x = (nx - z.pos.x) / dt;
        z.vel.z = (nz - z.pos.z) / dt;
        z.pos.x = nx;
        z.pos.z = nz;
        z.facing = Math.atan2(z.vel.x, z.vel.z);
        z.anim = 'walk';
      } else if (z.state === 'ambient') {
        const dir = z.facing + Math.sin(t * 0.5 + i) * 0.25 * dt;
        z.facing = dir;
        z.vel.x = Math.sin(dir) * BALANCE.walker.ambientSpeed;
        z.vel.z = Math.cos(dir) * BALANCE.walker.ambientSpeed;
        const zone = layout.spawnZones[z.spawnZone].rect;
        let nx = z.pos.x + z.vel.x * dt;
        let nz = z.pos.z + z.vel.z * dt;
        if (nx < zone.minX + 0.8 || nx > zone.maxX - 0.8) {
          z.facing = -z.facing;
          nx = Math.max(zone.minX + 0.8, Math.min(zone.maxX - 0.8, nx));
        }
        if (nz < zone.minZ + 0.8 || nz > zone.maxZ - 0.8) {
          z.facing = Math.PI - z.facing;
          nz = Math.max(zone.minZ + 0.8, Math.min(zone.maxZ - 0.8, nz));
        }
        z.pos.x = nx;
        z.pos.z = nz;
      } else if (z.state === 'rising') {
        if (z.animTime > BALANCE.conversion.riseDuration) {
          z.animTime = 0;
        }
      }
    }

    // Fire a fake shot tracer every 0.5 s from the West tower toward the avenue/plaza
    fakeEvents.length = 0;
    shotTimer += dt;
    if (shotTimer >= 0.5) {
      shotTimer -= 0.5;
      const towerGuard = state.guards[0];
      towerGuard.anim = 'attack';
      towerGuard.animTime = 0;
      const spreadX = Math.sin(t * 3.7) * 5.0;
      const spreadZ = Math.cos(t * 2.9) * 4.0;
      fakeEvents.push({
        type: 'shot',
        guardId: towerGuard.id,
        from: {
          x: towerGuard.pos.x,
          y: towerGuard.elevation + 1.35,
          z: towerGuard.pos.z + 0.4,
        },
        to: {
          x: towerGuard.pos.x - 16 + spreadX,
          y: 1.0,
          z: towerGuard.pos.z + 18 + spreadZ,
        },
        hit: true,
      });
    } else if (state.guards[0].anim === 'attack') {
      state.guards[0].animTime += dt;
      if (state.guards[0].animTime > 0.25) {
        state.guards[0].anim = 'idle';
      }
    }

    controls.update();
    city.update(dt, state.time);
    checkpoint.update(state.gate, dt, state.time);
    entityRenderer.update(state, 1.0, state.time, dt);
    hordeRenderer.update(
      state.zombies,
      1.0,
      state.time,
      state.abilities.rushTimeLeft > 0,
    );
    if (fakeEvents.length > 0) {
      effects.consume(fakeEvents, state);
      audio.consume(fakeEvents);
      hud.consume(fakeEvents);
    }
    effects.update(dt);

    renderer.render(scene, camera);

    hud.update(state, {
      fps: smoothFps,
      drawCalls: renderer.info.render.calls,
      showDebug,
      hoverLabel: null,
    });
  }

  requestAnimationFrame(frame);
}

bootVisualPreview();
