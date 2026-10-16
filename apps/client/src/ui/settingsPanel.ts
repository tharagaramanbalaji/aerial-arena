import { ACTIONS, ActionId, CameraSettings, keyLabel, settings } from '../settings/settingsStore.js';

export interface SettingsPanelHooks {
  /** Capture the next key/mouse press (null = cancelled). */
  captureKey: (cb: (code: string | null) => void) => void;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => boolean;
}

type Slider = { key: keyof CameraSettings; label: string; min: number; max: number; step: number; unit: string; digits: number };

const CAMERA_SLIDERS: Slider[] = [
  { key: 'fov', label: 'Field of view', min: 60, max: 110, step: 1, unit: '°', digits: 0 },
  { key: 'distance', label: 'Distance', min: 1.0, max: 4.0, step: 0.05, unit: ' m', digits: 2 },
  { key: 'height', label: 'Height', min: 0.4, max: 2.0, step: 0.05, unit: ' m', digits: 2 },
  { key: 'angle', label: 'Angle', min: -15, max: 0, step: 0.5, unit: '°', digits: 1 },
  { key: 'swivelSpeed', label: 'Swivel speed', min: 1, max: 10, step: 0.1, unit: '', digits: 1 },
  { key: 'ballCamMaxPitch', label: 'Ball Cam max tilt', min: 0, max: 45, step: 1, unit: '°', digits: 0 },
];

/**
 * Settings modal content: Controls (rebindable keys), Camera, Gameplay & Audio.
 * Everything persists through the settings store and applies immediately.
 */
export class SettingsPanel {
  readonly el: HTMLDivElement;
  private capturing: HTMLButtonElement | null = null;

  constructor(private hooks: SettingsPanelHooks) {
    this.el = document.createElement('div');
    this.el.className = 'settings-body';
    this.render();
    settings.subscribe(() => this.refresh());
  }

  private render() {
    const groups = [...new Set(ACTIONS.map((a) => a.group))];
    const rows = groups
      .map(
        (g) => `<tr class="grp"><td colspan="3">${g}</td></tr>` +
          ACTIONS.filter((a) => a.group === g)
            .map(
              (a) => `<tr><td>${a.label}</td>
                <td><button class="bind" data-action="${a.id}" data-slot="0"></button></td>
                <td><button class="bind" data-action="${a.id}" data-slot="1"></button></td></tr>`
            )
            .join('')
      )
      .join('');
    const sliders = CAMERA_SLIDERS.map(
      (s) => `<label class="slider-row"><span>${s.label}</span>
        <input type="range" data-cam="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
        <output data-cam-out="${s.key}"></output></label>`
    ).join('');
    this.el.innerHTML = `
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="controls" aria-selected="true">Controls</button>
        <button role="tab" data-tab="camera" aria-selected="false">Camera</button>
        <button role="tab" data-tab="game" aria-selected="false">Gameplay &amp; Audio</button>
      </div>
      <section data-pane="controls">
        <p class="hint">Click a binding, then press a key or mouse button. Esc cancels. A key can only belong to one action.</p>
        <table class="binds"><thead><tr><th>Action</th><th>Primary</th><th>Secondary</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="hint">Gamepad (fixed): RT/LT drive · left stick steer &amp; pitch · A jump · B boost · X powerslide/air roll · Y camera · LB/RB air roll · Start menu</p>
        <button class="btn ghost" data-reset="keys">Reset controls to defaults</button>
      </section>
      <section data-pane="camera" class="hidden">
        ${sliders}
        <label class="row">Camera shake <input type="checkbox" data-cam-bool="shake" /></label>
        <label class="row">Ball Cam button
          <select data-cam-select="ballCamMode"><option value="toggle">Toggle</option><option value="hold">Hold</option></select>
        </label>
        <button class="btn ghost" data-reset="camera">Reset camera to defaults</button>
      </section>
      <section data-pane="game" class="hidden">
        <label class="row">Invert air pitch (air only, never ground driving) <input type="checkbox" data-invert /></label>
        <label class="slider-row"><span>Volume</span><input type="range" data-volume min="0" max="1" step="0.05" /><output data-volume-out></output></label>
        <button class="btn ghost" data-mute>Mute</button>
      </section>`;

    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
        this.el.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
      })
    );
    this.el.querySelectorAll<HTMLButtonElement>('button.bind').forEach((b) =>
      b.addEventListener('click', () => this.startCapture(b))
    );
    this.el.querySelectorAll<HTMLInputElement>('[data-cam]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const key = inp.dataset.cam as keyof CameraSettings;
        settings.update((s) => {
          (s.camera as unknown as Record<string, number>)[key] = parseFloat(inp.value);
        });
      })
    );
    this.el.querySelector<HTMLInputElement>('[data-cam-bool="shake"]')!.addEventListener('change', (e) =>
      settings.update((s) => (s.camera.shake = (e.target as HTMLInputElement).checked))
    );
    this.el.querySelector<HTMLSelectElement>('[data-cam-select="ballCamMode"]')!.addEventListener('change', (e) =>
      settings.update((s) => (s.camera.ballCamMode = (e.target as HTMLSelectElement).value as 'toggle' | 'hold'))
    );
    this.el.querySelector<HTMLInputElement>('[data-invert]')!.addEventListener('change', (e) =>
      settings.update((s) => (s.invertAirPitch = (e.target as HTMLInputElement).checked))
    );
    const vol = this.el.querySelector<HTMLInputElement>('[data-volume]')!;
    vol.addEventListener('input', () => {
      const v = parseFloat(vol.value);
      settings.update((s) => (s.volume = v));
      this.hooks.onVolumeChange(v);
    });
    const mute = this.el.querySelector<HTMLButtonElement>('[data-mute]')!;
    mute.addEventListener('click', () => (mute.textContent = this.hooks.onToggleMute() ? 'Unmute' : 'Mute'));
    this.el.querySelector('[data-reset="keys"]')!.addEventListener('click', () => settings.resetKeybinds());
    this.el.querySelector('[data-reset="camera"]')!.addEventListener('click', () => settings.resetCamera());
    this.refresh();
  }

  private startCapture(b: HTMLButtonElement) {
    if (this.capturing) this.refresh();
    this.capturing = b;
    b.textContent = 'Press a key…';
    b.classList.add('capturing');
    this.hooks.captureKey((code) => {
      this.capturing = null;
      if (code) settings.bind(b.dataset.action as ActionId, Number(b.dataset.slot), code);
      this.refresh();
    });
  }

  /** True while waiting for a key, so Esc / clicks are not treated as menu actions. */
  get isCapturing(): boolean {
    return this.capturing !== null;
  }

  private refresh() {
    const s = settings.get();
    this.el.querySelectorAll<HTMLButtonElement>('button.bind').forEach((b) => {
      if (b === this.capturing) return;
      b.classList.remove('capturing');
      b.textContent = keyLabel(s.keybinds[b.dataset.action as ActionId][Number(b.dataset.slot)]);
    });
    for (const sl of CAMERA_SLIDERS) {
      const inp = this.el.querySelector<HTMLInputElement>(`[data-cam="${sl.key}"]`)!;
      const v = s.camera[sl.key] as number;
      if (document.activeElement !== inp) inp.value = String(v);
      this.el.querySelector<HTMLOutputElement>(`[data-cam-out="${sl.key}"]`)!.textContent = v.toFixed(sl.digits) + sl.unit;
    }
    this.el.querySelector<HTMLInputElement>('[data-cam-bool="shake"]')!.checked = s.camera.shake;
    this.el.querySelector<HTMLSelectElement>('[data-cam-select="ballCamMode"]')!.value = s.camera.ballCamMode;
    this.el.querySelector<HTMLInputElement>('[data-invert]')!.checked = s.invertAirPitch;
    const vol = this.el.querySelector<HTMLInputElement>('[data-volume]')!;
    vol.value = String(s.volume);
    this.el.querySelector<HTMLOutputElement>('[data-volume-out]')!.textContent = `${Math.round(s.volume * 100)}%`;
  }
}
