import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { AABB, Vec3 } from './types';
import {
  applyOrbitDelta,
  approachAngle,
  approachCameraDistance,
  cameraOffset,
  MOUSE_LOOK_SENSITIVITY,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomTarget,
  type CameraAngles,
} from './cameraMath';

const DEFAULT_PITCH = Math.atan(11 / 14);
/** Keyboard orbit speed (rad/s) for Z/X. */
const KEY_ORBIT_SPEED = 2.4;

export class ThirdPersonCamera {
  yaw = 0;
  pitch = DEFAULT_PITCH;
  zoom = ZOOM_DEFAULT;

  private targetZoom = ZOOM_DEFAULT;
  private bounds: AABB = { minX: BALANCE.world.minX, maxX: BALANCE.world.maxX, minZ: BALANCE.world.minZ, maxZ: BALANCE.world.maxZ };
  private sinceOrbit = 0;
  private recentering = false;
  /** Set once the player orbits manually; disables auto-follow until recenter (C). */
  private manualYaw = false;
  private turnAxis = 0;
  private lookBackHeld = false;
  /** 0..1 eased blend toward the 180° look-back view. */
  private lookBack = 0;
  /** Yaw actually used for rendering (base yaw + look-back). Movement keeps using `yaw`. */
  viewYaw = 0;
  private initialized = false;
  private boomLength = 0;
  private desiredDistance = 0;
  private actualDistance = 0;
  private readonly orbitScratch: CameraAngles = { yaw: 0, pitch: DEFAULT_PITCH };
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly visibilityTarget = new THREE.Vector3();
  private readonly localOrigin = new THREE.Vector3();
  private readonly inverseWorld = new THREE.Matrix4();
  private readonly raycaster = new THREE.Raycaster();
  private readonly intersections: THREE.Intersection[] = [];
  private readonly faded = new Set<THREE.Object3D>();
  private readonly insideHits = new Map<THREE.Object3D, THREE.Intersection>();

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly occluders: THREE.Object3D[]) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }

  addOrbit(dxPx: number, dyPx: number): void {
    applyOrbitDelta(this.yaw, this.pitch, dxPx, dyPx, MOUSE_LOOK_SENSITIVITY, this.orbitScratch);
    this.yaw = this.orbitScratch.yaw;
    this.pitch = this.orbitScratch.pitch;
    this.sinceOrbit = 0;
    this.recentering = false;
    this.manualYaw = true;
  }

  /** Per-frame free-look controls: turn axis in [-1,1] (Z/X) and hold-to-look-back (V). */
  setLook(turnAxis: number, lookBack: boolean): void {
    this.turnAxis = THREE.MathUtils.clamp(turnAxis, -1, 1);
    this.lookBackHeld = lookBack;
  }

  /** World rectangle the camera is kept near (open-world layout bounds). */
  setBounds(bounds: AABB): void { this.bounds = { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ }; }

  addZoom(wheelDeltaY: number): void {
    this.targetZoom = THREE.MathUtils.clamp(zoomTarget(this.targetZoom, wheelDeltaY), ZOOM_MIN, ZOOM_MAX);
  }

  /** Point the rig last aimed the camera at (gameplay pose handoff for the intro cinematic). */
  get lookPoint(): Readonly<THREE.Vector3> { return this.lookAt; }

  recenter(): void { this.recentering = true; this.manualYaw = false; }

  reset(leaderFacing: number, focus: Vec3): void {
    this.yaw = leaderFacing;
    this.pitch = DEFAULT_PITCH;
    this.zoom = this.targetZoom = ZOOM_DEFAULT;
    this.sinceOrbit = 0;
    this.recentering = false;
    this.manualYaw = false;
    this.turnAxis = 0;
    this.lookBackHeld = false;
    this.lookBack = 0;
    this.viewYaw = leaderFacing;
    this.focus.copy(focus);
    this.boomLength = Math.hypot(ZOOM_DEFAULT, ZOOM_DEFAULT * Math.tan(DEFAULT_PITCH));
    this.faded.clear();
    this.initialized = true;
    this.update(0, focus, leaderFacing, false, 0);
  }

  update(dt: number, focus: Vec3, leaderFacing: number, leaderMoving: boolean, shake: number): Set<THREE.Object3D> {
    dt = Math.max(0, dt);
    if (!this.initialized) this.reset(leaderFacing, focus);
    this.sinceOrbit += dt;
    if (this.turnAxis !== 0) {
      this.yaw -= this.turnAxis * KEY_ORBIT_SPEED * dt;
      this.sinceOrbit = 0;
      this.recentering = false;
      this.manualYaw = true;
    }
    const diff = Math.atan2(Math.sin(leaderFacing - this.yaw), Math.cos(leaderFacing - this.yaw));
    if (this.recentering) {
      this.yaw = approachAngle(this.yaw, leaderFacing, Math.abs(diff) * (1 - Math.exp(-12 * dt)));
      if (Math.abs(diff) < 0.002) this.recentering = false;
    } else if (!this.manualYaw && this.sinceOrbit >= 1.5 && leaderMoving && Math.abs(diff) < 100 * Math.PI / 180) {
      this.yaw = approachAngle(this.yaw, leaderFacing, 0.6 * dt);
    }
    this.lookBack += ((this.lookBackHeld ? 1 : 0) - this.lookBack) * (1 - Math.exp(-9 * dt));
    if (Math.abs(this.lookBack - (this.lookBackHeld ? 1 : 0)) < 1e-3) this.lookBack = this.lookBackHeld ? 1 : 0;
    // Smoothstep so the swing eases in and out.
    const blend = this.lookBack * this.lookBack * (3 - 2 * this.lookBack);
    this.viewYaw = this.yaw + Math.PI * blend;
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-10 * dt));
    this.focus.lerp(focus, 1 - Math.exp(-22 * dt));
    // Raycasts also run before the first render and after scene transforms change.
    for (const occluder of this.occluders) occluder.updateWorldMatrix(true, false);
    cameraOffset(this.viewYaw, this.zoom, this.zoom * Math.tan(this.pitch), this.desired);
    this.desired.add(this.focus);
    this.direction.subVectors(this.desired, this.focus);
    const desiredLength = this.direction.length();
    this.desiredDistance = desiredLength;
    this.direction.divideScalar(desiredLength);
    this.cast(this.focus, this.direction, desiredLength);
    let hitDistance: number | null = this.intersections[0]?.distance ?? null;
    this.visibilityTarget.set(focus.x, focus.y + 0.4, focus.z);
    hitDistance = this.nearestBoomObstruction(this.visibilityTarget, hitDistance);
    this.visibilityTarget.y = focus.y - 0.5;
    hitDistance = this.nearestBoomObstruction(this.visibilityTarget, hitDistance);
    // Move inward immediately to avoid crossing a wall; release the obstruction smoothly.
    this.boomLength = approachCameraDistance(this.boomLength, desiredLength, hitDistance, dt);
    this.direction.subVectors(this.desired, this.focus).normalize();
    this.camera.position.copy(this.focus).addScaledVector(this.direction, this.boomLength);
    const strength = Math.max(0, shake) * 0.3;
    if (strength > 0) {
      this.camera.position.x += (Math.random() * 2 - 1) * strength;
      this.camera.position.y += (Math.random() * 2 - 1) * strength;
      this.camera.position.z += (Math.random() * 2 - 1) * strength;
    }
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, this.bounds.minX - 45, this.bounds.maxX + 45);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, this.bounds.minZ - 45, this.bounds.maxZ + 45);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, 1.5, 100);
    this.direction.subVectors(this.camera.position, this.focus);
    // Shake must not violate the minimum boom distance either.
    if (this.direction.lengthSq() < 16) this.camera.position.copy(this.focus).addScaledVector(this.direction.normalize(), 4);
    this.actualDistance = this.camera.position.distanceTo(this.focus);
    this.lookAt.copy(this.focus);
    this.lookAt.x += Math.sin(this.viewYaw) * 2.5;
    this.lookAt.z += Math.cos(this.viewYaw) * 2.5;
    this.lookAt.y += 0.3;
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld(true);

    this.faded.clear();
    // Test the rendered leader, not just the lagging follow focus. At the 4m limit
    // a wall can still lie between camera and leader, so fading is independent of pull-in.
    this.collectOccluders(this.focus);
    this.visibilityTarget.set(focus.x, focus.y + 0.4, focus.z); // head (~1.8m)
    this.collectOccluders(this.visibilityTarget);
    this.visibilityTarget.y = focus.y - 0.5; // torso (~0.9m)
    this.collectOccluders(this.visibilityTarget);
    return this.faded;
  }

  debugCamera(): { occluderHits: string[]; cameraPos: Vec3; desiredDistance: number; actualDistance: number } {
    return {
      occluderHits: Array.from(this.faded, object => object.name || object.uuid),
      cameraPos: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      desiredDistance: this.desiredDistance,
      actualDistance: this.actualDistance,
    };
  }

  private collectOccluders(target: THREE.Vector3): void {
    this.direction.subVectors(target, this.camera.position);
    const distance = this.direction.length();
    if (distance === 0) return;
    this.direction.divideScalar(distance);
    this.cast(this.camera.position, this.direction, distance);
    for (const intersection of this.intersections) this.faded.add(intersection.object);
  }

  private nearestBoomObstruction(origin: THREE.Vector3, nearest: number | null): number | null {
    this.direction.subVectors(this.desired, origin);
    const length = this.direction.length();
    if (length === 0) return nearest;
    this.direction.divideScalar(length);
    this.cast(origin, this.direction, length);
    const hit = this.intersections[0];
    // Express the head/torso ray's hit as a fraction of the central camera boom.
    return hit ? Math.min(nearest ?? Infinity, hit.distance / length * this.desiredDistance) : nearest;
  }

  private cast(origin: THREE.Vector3, direction: THREE.Vector3, distance: number): void {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0;
    this.raycaster.far = distance;
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.occluders, false, this.intersections);
    // Even DoubleSide misses a segment wholly inside a volume. Expanded building
    // bounds and smoothed follow movement can put either end inside one.
    for (const object of this.occluders) {
      if (!(object instanceof THREE.Mesh) || !object.userData.occlusionVolume) continue;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      this.inverseWorld.copy(object.matrixWorld).invert();
      this.localOrigin.copy(origin).applyMatrix4(this.inverseWorld);
      if (!object.geometry.boundingBox!.containsPoint(this.localOrigin)) continue;
      let inside = this.insideHits.get(object);
      if (!inside) {
        inside = { object, distance: 0, point: new THREE.Vector3() };
        this.insideHits.set(object, inside);
      }
      inside.point.copy(origin);
      this.intersections.unshift(inside);
    }
  }
}
