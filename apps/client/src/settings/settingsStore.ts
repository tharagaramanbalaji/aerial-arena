import { CAMERA_CONFIG } from '@aerial-arena/shared';
import { CarLook, DEFAULT_LOOK } from '../renderer/carLook.js';

/** Rebindable keyboard actions. Values are KeyboardEvent.code strings. */
export const ACTIONS = [
  { id: 'throttle', label: 'Throttle / nose down', group: 'Driving' },
  { id: 'reverse', label: 'Brake & reverse / nose up', group: 'Driving' },
  { id: 'steerLeft', label: 'Steer left / yaw left', group: 'Driving' },
  { id: 'steerRight', label: 'Steer right / yaw right', group: 'Driving' },
  { id: 'jump', label: 'Jump / flip', group: 'Driving' },
  { id: 'boost', label: 'Boost', group: 'Driving' },
  { id: 'powerslide', label: 'Powerslide / free air roll', group: 'Driving' },
  { id: 'airRollLeft', label: 'Air roll left', group: 'Driving' },
  { id: 'airRollRight', label: 'Air roll right', group: 'Driving' },
  { id: 'ballCam', label: 'Ball Cam', group: 'Camera & menus' },
  { id: 'menu', label: 'Menu', group: 'Camera & menus' },
  { id: 'lookLeft', label: 'Look left', group: 'Camera & menus' },
  { id: 'lookRight', label: 'Look right', group: 'Camera & menus' },
  { id: 'lookBehind', label: 'Look behind', group: 'Camera & menus' },
  { id: 'help', label: 'Show / hide controls card', group: 'Camera & menus' },
  { id: 'resetBall', label: 'Reset ball', group: 'Free Play' },
  { id: 'resetCar', label: 'Reset car', group: 'Free Play' },
  { id: 'unlimitedBoost', label: 'Toggle unlimited boost', group: 'Free Play' },
  { id: 'popBall', label: 'Pop ball up', group: 'Free Play' },
  { id: 'lobBall', label: 'Lob ball toward me', group: 'Free Play' },
  { id: 'ballOnHood', label: 'Ball on hood', group: 'Free Play' },
] as const;

export type ActionId = (typeof ACTIONS)[number]['id'];
/** Up to two keys per action (primary, secondary). */
export type Keybinds = Record<ActionId, string[]>;

export const DEFAULT_KEYBINDS: Keybinds = {
  throttle: ['KeyW', 'ArrowUp'],
  reverse: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  // Not Ctrl: Ctrl+W (throttle) closes the browser tab and cannot be intercepted.
  powerslide: ['KeyX', 'AltLeft'],
  airRollLeft: ['KeyQ'],
  airRollRight: ['KeyE'],
  ballCam: ['KeyC'],
  menu: ['Escape'],
  help: ['KeyH'],
  resetBall: ['KeyR'],
  resetCar: ['Backspace'],
  unlimitedBoost: ['KeyU'],
  popBall: ['Digit1'],
  lobBall: ['Digit2'],
  ballOnHood: ['Digit3'],
  lookLeft: ['KeyZ'],
  lookRight: ['KeyV'],
  lookBehind: ['KeyB'],
};

/** RL-style camera settings (presentation only). */
export interface CameraSettings {
  fov: number; // horizontal degrees
  distance: number; // m behind the car
  height: number; // m above the car
  angle: number; // degrees, negative looks down
  swivelSpeed: number; // RL 1..10: how fast the camera turns (follow + manual look)
  ballCamMaxPitch: number; // degrees the view may tilt up toward a high ball
  shake: boolean;
  ballCamMode: 'toggle' | 'hold';
}

export const DEFAULT_CAMERA: CameraSettings = {
  fov: CAMERA_CONFIG.horizontalFovDeg,
  distance: CAMERA_CONFIG.distance,
  height: CAMERA_CONFIG.height,
  angle: CAMERA_CONFIG.pitchDeg,
  swivelSpeed: 5.2,
  ballCamMaxPitch: CAMERA_CONFIG.ballCamMaxPitchDeg,
  shake: false, // off by default: keeps the view calm
  ballCamMode: 'toggle',
};

export interface Settings {
  keybinds: Keybinds;
  camera: CameraSettings;
  invertAirPitch: boolean; // air pitch only; never affects ground steering/throttle
  volume: number;
  car: CarLook;
}

const STORAGE_KEY = 'aerial-arena-settings-v1';

function defaults(): Settings {
  return {
    keybinds: structuredClone(DEFAULT_KEYBINDS),
    camera: { ...DEFAULT_CAMERA },
    invertAirPitch: false,
    volume: 0.5,
    car: { ...DEFAULT_LOOK },
  };
}

/** Loads/saves settings in localStorage (per browser); every access is guarded. */
class SettingsStore {
  private data: Settings = defaults();
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        const d = defaults();
        const kb = { ...d.keybinds, ...(parsed.keybinds ?? {}) };
        // Migrate the old Ctrl powerslide default (Ctrl+W closes the tab).
        if (kb.powerslide.some((c) => c === 'ControlLeft' || c === 'ControlRight')) kb.powerslide = [...d.keybinds.powerslide];
        this.data = {
          keybinds: kb,
          camera: { ...d.camera, ...(parsed.camera ?? {}) },
          invertAirPitch: parsed.invertAirPitch ?? d.invertAirPitch,
          volume: parsed.volume ?? d.volume,
          car: { ...d.car, ...(parsed.car ?? {}) },
        };
      }
    } catch {
      this.data = defaults();
    }
  }

  get(): Settings {
    return this.data;
  }

  update(mutate: (s: Settings) => void): void {
    mutate(this.data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: settings still apply for this session */
    }
    for (const l of this.listeners) l(this.data);
  }

  /** Bind `code` to `action` in `slot` (0 primary, 1 secondary), removing it from other actions. */
  bind(action: ActionId, slot: number, code: string): void {
    this.update((s) => {
      for (const id of Object.keys(s.keybinds) as ActionId[]) {
        s.keybinds[id] = s.keybinds[id].filter((c) => c !== code);
      }
      const keys = [...s.keybinds[action]];
      keys[slot] = code;
      s.keybinds[action] = keys.filter(Boolean).slice(0, 2);
    });
  }

  resetKeybinds(): void {
    this.update((s) => {
      s.keybinds = structuredClone(DEFAULT_KEYBINDS);
    });
  }

  resetCamera(): void {
    this.update((s) => {
      s.camera = { ...DEFAULT_CAMERA };
    });
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new SettingsStore();

/** Human-readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  const map: Record<string, string> = {
    Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Mouse')) return code;
  return code;
}
