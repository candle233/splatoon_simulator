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
    ShiftRight: false,
    KeyQ: false,
    KeyE: false
  };

  private mouseLeftDown = false;
  private mouseRightDown = false;
  private mouseMiddleDown = false;

  private subWeaponFired = false;
  private specialFired = false;

  public yaw = 0;
  public pitch = 0;
  public chargeLevel = 0;
  private isCharging = false;
  private releasedChargerShot = false;
  private releasedChargeLevel = 0;
  private activeIsCharger = false;

  private mouseSensitivity = 0.0022;
  private onDebugToggleCallback?: () => void;
  private onLockChangeCallback?: (locked: boolean) => void;

  constructor(
    element: HTMLElement,
    onDebugToggle?: () => void,
    onLockChange?: (locked: boolean) => void
  ) {
    this.element = element;
    this.onDebugToggleCallback = onDebugToggle;
    this.onLockChangeCallback = onLockChange;
    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContextMenu);

    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
      // Fallback to active = true so controls function in iframes and devtools automation
      this.active = true;
    });

    window.addEventListener('blur', this.resetInputs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInputs();
    });
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  requestPointerLock(): void {
    this.active = true;
    if (!this.pointerLocked) {
      try {
        const lockRes = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
        if (lockRes && typeof lockRes.catch === 'function') {
          lockRes.catch(() => {
            // Pointer lock could fail if invoked without user gesture; fallback to active mode
            this.active = true;
          });
        }
      } catch {
        this.active = true;
      }
    }
  }

  isLocked(): boolean {
    return this.pointerLocked || this.active;
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
    this.active = this.pointerLocked;
    if (this.onLockChangeCallback) {
      this.onLockChangeCallback(this.pointerLocked);
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
    if (!(this.pointerLocked || this.active)) return;

    if (e.button === 0) {
      this.mouseLeftDown = true;
    } else if (e.button === 2) {
      this.mouseRightDown = true;
      e.preventDefault();
    } else if (e.button === 1) {
      this.mouseMiddleDown = true;
      e.preventDefault();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseLeftDown = false;
    } else if (e.button === 2) {
      this.mouseRightDown = false;
    } else if (e.button === 1) {
      this.mouseMiddleDown = false;
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

  updateCharge(dt: number, isCharger: boolean): void {
    this.activeIsCharger = isCharger;
    const isLocked = this.pointerLocked || this.active;

    if (isCharger) {
      if (this.mouseLeftDown && isLocked) {
        this.isCharging = true;
        this.chargeLevel = Math.min(1.0, this.chargeLevel + dt / 1.0);
      } else if (this.isCharging) {
        // Released mouse button -> trigger release shot!
        this.isCharging = false;
        this.releasedChargerShot = true;
        this.releasedChargeLevel = Math.max(0.2, this.chargeLevel);
        this.chargeLevel = 0;
      } else {
        this.chargeLevel = 0;
      }
    } else {
      this.isCharging = false;
      this.releasedChargerShot = false;
      this.releasedChargeLevel = 0;
      this.chargeLevel = 0;
    }
  }

  resetInputs = (): void => {
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
    this.mouseMiddleDown = false;
    this.chargeLevel = 0;
    this.isCharging = false;
    this.releasedChargerShot = false;
    this.releasedChargeLevel = 0;
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

    if (squid && this.activeIsCharger) {
      this.isCharging = false;
      this.chargeLevel = 0;
      this.releasedChargerShot = false;
    }

    let fire = false;
    let chargeToSend = this.chargeLevel;

    if (this.activeIsCharger) {
      if (this.releasedChargerShot) {
        fire = true;
        chargeToSend = this.releasedChargeLevel;
        this.releasedChargerShot = false;
        this.releasedChargeLevel = 0;
      } else {
        fire = false;
      }
    } else {
      fire = this.mouseLeftDown && (this.pointerLocked || this.active);
    }

    const subPressed = this.mouseRightDown || Boolean(this.keys.KeyQ);
    let subWeapon = false;
    if (subPressed && !this.subWeaponFired && (this.pointerLocked || this.active)) {
      subWeapon = true;
      this.subWeaponFired = true;
    } else if (!subPressed) {
      this.subWeaponFired = false;
    }

    const specialPressed = this.mouseMiddleDown || Boolean(this.keys.KeyE);
    let special = false;
    if (specialPressed && !this.specialFired && (this.pointerLocked || this.active)) {
      special = true;
      this.specialFired = true;
    } else if (!specialPressed) {
      this.specialFired = false;
    }

    return {
      seq,
      moveX,
      moveZ,
      yaw: this.yaw,
      pitch: this.pitch,
      jump,
      squid,
      fire,
      subWeapon,
      special,
      chargeLevel: chargeToSend,
      clientTime: Date.now()
    };
  }

  /**
   * Subagent 05 API: Returns current network input payload with sequence number
   */
  getNetworkInput(seq: number): PlayerInput {
    return this.getCurrentInput(seq);
  }

  /**
   * Subagent 05 API: Returns normalized frame input
   */
  getFrameInput(): {
    moveX: number;
    moveZ: number;
    jump: boolean;
    squid: boolean;
    fire: boolean;
    yaw: number;
    pitch: number;
  } {
    const input = this.getCurrentInput(0);
    return {
      moveX: input.moveX,
      moveZ: input.moveZ,
      jump: input.jump,
      squid: input.squid,
      fire: input.fire,
      yaw: input.yaw,
      pitch: input.pitch
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.resetInputs);
  }
}
