// [3D] Reusable scripted camera driver (docs/4_intro_scene.md §3). Animates the EXISTING game camera along
// Catmull-Rom keyframe paths in script time; it never owns a scene, a render loop or input.
import * as THREE from 'three';
import {
  blendPose, createPose, ease, sampleCameraPath, type CameraKey, type CameraPose,
} from './cinematicMath';

export class CinematicController {
  private keys: CameraKey[] = [];
  private readonly pose = createPose();
  private readonly exitFrom = createPose();
  private readonly exitTo = createPose();
  private readonly exitMid = createPose();
  private readonly look = new THREE.Vector3();
  private exitKeys: CameraKey[] | null = null;
  private exitStart = 0;
  private exitDuration = 0;
  private finalKey: CameraKey | null = null;
  /** Authored FOV of the last applied pose (before narrow-screen widening). */
  private rawFov = 55;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Loads a path. `finalPose` (the gameplay camera) is appended as the last key at `endTime`. */
  load(keys: readonly CameraKey[], endTime: number, finalPose: CameraPose): void {
    this.finalKey = { t: endTime, pos: { ...finalPose.pos }, look: { ...finalPose.look }, fov: finalPose.fov, ease: 'inOut' };
    this.keys = [...keys.filter(k => k.t < endTime), this.finalKey];
    this.exitKeys = null;
  }

  get endTime(): number { return this.finalKey?.t ?? 0; }

  /**
   * Leave the authored path early (Skip Intro): from the current pose, rise over the rooftops and settle into the
   * gameplay pose over `duration` seconds — the same final pose the full sequence ends on.
   */
  beginExit(now: number, duration: number): void {
    if (!this.finalKey) return;
    this.capture(this.exitFrom);
    this.exitFrom.fov = this.rawFov; // widening is re-applied (and faded out) during the exit
    const to = this.exitTo;
    to.pos = { ...this.finalKey.pos }; to.look = { ...this.finalKey.look }; to.fov = this.finalKey.fov;
    blendPose(this.exitFrom, to, 0.5, this.exitMid);
    this.exitMid.pos.y = Math.max(this.exitFrom.pos.y, to.pos.y) + 9;
    this.exitStart = now;
    this.exitDuration = Math.max(0.1, duration);
    this.exitKeys = [
      { t: 0, ...clonePose(this.exitFrom) },
      { t: 0.5, ...clonePose(this.exitMid) },
      { t: 1, ...clonePose(to) },
    ];
  }

  /** True once the camera has arrived on the gameplay pose. */
  isDone(now: number): boolean {
    if (this.exitKeys) return now >= this.exitStart + this.exitDuration;
    return now >= this.endTime;
  }

  /** Writes the pose for script time `now` into the camera. Pure function of time => frame-rate independent. */
  apply(now: number): void {
    let narrowWeight: number;
    if (this.exitKeys) {
      const u = ease('inOut', (now - this.exitStart) / this.exitDuration);
      sampleCameraPath(this.exitKeys, u, this.pose);
      narrowWeight = 1 - u;
    } else {
      sampleCameraPath(this.keys, now, this.pose);
      narrowWeight = Math.min(1, Math.max(0, (this.endTime - now) / NARROW_FADE_S));
    }
    this.rawFov = this.pose.fov;
    this.pose.fov = narrowScreenFov(this.pose.fov, this.camera.aspect, narrowWeight);
    const cam = this.camera;
    cam.position.set(this.pose.pos.x, this.pose.pos.y, this.pose.pos.z);
    this.look.set(this.pose.look.x, this.pose.look.y, this.pose.look.z);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.pose.fov) > 1e-4) {
      cam.fov = this.pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
  }

  /** Current look-at point (for chunk streaming / culling focus). */
  get lookTarget(): Readonly<CameraPose['look']> { return this.pose.look; }

  /** Reads the camera's current pose (look target 10 m along its view direction when unknown). */
  capture(out: CameraPose): CameraPose {
    const cam = this.camera;
    out.pos.x = cam.position.x; out.pos.y = cam.position.y; out.pos.z = cam.position.z;
    cam.getWorldDirection(this.look);
    const d = Math.max(4, Math.hypot(this.pose.look.x - cam.position.x, this.pose.look.y - cam.position.y, this.pose.look.z - cam.position.z));
    out.look.x = cam.position.x + this.look.x * d;
    out.look.y = cam.position.y + this.look.y * d;
    out.look.z = cam.position.z + this.look.z * d;
    out.fov = cam.fov;
    return out;
  }
}

/** Shots are framed for >= REF_ASPECT; narrower (portrait) screens widen the FOV to keep the subject in frame. */
const REF_ASPECT = 1.2;
const MAX_FOV = 80;
/** The widening eases out over the last seconds so the handoff lands exactly on the gameplay FOV. */
const NARROW_FADE_S = 2.5;

export function narrowScreenFov(fov: number, aspect: number, weight: number): number {
  if (!(aspect > 0) || aspect >= REF_ASPECT || weight <= 0) return fov;
  const half = (fov * Math.PI) / 360;
  const wide = Math.min(MAX_FOV, (Math.atan(Math.tan(half) * (REF_ASPECT / aspect)) * 360) / Math.PI);
  return fov + (Math.max(fov, wide) - fov) * Math.min(1, weight);
}

function clonePose(p: CameraPose): CameraPose {
  return { pos: { ...p.pos }, look: { ...p.look }, fov: p.fov };
}
