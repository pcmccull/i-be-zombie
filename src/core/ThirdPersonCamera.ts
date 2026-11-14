import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { Vec3 } from './types';
import { approachAngle, cameraOffset } from './cameraMath';

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
  private lift = 0;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly intersections: THREE.Intersection[] = [];
  private readonly faded = new Set<THREE.Object3D>();

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
    this.lift = 0;
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
    cameraOffset(this.yaw, this.zoom, this.zoom * Math.tan(this.pitch), this.desired);
    this.desired.add(this.focus);
    this.direction.subVectors(this.desired, this.focus);
    const desiredLength = this.direction.length();
    this.direction.divideScalar(desiredLength);
    this.cast(this.focus, this.direction, desiredLength);
    const hit = this.intersections[0];
    const allowedLength = hit ? Math.min(desiredLength, Math.max(4, hit.distance - 0.65)) : desiredLength;
    // Move inward immediately to avoid crossing a wall; release the obstruction smoothly.
    this.boomLength = allowedLength < this.boomLength
      ? allowedLength
      : this.boomLength + (allowedLength - this.boomLength) * (1 - Math.exp(-5 * dt));
    this.lift += ((hit ? 0.7 : 0) - this.lift) * (1 - Math.exp(-12 * dt));
    this.camera.position.copy(this.focus).addScaledVector(this.direction, this.boomLength);
    this.camera.position.y += this.lift;
    const strength = Math.max(0, shake) * 0.3;
    if (strength > 0) {
      this.camera.position.x += (Math.random() * 2 - 1) * strength;
      this.camera.position.y += (Math.random() * 2 - 1) * strength;
      this.camera.position.z += (Math.random() * 2 - 1) * strength;
    }
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, BALANCE.world.minX - 45, BALANCE.world.maxX + 45);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, BALANCE.world.minZ - 45, BALANCE.world.maxZ + 45);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, 1.5, 100);
    this.lookAt.copy(this.focus);
    this.lookAt.x += Math.sin(this.yaw) * 2.5;
    this.lookAt.z += Math.cos(this.yaw) * 2.5;
    this.lookAt.y += 0.3;
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld(true);

    this.direction.subVectors(this.camera.position, this.focus);
    const actualLength = this.direction.length();
    this.direction.divideScalar(actualLength);
    this.cast(this.focus, this.direction, actualLength);
    this.faded.clear();
    for (const intersection of this.intersections) this.faded.add(intersection.object);
    return this.faded;
  }

  private cast(origin: THREE.Vector3, direction: THREE.Vector3, distance: number): void {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0;
    this.raycaster.far = distance;
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.occluders, false, this.intersections);
  }
}
