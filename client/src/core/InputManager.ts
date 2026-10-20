import { PlayerInput, WeaponType, clamp } from '@ink/shared';

/** Edge-triggered quick-chat requests the InputManager surfaces to the Game. */
export type EmoteRequest = 'booyah' | 'ouch' | 'ping';

/** Client-side mirror of the server's 0.5s emote rate limit (no useless network spam). */
const EMOTE_CLIENT_COOLDOWN_MS = 500;

/** Max ms between two A/D presses that counts as a dodge-roll double tap. */
const DODGE_TAP_WINDOW_MS = 280;

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
    KeyE: false,
    KeyZ: false,
    KeyC: false
  };

  private mouseLeftDown = false;
  private mouseRightDown = false;
  private mouseMiddleDown = false;

  private subWeaponFired = false;
  private specialFired = false;

  // Dualies dodge roll: double-tap A/D detection + one-shot pending flag
  private lastTapAAt = 0;
  private lastTapDAt = 0;
  private dodgePending = false;
  /** -1 = dodge left, 1 = dodge right (screen space). */
  private dodgeDir: 1 | -1 = 1;

  public yaw = 0;
  public pitch = 0;
  public chargeLevel = 0;
  private isCharging = false;
  private releasedChargerShot = false;
  private releasedChargeLevel = 0;
  private activeIsCharger = false;
  private activeWeaponType: WeaponType = 'shooter';

  private mouseSensitivity = 0.0022;
  private onDebugToggleCallback?: () => void;
  private onLockChangeCallback?: (locked: boolean) => void;
  private onWeaponCycleCallback?: (dir: number) => void;
  private onEmoteCallback?: (type: EmoteRequest) => void;
  /** Timestamp of the last accepted quick-chat request (client-side rate limit). */
  private lastEmoteAt = 0;

  setSensitivity(sens: number): void {
    this.mouseSensitivity = sens;
  }

  setOnEmote(callback: (type: EmoteRequest) => void): void {
    this.onEmoteCallback = callback;
  }

  /** Clears the client-side emote cooldown (match reset). */
  resetEmoteCooldown(): void {
    this.lastEmoteAt = 0;
  }

  setActiveWeapon(weapon: WeaponType): void {
    this.activeWeaponType = weapon;
  }

  setOnWeaponCycle(callback: (dir: number) => void): void {
    this.onWeaponCycleCallback = callback;
  }

  isChargingWeapon(): boolean {
    return this.isCharging;
  }

  resetCharge(): void {
    this.isCharging = false;
    this.chargeLevel = 0;
    this.releasedChargerShot = false;
    this.releasedChargeLevel = 0;
  }

  isAimingDownSights(weaponType?: WeaponType): boolean {
    const isLocked = this.pointerLocked || this.active;
    if (!isLocked) return false;
    if (this.keys.KeyZ || this.keys.KeyC) return true;
    const type = weaponType || this.activeWeaponType;
    if (type === 'marksman' && this.mouseRightDown) return true;
    return false;
  }

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
    window.addEventListener('wheel', this.onWheel, { passive: true });
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

  private onWheel = (e: WheelEvent): void => {
    if (!this.pointerLocked && !this.active) return;
    if (Math.abs(e.deltaY) < 5) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    if (this.onWeaponCycleCallback) {
      this.onWeaponCycleCallback(dir);
    }
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

    // Quick-chat edge triggers (one-shot per press). D-pad Up / Arrow Up =
    // Booyah!, D-pad Down / Arrow Down = Ouch!, G = tactical map ping. The
    // 0.5s client throttle mirrors the server's rate limit.
    if (!e.repeat && (this.pointerLocked || this.active)) {
      const emote =
        e.code === 'ArrowUp' || e.code === 'DpadUp'
          ? 'booyah'
          : e.code === 'ArrowDown' || e.code === 'DpadDown'
            ? 'ouch'
            : e.code === 'KeyG'
              ? 'ping'
              : null;
      if (emote) {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastEmoteAt >= EMOTE_CLIENT_COOLDOWN_MS) {
          this.lastEmoteAt = now;
          if (this.onEmoteCallback) this.onEmoteCallback(emote);
        }
        return;
      }

      // Dualies dodge roll: double-tap A / D within the tap window while the
      // twin pistols are in hand. One-shot per detection.
      if (e.code === 'KeyA' || e.code === 'KeyD') {
        const now = performance.now();
        const lastTap = e.code === 'KeyA' ? this.lastTapAAt : this.lastTapDAt;
        if (now - lastTap <= DODGE_TAP_WINDOW_MS) {
          // Consume the tap so a third press does not chain a second dodge.
          if (e.code === 'KeyA') this.lastTapAAt = 0;
          else this.lastTapDAt = 0;
          if (this.activeWeaponType === 'dualies' && !this.dodgePending) {
            this.dodgePending = true;
            this.dodgeDir = e.code === 'KeyA' ? -1 : 1;
          }
        } else {
          if (e.code === 'KeyA') this.lastTapAAt = now;
          else this.lastTapDAt = now;
        }
      }
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
    this.dodgePending = false;
    this.lastTapAAt = 0;
    this.lastTapDAt = 0;
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

    const isMarksmanAds = this.activeWeaponType === 'marksman' && this.mouseRightDown;
    const subPressed = (!isMarksmanAds && this.mouseRightDown) || Boolean(this.keys.KeyQ);
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

    // Dodge roll: one-shot flag consumed here so each double tap sends a
    // single dodge request alongside the movement keys still held.
    let dodge = false;
    if (this.dodgePending) {
      dodge = true;
      this.dodgePending = false;
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
      dodge,
      chargeLevel: chargeToSend,
      clientTime: Date.now()
    };
  }

  /**
   * Returns the pending dodge request (one-shot): 0 = none, -1 = left, 1 =
   * right. The Game uses the direction for the dodge tilt visual.
   */
  consumeDodgeDirection(): 0 | 1 | -1 {
    if (!this.dodgePending) return 0;
    this.dodgePending = false;
    return this.dodgeDir;
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
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.resetInputs);
  }
}
