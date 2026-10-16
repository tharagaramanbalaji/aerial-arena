import { BOOST_GRADIENTS, CarLook, LOOK_OPTIONS, TEAM_BOOST } from '../renderer/carLook.js';
import { settings } from '../settings/settingsStore.js';

const LABELS: Record<string, string> = {
  gloss: 'Gloss', matte: 'Matte', metallic: 'Metallic', pearl: 'Pearl',
  sport: 'Sport 5', mesh: 'Mesh', turbine: 'Turbine', dish: 'Dish',
  street: 'Street', offroad: 'Off-road', slick: 'Slick',
  stripe: 'Side stripe', racing: 'Racing stripes', none: 'None',
  team: 'Team', inferno: 'Inferno', neon: 'Neon', synthwave: 'Synthwave', toxic: 'Toxic', ice: 'Ice',
};

/** Garage: customise the player's car. Changes save immediately and the showcase car rebuilds live. */
export class GaragePanel {
  readonly el = document.createElement('div');

  constructor(onClose: () => void) {
    this.el.className = 'garage panel interactive hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Garage');
    const swatches = (key: 'accent' | 'rimColor') =>
      LOOK_OPTIONS[key].map((c) => `<button class="swatch" data-key="${key}" data-val="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('');
    const chips = (key: keyof typeof LOOK_OPTIONS) =>
      (LOOK_OPTIONS[key] as string[])
        .map((v) => {
          const grad = key === 'boost' ? (v === 'team' ? TEAM_BOOST.blue : BOOST_GRADIENTS[v as keyof typeof BOOST_GRADIENTS]) : null;
          const style = grad ? ` style="--g:linear-gradient(90deg, ${grad[0]}, ${grad[1]}, ${grad[2]})"` : '';
          return `<button class="chip${grad ? ' boost-chip' : ''}" data-key="${key}" data-val="${v}"${style}>${LABELS[v] ?? v}</button>`;
        })
        .join('');
    this.el.innerHTML = `
      <div class="title-sm">Garage</div>
      <div class="g-row"><span>Accent</span><div class="opts">${swatches('accent')}</div></div>
      <div class="g-row"><span>Paint finish</span><div class="opts">${chips('finish')}</div></div>
      <div class="g-row"><span>Decal</span><div class="opts">${chips('decal')}</div></div>
      <div class="g-row"><span>Rims</span><div class="opts">${chips('rimStyle')}</div></div>
      <div class="g-row"><span>Rim color</span><div class="opts">${swatches('rimColor')}</div></div>
      <div class="g-row"><span>Tires</span><div class="opts">${chips('tire')}</div></div>
      <div class="g-row"><span>Boost</span><div class="opts">${chips('boost')}</div></div>
      <p class="hint">Body color follows your team (blue / orange). Everything else is yours.</p>
      <button class="btn" data-close>Done</button>`;
    this.el.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.key as keyof CarLook;
        settings.update((s) => {
          (s.car as unknown as Record<string, string>)[key] = b.dataset.val!;
        });
        this.refresh();
      })
    );
    this.el.querySelector('[data-close]')!.addEventListener('click', onClose);
    this.refresh();
  }

  private refresh() {
    const car = settings.get().car as unknown as Record<string, string>;
    this.el.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) =>
      b.setAttribute('aria-pressed', String(car[b.dataset.key!] === b.dataset.val))
    );
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
  }
}
