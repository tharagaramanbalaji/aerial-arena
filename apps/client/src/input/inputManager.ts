import { PlayerInput } from '@aerial-arena/shared';

export class InputManager {
  private keysHeld: Set<string> = new Set();
  private jumpPressedEdge = false;
  private inputSeq = 0;

  // Key event listeners callbacks
  public onToggleCamera?: () => void;
  public onResetBall?: () => void;
  public onResetCar?: () => void;
  public onToggleUnlimitedBoost?: () => void;
  public onLaunchBall?: () => void;
  public onPracticeShot?: () => void;
  public onTogglePause?: () => void;

  constructor() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // Prevent default scrolling for game keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }

    if (!this.keysHeld.has(e.code)) {
      this.keysHeld.add(e.code);

      // Edge triggers
      if (e.code === 'Space') {
        this.jumpPressedEdge = true;
      } else if (e.code === 'KeyC') {
        this.onToggleCamera?.();
      } else if (e.code === 'KeyR') {
        this.onResetBall?.();
      } else if (e.code === 'Backspace') {
        this.onResetCar?.();
      } else if (e.code === 'KeyU') {
        this.onToggleUnlimitedBoost?.();
      } else if (e.code === 'Digit1') {
        this.onLaunchBall?.();
      } else if (e.code === 'Digit2') {
        this.onPracticeShot?.();
      } else if (e.code === 'Escape') {
        this.onTogglePause?.();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keysHeld.delete(e.code);
  };

  private handleBlur = () => {
    this.clearAll();
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.clearAll();
    }
  };

  public clearAll(): void {
    this.keysHeld.clear();
    this.jumpPressedEdge = false;
  }

  public sampleInput(): PlayerInput {
    let throttle = 0;
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) throttle += 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) throttle -= 1;

    let steer = 0;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) steer += 1;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) steer -= 1;

    let roll = 0;
    if (this.keysHeld.has('KeyE')) roll += 1;
    if (this.keysHeld.has('KeyQ')) roll -= 1;

    const jump = this.jumpPressedEdge;
    this.jumpPressedEdge = false; // Consume edge trigger

    const jumpHeld = this.keysHeld.has('Space');
    const boost = this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight');
    const powerslide = this.keysHeld.has('ControlLeft') || this.keysHeld.has('ControlRight');

    return {
      seq: ++this.inputSeq,
      timestamp: Date.now(),
      throttle,
      steer,
      pitch: throttle, // Default air-pitch mapping to throttle (W/S)
      yaw: steer,       // Default air-yaw mapping to steer (A/D)
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
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
