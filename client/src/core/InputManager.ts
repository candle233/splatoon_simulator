import { PlayerInput, clamp } from '@ink/shared';

export class InputManager {
  private element: HTMLElement;
  private pointerLocked = false;
  private active = false;

  private keys: Record<string, boolean> = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false,
    ShiftRight: false
  };

  private mouseLeftDown = false;

  public yaw = 0;
  public pitch = 0;

  private mouseSensitivity = 0.0022;
  private onDebugToggleCallback?: () => void;

  constructor(element: HTMLElement, onDebugToggle?: () => void) {
    this.element = element;
    this.onDebugToggleCallback = onDebugToggle;
    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
    });

    window.addEventListener('blur', this.resetInputs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInputs();
    });
  }

  requestPointerLock(): void {
    this.active = true;
    if (!this.pointerLocked) {
      try {
        this.element.requestPointerLock();
      } catch {}
    }
  }

  isLocked(): boolean {
    return this.pointerLocked || this.active;
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
    if (this.pointerLocked) {
      this.active = true;
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault();
      if (this.onDebugToggleCallback) this.onDebugToggleCallback();
      return;
    }

    if (e.code in this.keys) {
      this.keys[e.code] = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code in this.keys) {
      this.keys[e.code] = false;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && (this.pointerLocked || this.active)) {
      this.mouseLeftDown = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeftDown = false;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked && !this.active) return;

    this.yaw -= e.movementX * this.mouseSensitivity;
    this.pitch -= e.movementY * this.mouseSensitivity;

    // Pitch clamped between -75 deg and +75 deg
    const maxPitch = (75 * Math.PI) / 180;
    this.pitch = clamp(this.pitch, -maxPitch, maxPitch);
  };

  resetInputs = (): void => {
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }
    this.mouseLeftDown = false;
  };

  getCurrentInput(seq: number): PlayerInput {
    let moveX = 0;
    let moveZ = 0;

    if (this.keys.KeyA) moveX -= 1;
    if (this.keys.KeyD) moveX += 1;
    if (this.keys.KeyW) moveZ -= 1;
    if (this.keys.KeyS) moveZ += 1;

    // Normalize diagonal movement
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > 1e-4) {
      moveX /= len;
      moveZ /= len;
    }

    const jump = Boolean(this.keys.Space);
    const squid = Boolean(this.keys.ShiftLeft || this.keys.ShiftRight);
    const fire = this.mouseLeftDown && (this.pointerLocked || this.active);

    return {
      seq,
      moveX,
      moveZ,
      yaw: this.yaw,
      pitch: this.pitch,
      jump,
      squid,
      fire,
      clientTime: Date.now()
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.resetInputs);
  }
}
