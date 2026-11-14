import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { Vec3 } from './types';
import { approachAngle, approachCameraDistance, cameraOffset } from './cameraMath';

const DEFAULT_PITCH = Math.atan(11 / 14);
const MIN_PITCH = 20 * Math.PI / 180;
const MAX_PITCH = 65 * Math.PI / 180;

export class ThirdPersonCamera {
  yaw = 0;
  pitch = DEFAULT_PITCH;
  zoom = 14;

  private targetZoom = 14;
  private sinceOrbit = 0;
  private recentering = false;
  private initialized = false;
  private boomLength = 0;
  private desiredDistance = 0;
  private actualDistance = 0;
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
    this.yaw -= dxPx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dyPx * 0.005, MIN_PITCH, MAX_PITCH);
    this.sinceOrbit = 0;
    this.recentering = false;
  }

  addZoom(wheelDeltaY: number): void {
    this.targetZoom = THREE.MathUtils.clamp(this.targetZoom + wheelDeltaY * 0.018, 8, 32);
  }

  recenter(): void { this.recentering = true; }

  reset(leaderFacing: number, focus: Vec3): void {
    this.yaw = leaderFacing;
    this.pitch = DEFAULT_PITCH;
    this.zoom = this.targetZoom = 14;
    this.sinceOrbit = 0;
    this.recentering = false;
    this.focus.copy(focus);
    this.boomLength = Math.hypot(14, 11);
    this.faded.clear();
    this.initialized = true;
    this.update(0, focus, leaderFacing, false, 0);
  }

  update(dt: number, focus: Vec3, leaderFacing: number, leaderMoving: boolean, shake: number): Set<THREE.Object3D> {
    dt = Math.max(0, dt);
    if (!this.initialized) this.reset(leaderFacing, focus);
    this.sinceOrbit += dt;
    const diff = Math.atan2(Math.sin(leaderFacing - this.yaw), Math.cos(leaderFacing - this.yaw));
    if (this.recentering) {
      this.yaw = approachAngle(this.yaw, leaderFacing, Math.abs(diff) * (1 - Math.exp(-12 * dt)));
      if (Math.abs(diff) < 0.002) this.recentering = false;
    } else if (this.sinceOrbit >= 1.5 && leaderMoving && Math.abs(diff) < 100 * Math.PI / 180) {
      this.yaw = approachAngle(this.yaw, leaderFacing, 0.6 * dt);
    }
    this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-10 * dt));
    this.focus.lerp(focus, 1 - Math.exp(-22 * dt));
    // Raycasts also run before the first render and after scene transforms change.
    for (const occluder of this.occluders) occluder.updateWorldMatrix(true, false);
    cameraOffset(this.yaw, this.zoom, this.zoom * Math.tan(this.pitch), this.desired);
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
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, BALANCE.world.minX - 45, BALANCE.world.maxX + 45);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, BALANCE.world.minZ - 45, BALANCE.world.maxZ + 45);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, 1.5, 100);
    this.direction.subVectors(this.camera.position, this.focus);
    // Shake must not violate the minimum boom distance either.
    if (this.direction.lengthSq() < 16) this.camera.position.copy(this.focus).addScaledVector(this.direction.normalize(), 4);
    this.actualDistance = this.camera.position.distanceTo(this.focus);
    this.lookAt.copy(this.focus);
    this.lookAt.x += Math.sin(this.yaw) * 2.5;
    this.lookAt.z += Math.cos(this.yaw) * 2.5;
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
