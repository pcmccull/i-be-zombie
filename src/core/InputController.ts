import * as THREE from 'three';
import type { HordeCommand, SimInput, TargetRef, Vec2 } from './types';
import {
  abilitySlotForKey,
  hordeCommandForRightClick,
  isClick,
  keyActionFor,
  keyAllowedWhileModal,
  type KeyAction,
  isInitialLockJump,
  pickNearestScreenTarget,
  type ScreenTarget,
} from './cameraMath';

interface InputDependencies {
  camera: THREE.Camera;
  pickables: () => THREE.Object3D[];
  occluders: THREE.Object3D[];
  onOrbit(dx: number, dy: number): void;
  onZoom(deltaY: number): void;
  /** One-shot key actions (recenter, help, debug, mute, map, pause). Regroup/follow become horde commands here. */
  onKey(action: Exclude<KeyAction, 'regroup' | 'follow'>): void;
  onFirstGesture(): void;
  canLock?: () => boolean;
  /** Pause menu / world map open: game keys and canvas orders are ignored. */
  isModal?: () => boolean;
  /** Offered every key press first; return true when a UI panel (nest panel) consumed it. */
  onUiKey?: (key: string) => boolean;
  /** Pointer lock was lost without the game asking for it (browser Esc, alt-tab). */
  onLockLost?: () => void;
}

function isEditing(target: EventTarget | null): boolean {
  return target instanceof Element && (
    target.closest('input, textarea, select') !== null ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export class InputController {
  private readonly listeners = new AbortController();
  private readonly keys = new Set<string>();
  private attackEdge = false;
  private aimPoint: Vec2 | null = null;
  private command: HordeCommand | null = null;
  private abilitySlot: number | null = null;
  private expectedUnlock = false;
  private lockLostAt = -1e9;
  private hover: TargetRef | null = null;
  private pointerId: number | null = null;
  private pointerButton = -1;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private pointerKnown = false;
  private dragged = false;
  private firstMoveAfterLock = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly groundPoint = new THREE.Vector3();
  private readonly candidates: THREE.Object3D[] = [];
  private readonly intersections: THREE.Intersection[] = [];
  private readonly sightRaycaster = new THREE.Raycaster();
  private readonly sightHits: THREE.Intersection[] = [];
  private readonly cameraPosition = new THREE.Vector3();
  private readonly worldCenter = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly sightDirection = new THREE.Vector3();
  private readonly localCameraPosition = new THREE.Vector3();
  private readonly inverseWorld = new THREE.Matrix4();
  private readonly targets: THREE.Object3D[] = [];
  private readonly screenPoints: ScreenTarget<number>[] = [];
  private readonly screenPointPool: ScreenTarget<number>[] = [];
  private readonly previousTouchAction: string;
  private readonly previousTabIndex: string | null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly deps: InputDependencies) {
    this.previousTouchAction = canvas.style.touchAction;
    this.previousTabIndex = canvas.getAttribute('tabindex');
    canvas.style.touchAction = 'none';
    canvas.tabIndex = 0;
    const signal = this.listeners.signal;
    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    // Capture also sees gestures on the onboarding/HUD overlay.
    window.addEventListener('pointerdown', this.onGesture, { capture: true, signal });
    canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    window.addEventListener('pointermove', this.onPointerMove, { signal });
    window.addEventListener('pointerup', this.onPointerUp, { signal });
    window.addEventListener('pointercancel', this.onPointerCancel, { signal });
    canvas.addEventListener('lostpointercapture', this.onPointerCancel, { signal });
    canvas.addEventListener('pointerleave', this.onPointerLeave, { signal });
    canvas.addEventListener('contextmenu', this.onContextMenu, { signal });
    canvas.addEventListener('wheel', this.onWheel, { passive: false, signal });
    document.addEventListener('mousemove', this.onMouseMove, { signal });
    document.addEventListener('pointerlockchange', this.onPointerLockChange, { signal });
    document.addEventListener('pointerlockerror', this.onPointerLockError, { signal });
    window.addEventListener('blur', this.onBlur, { signal });
    document.addEventListener('visibilitychange', this.onVisibility, { signal });
  }

  get hovered(): TargetRef | null { return this.hover; }
  get isLocked(): boolean {
    return (
      typeof document !== 'undefined' &&
      'pointerLockElement' in document &&
      document.pointerLockElement === this.canvas
    );
  }
  /** Keyboard camera orbit axis: X = +1 (orbit right), Z = -1 (orbit left). */
  get cameraTurn(): number { return Number(this.keys.has('KeyX')) - Number(this.keys.has('KeyZ')); }
  /** Hold V to swing the camera around and look behind the leader at the horde. */
  get lookBack(): boolean { return this.keys.has('KeyV'); }

  /** Builds one step's input. Edge fields (attack, command, ability) are consumed; legacy fields stay false/null. */
  buildSimInput(cameraYaw: number): SimInput {
    const modal = this.modal();
    const held = (a: string, b: string): number => modal ? 0 : Number(this.keys.has(a) || this.keys.has(b));
    const input: SimInput = {
      moveForward: held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'),
      moveRight: held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'),
      cameraYaw,
      sprint: !modal && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
      rally: false, rush: false, recall: false, attackTarget: null,
      attack: this.attackEdge, aimPoint: this.attackEdge ? this.aimPoint : null,
      hordeCommand: this.command, abilitySlot: this.abilitySlot, equip: null,
    };
    this.attackEdge = false;
    this.aimPoint = null;
    this.command = null;
    this.abilitySlot = null;
    return input;
  }

  private modal(): boolean { return this.deps.isModal?.() === true; }

  updateHover(): void {
    if (this.isLocked) {
      const rect = this.canvas.getBoundingClientRect();
      this.hover = this.pick(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
      return;
    }
    this.hover = this.pointerKnown ? this.pick(this.lastX, this.lastY) : null;
  }

  /** Request mouse capture from inside a user gesture (intro / restart click). Returns false if not possible now. */
  requestPointerLock(): boolean {
    return this.tryRequestPointerLock();
  }

  exitPointerLock(): void {
    this.firstMoveAfterLock = false;
    if (this.isLocked && typeof document.exitPointerLock === 'function') {
      this.expectedUnlock = true;
      try {
        document.exitPointerLock();
      } catch {
        // Ignore if browser disallows exitPointerLock
      }
    }
  }

  clear(): void {
    this.keys.clear();
    this.attackEdge = false;
    this.aimPoint = null;
    this.command = null;
    this.abilitySlot = null;
    this.hover = null;
    this.pointerKnown = false;
    this.firstMoveAfterLock = false;
    this.releasePointer();
  }

  dispose(): void {
    this.exitPointerLock();
    this.listeners.abort();
    this.clear();
    this.canvas.style.touchAction = this.previousTouchAction;
    if (this.previousTabIndex === null) this.canvas.removeAttribute('tabindex');
    else this.canvas.setAttribute('tabindex', this.previousTabIndex);
  }

  private isPointerLockSupported(): boolean {
    return (
      typeof document !== 'undefined' &&
      'pointerLockElement' in document &&
      typeof this.canvas.requestPointerLock === 'function'
    );
  }

  private tryRequestPointerLock(): boolean {
    if (!this.isPointerLockSupported()) return false;
    const canLock = this.deps.canLock ? this.deps.canLock() : !this.isLocked;
    if (!canLock) return false;
    try {
      this.firstMoveAfterLock = true;
      const result: unknown = this.canvas.requestPointerLock();
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => {
          this.onPointerLockError();
        });
      }
      return true;
    } catch {
      this.onPointerLockError();
      return false;
    }
  }

  private readonly onGesture = (): void => { this.deps.onFirstGesture(); };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.deps.onFirstGesture();
    if (isEditing(event.target)) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3'].includes(event.code)) event.preventDefault();
    if (!event.repeat && this.deps.onUiKey?.(event.key)) return;
    if (!keyAllowedWhileModal(event.code, this.modal())) return;
    const alreadyHeld = this.keys.has(event.code);
    this.keys.add(event.code);
    if (event.repeat || alreadyHeld) return;
    const slot = abilitySlotForKey(event.code);
    if (slot !== null) { this.abilitySlot = slot; return; }
    const action = keyActionFor(event.code);
    if (action === 'regroup') this.command = { type: 'regroup' };
    else if (action === 'follow') this.command = { type: 'follow' };
    else if (action === 'pause') {
      // Browsers swallow the Esc that leaves pointer lock; if both arrive, do not toggle twice.
      if (performance.now() - this.lockLostAt > 250) this.deps.onKey('pause');
    } else if (action) this.deps.onKey(action);
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    // Always release a previously held key even if focus moved into an editor.
    this.keys.delete(event.code);
    if (!isEditing(event.target) && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3'].includes(event.code)) event.preventDefault();
  };
  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.isLocked) return;
    const mx = event.movementX;
    const my = event.movementY;
    if (mx === 0 && my === 0) return;
    const firstMove = this.firstMoveAfterLock;
    this.firstMoveAfterLock = false;
    if (isInitialLockJump(mx, my, firstMove)) return;
    this.deps.onOrbit(mx, my);
  };
  private readonly onPointerLockChange = (): void => {
    const locked = this.isLocked;
    this.firstMoveAfterLock = locked;
    if (locked) {
      this.pointerKnown = true;
      this.releasePointer();
    } else {
      this.pointerKnown = false;
      this.hover = null;
      this.releasePointer();
      const asked = this.expectedUnlock;
      this.expectedUnlock = false;
      if (!asked) {
        this.lockLostAt = performance.now();
        this.deps.onLockLost?.();
      }
    }
  };
  private readonly onPointerLockError = (): void => {
    this.firstMoveAfterLock = false;
    this.releasePointer();
  };
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    if (this.modal()) return;
    if (this.isLocked) {
      // Captured mouse: act immediately on the crosshair (no drag possible).
      const rect = this.canvas.getBoundingClientRect();
      this.handleClick(event.button, rect.left + rect.width * 0.5, rect.top + rect.height * 0.5, event.shiftKey, event.ctrlKey);
      return;
    }
    this.pointerId = event.pointerId;
    this.pointerButton = event.button;
    this.downX = this.lastX = event.clientX;
    this.downY = this.lastY = event.clientY;
    this.pointerKnown = true;
    this.dragged = false;
    if (!this.isLocked) {
      // Capture clicks too so releasing outside the canvas cannot leave a stuck button.
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture is unavailable
      }
    }
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.isLocked) return;
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    if (this.pointerId === null && event.target !== this.canvas) {
      this.pointerKnown = false;
      this.hover = null;
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.pointerKnown = true;
    if (this.pointerId === null) return;
    const buttonMask = this.pointerButton === 2 ? 2 : 1;
    if (!(event.buttons & buttonMask)) { this.releasePointer(); return; }
    if (!this.dragged && !isClick(this.downX, this.downY, event.clientX, event.clientY)) this.dragged = true;
    // Either button drags the camera around; a click (no drag) still issues orders.
    if (this.dragged) this.deps.onOrbit(dx, dy);
  };
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || event.button !== this.pointerButton) return;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (!this.dragged && isClick(this.downX, this.downY, event.clientX, event.clientY) && !this.modal()) {
      // Free cursor: a click acts on whatever is under the pointer (point-and-click horde orders).
      this.handleClick(this.pointerButton, event.clientX, event.clientY, event.shiftKey, event.ctrlKey);
    }
    this.releasePointer();
  };

  /** LMB = Alpha attack (aimed at the ground point under the pointer/crosshair); RMB = horde command. */
  private handleClick(button: number, x: number, y: number, shift: boolean, ctrl: boolean): void {
    if (button === 0) {
      this.attackEdge = true;
      this.aimPoint = this.groundAt(x, y);
      return;
    }
    if (button !== 2) return;
    const target = shift ? null : this.pick(x, y);
    let ground: Vec2 | null = null;
    if (!shift && !target) {
      // pick() leaves the nearest solid hit in this.intersections; a building in front of the ground point blocks the order.
      const blockedAt = this.intersections[0]?.distance ?? Infinity;
      ground = this.groundAt(x, y);
      if (ground && blockedAt < this.raycaster.ray.origin.distanceTo(this.groundPoint) - 0.75) ground = null;
    }
    const command = hordeCommandForRightClick({ target, ground, shift, ctrl });
    if (command) this.command = command;
  }

  private groundAt(x: number, y: number): Vec2 | null {
    if (!this.setPointerRay(x, y) || !this.raycaster.ray.intersectPlane(this.ground, this.groundPoint)) return null;
    return { x: this.groundPoint.x, z: this.groundPoint.z };
  }

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.releasePointer();
  };
  private readonly onPointerLeave = (): void => {
    if (this.isLocked) return;
    if (this.pointerId === null) { this.pointerKnown = false; this.hover = null; }
  };
  private readonly onContextMenu = (event: MouseEvent): void => { event.preventDefault(); };
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Normalize line/page wheels to pixel-like units.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1;
    this.deps.onZoom(event.deltaY * scale);
  };
  private readonly onBlur = (): void => { this.clear(); };
  private readonly onVisibility = (): void => { if (document.hidden) this.clear(); };

  private releasePointer(): void {
    const id = this.pointerId;
    this.pointerId = null;
    this.pointerButton = -1;
    this.dragged = false;
    if (id !== null && !this.isLocked && this.canvas.hasPointerCapture(id)) {
      try {
        this.canvas.releasePointerCapture(id);
      } catch {
        // Ignore if pointer capture is already released
      }
    }
  }

  private setPointerRay(x: number, y: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
    this.deps.camera.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
    return true;
  }

  private pick(x: number, y: number): TargetRef | null {
    if (!this.setPointerRay(x, y)) return null;
    this.candidates.length = 0;
    this.targets.length = 0;
    for (const object of this.deps.pickables()) {
      if (object.userData.target) {
        this.targets.push(object);
        this.candidates.push(object);
      }
    }
    for (const object of this.deps.occluders) {
      if (object.userData.ignorePickOcclusion) continue;
      if (!this.candidates.includes(object)) this.candidates.push(object);
    }
    for (const object of this.candidates) object.updateWorldMatrix(true, false);
    this.intersections.length = 0;
    this.raycaster.intersectObjects(this.candidates, false, this.intersections);
    const direct = this.intersections[0]?.object.userData.target as TargetRef | undefined;
    if (direct) return direct;

    // Missed a small/moving proxy: use the same visible-center tolerance for clicks and hover.
    const rect = this.canvas.getBoundingClientRect();
    this.deps.camera.getWorldPosition(this.cameraPosition);
    this.screenPoints.length = 0;
    for (let i = 0; i < this.targets.length; i++) {
      const object = this.targets[i];
      if (object instanceof THREE.Mesh) {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        object.geometry.boundingBox!.getCenter(this.worldCenter).applyMatrix4(object.matrixWorld);
      } else object.getWorldPosition(this.worldCenter);
      this.projected.copy(this.worldCenter).project(this.deps.camera);
      // Exclude centers behind the camera or outside its near/far clip planes.
      if (this.projected.z < -1 || this.projected.z > 1) continue;
      const sx = rect.left + (this.projected.x + 1) * rect.width * 0.5;
      const sy = rect.top + (1 - this.projected.y) * rect.height * 0.5;
      if ((sx - x) ** 2 + (sy - y) ** 2 > 28 * 28) continue;
      this.sightDirection.subVectors(this.worldCenter, this.cameraPosition);
      const distance = this.sightDirection.length();
      if (distance <= 0) continue;
      this.sightDirection.divideScalar(distance);
      this.sightRaycaster.set(this.cameraPosition, this.sightDirection);
      this.sightRaycaster.far = distance;
      this.sightHits.length = 0;
      this.sightRaycaster.intersectObjects(this.deps.occluders, false, this.sightHits);
      // The gate's own solid volume is part of the target, not cover in front of it.
      let blocked = false;
      for (const hit of this.sightHits) {
        if (hit.object.userData.ignorePickOcclusion) continue;
        if (hit.object !== object && hit.object.userData.pickTarget !== object) { blocked = true; break; }
      }
      // A segment wholly inside a building proxy has no surface intersection.
      // Do not allow tolerance picking through that volume either.
      if (!blocked) {
        for (const occluder of this.deps.occluders) {
          if (!(occluder instanceof THREE.Mesh) || !occluder.userData.occlusionVolume || occluder.userData.ignorePickOcclusion) continue;
          if (!occluder.geometry.boundingBox) occluder.geometry.computeBoundingBox();
          this.inverseWorld.copy(occluder.matrixWorld).invert();
          this.localCameraPosition.copy(this.cameraPosition).applyMatrix4(this.inverseWorld);
          if (occluder.geometry.boundingBox!.containsPoint(this.localCameraPosition)) { blocked = true; break; }
        }
      }
      if (blocked) continue;
      const slot = this.screenPoints.length;
      const point = this.screenPointPool[slot] ?? (this.screenPointPool[slot] = { x: 0, y: 0, id: 0 });
      point.x = sx;
      point.y = sy;
      point.id = i;
      this.screenPoints.push(point);
    }
    const nearest = pickNearestScreenTarget(this.screenPoints, x, y, 28);
    return nearest === null ? null : this.targets[nearest].userData.target as TargetRef;
  }
}
