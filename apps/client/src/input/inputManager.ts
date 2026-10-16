import { PlayerInput } from '@aerial-arena/shared';
import { ActionId, settings } from '../settings/settingsStore.js';

/**
 * Keyboard / mouse + gamepad input.
 *
 * Keyboard and mouse bindings come from the settings store (rebindable in Settings → Controls);
 * mouse buttons bind as "Mouse0" (left), "Mouse1" (middle), "Mouse2" (right).
 * In the air the throttle keys pitch (throttle = nose down) and steer keys yaw;
 * holding powerslide in the air turns steer into roll (free air roll).
 *
 * Gamepad (standard mapping, Xbox labels): RT throttle, LT reverse, left stick steer/pitch,
 * A jump, B boost, X powerslide/air roll, Y camera, LB/RB directional air roll, Start menu.
 */
export class InputManager {
  private keysHeld = new Set<string>();
  private jumpPressedEdge = false;
  private inputSeq = 0;
  private padButtonsPrev: boolean[] = [];
  private captureCallback: ((code: string | null) => void) | null = null;

  public onToggleCamera?: () => void;
  /** Ball Cam "hold" mode: fired with true on press and false on release. */
  public onHoldCamera?: (held: boolean) => void;
  public onResetBall?: () => void;
  public onResetCar?: () => void;
  public onToggleUnlimitedBoost?: () => void;
  public onLaunchBall?: () => void;
  public onPracticeShot?: () => void;
  public onBallOnHood?: () => void;
  public onTogglePause?: () => void;
  public onToggleHelp?: () => void;
  /** Fired after held keys are cleared because the window lost focus or was hidden. */
  public onFocusLost?: () => void;

  /** Set while a menu has focus so gameplay keys do not leak into the simulation. */
  public suspended = false;

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /** Capture the next key / mouse button for rebinding. Esc cancels (callback gets null). */
  captureNext(cb: (code: string | null) => void): void {
    this.captureCallback = cb;
  }

  private actionFor(code: string): ActionId | null {
    const binds = settings.get().keybinds;
    for (const id of Object.keys(binds) as ActionId[]) if (binds[id].includes(code)) return id;
    return null;
  }

  private held(action: ActionId): boolean {
    for (const c of settings.get().keybinds[action]) if (this.keysHeld.has(c)) return true;
    return false;
  }

  private press(code: string) {
    if (this.keysHeld.has(code)) return;
    this.keysHeld.add(code);
    const action = this.actionFor(code);
    // The menu key always works so a player can never lock themselves out of the menu.
    if (code === 'Escape' && action !== 'menu') {
      this.onTogglePause?.();
      return;
    }
    switch (action) {
      case 'jump':
        this.jumpPressedEdge = true;
        break;
      case 'ballCam':
        if (settings.get().camera.ballCamMode === 'hold') this.onHoldCamera?.(true);
        else this.onToggleCamera?.();
        break;
      case 'menu':
        this.onTogglePause?.();
        break;
      case 'help':
        this.onToggleHelp?.();
        break;
      case 'resetBall':
        this.onResetBall?.();
        break;
      case 'resetCar':
        this.onResetCar?.();
        break;
      case 'unlimitedBoost':
        this.onToggleUnlimitedBoost?.();
        break;
      case 'popBall':
        this.onLaunchBall?.();
        break;
      case 'lobBall':
        this.onPracticeShot?.();
        break;
      case 'ballOnHood':
        this.onBallOnHood?.();
        break;
    }
  }

  private release(code: string) {
    if (!this.keysHeld.delete(code)) return;
    if (this.actionFor(code) === 'ballCam' && settings.get().camera.ballCamMode === 'hold') this.onHoldCamera?.(false);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.captureCallback) {
      e.preventDefault();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(e.code === 'Escape' ? null : e.code);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (this.actionFor(e.code) || ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.press(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => this.release(e.code);

  private isGameSurface(e: MouseEvent) {
    return (e.target as HTMLElement | null)?.id === 'game-canvas' || (e.target as HTMLElement | null)?.id === 'ui-root';
  }

  private handleMouseDown = (e: MouseEvent) => {
    if (this.captureCallback && !(e.target as HTMLElement).closest('[data-capture-ignore]')) {
      e.preventDefault();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(`Mouse${e.button}`);
      return;
    }
    if (!this.isGameSurface(e)) return;
    this.press(`Mouse${e.button}`);
  };

  private handleMouseUp = (e: MouseEvent) => this.release(`Mouse${e.button}`);

  private handleContextMenu = (e: MouseEvent) => {
    if (this.isGameSurface(e)) e.preventDefault(); // right mouse is a valid bind
  };

  private handleBlur = () => {
    this.clearAll();
    this.onFocusLost?.();
  };

  private handleVisibilityChange = () => {
    if (document.hidden) this.handleBlur();
  };

  /** Keyboard look-around: x = -1 left .. 1 right (look behind = full turn). */
  public sampleLook(): { x: number; y: number } {
    if (this.suspended) return { x: 0, y: 0 };
    if (this.held('lookBehind')) return { x: 1, y: 0 };
    return { x: ((this.held('lookRight') ? 1 : 0) - (this.held('lookLeft') ? 1 : 0)) * 0.5, y: 0 };
  }

  public clearAll = () => {
    this.keysHeld.clear();
    this.jumpPressedEdge = false;
  };

  private readGamepad() {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
    if (!gp) return null;
    const dz = (v: number, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const val = (i: number) => gp.buttons[i]?.value ?? 0;
    const edge = (i: number) => btn(i) && !(this.padButtonsPrev[i] ?? false);
    const res = {
      steer: dz(gp.axes[0] ?? 0),
      pitch: dz(gp.axes[1] ?? 0), // stick up (negative) = nose down
      throttle: val(7) - val(6),
      jumpEdge: edge(0),
      jumpHeld: btn(0),
      boost: btn(1),
      powerslide: btn(2),
      rollLeft: btn(4),
      rollRight: btn(5),
      camEdge: edge(3),
      pauseEdge: edge(9),
      resetEdge: edge(8),
    };
    this.padButtonsPrev = gp.buttons.map((b) => b.pressed);
    return res;
  }

  public sampleInput(): PlayerInput {
    const pad = this.readGamepad();
    const h = (a: ActionId) => this.held(a);

    let throttle = (h('throttle') ? 1 : 0) - (h('reverse') ? 1 : 0);
    let steer = (h('steerRight') ? 1 : 0) - (h('steerLeft') ? 1 : 0);
    let pitch = -throttle; // keyboard: throttle key pitches the nose down in the air
    let roll = (h('airRollRight') ? 1 : 0) - (h('airRollLeft') ? 1 : 0);
    let jump = this.jumpPressedEdge;
    let jumpHeld = h('jump');
    let boost = h('boost');
    let powerslide = h('powerslide');
    this.jumpPressedEdge = false;

    if (pad) {
      if (pad.camEdge) this.onToggleCamera?.();
      if (pad.pauseEdge) this.onTogglePause?.();
      if (pad.resetEdge) this.onResetBall?.();
      if (Math.abs(pad.throttle) > Math.abs(throttle)) throttle = pad.throttle;
      if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
      if (Math.abs(pad.pitch) > 0) pitch = pad.pitch;
      jump = jump || pad.jumpEdge;
      jumpHeld = jumpHeld || pad.jumpHeld;
      boost = boost || pad.boost;
      powerslide = powerslide || pad.powerslide;
      if (pad.rollLeft || pad.rollRight) roll = (pad.rollRight ? 1 : 0) - (pad.rollLeft ? 1 : 0);
    }

    if (settings.get().invertAirPitch) pitch = -pitch; // air only; ground throttle is untouched

    // Free air roll: holding powerslide in the air turns steer into roll.
    let yaw = steer;
    if (powerslide) {
      if (roll === 0) roll = steer;
      yaw = 0;
    }

    if (this.suspended) {
      throttle = steer = pitch = yaw = roll = 0;
      jump = jumpHeld = boost = powerslide = false;
    }

    return {
      seq: ++this.inputSeq,
      timestamp: Date.now(),
      throttle,
      steer,
      pitch,
      yaw,
      roll,
      jump,
      jumpHeld,
      boost,
      powerslide,
    };
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
